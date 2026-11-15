import numpy as np

from landcover import check_limits, tile_fractions, worldcover_tile_name


def test_worldcover_tile_names():
    assert worldcover_tile_name(35.0, -111.0) == "N33W111"     # 3x3 degree squares, SW corner
    assert worldcover_tile_name(35.0, -110.5) == "N33W111"
    assert worldcover_tile_name(-2.0, 7.0) == "S03E006"


def test_fractions():
    block = np.array([[40, 40], [60, 80]], dtype="uint8")        # cropland, cropland, bare, water
    f = tile_fractions(block, max_missing=0.05)
    assert f["cropland_frac"] == 0.5 and f["bare_frac"] == 0.25 and f["water_frac"] == 0.25
    assert f["tree_frac"] == 0


def test_mostly_missing_tile_is_unknown():
    block = np.zeros((10, 10), "uint8")                          # 0 = no data
    block[0, 0] = 40
    assert all(np.isnan(v) for v in tile_fractions(block, 0.05).values())


def test_limits_flag_and_unknown():
    limits = {"cropland_frac": {"max": 0.2}, "water_frac": {"max": 0.05}, "tree_frac": {"max": 0.3}}
    flagged, unknown = check_limits({"cropland_frac": 0.9, "water_frac": 0.0, "tree_frac": float("nan")}, limits)
    assert flagged == ["cropland_frac"] and unknown == ["tree_frac"]
