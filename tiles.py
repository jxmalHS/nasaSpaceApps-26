"""
tiles.py - cut a cleaned elevation grid into equal square tiles.

Tiles with too much missing data (sea, gaps, removed spikes) are dropped and
COUNTED, never patched up.
"""
from __future__ import annotations

import numpy as np
from rasterio.warp import transform as warp_transform


def cut_tiles(z: np.ndarray, transform, crs, geo_crs, tile_px: int,
              max_missing: float) -> tuple[list[dict], int]:
    """Split z into tile_px x tile_px tiles. Returns (kept tiles, number dropped).

    Each kept tile is a dict with its id, centre (map metres and lon/lat),
    share of missing pixels, and the height array itself.
    """
    h, w = z.shape
    kept, dropped = [], 0
    for r0 in range(0, h - tile_px + 1, tile_px):
        for c0 in range(0, w - tile_px + 1, tile_px):
            block = z[r0:r0 + tile_px, c0:c0 + tile_px]
            missing = float(np.isnan(block).mean())
            if missing > max_missing:
                dropped += 1
                continue
            x, y = transform @ (c0 + tile_px / 2, r0 + tile_px / 2)   # pixel -> map coordinates
            kept.append({"tile_id": f"r{r0:04d}c{c0:04d}", "x": x, "y": y,
                         "missing_frac": missing, "heights": block})
    if kept:
        lons, lats = warp_transform(crs, geo_crs, [t["x"] for t in kept], [t["y"] for t in kept])
        for t, lon, lat in zip(kept, lons, lats):
            t["lon"], t["lat"] = lon, lat
    return kept, dropped
