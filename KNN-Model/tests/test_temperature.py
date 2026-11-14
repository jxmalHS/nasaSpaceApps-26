"""Temperature group: unit handling, annual range, per-tile summaries (no internet)."""
import numpy as np
import pytest
from affine import Affine
from rasterio.crs import CRS

import temperature


def test_modis_integers_become_kelvin_and_fill_is_missing():
    raw = np.array([[0, 15000], [14000, 25000]], dtype="uint16")   # 0 = no data; 25000 * 0.02 = 500 K
    k = temperature.to_kelvin(raw)
    assert np.isnan(k[0, 0]) and k[0, 1] == pytest.approx(300.0) and k[1, 0] == pytest.approx(280.0)
    assert np.isnan(k[1, 1])                                         # 500 K is impossible -> error


def test_annual_range_is_hottest_day_minus_coldest_night():
    tr, crs = Affine(0.01, 0, 0, 0, -0.01, 1), CRS.from_epsg(4326)
    day = [(np.full((2, 2), 300.0), tr, crs), (np.full((2, 2), 320.0), tr, crs)]
    night = [(np.full((2, 2), 270.0), tr, crs), (np.full((2, 2), 260.0), tr, crs)]
    rng, _, _ = temperature.earth_range_from_layers(day, night)
    assert (rng == 60.0).all()
    assert temperature.earth_range_from_layers([], night) is None


def test_tile_summary_mean_spread_and_count():
    block = np.array([[50.0, 70.0], [np.nan, 60.0]])
    t = temperature.tile_temperature(block)
    assert t["temp_range_mean"] == pytest.approx(60.0) and t["temp_pixels"] == 3
    assert np.isnan(temperature.tile_temperature(np.full((2, 2), np.nan))["temp_range_mean"])


def test_credentials_message_when_not_logged_in(monkeypatch, tmp_path):
    monkeypatch.setattr(temperature.Path, "home", lambda: tmp_path)
    with pytest.raises(RuntimeError, match="earthaccess"):
        temperature._credentials()
