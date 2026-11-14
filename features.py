"""
features.py - describe the SHAPE of the ground in one tile with a few numbers.

Absolute height is never used (the Moon, Mars and Earth measure height from
different reference levels). Every number below only depends on height
DIFFERENCES inside the tile, so adding a constant to all heights changes nothing.

    slope_mean, slope_std, slope_p90  - how steep (degrees)
    frac_steep                        - share of the tile steeper than steep_slope_deg
    relief                            - highest minus lowest point (m)
    hypsometric_integral              - 0..1, is the tile mostly high ground or low ground?
    rough_small, rough_large          - bumpiness after removing the overall tilt (m),
                                        at two scales; only if the scale is >= 3 pixels
    curvature_abs_mean                - how curved the surface is (1/km)
    pit_density                       - crater-like dips per km^2 (a rough crater proxy)
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

FEATURES = ["slope_mean", "slope_std", "slope_p90", "frac_steep", "relief", "hypsometric_integral",
            "rough_small", "rough_large", "curvature_abs_mean", "pit_density"]
MIN_ROUGHNESS_PX = 3   # roughness measured over fewer pixels than this is meaningless


def slope_deg(z: np.ndarray, px: float) -> np.ndarray:
    """Slope of every pixel in degrees, from the height change to its neighbours."""
    dz_dy, dz_dx = np.gradient(z, px)
    return np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))


def roughness(z: np.ndarray, px: float, scale_m: float) -> float:
    """Average bumpiness in square blocks of scale_m, after removing each block's tilt.

    In every block we fit a flat (tilted) plane and measure how far the ground
    sits above/below it (standard deviation, metres). A smooth slope scores ~0.
    Returns NaN if the scale is under MIN_ROUGHNESS_PX pixels or larger than the tile.
    """
    b = int(round(scale_m / px))
    if b < MIN_ROUGHNESS_PX or b > min(z.shape):
        return float("nan")
    nr, nc = z.shape[0] // b, z.shape[1] // b
    blocks = z[: nr * b, : nc * b].reshape(nr, b, nc, b).swapaxes(1, 2).reshape(nr * nc, b * b)
    blocks = blocks[np.isfinite(blocks).all(axis=1)]          # only complete blocks
    if len(blocks) == 0:
        return float("nan")
    yy, xx = np.mgrid[0:b, 0:b]
    a = np.column_stack([xx.ravel(), yy.ravel(), np.ones(b * b)])
    plane = a @ np.linalg.pinv(a)                               # fits the best plane to any block
    resid = blocks - blocks @ plane.T
    return float(np.mean(np.sqrt((resid ** 2).sum(axis=1) / (b * b - 3))))


def curvature_abs_mean(z: np.ndarray, px: float) -> float:
    """Mean absolute curvature (second derivative of height), in 1/km."""
    dz_dy, dz_dx = np.gradient(z, px)
    lap = np.gradient(dz_dx, px, axis=1) + np.gradient(dz_dy, px, axis=0)
    return float(np.nanmean(np.abs(lap)) * 1000) if np.isfinite(lap).any() else float("nan")


def pit_density(z: np.ndarray, px: float, window_m: float, min_depth_m: float) -> float:
    """Number of separate dips deeper than min_depth_m below the local average, per km^2."""
    w = max(3, int(round(window_m / px)) | 1)      # odd window size in pixels
    local_mean = ndimage.uniform_filter(z, size=w, mode="nearest")
    with np.errstate(invalid="ignore"):
        pits = ((local_mean - z) > min_depth_m) & np.isfinite(local_mean) & np.isfinite(z)
    _, n = ndimage.label(pits)                     # count connected groups of dip pixels
    area_km2 = np.isfinite(z).sum() * (px / 1000) ** 2
    return float(n / area_km2) if area_km2 > 0 else float("nan")


def tile_features(z: np.ndarray, px: float, cfg: dict) -> dict[str, float]:
    """All terrain features for one tile. Missing pixels (NaN) are ignored."""
    z = z.astype("float64")
    s = slope_deg(z, px)
    s, zv = s[np.isfinite(s)], z[np.isfinite(z)]
    if s.size == 0 or zv.size == 0:
        return {f: float("nan") for f in FEATURES}
    lo, hi = float(zv.min()), float(zv.max())
    relief = hi - lo
    scales = cfg["roughness_scales_m"]
    return {
        "slope_mean": float(s.mean()),
        "slope_std": float(s.std()),
        "slope_p90": float(np.percentile(s, 90)),
        "frac_steep": float((s > cfg["steep_slope_deg"]).mean()),
        "relief": relief,
        "hypsometric_integral": (float(zv.mean()) - lo) / relief if relief > 0 else float("nan"),
        "rough_small": roughness(z, px, scales["rough_small"]),
        "rough_large": roughness(z, px, scales["rough_large"]),
        "curvature_abs_mean": curvature_abs_mean(z, px),
        "pit_density": pit_density(z, px, cfg["pit"]["window_m"], cfg["pit"]["min_depth_m"]),
    }
