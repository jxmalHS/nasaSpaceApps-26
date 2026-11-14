"""
pipeline.py - run one mission through all 5 steps:

    1. mission     sort every condition into target / ignored / interference (mission.py)
    2. Moon        LOLA elevation -> tiles -> terrain numbers
    3. Earth       Copernicus elevation (+ WorldCover land cover) -> same numbers, same scale
    4. rank        weighted kNN, compared with the Moon target and NASA's baseline sites
    5. report      coverage, requirements, interference, confidence, what Earth can't reproduce

Streamed grids are cached in data/cache/ so re-runs don't stream again.
"""
from __future__ import annotations

import logging
import math
import os
import re
import struct
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import yaml
from affine import Affine
from rasterio.crs import CRS

import charts
import landcover
import report
import sources
import temperature
import validation
from analog_knn import run_knn
from features import tile_features
from mission import MET, NOT_MET, UNKNOWN, Mission, parse_mission
from preprocess import earth_box, remove_spikes, snapped_box, to_metric_grid
from tiles import cut_tiles, tile_blocks

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
    """Write to a temporary file first, then rename: a stopped run never leaves a half-written cache."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".tmp.npz")
    np.savez_compressed(tmp, z=z, transform=np.array(transform)[:6], crs=crs.to_wkt())
    os.replace(tmp, path)


def _load(path: Path):
    d = np.load(path)
    return d["z"], Affine(*d["transform"]), CRS.from_wkt(str(d["crs"]))


def earth_grid(site: dict, body_cfg: dict, root: Path, offline: bool = False):
    """Metric elevation grid for one Earth site (streamed once, then cached)."""
    res, box_km = body_cfg["resolution_m"], body_cfg["earth_box_km"]
    path = _cache_path(root, "earth", site["name"], res, box_km)
    if path.exists():
        return _load(path)
    if offline:
        raise FileNotFoundError("not downloaded yet (offline mode)")
    crs, box, lonlat = earth_box(site["lon"], site["lat"], box_km, res)
    got = sources.read_copernicus(*lonlat)
    if got is None:                                            # all ocean: keep an all-NaN grid
        n = round(box_km * 1000 / res)
        z, transform = np.full((n, n), np.nan, "float32"), Affine(res, 0, box[0], 0, -res, box[3])
    else:
        z, transform = to_metric_grid(*got, crs, box, res)
    _save(path, z, transform, crs)
    return z, transform, crs


def earth_landcover(site: dict, body_cfg: dict, settings: dict, root: Path, offline: bool = False):
    """Land-cover classes for one Earth site on the same box as its terrain (cached)."""
    lc_res, box_km = settings["landcover"]["resolution_m"], body_cfg["earth_box_km"]
    path = _cache_path(root, "earth", site["name"] + "_landcover", lc_res, box_km)
    if path.exists():
        return _load(path)
    if offline:
        raise FileNotFoundError("land cover not downloaded yet (offline mode)")
    crs, box, lonlat = earth_box(site["lon"], site["lat"], box_km, body_cfg["resolution_m"])
    got = landcover.read_worldcover(*lonlat, coarsen=settings["landcover"]["coarsen"])
    if got is None:
        n = round(box_km * 1000 / lc_res)
        classes, transform = np.zeros((n, n), "uint8"), Affine(lc_res, 0, box[0], 0, -lc_res, box[3])
    else:
        classes, transform = landcover.to_metric_classes(*got, crs, box, lc_res)
    _save(path, classes, transform, crs)
    return classes, transform, crs


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


def coarsen_grid(z: np.ndarray, transform, factor: int):
    """Make pixels `factor` times bigger by averaging (used for the stability check).
    A bigger pixel touching any gap becomes a gap (no guessing)."""
    if factor == 1:
        return z, transform
    h, w = (z.shape[0] // factor) * factor, (z.shape[1] // factor) * factor
    out = z[:h, :w].reshape(h // factor, factor, w // factor, factor).mean(axis=(1, 3))
    return out, transform @ Affine.scale(factor)


# ------------------------------------------------------------------- tiles
def grid_to_rows(name: str, role: str, z, transform, crs, geo_crs, body_cfg: dict, settings: dict,
                 factor: int = 1, offset_frac: float = 0.0) -> tuple[list[dict], dict]:
    """Clean a grid, cut it into tiles and measure each tile (terrain numbers)."""
    z, transform = coarsen_grid(z, transform, factor)
    res = body_cfg["resolution_m"] * factor
    z, n_spikes = remove_spikes(z, settings["spike_threshold_m"])
    tile_px = round(body_cfg["tile_km"] * 1000 / res)
    tiles, dropped = cut_tiles(z, transform, crs, geo_crs, tile_px, settings["max_missing_frac"],
                               offset_px=round(offset_frac * tile_px))
    rows = [{"site": name, "role": role, "tile_id": t["tile_id"], "lat": t["lat"], "lon": t["lon"],
             "missing_frac": t["missing_frac"], **tile_features(t["heights"], res, settings["terrain"])}
            for t in tiles]
    return rows, {"site": name, "tiles_kept": len(rows), "tiles_dropped": dropped, "spike_pixels": n_spikes}


def landcover_by_tile(classes, body_cfg: dict, settings: dict) -> dict[str, dict]:
    """Land-cover shares for every tile, keyed by tile id (same ids as the terrain tiles)."""
    tile_px = round(body_cfg["tile_km"] * 1000 / settings["landcover"]["resolution_m"])
    return {tid: landcover.tile_fractions(block, settings["max_missing_frac"])
            for tid, _, _, block in tile_blocks(classes, tile_px)}


# -------------------------------------------------------------- temperature
def target_temperature(name: str, target: dict, body_cfg: dict, settings: dict, root: Path, offline: bool):
    """Moon annual temperature range on a 1 km grid over the target box (cached). None if unavailable."""
    res = settings["temperature"]["resolution_m"]
    path = _cache_path(root, target["body"], name + "_temprange", res, target["box_km"])
    if path.exists():
        return _load(path)
    if offline:
        return None
    box = snapped_box(*target["center_xy_m"], target["box_km"] * 1000, body_cfg["resolution_m"])
    grid, transform, crs = temperature.moon_range(box, res)
    _save(path, grid, transform, crs)
    return grid, transform, crs


def earth_temperature(site: dict, body_cfg: dict, settings: dict, root: Path):
    """Earth annual temperature range for a site, from the cache only (see download_temperature)."""
    path = _cache_path(root, "earth", site["name"] + "_temprange",
                       settings["temperature"]["resolution_m"], body_cfg["earth_box_km"])
    return _load(path) if path.exists() else None


def temperature_by_tile(grid, body_cfg: dict, settings: dict, offset_frac: float = 0.0) -> dict[str, dict]:
    """Temperature mean / spread / pixel count per tile, keyed by tile id."""
    tile_px = round(body_cfg["tile_km"] * 1000 / settings["temperature"]["resolution_m"])
    return {tid: temperature.tile_temperature(block)
            for tid, _, _, block in tile_blocks(grid, tile_px, round(offset_frac * tile_px))}


def download_temperature(mission_name: str, root: Path) -> list[str]:
    """Fetch MODIS temperature (via AppEEARS) for every downloaded Earth site that lacks it."""
    settings, sites_cfg, missions = load_config(root)
    mission = parse_mission(mission_name, missions[mission_name])
    body_cfg, tcfg = settings["bodies"][mission.body], settings["temperature"]
    todo, boxes = {}, {}
    for s in earth_sites_for(mission.body, sites_cfg, root):
        have_dem = _cache_path(root, "earth", s["name"], body_cfg["resolution_m"], body_cfg["earth_box_km"]).exists()
        if have_dem and earth_temperature(s, body_cfg, settings, root) is None:
            crs, box, lonlat = earth_box(s["lon"], s["lat"], body_cfg["earth_box_km"], body_cfg["resolution_m"])
            todo[s["name"]], boxes[s["name"]] = (crs, box), lonlat
    if not todo:
        log.info("All downloaded sites already have temperature data")
        return []
    token, tasks = temperature.submit_tasks(boxes, tcfg["year"])
    done = []
    for name, task_id in tasks.items():
        try:
            temperature.wait_for(token, task_id, max_wait_s=tcfg["max_wait_s"])
            layers = temperature.read_task(token, task_id)
            got = temperature.earth_range_from_layers(layers["LST_Day_1km"], layers["LST_Night_1km"])
            if got is None:
                raise ValueError("no temperature files in the AppEEARS result")
            crs, box = todo[name]
            grid, transform = temperature.to_grid(got[0], got[1], got[2], crs, box, tcfg["resolution_m"])
            _save(_cache_path(root, "earth", name + "_temprange", tcfg["resolution_m"],
                              body_cfg["earth_box_km"]), grid, transform, crs)
            done.append(name)
            log.info("  temperature saved: %s", name)
        except Exception as exc:
            log.warning("  %s: temperature failed: %s", name, exc)
    return done


# ------------------------------------------------------------------- steps
@dataclass
class Inputs:
    """Everything loaded for one mission (all grids are on metric grids, from the cache or streamed)."""
    target: tuple                      # (heights, transform, crs)
    target_temp: tuple | None          # (annual temperature range, transform, crs) or None
    earth: list[dict]                  # Earth site descriptions
    grids: dict[str, tuple]            # site -> elevation grid
    covers: dict[str, dict]            # site -> {tile_id: land-cover shares}
    temps: dict[str, tuple]            # site -> temperature grid (missing = no data)
    failed: list[dict]


def load_grids(mission: Mission, settings: dict, sites_cfg: dict, root: Path, offline: bool) -> Inputs:
    """Steps 2-3 (data part): get every grid, streaming only what isn't cached yet."""
    body_cfg = settings["bodies"][mission.body]
    log.info("Target %s: reading (cached after first run)", mission.target)
    target = sites_cfg["targets"][mission.target]
    target_g = target_grid(mission.target, target, body_cfg, root)
    try:
        target_t = target_temperature(mission.target, target, body_cfg, settings, root, offline)
    except Exception as exc:
        log.warning("Moon temperature unavailable (%s) -> unknown", exc)
        target_t = None

    earth = earth_sites_for(mission.body, sites_cfg, root)
    log.info("%d Earth sites to process", len(earth))
    grids, covers, failed = {}, {}, []

    def work(site):
        g = earth_grid(site, body_cfg, root, offline)
        try:                                       # land cover is extra: if it fails, flags are "unknown"
            c = landcover_by_tile(earth_landcover(site, body_cfg, settings, root, offline)[0], body_cfg, settings)
        except Exception as exc:
            log.warning("  %s: land cover unavailable (%s) -> unknown", site["name"], exc)
            c = {}
        return g, c

    with ThreadPoolExecutor(max_workers=settings.get("workers", 4)) as pool:
        futures = {pool.submit(work, s): s for s in earth}
        for i, fut in enumerate(as_completed(futures), 1):
            site = futures[fut]
            try:
                grids[site["name"]], covers[site["name"]] = fut.result()
            except Exception as exc:                   # one bad site must not stop the run
                failed.append({"site": site["name"], "error": str(exc)[:200]})
                log.warning("  %s skipped: %s", site["name"], exc)
            if i % 10 == 0 or i == len(earth):
                log.info("  %d/%d sites done", i, len(earth))
    temps = {s["name"]: t for s in earth if (t := earth_temperature(s, body_cfg, settings, root)) is not None}
    return Inputs(target_g, target_t, earth, grids, covers, temps, failed)


