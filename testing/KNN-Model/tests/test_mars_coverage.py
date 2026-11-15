"""Mars support (MOLA target, Mars sites and missions) and multi-site coverage. No internet."""
import json
import math
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from affine import Affine
from rasterio.crs import CRS

import coverage
import pipeline
import sources
from helpers import bumpy, cratered
from mission import Mission, Requirement, parse_mission

ROOT = Path(__file__).resolve().parent.parent
ZIP = ROOT / "data" / "site_lists" / "usgs_known_terrestrial_analogs.zip"


# ------------------------------------------------------------------ config
def test_every_mission_parses_and_mars_missions_target_jezero():
    _, sites_cfg, missions = pipeline.load_config(ROOT)
    parsed = {n: parse_mission(n, r) for n, r in missions.items()}
    mars = {n: m for n, m in parsed.items() if m.body == "mars"}
    assert set(mars) == {"mars_landing_jezero", "mars_rover_jezero"}
    for m in mars.values():
        assert m.target == "jezero" and sites_cfg["targets"]["jezero"]["body"] == "mars"
        # 500 m pixels can't measure the 500 m roughness scale: it must never be weighted
        assert "rough_small" in m.ignored


def test_mars_site_list_has_baselines_controls_and_usgs_craters():
    _, sites_cfg, _ = pipeline.load_config(ROOT)
    sites = pipeline.earth_sites_for("mars", sites_cfg, ROOT)
    roles = pd.Series([s["role"] for s in sites]).value_counts()
    assert roles["baseline"] == 6 and roles["negative_control"] == 2
    assert roles["candidate"] >= 180                  # the USGS impact craters + the volcanic site
    names = [s["name"] for s in sites]
    assert len(names) == len(set(names))
    assert not any(n.startswith("grand_falls") for n in names if n != "grand_falls_dunes")  # = baseline


def test_mars_settings_read_a_coarser_copy_but_never_sharpen():
    settings, _, _ = pipeline.load_config(ROOT)
    for body, cfg in settings["bodies"].items():
        source_px = 30 * cfg["earth_read_coarsen"]    # Copernicus is 30 m
        assert source_px < cfg["resolution_m"], body       # we only ever average down
    assert 30 * settings["bodies"]["mars"]["earth_read_coarsen"] * 2 <= settings["bodies"]["mars"]["resolution_m"]
    assert len(settings["bodies"]["mars"]["cannot_reproduce"]) >= 4


# ------------------------------------------------------------------- MOLA
def test_read_mola_rejects_boxes_across_the_180_meridian():
    with pytest.raises(ValueError):
        sources.read_mola(179.5, 0, 180.5, 1)


def test_mars_target_grid_is_metric_and_centred(tmp_path, monkeypatch):
    """A fake MOLA strip (equirectangular metres) is resampled to 500 m on a local grid."""
    k = math.pi / 180 * sources.MARS_RADIUS_M
    eqc = CRS.from_proj4("+proj=eqc +R=3396190 +units=m +no_defs")
    seen = {}

    def fake_read(lon_min, lat_min, lon_max, lat_max):
        seen["box"] = (lon_min, lat_min, lon_max, lat_max)
        px = 463.0
        x0, y1 = lon_min * k, lat_max * k
        w, h = math.ceil((lon_max - lon_min) * k / px), math.ceil((lat_max - lat_min) * k / px)
        return cratered(max(w, h), px, seed=3)[:h, :w].astype("float32"), Affine(px, 0, x0, 0, -px, y1), eqc

    monkeypatch.setattr(sources, "read_mola", fake_read)
    settings, sites_cfg, _ = pipeline.load_config(ROOT)
    t = sites_cfg["targets"]["jezero"]
    z, tf, crs = pipeline.target_grid("jezero", t, settings["bodies"]["mars"], tmp_path)
    assert z.shape == (160, 160) and tf.a == 500                  # 80 km box at 500 m
    assert np.isfinite(z).mean() > 0.99
    lon_min, lat_min, lon_max, lat_max = seen["box"]
    assert lon_min < t["lon"] < lon_max and lat_min < t["lat"] < lat_max
    assert "aeqd" in crs.to_proj4()
    # cached: a second call doesn't read again
    seen.clear()
    pipeline.target_grid("jezero", t, settings["bodies"]["mars"], tmp_path)
    assert not seen


