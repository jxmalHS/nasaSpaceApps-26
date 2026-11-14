"""
landcover.py - Earth-only "test spoiler" conditions from ESA WorldCover 2021 (10 m).

Things like trees, crops, snow or water can ruin a terrain test (they hide or
change the ground). For every tile we measure what share of it is covered by
each kind of land. These numbers are NOT used for similarity - the Moon has no
trees - they are checked against the mission's limits and reported as flags.

Class codes come from the legend stored inside the WorldCover files:
    10 Tree cover, 20 Shrubland, 30 Grassland, 40 Cropland, 50 Built-up,
    60 Bare/sparse vegetation, 70 Snow and ice, 80 Permanent water bodies,
    90 Herbaceous wetland, 95 Mangroves, 100 Moss and lichen.   (0 = no data)

Licence: CC-BY 4.0, credit line in WORLDCOVER_NOTICE.
"""
from __future__ import annotations

import math

import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.warp import reproject

from sources import HTTP_ENV, tile_exists

WORLDCOVER_URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
                  "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif")
WORLDCOVER_NOTICE = ("© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) "
                     "processed by ESA WorldCover consortium (CC-BY 4.0)")

# Which WorldCover classes count towards each condition.
CLASS_GROUPS = {
    "tree_frac": [10, 95],              # trees, mangroves
    "cropland_frac": [40],
    "grass_shrub_frac": [20, 30, 90, 100],
    "builtup_frac": [50],
    "bare_frac": [60],
    "snow_ice_frac": [70],
    "water_frac": [80],
}
LANDCOVER_FEATURES = list(CLASS_GROUPS)


def worldcover_tile_name(lat: float, lon: float) -> str:
    """WorldCover files are 3x3 degree squares named by their south-west corner."""
    la, lo = 3 * math.floor(lat / 3), 3 * math.floor(lon / 3)
    return f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}"


def read_worldcover(lon_min: float, lat_min: float, lon_max: float, lat_max: float, coarsen: int = 4):
    """Stream land-cover classes for a lon/lat box. Returns None if no file covers it.

    coarsen=4 reads the file's built-in 40 m copy instead of 10 m (16x less data).
    Each 5 km tile still gets ~15,000 pixels, plenty to estimate shares.
    """
    names = {worldcover_tile_name(la, lo)
             for la in (lat_min, lat_max) for lo in (lon_min, lon_max)}
    urls = [WORLDCOVER_URL.format(tile=n) for n in sorted(names)]
    urls = [u for u in urls if tile_exists(u)]
    if not urls:
        return None
    with rasterio.Env(**HTTP_ENV, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        srcs = [rasterio.open("/vsicurl/" + u) for u in urls]
        try:
            res = tuple(r * coarsen for r in srcs[0].res)
            classes, transform = merge(srcs, bounds=(lon_min, lat_min, lon_max, lat_max),
                                       res=res, nodata=0, dtype="uint8")
            crs = srcs[0].crs
        finally:
            for s in srcs:
                s.close()
    return classes[0], transform, crs


def to_metric_classes(classes, src_transform, src_crs, dst_crs, box, res: float):
    """Move class codes onto the metric grid. 'Nearest' keeps codes as codes (no averaging)."""
    x_min, y_min, x_max, y_max = box
    out = np.zeros((round((y_max - y_min) / res), round((x_max - x_min) / res)), dtype="uint8")
    dst_transform = Affine(res, 0, x_min, 0, -res, y_max)
    reproject(source=classes, destination=out, src_transform=src_transform, src_crs=src_crs,
              src_nodata=0, dst_transform=dst_transform, dst_crs=dst_crs, dst_nodata=0,
              resampling=Resampling.nearest)
    return out, dst_transform


def tile_fractions(block: np.ndarray, max_missing: float) -> dict[str, float]:
    """Share of the tile (0-1) covered by each condition. NaN = unknown (too little data)."""
    valid = block != 0
    if valid.size == 0 or 1 - valid.mean() > max_missing:
        return {f: float("nan") for f in LANDCOVER_FEATURES}
    vals = block[valid]
    return {f: float(np.isin(vals, codes).mean()) for f, codes in CLASS_GROUPS.items()}


def check_limits(values: dict[str, float], limits: dict[str, dict]) -> tuple[list[str], list[str]]:
    """Compare a tile's shares with the mission limits.

    Returns (flagged conditions, unknown conditions). Unknown is never a pass.
    """
    flagged, unknown = [], []
    for feat, lim in limits.items():
        v = values.get(feat, float("nan"))
        if v is None or not np.isfinite(v):
            unknown.append(feat)
        elif ("max" in lim and v > lim["max"]) or ("min" in lim and v < lim["min"]):
            flagged.append(feat)
    return flagged, unknown