def build_table(mission, settings, inp: Inputs, factor=1, offset_frac=0.0):
    """Turn every grid into tiles with terrain numbers, plus temperature (both worlds)
    and land-cover shares (Earth). Missing data stays NaN = unknown."""
    body_cfg = settings["bodies"][mission.body]
    no_temp = {"temp_range_mean": np.nan, "temp_range_std": np.nan, "temp_pixels": 0}
    no_cover = {f: np.nan for f in landcover.LANDCOVER_FEATURES}

    def add_temperature(rows, grid):
        temps = temperature_by_tile(grid[0], body_cfg, settings, offset_frac) if grid is not None else {}
        for r in rows:
            r.update(temps.get(r["tile_id"], no_temp))

    rows, stats = grid_to_rows(mission.target, "target", *inp.target, GEO_CRS[mission.body], body_cfg,
                               settings, factor, offset_frac)
    add_temperature(rows, inp.target_temp)
    all_stats = [stats]
    for site in inp.earth:
        if site["name"] not in inp.grids:
            continue
        site_rows, stats = grid_to_rows(site["name"], site["role"], *inp.grids[site["name"]], GEO_CRS["earth"],
                                        body_cfg, settings, factor, offset_frac)
        add_temperature(site_rows, inp.temps.get(site["name"]))
        if factor == 1 and offset_frac == 0:       # land cover only matters for the main run's report
            for r in site_rows:
                r.update(inp.covers[site["name"]].get(r["tile_id"], no_cover))
        rows += site_rows
        all_stats.append(stats)
    return pd.DataFrame(rows), pd.DataFrame(all_stats)


