"""Measure Moon and Mars target terrain at the SAME scale as the Earth index.

    python pipeline/measure_targets.py            # measure every target, write target_terrain.json
    python pipeline/measure_targets.py --check    # FIRST: re-measure 12 Earth cells, compare with the
                                                  # Earth index, save the calibration factors

Earth index definitions (src/config/features.json):
  slope_deg  "gradient of 0.5 deg mean elevation": block-mean elevation on a 0.5 deg grid, then the
             slope from the neighbouring blocks (central differences).
  rough_m    "RMS residual about a 3x3 least-squares plane at 1/12 deg", averaged over the cell's
             6 x 6 pixels of 1/12 deg.

What the Earth check found (12 cells, flat plains to the Himalaya, Copernicus vs the index's
Terrarium DEM): roughness tracks the index closely (r ~ 0.98) but reads ~1.3x higher (different
DEM); slope is closest with the difference taken across ONE cell spacing (the 2-cell central
difference reads ~half the index), r ~ 0.8, scatter mostly at coasts, where the index's grid
treats sea cells differently. So each target value is multiplied by the Earth calibration
factor (median index/ours ratio) and carries that factor and its 10-90% spread.

Physical sizes on Earth: 0.5 deg of latitude = 55.6 km, 1/12 deg = 9.27 km. On the Moon and Mars
we use those same physical sizes (not the same angles: a degree on the Moon is 30 km, on Mars
59 km), on a local equidistant grid centred on the target. Every source is first averaged to
463 m (finer than 9.27 km, so nothing is sharpened), then into 9.27 km and 55.6 km blocks.

Sources (streamed, only the needed window is read):
  Moon 80-90 S : LOLA LDEM_80S_80M (polar stereographic, 80 m)  - NASA PDS, MIT LOLA archive
  Moon other   : LOLA LDEM_16 (cylindrical, 16 px/deg ~ 1.9 km)  - same archive
  Mars         : MGS MOLA DEM 463 m (USGS Astrogeology mosaic)
  Earth check  : Copernicus GLO-30 (read at 240 m)
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[1]
UA = "analog-research-client/0.1"
ENV = dict(GDAL_HTTP_USERAGENT=UA, CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.LBL,.IMG",
           GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="3")
LOLA_POLAR = "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_80M.LBL"
LOLA_CYL = "https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_16.LBL"
MOLA = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
COP = "https://copernicus-dem-30m.s3.amazonaws.com"
RADIUS = {"moon": 1737400.0, "mars": 3396190.0, "earth": 6371008.8}

ROUGH_PX = 6371008.8 * math.pi / 180 / 12        # 1/12 deg of Earth latitude = 9266 m
CELL = 6 * ROUGH_PX                               # 0.5 deg = 55.6 km
FINE = ROUGH_PX / 20                              # 463 m working grid (20 x 20 per roughness pixel)
HALF_PX = 9                                       # box = 18 roughness pixels = 3 cells (for the slope)


def local_crs(body: str, lat: float, lon: float) -> CRS:
    if body == "earth":
        return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs")
    return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +R={RADIUS[body]:.0f} +units=m +no_defs")


def geo_crs(body: str) -> CRS:
    return CRS.from_epsg(4326) if body == "earth" else CRS.from_proj4(f"+proj=longlat +R={RADIUS[body]:.0f} +no_defs")


def read_window(url: str, crs_dst: CRS, box, pad_m: float = 5000):
    """Read the part of a raster that covers box (in crs_dst), return (array, transform, crs)."""
    with rasterio.Env(**ENV), rasterio.open("/vsicurl/" + url) as src:
        b = transform_bounds(crs_dst, src.crs, box[0] - pad_m, box[1] - pad_m, box[2] + pad_m, box[3] + pad_m,
                             densify_pts=41)
        w = from_bounds(*b, src.transform).round_offsets().round_lengths()
        w = w.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        a = src.read(1, window=w, masked=True).astype("float64").filled(np.nan) * float(src.scales[0])
        return a, src.window_transform(w), src.crs


def read_copernicus(lon_min, lat_min, lon_max, lat_max):
    urls = []
    for la in range(math.floor(lat_min), math.floor(lat_max) + 1):
        for lo in range(math.floor(lon_min), math.floor(lon_max) + 1):
            name = (f"Copernicus_DSM_COG_10_{'N' if la >= 0 else 'S'}{abs(la):02d}_00_"
                    f"{'E' if lo >= 0 else 'W'}{abs(lo):03d}_00_DEM")
            urls.append(f"{COP}/{name}/{name}.tif")
    with rasterio.Env(**ENV):
        srcs = []
        for u in urls:
            try:
                srcs.append(rasterio.open("/vsicurl/" + u))
            except rasterio.errors.RasterioIOError:
                pass                                   # ocean tile (does not exist)
        # res x 8 reads the file's built-in 240 m copy: still finer than our 463 m working grid
        a, tf = merge(srcs, bounds=(lon_min, lat_min, lon_max, lat_max), res=tuple(r * 8 for r in srcs[0].res),
                      nodata=np.nan, dtype="float32")
        crs = srcs[0].crs
        for s in srcs:
            s.close()
    return a[0].astype("float64"), tf, crs


def fine_grid(body: str, lat: float, lon: float):
    """Elevation on a 463 m local grid, box = 3 x 3 cells (166.8 km) centred on (lat, lon)."""
    crs = local_crs(body, lat, lon)
    half = HALF_PX * ROUGH_PX
    box = (-half, -half, half, half)
    if body == "mars":
        src = read_window(MOLA, crs, box)
    elif body == "moon":
        # the polar file stops at 80 S; the 167 km box reaches 2.75 deg of latitude from the centre
        src = read_window(LOLA_POLAR if lat <= -83.0 else LOLA_CYL, crs, box)
    else:
        lon_min, lat_min, lon_max, lat_max = transform_bounds(crs, geo_crs("earth"), *box, densify_pts=41)
        src = read_copernicus(lon_min - 0.05, lat_min - 0.05, lon_max + 0.05, lat_max + 0.05)
    n = 2 * HALF_PX * 20
    out = np.full((n, n), np.nan)
    reproject(src[0], out, src_transform=src[1], src_crs=src[2], src_nodata=np.nan,
              dst_transform=Affine(FINE, 0, -half, 0, -FINE, half), dst_crs=crs, dst_nodata=np.nan,
              resampling=Resampling.average)
    return out


def block_mean(z: np.ndarray, k: int) -> np.ndarray:
    h, w = z.shape[0] // k, z.shape[1] // k
    return np.nanmean(z[: h * k, : w * k].reshape(h, k, w, k), axis=(1, 3))


def plane_rms(win: np.ndarray) -> float:
    yy, xx = np.mgrid[0:3, 0:3] * ROUGH_PX
    a = np.column_stack([xx.ravel(), yy.ravel(), np.ones(9)])
    coef, *_ = np.linalg.lstsq(a, win.ravel(), rcond=None)
    return float(np.sqrt(np.mean((win.ravel() - a @ coef) ** 2)))


def measure(z: np.ndarray) -> dict:
    """slope_deg and rough_m of the centre cell, exactly as the Earth index defines them."""
    cells = block_mean(z, 120)                          # 3 x 3 cells of 55.6 km
    # difference across the two neighbours divided by ONE cell spacing: the form that best
    # reproduces the Earth index (see the module docstring; checked with --check)
    dzdy = (cells[0, 1] - cells[2, 1]) / CELL           # row 0 = north
    dzdx = (cells[1, 2] - cells[1, 0]) / CELL
    slope = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    px = block_mean(z, 20)                              # 18 x 18 pixels of 9.27 km
    rms = [plane_rms(px[r - 1:r + 2, c - 1:c + 2]) for r in range(6, 12) for c in range(6, 12)
           if np.isfinite(px[r - 1:r + 2, c - 1:c + 2]).all()]
    return {"slope_deg": round(slope, 2), "rough_m": round(float(np.mean(rms)), 1) if rms else None,
            "valid_share": round(float(np.isfinite(z).mean()), 3)}


CHECK_CELLS = [(37.75, -100.75), (35.25, -111.25), (36.25, -116.75), (46.75, 9.75), (27.75, 86.75),
               (-24.25, -69.75), (64.75, -16.75), (19.75, -155.25), (31.25, 35.25), (-33.75, 150.25),
               (40.25, -105.75), (23.25, 12.25)]
CALIBRATION = ROOT / "pipeline" / "target_terrain_calibration.json"


DIVINER = "https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/additional_maps/polar_south_80_{}-float.tif"
DIVINER_CITE = ("Diviner polar seasonal temperatures (Williams et al. 2019, JGR Planets 124, 2505-2521, "
                "doi:10.1029/2019JE006028), 240 m, mean over the 55.6 km cell")


def diviner_temps(lat: float, lon: float) -> dict | None:
    """Moon south-polar temperatures over one 55.6 km cell, mapped onto the Earth index's features.

    Diviner maps (bolometric surface temperature, K) per season: avg, max, min over a lunation.
      lst_dtr_K  day-night swing   = mean of (summer max - summer min) and (winter max - winter min)
      t_mean_C   mean temperature  = mean of the summer and winter averages, in deg C
                 (SURFACE temperature: the Moon has no air; Earth's t_mean is 2 m air temperature)
      t_range_K  seasonal range    = summer average - winter average
    Each map is averaged over the cell first, so this is the cell's typical value, not its extremes.
    """
    if lat > -80.0 + CELL / 2 / 30300:                 # maps cover 80-90 S only (~30.3 km per degree)
        return None
    crs = local_crs("moon", lat, lon)
    half = CELL / 2
    m = {}
    for season in ("summer", "winter"):
        for kind in ("avg", "max", "min"):
            a, tf, src_crs = read_window(DIVINER.format(f"{season}_{kind}"), crs, (-half, -half, half, half), pad_m=0)
            n = 60
            out = np.full((n, n), np.nan)
            reproject(np.where(a > 0, a, np.nan), out, src_transform=tf, src_crs=src_crs, src_nodata=np.nan,
                      dst_transform=Affine(CELL / n, 0, -half, 0, -CELL / n, half), dst_crs=crs,
                      dst_nodata=np.nan, resampling=Resampling.average)
            m[f"{season}_{kind}"] = float(np.nanmean(out))
    return {"lst_dtr_K": round(((m["summer_max"] - m["summer_min"]) + (m["winter_max"] - m["winter_min"])) / 2, 1),
            "t_mean_C": round((m["summer_avg"] + m["winter_avg"]) / 2 - 273.15, 1),
            "t_range_K": round(m["summer_avg"] - m["winter_avg"], 1), "maps_K": {k: round(v, 1) for k, v in m.items()}}


def earth_check(cells: list[tuple[float, float]]) -> dict:
    """Re-measure Earth cells with the target method and compare with the index (other DEM)."""
    rows = {}
    with gzip.open(ROOT / "public" / "data" / "earth_index.csv.gz", "rt", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            rows[(float(r["lat"]), float(r["lon"]))] = r
    out = []
    for lat, lon in cells:
        clat, clon = math.floor(lat * 2) / 2 + 0.25, math.floor(lon * 2) / 2 + 0.25
        idx = rows[(round(clat, 2), round(clon, 2))]
        got = measure(fine_grid("earth", clat, clon))
        out.append({"cell": [clat, clon], "index_slope": float(idx["slope_deg"]), "ours_slope": got["slope_deg"],
                    "index_rough": float(idx["rough_m"]), "ours_rough": got["rough_m"]})
        print(out[-1], flush=True)
    cal = {}
    for f, i, o in (("slope_deg", "index_slope", "ours_slope"), ("rough_m", "index_rough", "ours_rough")):
        ok = [r for r in out if r[o]]
        ratio = np.array([r[i] / r[o] for r in ok])
        cal[f] = {"factor": round(float(np.median(ratio)), 3),
                  "spread_p10_p90": [round(float(np.percentile(ratio, 10)), 2), round(float(np.percentile(ratio, 90)), 2)],
                  "r": round(float(np.corrcoef([r[o] for r in ok], [r[i] for r in ok])[0, 1]), 3), "n_cells": len(ok)}
    CALIBRATION.write_text(json.dumps({"cells": out, "calibration": cal}, indent=1), encoding="utf-8")
    print(cal)
    return cal


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.check:
        # flat plains, a volcanic field, mountains: three very different cells
        earth_check(CHECK_CELLS)
        return
    cal = json.loads(CALIBRATION.read_text(encoding="utf-8"))["calibration"]
    targets = json.loads((ROOT / "src" / "config" / "targets.json").read_text(encoding="utf-8"))["targets"]
    res = {}
    for t in targets:
        lon = t["lon"] if t["lon"] <= 180 else t["lon"] - 360
        raw = measure(fine_grid(t["body"], t["lat"], lon))
        res[t["id"]] = {"body": t["body"], "lat": t["lat"], "lon": lon, "raw": raw,
                        "slope_deg": round(raw["slope_deg"] * cal["slope_deg"]["factor"], 2),
                        "rough_m": None if raw["rough_m"] is None else round(raw["rough_m"] * cal["rough_m"]["factor"], 1)}
        if t["body"] == "moon":
            temps = diviner_temps(t["lat"], lon)
            if temps:
                res[t["id"]]["temperature"] = {**temps, "source": DIVINER_CITE}
        print(t["id"], res[t["id"]])
    out = ROOT / "pipeline" / "target_terrain.json"
    out.write_text(json.dumps({"method": " ".join(__doc__.split("\n\n")[1].split()), "calibration": cal,
                               "cell_km": round(CELL / 1000, 2), "rough_px_km": round(ROUGH_PX / 1000, 3),
                               "targets": res}, indent=1), encoding="utf-8")
    print("wrote", out)


if __name__ == "__main__":
    main()
