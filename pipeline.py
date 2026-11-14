"""
pipeline.py - run one mission end to end:

    sites -> stream elevation -> clean -> tiles -> terrain features -> kNN -> results

Downloaded/resampled grids are cached in data/cache/ so re-runs don't stream again.
"""
from __future__ import annotations

import json
import logging
import math
import re
import struct
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import yaml
from affine import Affine
from rasterio.crs import CRS

import sources
from analog_knn import run_knn
from features import FEATURES, tile_features
from preprocess import earth_box, remove_spikes, snapped_box, to_metric_grid
from tiles import cut_tiles

log = logging.getLogger("pipeline")
GEO_CRS = {"earth": CRS.from_epsg(4326), "moon": CRS.from_proj4("+proj=longlat +R=1737400 +no_defs")}


# ------------------------------------------------------------------ config
def load_config(root: Path) -> tuple[dict, dict, dict]:
    read = lambda name: yaml.safe_load((root / "config" / name).read_text(encoding="utf-8"))  # noqa: E731
    return read("settings.yaml"), read("sites.yaml"), read("missions.yaml")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def distance_km(lat1, lon1, lat2, lon2) -> float:
    """Great-circle distance on Earth (haversine formula)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def read_usgs_analog_list(zip_path: Path) -> list[dict]:
    """Read the USGS analog-site table (.dbf inside the zip) with the standard library only."""
    raw = zipfile.ZipFile(zip_path).read("TerrestrialAnalogs/TerrestrialAnalogs.dbf")
    n_rec, hdr_len, rec_len = struct.unpack("<IHH", raw[4:12])
    fields, pos = [], 32
    while raw[pos] != 0x0D:                                    # field descriptors end with 0x0D
        fields.append((raw[pos:pos + 11].split(b"\0")[0].decode(), raw[pos + 16]))
        pos += 32
    rows = []
    for i in range(n_rec):
        rec = raw[hdr_len + i * rec_len: hdr_len + (i + 1) * rec_len]
        if rec[:1] == b"*":                                    # deleted record
            continue
        off, row = 1, {}
        for name, length in fields:
            row[name] = rec[off:off + length].decode("utf-8", "replace").strip()
            off += length
        rows.append(row)
    return rows


def earth_sites_for(body: str, sites_cfg: dict, root: Path) -> list[dict]:
    """Baselines + negative controls from sites.yaml, plus candidates from the USGS list."""
    sites = [dict(s) for s in sites_cfg["earth_sites"] if s["compare_with"] == body]
    baselines = [s for s in sites if s["role"] == "baseline"]
    for spec in sites_cfg.get("candidate_lists", []):
        if spec["compare_with"] != body:
            continue
        names = {s["name"] for s in sites}
        for row in read_usgs_analog_list(root / spec["file"]):
            if row["AnalogType"] != spec["analog_type"]:
                continue
            lat, lon = float(row["Lat"]), float(row["Lon"])
            # Skip entries that are really one of our baselines (e.g. Barringer = Meteor Crater).
            if any(distance_km(lat, lon, b["lat"], b["lon"]) < 5 for b in baselines):
                continue
            name = slug(row["Name"])
            while name in names:
                name += "_2"
            names.add(name)
            sites.append({"name": name, "role": spec["role"], "compare_with": body, "lat": lat,
                          "lon": lon, "source": f"{spec['source']}, entry '{row['Name']}'"})
    return sites


# ------------------------------------------------------------------- grids
def _cache_path(root: Path, body: str, name: str, res: float, box_km: float) -> Path:
    return root / "data" / "cache" / body / f"{name}_{res:g}m_{box_km:g}km.npz"


def _save(path: Path, z, transform, crs) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, z=z, transform=np.array(transform)[:6], crs=crs.to_wkt())


def _load(path: Path):
    d = np.load(path)
    return d["z"], Affine(*d["transform"]), CRS.from_wkt(str(d["crs"]))


def earth_grid(site: dict, body_cfg: dict, root: Path):
    """Cleaned-to-be metric grid for one Earth site (streamed once, then cached)."""
    res, box_km = body_cfg["resolution_m"], body_cfg["earth_box_km"]
    path = _cache_path(root, "earth", site["name"], res, box_km)
    if path.exists():
        return _load(path)
    crs, box, lonlat = earth_box(site["lon"], site["lat"], box_km, res)
    got = sources.read_copernicus(*lonlat)
    if got is None:                                            # all ocean: keep an all-NaN grid
        n = round(box_km * 1000 / res)
        z, transform = np.full((n, n), np.nan, "float32"), Affine(res, 0, box[0], 0, -res, box[3])
    else:
        z, transform = to_metric_grid(*got, crs, box, res)
    _save(path, z, transform, crs)
    return z, transform, crs


def target_grid(name: str, target: dict, body_cfg: dict, root: Path):
    """Metric grid for the planetary target (streamed once, then cached)."""
    res = body_cfg["resolution_m"]
    path = _cache_path(root, target["body"], name, res, target["box_km"])
    if path.exists():
        return _load(path)
    if target["dataset"] != "lola_south_pole_20m":
        raise NotImplementedError(f"No reader for dataset '{target['dataset']}' yet")
    box = snapped_box(*target["center_xy_m"], target["box_km"] * 1000, res)
    heights, transform, crs = sources.read_lola(*box)
    z, transform = to_metric_grid(heights, transform, crs, crs, box, res)
    _save(path, z, transform, crs)
    return z, transform, crs


# ------------------------------------------------------------------- tiles
def grid_to_rows(name: str, role: str, z, transform, crs, geo_crs, body_cfg: dict,
                 settings: dict) -> tuple[list[dict], dict]:
    """Clean a grid, cut it into tiles and measure each tile."""
    res = body_cfg["resolution_m"]
    z, n_spikes = remove_spikes(z, settings["spike_threshold_m"])
    tile_px = round(body_cfg["tile_km"] * 1000 / res)
    tiles, dropped = cut_tiles(z, transform, crs, geo_crs, tile_px, settings["max_missing_frac"])
    rows = [{"site": name, "role": role, "tile_id": t["tile_id"], "lat": t["lat"], "lon": t["lon"],
             "missing_frac": t["missing_frac"], **tile_features(t["heights"], res, settings["terrain"])}
            for t in tiles]
    return rows, {"site": name, "tiles_kept": len(rows), "tiles_dropped": dropped, "spike_pixels": n_spikes}


# ----------------------------------------------------------------- mission
def run_mission(mission_name: str, root: Path) -> Path:
    settings, sites_cfg, missions = load_config(root)
    mission = missions[mission_name]
    body = mission["body"]
    body_cfg = settings["bodies"][body]

    # 1. Target
    log.info("Target %s: reading (cached after first run)", mission["target"])
    target = sites_cfg["targets"][mission["target"]]
    z, tr, crs = target_grid(mission["target"], target, body_cfg, root)
    rows, stats = grid_to_rows(mission["target"], "target", z, tr, crs, GEO_CRS[body], body_cfg, settings)
    all_stats, failed = [stats], []

    # 2. Earth sites, streamed a few at a time
    earth = earth_sites_for(body, sites_cfg, root)
    log.info("%d Earth sites to process", len(earth))

    def work(site):
        z, tr, crs = earth_grid(site, body_cfg, root)
        return grid_to_rows(site["name"], site["role"], z, tr, crs, GEO_CRS["earth"], body_cfg, settings)

    with ThreadPoolExecutor(max_workers=settings.get("workers", 4)) as pool:
        futures = {pool.submit(work, s): s for s in earth}
        for i, fut in enumerate(as_completed(futures), 1):
            site = futures[fut]
            try:
                site_rows, stats = fut.result()
                rows += site_rows
                all_stats.append(stats)
            except Exception as exc:                            # one bad site must not stop the run
                failed.append({"site": site["name"], "error": str(exc)[:200]})
                log.warning("  %s failed: %s", site["name"], exc)
            if i % 10 == 0 or i == len(earth):
                log.info("  %d/%d sites done", i, len(earth))

    table = pd.DataFrame(rows)

    # 3. Use only weighted features that actually have data (e.g. roughness under 3 px is NaN)
    weights = {f: w for f, w in mission["weights"].items()
               if table.loc[table.role == "target", f].notna().any()
               and table.loc[table.role != "target", f].notna().any()}
    skipped_features = sorted(set(mission["weights"]) - set(weights))

    # 4. kNN
    knn = settings["knn"]
    result = run_knn(table, weights, k=knn["k"], site_quantile=knn["site_quantile"])
    info = pd.DataFrame(earth).set_index("name")[["lat", "lon", "source"]]
    ranking = result.sites.join(info, on="site")

    out = root / "results" / mission_name
    out.mkdir(parents=True, exist_ok=True)
    ranking.to_csv(out / "ranking.csv", index=False)
    result.tiles.to_csv(out / "tiles.csv", index=False)
    table[table.role == "target"].to_csv(out / "target_tiles.csv", index=False)
    stats_df = pd.DataFrame(all_stats)
    stats_df.to_csv(out / "site_stats.csv", index=False)
    summary = {"mission": mission_name, "body": body, "weights_used": result.weights,
               "features_skipped_no_data": skipped_features, "k": result.k,
               "target_tiles": int((table.role == "target").sum()),
               "earth_sites_ranked": int(len(ranking)), "earth_sites_failed": failed,
               "earth_sites_no_usable_tiles": stats_df.loc[stats_df.tiles_kept == 0, "site"].tolist(),
               "attribution": [sources.COPERNICUS_NOTICE]}
    (out / "summary.json").write_text(json.dumps(summary, indent=2, default=float), encoding="utf-8")
    return out