def rank(table: pd.DataFrame, weights: dict, settings: dict):
    """Step 4: weighted kNN, using only weighted features that actually have data."""
    if table.empty or not (table.role != "target").any():
        raise ValueError("No Earth site has usable data (all failed, not downloaded, or all sea)")
    usable = {f: w for f, w in weights.items()
              if f in table and table.loc[table.role == "target", f].notna().any()
              and table.loc[table.role != "target", f].notna().any()}
    skipped = sorted(set(weights) - set(usable))
    k = settings["knn"]
    return run_knn(table, usable, k=k["k"], site_quantile=k["site_quantile"]), skipped


def stability(mission, settings, base_sites, table, inp: Inputs) -> dict:
    """Confidence: change ONE thing at a time and see whether each site keeps its rank.

    Changes: each target weight +/-20%, pixels 2x bigger, tile grid shifted by half a tile.
    A site 'survives' a change if its rank moves by at most 5% of the number of sites (min 1).
    """
    cfg = settings["stability"]
    variants = []
    for f in mission.weights:
        for sign in (1, -1):
            w = dict(mission.weights)
            w[f] *= 1 + sign * cfg["weight_change"]
            variants.append((f"weight {f} {'+' if sign > 0 else '-'}{cfg['weight_change']:.0%}", table, w))
    fac = cfg["alt_resolution_factor"]
    variants.append((f"pixels x{fac}", build_table(mission, settings, inp, fac)[0], mission.weights))
    variants.append(("tiles shifted half a tile", build_table(mission, settings, inp, 1, 0.5)[0], mission.weights))

    base = base_sites.set_index("site")["rank"]
    tol = max(1, round(cfg["rank_tolerance_frac"] * len(base)))
    top5 = set(base_sites.nsmallest(5, "rank")["site"])
    results, survived = [], {s: 0 for s in base.index}
    for name, tab, w in variants:
        try:
            other = rank(tab, w, settings)[0].sites.set_index("site")["rank"]
        except ValueError as exc:
            results.append({"variant": name, "error": str(exc)})
            continue
        for s in base.index:
            if s in other.index and abs(other[s] - base[s]) <= tol:
                survived[s] += 1
        results.append({"variant": name, "top1_same": bool(other.idxmin() == base.idxmin()),
                        "top5_survivors": len(top5 & set(other.nsmallest(5).index))})
    n = len(variants)
    ok = [r for r in results if "error" not in r]
    return {"n_variants": n, "rank_tolerance": tol,
            "top1_unchanged_share": float(np.mean([r["top1_same"] for r in ok])) if ok else float("nan"),
            "mean_top5_survivors": float(np.mean([r["top5_survivors"] for r in ok])) if ok else float("nan"),
            "variants": results, "site_confidence": {s: survived[s] / n for s in base.index}}


