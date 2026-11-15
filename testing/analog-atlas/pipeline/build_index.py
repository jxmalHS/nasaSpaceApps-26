"""Build the Earth analog index used by the web app and by the ML laptop.

    python pipeline/build_index.py

Inputs (pipeline/source/, all real, see README "Data provenance"):
  grids_0p5deg.npz   0.5 deg EPSG:4326 grids, row 0 = 89.75N, col 0 = 179.75W
                     (terrain from AWS Terrarium DEM, NASA POWER/MERRA-2 climate,
                      MODIS LST day-night, MODIS NDVI, MERRA-2 dust, MODIS snow, GLiM)
  ne_10m_populated_places_simple.geojson, ne_50m_admin_0_countries.geojson

Outputs:
  public/data/earth_index.bin        columnar uint16 (65535 = missing) + cell ids
  public/data/earth_index.meta.json  column ranges, Earth quantiles, names, analog cells
  public/data/earth_index.csv.gz     full-precision table for training / auditing
  ml/feature_schema.json             column order and units the model must use

Cell id = row * 720 + col on the 0.5 deg grid. It never changes, so ML scores,
patches and share links can all key on it.
"""

from __future__ import annotations

import gzip
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "pipeline" / "source"
CFG = ROOT / "src" / "config"
OUT = ROOT / "public" / "data"
NROW, NCOL, CELL = 360, 720, 0.5
LAT = 90.0 - (np.arange(NROW) + 0.5) * CELL
LON = -180.0 + (np.arange(NCOL) + 0.5) * CELL
MISSING = 65535


def solar_by_latitude(lat_deg: np.ndarray, obliquity: float = 23.44, step_min: int = 10):
    """Low-sun share of daylight (%) and longest continuous darkness (days) per latitude."""
    days = np.arange(365)
    decl = np.radians(obliquity) * np.sin(2 * np.pi * (days - 80) / 365.0)  # ~equinox on day 80
    hours = np.arange(0, 24 * 60, step_min) / 60.0
    ha = np.radians((hours - 12.0) * 15.0)
    low = np.zeros(lat_deg.size)
    dark = np.zeros(lat_deg.size)
    horizon = np.radians(-0.833)
    for i, la in enumerate(np.radians(lat_deg)):
        s = np.sin(la) * np.sin(decl)[:, None] + np.cos(la) * np.cos(decl)[:, None] * np.cos(ha)[None, :]
        elev = np.arcsin(np.clip(s, -1, 1)).ravel()
        up = elev > horizon
        low[i] = 100.0 * np.mean(elev[up] < np.radians(10)) if up.any() else 100.0
        if not up.any():
            dark[i] = 365.0
            continue
        down = ~up
        # longest run of darkness, wrapping the year end to its start
        d2 = np.concatenate([down, down])
        best = run = 0
        for v in d2:
            run = run + 1 if v else 0
            if run > best:
                best = run
        dark[i] = min(best, down.size) * step_min / (60 * 24)
    return low, dark


