"""
temperature.py - the temperature parameter group.

Measured the SAME way on both worlds:

    annual temperature range = hottest daytime surface temperature
                             - coldest night-time surface temperature   (Kelvin)

    Moon : Diviner polar maps (Williams et al. 2019, doi:10.1029/2019JE006028), 240 m:
           south summer MAXIMUM minus south winter MINIMUM.
    Earth: MODIS MOD11A2 v061 land surface temperature (8-day, 1 km) over one year,
           cut out per site with NASA AppEEARS (no bulk download; needs the Earthdata login):
           highest LST_Day minus lowest LST_Night.

Both are compared at 1 km (the coarser of the two; never sharpen). Per 5 km tile we keep
the mean, the spread (std) and the pixel count - not percentiles, too few pixels for that.

Honest limit: no Earth site reaches lunar temperature ranges, so this ranks Earth sites by
"closest achievable", and absolute lunar temperatures stay in "what Earth can't reproduce".
"""
from __future__ import annotations

import base64
import json
import logging
import netrc
import time
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.windows import from_bounds

from sources import HTTP_ENV

log = logging.getLogger("temperature")

DIVINER = "https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/additional_maps/"
DIVINER_MAX = DIVINER + "polar_south_80_summer_max-float.tif"
DIVINER_MIN = DIVINER + "polar_south_80_winter_min-float.tif"
DIVINER_NOTICE = ("Diviner polar temperatures: Williams et al. (2019), Seasonal polar temperatures on the Moon, "
                  "JGR Planets 124, 2505-2521")
MODIS_NOTICE = "MODIS MOD11A2 v061 land surface temperature (Wan, Hook, Hulley 2021), via NASA AppEEARS"

APPEEARS = "https://appeears.earthdatacloud.nasa.gov/api"
TEMP_FEATURES = ["temp_range_mean", "temp_range_std"]


# ----------------------------------------------------------------- per tile
def tile_temperature(block: np.ndarray) -> dict[str, float]:
    """Mean and spread of the annual range in one tile, ignoring missing pixels."""
    vals = block[np.isfinite(block)]
    if vals.size == 0:
        return {"temp_range_mean": np.nan, "temp_range_std": np.nan, "temp_pixels": 0}
    return {"temp_range_mean": float(vals.mean()), "temp_range_std": float(vals.std()),
            "temp_pixels": int(vals.size)}


def to_grid(arr, src_transform, src_crs, dst_crs, box, res):
    """Average onto a res-metre grid covering box (coarser only)."""
    x_min, y_min, x_max, y_max = box
    out = np.full((round((y_max - y_min) / res), round((x_max - x_min) / res)), np.nan, "float32")
    reproject(source=arr.astype("float32"), destination=out, src_transform=src_transform, src_crs=src_crs,
              src_nodata=np.nan, dst_transform=Affine(res, 0, x_min, 0, -res, y_max), dst_crs=dst_crs,
              dst_nodata=np.nan, resampling=Resampling.average)
    return out, Affine(res, 0, x_min, 0, -res, y_max)