def download_sites(mission_name: str, root: Path, count: int, seed: int = 42) -> list[str]:
    """Stream and cache the next `count` Earth sites that aren't downloaded yet.

    Order: NASA baselines and farmland controls first (needed for the checks), then
    candidate craters in a fixed random order (seeded, so every run picks the same ones).
    """
    settings, sites_cfg, missions = load_config(root)
    mission = parse_mission(mission_name, missions[mission_name])
    body_cfg = settings["bodies"][mission.body]
    earth = earth_sites_for(mission.body, sites_cfg, root)
    first = [s for s in earth if s["role"] != "candidate"]
    rest = [s for s in earth if s["role"] == "candidate"]
    rest = [rest[i] for i in np.random.default_rng(seed).permutation(len(rest))]
    todo = [s for s in first + rest
            if not _cache_path(root, "earth", s["name"], body_cfg["resolution_m"], body_cfg["earth_box_km"]).exists()
            ][:count]
    # Already-downloaded sites may still be missing their land cover: fetch that too.
    lc_missing = [s for s in earth
                  if _cache_path(root, "earth", s["name"], body_cfg["resolution_m"], body_cfg["earth_box_km"]).exists()
                  and not _cache_path(root, "earth", s["name"] + "_landcover",
                                      settings["landcover"]["resolution_m"], body_cfg["earth_box_km"]).exists()]
    log.info("Downloading %d new sites (+ land cover for %d already downloaded)", len(todo), len(lc_missing))

    def work(site):
        if site in todo:
            earth_grid(site, body_cfg, root)
        earth_landcover(site, body_cfg, settings, root)
        return site["name"]

    done = []
    with ThreadPoolExecutor(max_workers=settings.get("workers", 4)) as pool:
        futures = {pool.submit(work, s): s for s in todo + lc_missing}
        for fut in as_completed(futures):
            try:
                done.append(fut.result())
                log.info("  done: %s", done[-1])
            except Exception as exc:
                log.warning("  %s failed: %s", futures[fut]["name"], exc)
    return done


