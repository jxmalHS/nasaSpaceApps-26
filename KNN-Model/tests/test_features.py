import numpy as np
import pytest

from features import roughness, tile_features
from helpers import bumpy, cratered

PX = 100.0
CFG = {"steep_slope_deg": 15, "roughness_scales_m": {"rough_small": 500, "rough_large": 2500},
       "pit": {"window_m": 1000, "min_depth_m": 5}}


def test_tilted_plane():
    yy, xx = np.mgrid[0:50, 0:50] * PX
    f = tile_features(0.1 * xx, PX, CFG)                       # rises 10 m every 100 m
    assert f["slope_mean"] == pytest.approx(np.degrees(np.arctan(0.1)))
    assert f["rough_small"] == pytest.approx(0, abs=1e-6)      # a smooth slope is not "rough"
    assert f["frac_steep"] == 0


def test_absolute_height_never_matters():
    z = cratered(50, PX, seed=0)
    a, b = tile_features(z, PX, CFG), tile_features(z + 5000, PX, CFG)
    for k in a:
        assert a[k] == pytest.approx(b[k], abs=1e-9), k


def test_craters_are_rougher_than_plains():
    c = tile_features(cratered(50, PX, seed=1), PX, CFG)
    p = tile_features(bumpy(50, 1, seed=1), PX, CFG)
    for k in ("slope_mean", "slope_p90", "rough_small", "rough_large", "relief"):
        assert c[k] > p[k], k


def test_roughness_needs_at_least_3_pixels():
    z = bumpy(40, 10, seed=2)
    assert np.isnan(roughness(z, 500.0, 500))                  # 1 pixel -> not measured
    assert np.isfinite(roughness(z, 500.0, 1500))              # 3 pixels -> measured


def test_missing_pixels_are_ignored():
    z = bumpy(50, 10, seed=3)
    z[:2, :2] = np.nan
    assert all(np.isfinite(v) for v in tile_features(z, PX, CFG).values())
