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

    def fake_earth(site, body_cfg, root):
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

    monkeypatch.setattr(pipeline, "earth_grid", fake_earth)
    monkeypatch.setattr(pipeline, "target_grid", fake_target)
    return tmp_path


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