# ----------------------------------------------------------------- mission
def run_mission(mission_name: str, root: Path, offline: bool = False, run_stability: bool = True) -> Path:
    settings, sites_cfg, missions = load_config(root)
    mission = parse_mission(mission_name, missions[mission_name])                 # step 1
    inp = load_grids(mission, settings, sites_cfg, root, offline)
    earth, failed = inp.earth, inp.failed
    table, stats = build_table(mission, settings, inp)                            # steps 2-3
    result, skipped = rank(table, mission.weights, settings)                      # step 4
    # Sites with data that still dropped out: they lack a measurement the mission needs
    # (e.g. no temperature yet). Reported as "incomplete", never silently ranked on less.
    used = set(result.weights)
    incomplete = []
    for s in sorted(set(table.loc[table.role != "target", "site"]) - set(result.sites["site"])):
        rows = table[table.site == s]
        missing = [f for f in used if rows[f].isna().all()]
        incomplete.append({"site": s, "missing": missing or ["too many tiles with gaps"]})

    # Validation: held-out NASA sites, simple-method comparison, mission sensitivity
    knn = settings["knn"]
    held_out = validation.held_out_test(table, result.weights, knn["k"], knn["site_quantile"])
    simple = validation.simple_method_ranking(table, result.weights, knn["site_quantile"])
    agreement = validation.method_agreement(result.sites, simple)
    others = {}
    for other_name, other_raw in missions.items():
        other = parse_mission(other_name, other_raw)
        if other_name != mission_name and other.body == mission.body and other.target == mission.target:
            others[other_name] = rank(table, other.weights, settings)[0].sites
    sensitivity = validation.mission_sensitivity(result.sites, others)

    # Step 5: report
    profile = report.target_profile(table[table.role == "target"])
    stab = (stability(mission, settings, result.sites, table, inp)
            if run_stability else {"site_confidence": {}})
    info = pd.DataFrame(earth).set_index("name")[["lat", "lon", "source"]]
    ranking = result.sites.join(info, on="site").merge(simple, on="site", how="left")
    details = {s: report.site_details(s, result.tiles[result.tiles.site == s], mission, profile)
               for s in ranking["site"]}
    cannot = settings["bodies"][mission.body].get("cannot_reproduce", [])
    for col, fn in {
        "test_tile_id": lambda d: d["test_tile"]["tile_id"],
        "test_tile_lat": lambda d: d["test_tile"]["lat"],
        "test_tile_lon": lambda d: d["test_tile"]["lon"],
        "req_met": lambda d: sum(r["status"] == MET for r in d["requirements"]),
        "req_not_met": lambda d: sum(r["status"] == NOT_MET for r in d["requirements"]),
        "req_unknown": lambda d: sum(r["status"] == UNKNOWN for r in d["requirements"]),
        "interference_flags": lambda d: ", ".join(d["interference"]["flagged"]),
        "interference_unknown": lambda d: ", ".join(d["interference"]["unknown"]),
    }.items():
        ranking[col] = ranking["site"].map(lambda s: fn(details[s]))
    ranking["confidence"] = ranking["site"].map(stab["site_confidence"])
    ranking["confidence_label"] = ranking["confidence"].map(report.confidence_label)

    out = root / "results" / mission_name
    out.mkdir(parents=True, exist_ok=True)
    ranking.to_csv(out / "ranking.csv", index=False)
    result.tiles.to_csv(out / "tiles.csv", index=False)
    table[table.role == "target"].to_csv(out / "target_tiles.csv", index=False)
    stats.to_csv(out / "site_stats.csv", index=False)
    for _, r in ranking.iterrows():
        d = details[r.site]
        report.write_json(out / "sites" / f"{r.site}.json", {
            "site": r.site, "role": r.role, "rank": int(r["rank"]), "score": r.score,
            "location": {"lat": r.lat, "lon": r.lon, "source": r.source},
            "covers": {"target_coverage": r.target_coverage},
            "test_tile": {k: d["test_tile"].get(k) for k in ("tile_id", "lat", "lon", "similarity")},
            "requirements": d["requirements"], "differences_from_target": d["differences"],
            "interference": d["interference"],
            "baselines": {"nearest": r.nearest_baseline, "closer_than": r.closer_than_baselines},
            "confidence": {"value": r.confidence, "label": r.confidence_label},
            "cannot_reproduce_on_earth": cannot, "disclaimer": settings["disclaimer"]})

    summary = {"mission": mission.name, "description": mission.description, "body": mission.body,
               "target": mission.target, "target_tiles": int((table.role == "target").sum()),
               "target_profile": profile, "weights_used": result.weights,
               "features_skipped_no_data": skipped, "ignored": mission.ignored,
               "interference_limits": mission.interference,
               "mandatory": [r.describe() for r in mission.mandatory],
               "earth_sites_ranked": int(len(ranking)), "earth_sites_failed": failed,
               "earth_sites_incomplete": incomplete,
               "earth_sites_no_usable_tiles": stats.loc[(stats.tiles_kept == 0) & (stats.site != mission.target),
                                                        "site"].tolist(),
               "checks": {"negative_controls": report.negative_control_check(ranking),
                          "stability": {k: v for k, v in stab.items() if k != "site_confidence"},
                          "held_out_nasa_sites": held_out,
                          "simple_method_agreement": agreement,
                          "mission_sensitivity": sensitivity},
               "attribution": [sources.COPERNICUS_NOTICE, landcover.WORLDCOVER_NOTICE,
                               temperature.DIVINER_NOTICE, temperature.MODIS_NOTICE]}
    report.write_json(out / "summary.json", summary)
    (out / "report.md").write_text(report.markdown_report(ranking, summary, cannot, settings["disclaimer"]),
                                   encoding="utf-8")
    charts.ranking_chart(ranking, mission.name, out)
    for s in ranking.head(3)["site"]:                       # "how close to the Moon" for the top 3
        charts.closeness_chart(s, details[s], mission.weights, out)
    if summary["checks"]["negative_controls"]["status"] == "FAIL":
        log.error("NEGATIVE CONTROL CHECK FAILED: farmland ranked in the top half - see report.md")
    return out