def test_mars_mission_end_to_end(tmp_path, monkeypatch):
    shutil.copytree(ROOT / "config", tmp_path / "config")
    (tmp_path / "data" / "site_lists").mkdir(parents=True)
    shutil.copy(ZIP, tmp_path / "data" / "site_lists")
    keep = {"badwater_basin", "kelso_dunes", "garden_city_kansas", "ames_iowa", "lonar", "sudbury"}
    real = pipeline.earth_sites_for
    monkeypatch.setattr(pipeline, "earth_sites_for",
                        lambda body, cfg, root: [s for s in real(body, cfg, root) if s["name"] in keep])
    utm = CRS.from_epsg(32611)
    tr = Affine(500, 0, 500000, 0, -500, 4000000)
    mars = CRS.from_proj4(sources.mars_local_crs(18.44, 77.45))

    def fake_earth(site, body_cfg, root, offline=False):
        flat = site["role"] == "negative_control"
        z = bumpy(120, 0.5, 1) if flat else cratered(120, 500, sum(map(ord, site["name"])), n_craters=20) * 3
        return z.astype("float32"), tr, utm

    monkeypatch.setattr(pipeline, "earth_grid", fake_earth)
    monkeypatch.setattr(pipeline, "target_grid", lambda n, t, b, r: (
        (cratered(160, 500, 7, n_craters=25) * 3).astype("float32"), Affine(500, 0, -40000, 0, -500, 40000), mars))
    monkeypatch.setattr(pipeline, "earth_landcover", lambda site, b, s, r, offline=False: (
        np.full((1500, 1500), 40 if site["role"] == "negative_control" else 60, "uint8"),
        Affine(40, 0, 500000, 0, -40, 4000000), utm))
    monkeypatch.setattr(pipeline, "earth_temperature", lambda *a: None)

    out = pipeline.run_mission("mars_landing_jezero", tmp_path, run_stability=False)
    summary = json.loads((out / "summary.json").read_text())
    assert summary["body"] == "mars" and summary["target_tiles"] == 16     # 80 km / 20 km tiles
    assert summary["tile_km"] == 20
    assert any("MOLA" in a for a in summary["attribution"])
    assert not any("Diviner" in a for a in summary["attribution"])
    text = (out / "report.md").read_text(encoding="utf-8")
    assert "## Multi-site coverage" in text and "Gravity: about 38%" in text
    cov = summary["multi_site_coverage"]
    assert cov["n_requirements"] == len(summary["weights_used"])           # no mandatory rules on Mars
    assert all(s["role"] != "negative_control" for s in cov["steps"])


# --------------------------------------------------------------- coverage
def _mission(mandatory=()):
    return Mission("m", "", "moon", "t", {"slope_mean": 1.0, "relief": 1.0}, [], {"tree_frac": {"max": 0.3}},
                   list(mandatory))


def _tiles(rows):
    base = {"tree_frac": 0.0, "cropland_frac": 0.0, "builtup_frac": 0.0, "snow_ice_frac": 0.0, "water_frac": 0.0}
    return pd.DataFrame([{**base, **r} for r in rows])


TARGET = pd.DataFrame({"slope_mean": np.linspace(10, 20, 11), "relief": np.linspace(100, 200, 11)})


def test_requirements_are_mandatory_rules_plus_target_ranges():
    reqs = coverage.requirements(_mission([Requirement("slope_mean", "max_abs_diff", 2.0, "deg")]), TARGET)
    ids = [q["id"] for q in reqs]
    assert ids == ["slope_mean_max_abs_diff", "slope_mean_in_target_range", "relief_in_target_range"]
    rng = reqs[1]
    assert rng["low"] == pytest.approx(11.0) and rng["high"] == pytest.approx(19.0)    # 10th-90th percentile
    assert rng["test"]({"slope_mean": 11.0}) and not rng["test"]({"slope_mean": 10.5})
    assert not rng["test"]({"slope_mean": np.nan})                                     # missing is not met


def test_greedy_needs_both_conditions_on_one_clean_tile():
    tiles = _tiles([
        # site A: slope on one tile, relief on ANOTHER -> never both together
        {"site": "a", "tile_id": "r0", "lat": 1, "lon": 1, "slope_mean": 15, "relief": 10},
        {"site": "a", "tile_id": "r1", "lat": 1, "lon": 1, "slope_mean": 1, "relief": 150},
        # site B: both on one tile, but it is a forest (interference) -> unusable
        {"site": "b", "tile_id": "r0", "lat": 2, "lon": 2, "slope_mean": 15, "relief": 150, "tree_frac": 0.9},
        # site C: relief only, clean
        {"site": "c", "tile_id": "r0", "lat": 3, "lon": 3, "slope_mean": 50, "relief": 150},
        # farmland control matching everything is never proposed
        {"site": "farm", "tile_id": "r0", "lat": 4, "lon": 4, "slope_mean": 15, "relief": 150},
    ])
    ranking = pd.DataFrame({"site": ["a", "b", "c", "farm"], "rank": [1, 2, 3, 4],
                            "role": ["candidate", "candidate", "baseline", "negative_control"]})
    cov = coverage.greedy_cover(tiles, ranking, _mission(), TARGET)
    assert [s["site"] for s in cov["steps"]] == ["a", "c"] or [s["site"] for s in cov["steps"]] == ["a"]
    first = cov["steps"][0]
    assert first["covered_so_far"] == 1                         # A covers one requirement per tile, not two
    assert all(s["site"] not in ("b", "farm") for s in cov["steps"])
    assert cov["n_requirements"] == 2


def test_greedy_reports_what_no_site_covers_and_prefers_better_rank_on_ties():
    tiles = _tiles([
        {"site": "x", "tile_id": "r0", "lat": 0, "lon": 0, "slope_mean": 15, "relief": 0},
        {"site": "y", "tile_id": "r0", "lat": 0, "lon": 0, "slope_mean": 15, "relief": 0},
    ])
    ranking = pd.DataFrame({"site": ["x", "y"], "rank": [2, 1], "role": ["candidate", "candidate"]})
    cov = coverage.greedy_cover(tiles, ranking, _mission(), TARGET)
    assert [s["site"] for s in cov["steps"]] == ["y"]           # tie -> better rank (1)
    assert len(cov["not_covered_by_any_site"]) == 1 and "Relief" in cov["not_covered_by_any_site"][0]
    md = "\n".join(coverage.markdown(cov))
    assert "Not covered by any Earth site" in md and "Relief" in md
