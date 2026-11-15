"""
tiles.py - cut a cleaned grid into equal square tiles.

Tiles with too much missing data (sea, gaps, removed spikes) are dropped and
COUNTED, never patched up.

Tile ids are the tile's row/column position (e.g. "r02c04"), not pixel numbers,
so grids with different pixel sizes over the same box (terrain at 100 m,
land cover at 40 m) give the same id to the same piece of ground.
"""
from __future__ import annotations

from collections.abc import Iterator

import numpy as np
from rasterio.warp import transform as warp_transform


def tile_blocks(arr: np.ndarray, tile_px: int,
                offset_px: int = 0) -> Iterator[tuple[str, int, int, np.ndarray]]:
    """Yield (tile_id, first_row, first_col, block) for every full tile in arr.
    offset_px shifts the whole tile grid (used to check results don't depend on where tiles start)."""
    h, w = arr.shape
    for i, r0 in enumerate(range(offset_px, h - tile_px + 1, tile_px)):
        for j, c0 in enumerate(range(offset_px, w - tile_px + 1, tile_px)):
            yield f"r{i:02d}c{j:02d}", r0, c0, arr[r0:r0 + tile_px, c0:c0 + tile_px]


def cut_tiles(z: np.ndarray, transform, crs, geo_crs, tile_px: int,
              max_missing: float, offset_px: int = 0) -> tuple[list[dict], int]:
    """Split z into tile_px x tile_px tiles. Returns (kept tiles, number dropped).

    Each kept tile is a dict with its id, centre (map metres and lon/lat),
    share of missing pixels, and the height array itself.
    """
    kept, dropped = [], 0
    for tile_id, r0, c0, block in tile_blocks(z, tile_px, offset_px):
        missing = float(np.isnan(block).mean())
        if missing > max_missing:
            dropped += 1
            continue
        x, y = transform @ (c0 + tile_px / 2, r0 + tile_px / 2)   # pixel -> map coordinates
        kept.append({"tile_id": tile_id, "x": x, "y": y, "missing_frac": missing, "heights": block})
    if kept:
        lons, lats = warp_transform(crs, geo_crs, [t["x"] for t in kept], [t["y"] for t in kept])
        for t, lon, lat in zip(kept, lons, lats):
            t["lon"], t["lat"] = lon, lat
    return kept, dropped
