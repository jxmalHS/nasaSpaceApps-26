import urllib.error

import numpy as np
import pytest
from affine import Affine
from rasterio.crs import CRS

import sources
from preprocess import remove_spikes, snapped_box, to_metric_grid, utm_crs
from tiles import cut_tiles

UTM12 = CRS.from_epsg(32612)


def test_utm_zone():
    assert utm_crs(-111.0, 35.0).to_epsg() == 32612            # Arizona
    assert utm_crs(51.5, 25.3).to_epsg() == 32639              # Doha
    assert utm_crs(-70.0, -33.0).to_epsg() == 32719            # southern hemisphere


def test_box_is_snapped_to_pixels():
    x0, y0, x1, y1 = snapped_box(1234.0, 5678.0, 30000, 100)
    assert x0 % 100 == 0 and y0 % 100 == 0 and x1 - x0 == 30000


def test_resampling_averages_down():
    src = np.arange(16, dtype="float32").reshape(4, 4)         # 4x4 pixels of 50 m
    out, _ = to_metric_grid(src, Affine(50, 0, 0, 0, -50, 200), UTM12, UTM12, (0, 0, 200, 200), 100)
    assert out.shape == (2, 2)
    assert out[0, 0] == pytest.approx(np.mean([0, 1, 4, 5]))   # each 100 m pixel = mean of 4


def test_spike_removed_gaps_kept():
    z = np.zeros((20, 20), "float32")
    z[10, 10] = 5000                                            # an impossible spike
    z[0, 0] = np.nan
    cleaned, n = remove_spikes(z, threshold_m=300)
    assert n == 1 and np.isnan(cleaned[10, 10]) and np.isnan(cleaned[0, 0])
    assert np.isfinite(cleaned[5, 5])


def test_tiles_with_gaps_are_dropped_and_counted():
    z = np.zeros((100, 100), "float32")
    z[:50, :50] = np.nan                                        # one tile all missing
    tiles, dropped = cut_tiles(z, Affine(100, 0, 500000, 0, -100, 4000000), UTM12,
                               CRS.from_epsg(4326), 50, 0.05)
    assert dropped == 1 and len(tiles) == 3
    assert all(t["heights"].shape == (50, 50) for t in tiles)


def test_copernicus_tile_names():
    assert sources.copernicus_tile_name(35, -112) == "Copernicus_DSM_COG_10_N35_00_W112_00_DEM"
    assert sources.copernicus_tile_name(-5, 7) == "Copernicus_DSM_COG_10_S05_00_E007_00_DEM"


def test_ocean_tile_is_missing_but_network_error_raises(monkeypatch):
    def not_found(*a, **k):
        raise urllib.error.HTTPError("u", 404, "Not Found", None, None)
    monkeypatch.setattr(sources.urllib.request, "urlopen", not_found)
    assert sources.tile_exists("http://x") is False

    def offline(*a, **k):
        raise urllib.error.URLError("no network")
    monkeypatch.setattr(sources.urllib.request, "urlopen", offline)
    monkeypatch.setattr(sources.time, "sleep", lambda s: None)
    with pytest.raises(ConnectionError):                        # never mistaken for "ocean"
        sources.tile_exists("http://x")