# --------------------------------------------------------------------- Moon
def moon_range(box: tuple[float, float, float, float], res: float):
    """Diviner annual range (summer max - winter min) on our polar-stereo grid at res metres."""
    pad = 1000
    padded = (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)
    layers = []
    with rasterio.Env(**HTTP_ENV, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        for url in (DIVINER_MAX, DIVINER_MIN):
            with rasterio.open("/vsicurl/" + url) as src:
                w = from_bounds(*padded, src.transform).round_offsets().round_lengths()
                layers.append((src.read(1, window=w), src.window_transform(w), src.crs))
    (tmax, tr, crs), (tmin, _, _) = layers
    return (*to_grid(tmax - tmin, tr, crs, crs, box, res), crs)


# -------------------------------------------------------------------- Earth
def _credentials() -> tuple[str, str]:
    """Earthdata username/password from the user's netrc file (never printed or stored)."""
    for name in (".netrc", "_netrc"):
        path = Path.home() / name
        if path.exists():
            auth = netrc.netrc(path).authenticators("urs.earthdata.nasa.gov")
            if auth:
                return auth[0], auth[2]
    raise RuntimeError("No Earthdata login found. Run: python -c \"import earthaccess; "
                       "earthaccess.login(strategy='interactive', persist=True)\"")


def _api(path: str, token: str | None = None, data: dict | None = None, method: str | None = None,
         auth: tuple[str, str] | None = None):
    req = urllib.request.Request(APPEEARS + path, method=method or ("POST" if data is not None else "GET"))
    req.add_header("User-Agent", "analog-research-client/0.1")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if auth:
        req.add_header("Authorization", "Basic " + base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode())
    if data is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(data).encode()
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read()
    return json.loads(body) if body[:1] in (b"{", b"[") else body


def submit_tasks(boxes: dict[str, tuple], year: int) -> tuple[str, dict[str, str]]:
    """Ask AppEEARS for one year of MOD11A2 day/night LST, ONE task per site box.

    One task per site means every output file clearly belongs to one site.
    Returns (token, {site: task_id}).
    """
    token = _api("/login", data={}, auth=_credentials())["token"]
    tasks = {}
    for site, (x0, y0, x1, y1) in boxes.items():
        task = {"task_type": "area", "task_name": f"analog_temp_{site}_{year}",
                "params": {"dates": [{"startDate": f"01-01-{year}", "endDate": f"12-31-{year}"}],
                           "layers": [{"product": "MOD11A2.061", "layer": "LST_Day_1km"},
                                      {"product": "MOD11A2.061", "layer": "LST_Night_1km"}],
                           "geo": {"type": "FeatureCollection", "features": [{
                               "type": "Feature", "properties": {},
                               "geometry": {"type": "Polygon", "coordinates":
                                            [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}}]},
                           "output": {"format": {"type": "geotiff"}, "projection": "geographic"}}}
        tasks[site] = _api("/task", token=token, data=task)["task_id"]
        log.info("AppEEARS task for %s: %s", site, tasks[site])
    return token, tasks


def wait_for(token: str, task_id: str, poll_s: int = 30, max_wait_s: int = 3600) -> None:
    """AppEEARS works through a queue; wait until this task is done."""
    waited = 0
    while True:
        status = _api(f"/task/{task_id}", token=token).get("status")
        if status == "done":
            return
        if status in ("error", "expired", "deleted"):
            raise RuntimeError(f"AppEEARS task {task_id} ended with status '{status}'")
        if waited >= max_wait_s:
            raise TimeoutError(f"AppEEARS task {task_id} still '{status}' after {max_wait_s}s")
        time.sleep(poll_s)
        waited += poll_s


def read_task(token: str, task_id: str) -> dict[str, list[tuple]]:
    """Download one task's small GeoTIFFs: {"LST_Day_1km": [(K array, transform, crs), ...], ...}."""
    out = {"LST_Day_1km": [], "LST_Night_1km": []}
    for f in _api(f"/bundle/{task_id}", token=token)["files"]:
        name = f["file_name"]
        if not name.endswith(".tif") or "QC" in name:
            continue
        layer = next((l for l in out if l in name), None)
        if layer is None:
            continue
        raw = _api(f"/bundle/{task_id}/{f['file_id']}", token=token)
        with rasterio.MemoryFile(raw) as mem, mem.open() as src:
            out[layer].append((to_kelvin(src.read(1)), src.transform, src.crs))
    return out


def to_kelvin(arr: np.ndarray) -> np.ndarray:
    """MODIS stores LST as integers x 50 (scale 0.02); 0 = no data. Values outside 150-400 K are errors."""
    arr = arr.astype("float32")
    arr[arr == 0] = np.nan
    if np.nanmax(arr, initial=0) > 2000:          # still stored integers -> convert
        arr *= 0.02
    arr[(arr < 150) | (arr > 400)] = np.nan
    return arr


def earth_range_from_layers(day: list, night: list):
    """Annual range per pixel: highest daytime LST minus lowest night-time LST."""
    if not day or not night:
        return None
    tr, crs = day[0][1], day[0][2]
    hot = np.nanmax(np.stack([d[0] for d in day]), axis=0)
    cold = np.nanmin(np.stack([n[0] for n in night]), axis=0)
    return hot - cold, tr, crs