def rasterize_countries(path: Path, scale: int = 4):
    gj = json.loads(path.read_text())
    w, h = NCOL * scale, NROW * scale
    img = Image.new("I", (w, h), 0)
    draw = ImageDraw.Draw(img)
    names, continents = ["—"], ["—"]
    for feat in gj["features"]:
        p = feat["properties"]
        names.append(p.get("NAME") or p.get("ADMIN") or "—")
        continents.append(p.get("CONTINENT") or "—")
        idx = len(names) - 1
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            ring = [((x + 180) / 360 * w, (90 - y) / 180 * h) for x, y in poly[0]]
            if len(ring) > 2:
                draw.polygon(ring, fill=idx)
    a = np.array(img)[scale // 2 :: scale, scale // 2 :: scale]
    # Coastal cells whose centre falls offshore take the nearest country.
    _, (ri, ci) = distance_transform_edt(a == 0, return_indices=True)
    return a[ri, ci], names, continents


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    g = dict(np.load(SRC / "grids_0p5deg.npz"))
    features = json.loads((CFG / "features.json").read_text())["features"]
    analogs = json.loads((CFG / "analogs.json").read_text())["sites"]

    land = np.isfinite(g["slope"]) & (g["land_fraction"] >= 0.5)
    rows, cols = np.nonzero(land)
    ids = (rows * NCOL + cols).astype(np.uint32)
    n = ids.size
    lat, lon = LAT[rows], LON[cols]
    print(f"land cells: {n}")

    low_sun, dark = solar_by_latitude(LAT)

    places = json.loads((SRC / "ne_10m_populated_places_simple.geojson").read_text())["features"]
    p_lat = np.array([f["properties"]["latitude"] for f in places])
    p_lon = np.array([f["properties"]["longitude"] for f in places])
    p_name = [f["properties"]["name"] for f in places]

    def xyz(la, lo):
        la, lo = np.radians(la), np.radians(lo)
        return np.c_[np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]

    tree = cKDTree(xyz(p_lat, p_lon))
    chord, near = tree.query(xyz(lat, lon))
    remote_km = 2 * 6371.0 * np.arcsin(np.clip(chord / 2, 0, 1))

    country_grid, country_names, country_continents = rasterize_countries(SRC / "ne_50m_admin_0_countries.geojson")
    country = country_grid[rows, cols].astype(np.uint16)

    elev = g["elevation"][rows, cols]
    cols_data = {
        "slope_deg": g["slope"][rows, cols],
        "rough_m": g["roughness"][rows, cols],
        "elev_m": elev,
        "lst_dtr_K": g["lst_diurnal_range"][rows, cols],
        "t_mean_C": g["mean_annual_temperature"][rows, cols],
        "t_range_K": g["annual_temperature_range"][rows, cols],
        "low_sun_pct": low_sun[rows],
        "dark_d": dark[rows],
        "pressure_kPa": 101.325 * np.exp(-np.maximum(elev, -500) / 8434.0),
        "dust_ug": g["dust"][rows, cols],
        "precip_mm": g["precipitation"][rows, cols],
        "ndvi": g["vegetation"][rows, cols],
        "snow_mo": g["snow_months"][rows, cols],
        "basalt": g["basaltic_volcanic"][rows, cols],
        "remote_km": remote_km,
    }
    lst_measured = (g["lst_source"][rows, cols] == 1).astype(np.uint8)

    # Terrarium DEM tiles are Web Mercator: nothing real beyond ±85.05°. Mark terrain missing there.
    beyond = np.abs(lat) > 85.0
    for k in ("slope_deg", "rough_m", "elev_m", "pressure_kPa"):
        cols_data[k] = np.where(beyond, np.nan, cols_data[k])
    # MODIS snow has no retrieval where MODIS LST is also absent (Antarctic interior, polar night):
    # the source wrote 0 months there. That is "no data", not "no snow".
    no_modis = (lst_measured == 0) & (lat < -60)
    cols_data["snow_mo"] = np.where(no_modis & (cols_data["snow_mo"] == 0), np.nan, cols_data["snow_mo"])

    measured = [f["id"] for f in features if not f.get("pending")]
    assert set(measured) == set(cols_data), set(measured) ^ set(cols_data)

    # Quantize to uint16 per column. Quantiles describe the Earth distribution and are
    # what the scorer uses to put Earth and target values on one comparable axis.
    meta_cols, blobs = [], []
    for fid in measured:
        x = cols_data[fid].astype(np.float64)
        ok = np.isfinite(x)
        lo, hi = float(np.min(x[ok])), float(np.max(x[ok]))
        span = hi - lo if hi > lo else 1.0
        q = np.full(n, MISSING, dtype=np.uint16)
        q[ok] = np.round((x[ok] - lo) / span * 65534).astype(np.uint16)
        blobs.append(q)
        quant = np.percentile(x[ok], np.arange(101)).round(5).tolist()
        meta_cols.append({"id": fid, "min": lo, "max": hi, "q": quant, "missing": int((~ok).sum())})
        print(f"  {fid:14s} {lo:10.3f} .. {hi:10.3f}  missing {int((~ok).sum())}")

    # Analog sites → cell (nearest land cell; reported so offsets are visible).
    land_tree = cKDTree(xyz(lat, lon))
    analog_cells = {}
    for s in analogs:
        d, i = land_tree.query(xyz(np.array([s["lat"]]), np.array([s["lon"]])))
        km = float(2 * 6371.0 * np.arcsin(min(d[0] / 2, 1)))
        analog_cells[s["id"]] = {"index": int(i[0]), "id": int(ids[i[0]]), "offset_km": round(km, 1)}

    with open(OUT / "earth_index.bin", "wb") as fh:
        fh.write(ids.tobytes())
        for b in blobs:
            fh.write(b.tobytes())
        fh.write(country.tobytes())
        fh.write(near.astype(np.uint16).tobytes())
        fh.write(lst_measured.tobytes())

    used_places = sorted(set(near.tolist()))
    meta = {
        "schema_version": 1,
        "grid": {"cell_deg": CELL, "nrow": NROW, "ncol": NCOL, "id": "row*720+col, row 0 = 89.75N, col 0 = 179.75W"},
        "n": int(n),
        "layout": ["ids:uint32[n]"] + [f"{c['id']}:uint16[n]" for c in meta_cols] + ["country:uint16[n]", "place:uint16[n]", "lst_measured:uint8[n]"],
        "missing_code": MISSING,
        "columns": meta_cols,
        "countries": country_names,
        "continents": country_continents,
        "places": [[p_name[i], round(float(p_lat[i]), 3), round(float(p_lon[i]), 3)] if i in set(used_places) else None for i in range(len(p_name))],
        "analog_cells": analog_cells,
        "synthetic": False,
        "provenance": "terra-nova cache/derived grids (see README)"
    }
    (OUT / "earth_index.meta.json").write_text(json.dumps(meta, separators=(",", ":")))

    header = ["cell_id", "lat", "lon", "country", "nearest_place"] + measured + ["lst_measured"]
    with gzip.open(OUT / "earth_index.csv.gz", "wt", newline="") as fh:
        fh.write(",".join(header) + "\n")
        for k in range(n):
            vals = [str(int(ids[k])), f"{lat[k]:.2f}", f"{lon[k]:.2f}", '"' + country_names[country[k]].replace('"', "'") + '"',
                    '"' + p_name[near[k]].replace('"', "'") + '"']
            for fid in measured:
                v = cols_data[fid][k]
                vals.append("" if not np.isfinite(v) else f"{float(v):.4g}")
            vals.append(str(int(lst_measured[k])))
            fh.write(",".join(vals) + "\n")

    schema = {
        "schema_version": 1,
        "id_column": "cell_id",
        "feature_columns": [{"id": f["id"], "unit": f["unit"], "label": f["label"]} for f in features if not f.get("pending")],
        "pending_features": [f["id"] for f in features if f.get("pending")],
        "rows": int(n),
        "note": "Score every row of earth_index.csv.gz, keyed by cell_id. Missing inputs are empty strings: keep them missing, do not impute silently.",
    }
    (ROOT / "ml").mkdir(exist_ok=True)
    (ROOT / "ml" / "feature_schema.json").write_text(json.dumps(schema, indent=1))
    size = (OUT / "earth_index.bin").stat().st_size
    print(f"wrote earth_index.bin {size/1e6:.2f} MB, analogs: " + ", ".join(f"{k} {v['offset_km']} km" for k, v in analog_cells.items()))


if __name__ == "__main__":
    main()
