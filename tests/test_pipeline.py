"""End-to-end pipeline test with the streaming replaced by made-up terrain."""
import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from affine import Affine
from rasterio.crs import CRS

import pipeline
from helpers import bumpy, cratered

ROOT = Path(__file__).resolve().parent.parent
ZIP = ROOT / "data" / "baselines" / "KnownTerrestria.zip"


def test_usgs_list_reads_192_sites():
    rows = pipeline.read_usgs_analog_list(ZIP)
    assert len(rows) == 192
    assert {"Name", "AnalogType", "Lat", "Lon", "AnalogBody"} <= set(rows[0])


def test_baseline_duplicates_are_not_candidates():
    _, sites_cfg, _ = pipeline.load_config(ROOT)
    sites = pipeline.earth_sites_for("moon", sites_cfg, ROOT)
    names = [s["name"] for s in sites]
    assert len(names) == len(set(names))
    assert not any("barringer" in n for n in names)            # = Meteor Crater baseline


@pytest.fixture
def fake_project(tmp_path, monkeypatch):
    """Copy the config, keep only a few sites, and replace streaming with made-up grids."""
    shutil.copytree(ROOT / "config", tmp_path / "config")
    (tmp_path / "data" / "baselines").mkdir(parents=True)
    shutil.copy(ZIP, tmp_path / "data" / "baselines")
    keep = {"meteor_crater", "buffalo_park", "garden_city_kansas", "ames_iowa",
            "lonar", "sudbury", "chesapeake_bay"}
    real = pipeline.earth_sites_for
    monkeypatch.setattr(pipeline, "earth_sites_for",
                        lambda body, cfg, root: [s for s in real(body, cfg, root) if s["name"] in keep])

    utm = CRS.from_epsg(32612)
    tr = Affine(100, 0, 500000, 0, -100, 4000000)

    def fake_earth(site, body_cfg, root, offline=False):
        seed = sum(map(ord, site["name"]))
        if site["role"] == "negative_control":
            z = bumpy(300, 0.5, seed)                          # flat farmland
        elif site["name"] == "chesapeake_bay":
            z = np.full((300, 300), np.nan, "float32")         # all sea
        else:
            z = cratered(300, 100, seed)
        return z.astype("float32"), tr, utm

    def fake_target(name, target, body_cfg, root):
        z = cratered(400, 100, seed=99)
        moon = CRS.from_proj4("+proj=stere +lat_0=-90 +lon_0=0 +R=1737400 +units=m +no_defs")
        return z.astype("float32"), Affine(100, 0, -20000, 0, -100, 20000), moon

    def fake_landcover(site, body_cfg, settings, root, offline=False):
        if site["name"] == "buffalo_park":
            raise ConnectionError("no network")               # land cover fails -> flags unknown
        code = 40 if site["role"] == "negative_control" else 60   # farmland = cropland, else bare
        return np.full((750, 750), code, "uint8"), tr, utm

    def fake_target_temp(name, target, body_cfg, settings, root, offline):
        moon = CRS.from_proj4("+proj=stere +lat_0=-90 +lon_0=0 +R=1737400 +units=m +no_defs")
        return np.full((40, 40), 200.0, "float32"), Affine(1000, 0, -20000, 0, -1000, 20000), moon

    def fake_earth_temp(site, body_cfg, settings, root):
        if site["name"] == "lonar":
            return None                                         # no temperature yet -> incomplete
        swing = 30.0 if site["role"] == "negative_control" else 70.0
        return np.full((30, 30), swing, "float32"), Affine(1000, 0, 500000, 0, -1000, 4000000), utm

    monkeypatch.setattr(pipeline, "earth_grid", fake_earth)
    monkeypatch.setattr(pipeline, "target_grid", fake_target)
    monkeypatch.setattr(pipeline, "earth_landcover", fake_landcover)
    monkeypatch.setattr(pipeline, "target_temperature", fake_target_temp)
    monkeypatch.setattr(pipeline, "earth_temperature", fake_earth_temp)
    return tmp_path


def test_terrain_plus_temperature_mission(fake_project):
    out = pipeline.run_mission("lunar_rover_thermal_terrain", fake_project, run_stability=False)
    ranking = pd.read_csv(out / "ranking.csv")
    summary = json.loads((out / "summary.json").read_text())
    assert "temp_range_mean" in summary["weights_used"]
    # a site without temperature is NOT ranked on terrain alone - it is reported as incomplete
    assert "lonar" not in set(ranking["site"])
    assert {"site": "lonar", "missing": ["temp_range_mean"]} in summary["earth_sites_incomplete"]
    assert "lonar (temp_range_mean)" in (out / "report.md").read_text(encoding="utf-8")
    # farmland has a small temperature swing AND flat terrain -> bottom half
    assert summary["checks"]["negative_controls"]["status"] == "PASS"
    # the temperature rule (swing >= 60 K) is evaluated with real-unit values
    site = json.loads((out / "sites" / "meteor_crater.json").read_text())
    rule = next(r for r in site["requirements"] if r["requirement"].startswith("temp_range_mean"))
    assert rule["status"] == "met" and rule["value"] == pytest.approx(70.0)


