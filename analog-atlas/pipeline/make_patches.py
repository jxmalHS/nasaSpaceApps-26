"""Cut measured 2 x 2 km terrain patches for the Compare page.

    pip install rasterio numpy
    python pipeline/make_patches.py earth --dem NASADEM_HGT_n24w070.tif --cell 252029 --lat -24.08 --lon -70.01 --source-spacing 30 --source-url <dataset-url>
    python pipeline/make_patches.py moon  --dem LOLA_SPole_20m.tif      --key connecting-ridge --lat -89.45 --lon -137.5 --source-spacing 20 --source-url <dataset-url>

Writes public/data/patches/{body}/{key}.json:
    {"size_m": 2000, "n": 128, "z": [...], "source": "..."}
The app picks these up automatically and drops the "illustrative" label.

Earth: NASADEM_HGT (30 m) below 60N, ASTER GDEM v3 above. Moon: LOLA 20 m polar DEMs (PGDA)
or LOLA GDR. Mars: HiRISE / CTX DTMs. The DEM may be in any CRS rasterio can read; the window
is sampled on a local azimuthal grid centred on the site so both sides share metres, not degrees.
NOTE: not executed in the build environment (no DEMs bundled); test on the laptop.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

RADIUS_M = {"earth": 6371000.0, "moon": 1737400.0, "mars": 3389500.0}
OUT = Path(__file__).resolve().parents[1] / "public" / "data" / "patches"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("body", choices=RADIUS_M)
    ap.add_argument("--dem", required=True)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--cell", help="Earth cell id (from the index)")
    ap.add_argument("--key", help="target id (Moon/Mars)")
    ap.add_argument("--size", type=float, default=2000.0)
    ap.add_argument("--n", type=int, default=128)
    ap.add_argument("--source-url", required=True, help="Public product or dataset URL")
    ap.add_argument("--source-spacing", type=float, required=True, help="Native DEM grid spacing in metres")
    a = ap.parse_args()
    if a.n != 128 or a.size != 2000 or a.source_spacing <= 0:
        ap.error("Compare uses a 128 x 128 grid over 2000 m; provide positive source spacing.")
    import rasterio
    from rasterio.warp import transform

    key = a.cell if a.body == "earth" else a.key
    if not key:
        raise SystemExit("--cell (earth) or --key (moon/mars) is required")
    R = RADIUS_M[a.body]  # explicit body radius: never an Earth default for other worlds
    half = a.size / 2
    xs = np.linspace(-half, half, a.n)
    X, Y = np.meshgrid(xs, -xs)  # row 0 = north
    lat0, lon0 = np.radians(a.lat), np.radians(a.lon)
    rho = np.hypot(X, Y)
    c = rho / R
    lat = np.arcsin(np.cos(c) * np.sin(lat0) + np.where(rho > 0, Y * np.sin(c) * np.cos(lat0) / np.maximum(rho, 1e-9), 0))
    lon = lon0 + np.arctan2(X * np.sin(c), rho * np.cos(lat0) * np.cos(c) - Y * np.sin(lat0) * np.sin(c))
    lat_d, lon_d = np.degrees(lat).ravel(), np.degrees(lon).ravel()
    with rasterio.open(a.dem) as ds:
        if ds.crs and ds.crs.is_geographic:
            px, py = lon_d, lat_d
        else:
            px, py = transform("+proj=longlat +R=%f +no_defs" % R, ds.crs, lon_d.tolist(), lat_d.tolist())
        z = np.array([v[0] for v in ds.sample(zip(px, py))], dtype=float)
        if ds.nodata is not None:
            z[z == ds.nodata] = np.nan
        source = Path(a.dem).name
    if not np.isfinite(z).all():
        raise SystemExit("The footprint contains missing elevation; choose another DEM or site.")
    z = np.where(np.isnan(z), np.nanmean(z), z).reshape(a.n, a.n)
    out = OUT / a.body / f"{key}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"body": a.body, "lat": a.lat, "lon": a.lon, "sampleSpacingM": a.source_spacing, "sourceUrl": a.source_url, "size_m": a.size, "n": a.n, "z": np.round(z, 2).ravel().tolist(), "source": source}))
    print("wrote", out)


if __name__ == "__main__":
    main()
