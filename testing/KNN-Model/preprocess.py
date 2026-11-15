"""
preprocess.py - put elevation data on a clean, common grid.

    1. Choose a map projection in METRES for the area (local UTM zone on Earth;
       LOLA is already in metres).
    2. Resample to the agreed pixel size by AVERAGING (only ever make pixels
       bigger, never smaller - sharpening would invent detail).
    3. Remove obvious errors ("spikes"): pixels far above/below their neighbours.

Missing pixels stay NaN. Nothing is ever filled in with guesses.
"""
from __future__ import annotations

import math

import numpy as np
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform as warp_transform, transform_bounds
from scipy import ndimage


def utm_crs(lon: float, lat: float) -> CRS:
    """The WGS84 UTM zone containing a point (zones are 6 degrees wide)."""
    zone = min(max(int((lon + 180) // 6) + 1, 1), 60)
    return CRS.from_epsg((32600 if lat >= 0 else 32700) + zone)


def snapped_box(cx: float, cy: float, box_m: float, res: float) -> tuple[float, float, float, float]:
    """A square box of side box_m centred on (cx, cy), corners snapped to the pixel size."""
    half = box_m / 2
    x_min = math.floor((cx - half) / res) * res
    y_min = math.floor((cy - half) / res) * res
    return x_min, y_min, x_min + box_m, y_min + box_m


def earth_box(lon: float, lat: float, box_km: float, res: float):
    """Metric box around an Earth point, plus the lon/lat box we need to read to cover it."""
    crs = utm_crs(lon, lat)
    xs, ys = warp_transform(CRS.from_epsg(4326), crs, [lon], [lat])
    box = snapped_box(xs[0], ys[0], box_km * 1000, res)
    lon_min, lat_min, lon_max, lat_max = transform_bounds(crs, CRS.from_epsg(4326), *box, densify_pts=21)
    pad = 0.005  # ~500 m extra so edge pixels have source data around them
    return crs, box, (lon_min - pad, lat_min - pad, lon_max + pad, lat_max + pad)


def to_metric_grid(heights: np.ndarray, src_transform, src_crs, dst_crs,
                   box: tuple[float, float, float, float], res: float) -> tuple[np.ndarray, Affine]:
    """Resample heights onto a res x res metre grid covering box, by averaging."""
    x_min, y_min, x_max, y_max = box
    width, height = round((x_max - x_min) / res), round((y_max - y_min) / res)
    dst_transform = Affine(res, 0, x_min, 0, -res, y_max)
    out = np.full((height, width), np.nan, dtype="float32")
    reproject(
        source=heights.astype("float32"), destination=out,
        src_transform=src_transform, src_crs=src_crs, src_nodata=np.nan,
        dst_transform=dst_transform, dst_crs=dst_crs, dst_nodata=np.nan,
        resampling=Resampling.average,   # each new pixel = mean of the old pixels inside it
    )
    return out, dst_transform


def remove_spikes(z: np.ndarray, threshold_m: float, window_px: int = 5) -> tuple[np.ndarray, int]:
    """Turn pixels that differ from their neighbourhood median by more than threshold_m into NaN.

    Real terrain changes gradually at 100 m+ pixels; a single pixel hundreds of
    metres off its neighbours is almost always a data error. Returns the cleaned
    array and how many pixels were removed.
    """
    valid = np.isfinite(z)
    if not valid.any():
        return z, 0
    # The median filter can't skip NaN, so gaps are temporarily given the overall
    # median just for this comparison. The gaps themselves stay NaN in the output.
    filled = np.where(valid, z, np.nanmedian(z))
    med = ndimage.median_filter(filled, size=window_px, mode="nearest")
    spikes = valid & (np.abs(z - med) > threshold_m)
    cleaned = z.copy()
    cleaned[spikes] = np.nan
    return cleaned, int(spikes.sum())