def test_run_mission_end_to_end(fake_project):
    out = pipeline.run_mission("lunar_surface_mobility", fake_project)
    ranking = pd.read_csv(out / "ranking.csv")
    summary = json.loads((out / "summary.json").read_text())

    assert summary["target_tiles"] == 64                       # 40 km box, 5 km tiles
    assert "chesapeake_bay" in summary["earth_sites_no_usable_tiles"]
    assert "chesapeake_bay" not in set(ranking["site"])
    controls = ranking[ranking["role"] == "negative_control"]["rank"]
    assert (controls > len(ranking) / 2).all()                 # farmland ranks in the bottom half
    assert {"lat", "lon", "source", "best_tile_lat"} <= set(ranking.columns)
    assert "Copernicus" in summary["attribution"][0]


def test_interference_flags(fake_project):
    out = pipeline.run_mission("lunar_surface_mobility", fake_project)
    r = pd.read_csv(out / "ranking.csv", keep_default_na=False).set_index("site")
    assert r.loc["garden_city_kansas", "interference_flags"] == "cropland_frac"
    assert r.loc["meteor_crater", "interference_flags"] == ""        # bare ground: clear
    assert "tree_frac" in r.loc["buffalo_park", "interference_unknown"]   # no data -> unknown, not pass


def test_step5_report_outputs(fake_project):
    out = pipeline.run_mission("lunar_surface_mobility", fake_project)
    r = pd.read_csv(out / "ranking.csv")
    summary = json.loads((out / "summary.json").read_text())
    # requirements: every site has a verdict for each of the 3 mandatory rules
    assert ((r.req_met + r.req_not_met + r.req_unknown) == 3).all()
    # confidence from the stability check
    assert r["confidence"].between(0, 1).all()
    assert set(r["confidence_label"]) <= {"high", "medium", "low"}
    assert summary["checks"]["stability"]["n_variants"] == 2 * 6 + 2
    assert summary["checks"]["negative_controls"]["status"] == "PASS"
    # per-site file: differences in real units + what Earth can't reproduce
    site = json.loads((out / "sites" / "meteor_crater.json").read_text())
    assert any("than the target" in d["statement"] for d in site["differences_from_target"])
    assert site["cannot_reproduce_on_earth"] and site["disclaimer"]
    assert "Gravity" in (out / "report.md").read_text(encoding="utf-8")
    # consumer charts
    assert (out / "ranking.png").stat().st_size > 10_000
    top = pd.read_csv(out / "ranking.csv")["site"].head(3)
    assert all((out / f"closeness_{s}.png").exists() for s in top)


def test_offline_mode_skips_sites_not_downloaded(fake_project, monkeypatch):
    real = pipeline.earth_grid

    def only_meteor(site, body_cfg, root, offline=False):
        if site["name"] != "meteor_crater" and offline:
            raise FileNotFoundError("not downloaded yet (offline mode)")
        return real(site, body_cfg, root, offline)
    monkeypatch.setattr(pipeline, "earth_grid", only_meteor)
    out = pipeline.run_mission("lunar_surface_mobility", fake_project, offline=True, run_stability=False)
    assert list(pd.read_csv(out / "ranking.csv")["site"]) == ["meteor_crater"]


def test_interference_ranks_below_clean_sites(fake_project):
    """Clean sites first, then unknown land cover, then sites over a limit; the kNN-only
    order is kept as similarity_rank."""
    out = pipeline.run_mission("lunar_surface_mobility", fake_project)
    r = pd.read_csv(out / "ranking.csv")
    assert list(r["rank"]) == list(range(1, len(r) + 1))
    assert r["interference_level"].is_monotonic_increasing
    assert set(r.tail(2)["site"]) == {"garden_city_kansas", "ames_iowa"}     # cropland: last
    assert sorted(r["similarity_rank"]) == list(range(1, len(r) + 1))


def test_candidates_scored_only_on_usable_tiles(fake_project):
    """A forested candidate is judged on its clear tiles only; NASA sites and farmland
    (yardsticks) keep every tile."""
    settings, _, missions = pipeline.load_config(fake_project)
    mission = pipeline.parse_mission("lunar_surface_mobility", missions["lunar_surface_mobility"])
    t = pd.DataFrame({"site": ["forest"] * 3 + ["nasa", "farm"], "tile_id": ["a", "b", "c", "a", "a"],
                      "role": ["candidate"] * 3 + ["baseline", "negative_control"],
                      "tree_frac": [0.9, 0.95, 0.1, 0.9, 0.0], "cropland_frac": [0, 0, 0, 0, 0.9]})
    blocked = pipeline.interference_blocked(t, mission)
    assert blocked == {("forest", "a"), ("forest", "b")}
    kept = pipeline.drop_blocked(t, blocked)
    assert list(kept["site"]) == ["forest", "nasa", "farm"] and kept.iloc[0]["tile_id"] == "c"
