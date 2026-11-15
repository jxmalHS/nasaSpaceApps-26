"""
sources.py - read elevation data straight from the internet (streaming).

Only the part of each file that covers our area is transferred, not the whole file.

    Earth : Copernicus DEM GLO-30 (30 m), Cloud-Optimised GeoTIFFs on AWS, no login.
            Licence requires the notice in COPERNICUS_NOTICE on anything we publish.
    Moon  : LOLA LDEM_80S_20M (20 m, 80-90 S), NASA PDS file on the MIT LOLA archive.
    Mars  : MGS MOLA global DEM, 463 m (USGS Astrogeology mosaic of the NASA MOLA MEGDR),
            a plain GeoTIFF read one strip of rows at a time (only the rows we need).

Every function returns (heights, transform, crs):
    heights   - 2-D float32 array in metres, NaN where there is no data
    transform - maps pixel (column, row) to map coordinates
    crs       - the map projection the array is in
"""
from __future__ import annotations

import math
import time
import urllib.error
import urllib.request

import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.windows import Window, from_bounds

USER_AGENT = "analog-research-client/0.1"

COPERNICUS_BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
COPERNICUS_NOTICE = (
    "Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and "
    "Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved."
)
LOLA_SOUTH_20M = "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_20M.LBL"
MOLA_463M = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
MOLA_NOTICE = ("Mars MGS MOLA DEM 463 m: Smith et al. (2001), Mars Orbiter Laser Altimeter: experiment summary "
               "after the first year of global mapping of Mars, JGR 106(E10); mosaic by USGS Astrogeology")
MARS_RADIUS_M = 3396190.0
MARS_GEO = "+proj=longlat +R=3396190 +no_defs"


def mars_local_crs(lat: float, lon: float) -> str:
    """A metric map projection centred on a Mars point (azimuthal equidistant on the MOLA sphere).
    Distances from the centre are true, so 20 km tiles are 20 km on the ground."""
    return f"+proj=aeqd +lat_0={lat} +lon_0={lon} +R={MARS_RADIUS_M:.0f} +units=m +no_defs"

# GDAL settings for reading over HTTP: identify ourselves, read in big chunks
# (fewer round trips), retry on flaky connections, and don't list folders.
HTTP_ENV = dict(
    GDAL_HTTP_USERAGENT=USER_AGENT,
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.LBL,.IMG",
    CPL_VSIL_CURL_CHUNK_SIZE="10485760",
    GDAL_HTTP_MAX_RETRY="5",
    GDAL_HTTP_RETRY_DELAY="3",
)


# ----------------------------------------------------------------- Earth
def copernicus_tile_name(lat_floor: int, lon_floor: int) -> str:
    """Name of the 1x1 degree tile whose south-west corner is (lat_floor, lon_floor)."""
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    return f"Copernicus_DSM_COG_10_{ns}{abs(lat_floor):02d}_00_{ew}{abs(lon_floor):03d}_00_DEM"


def copernicus_tile_url(lat_floor: int, lon_floor: int) -> str:
    name = copernicus_tile_name(lat_floor, lon_floor)
    return f"{COPERNICUS_BUCKET}/{name}/{name}.tif"


def tile_exists(url: str, tries: int = 4) -> bool:
    """True if the tile exists. Ocean tiles don't exist (HTTP 404/403).

    Network errors are retried and then raised: a dropped connection must never
    be mistaken for "ocean", or land would silently go missing.
    """
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
            urllib.request.urlopen(req, timeout=30)
            return True
        except urllib.error.HTTPError as err:
            if err.code in (403, 404):
                return False
            last = err
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last = err
        time.sleep(5 * (attempt + 1))          # wait a bit longer after each failure
    raise ConnectionError(f"Could not reach {url}: {last}")


def read_copernicus(lon_min: float, lat_min: float, lon_max: float, lat_max: float,
                    coarsen: int = 2):
    """Stream Copernicus heights for a lon/lat box. Returns None if it is all ocean.

    coarsen=2 reads the file's built-in half-resolution copy (~60 m instead of
    30 m): 4x less data to stream, and still sharper than our 100 m grid, so the
    later averaging down to 100 m stays valid (we never sharpen).
    """
    urls = [copernicus_tile_url(lat, lon)
            for lat in range(math.floor(lat_min), math.floor(lat_max) + 1)
            for lon in range(math.floor(lon_min), math.floor(lon_max) + 1)]
    urls = [u for u in urls if tile_exists(u)]
    if not urls:
        return None
    with rasterio.Env(**HTTP_ENV, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        sources = [rasterio.open("/vsicurl/" + u) for u in urls]
        try:
            # merge() stitches neighbouring tiles and only reads the box we ask for.
            # Areas with no tile (sea) come back as NaN.
            res = tuple(r * coarsen for r in sources[0].res)
            heights, transform = merge(sources, bounds=(lon_min, lat_min, lon_max, lat_max),
                                       res=res, nodata=np.nan, dtype="float32")
            crs = sources[0].crs
        finally:
            for s in sources:
                s.close()
    return heights[0], transform, crs


# ------------------------------------------------------------------ Moon
def read_lola(x_min: float, y_min: float, x_max: float, y_max: float):
    """Stream LOLA heights for a box in lunar polar stereographic metres.

    The file stores whole numbers; multiplying by the file's scale (0.5) gives
    metres. The file's offset (the 1,737,400 m reference radius) is NOT added:
    we only ever use height differences, never absolute height.
    """
    with rasterio.Env(**HTTP_ENV):
        with rasterio.open("/vsicurl/" + LOLA_SOUTH_20M) as src:
            w = from_bounds(x_min, y_min, x_max, y_max, src.transform)
            # Snap to whole pixels (the box edges are multiples of 20 m, so this is exact).
            window = Window(round(w.col_off), round(w.row_off), round(w.width), round(w.height))
            raw = src.read(1, window=window, masked=True)
            heights = raw.astype("float32").filled(np.nan) * float(src.scales[0])
            return heights, src.window_transform(window), src.crs


# ------------------------------------------------------------------ Mars
def read_mola(lon_min: float, lat_min: float, lon_max: float, lat_max: float):
    """Stream MOLA heights for a lon/lat box (degrees east, -180..180) on Mars.

    The file is in an equirectangular projection (metres along the equator). Heights are
    whole metres; the file's nodata (-32768) becomes NaN. As on the Moon, only height
    differences are ever used.
    """
    if lon_min < -180 or lon_max > 180:
        raise ValueError("Mars boxes that cross the 180 deg meridian are not supported")
    k = math.pi / 180 * MARS_RADIUS_M                        # metres per degree in the file's x/y
    with rasterio.Env(**HTTP_ENV, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open("/vsicurl/" + MOLA_463M) as src:
            w = from_bounds(lon_min * k, lat_min * k, lon_max * k, lat_max * k, src.transform)
            w = w.round_offsets().round_lengths()
            raw = src.read(1, window=w, masked=True)
            return raw.astype("float32").filled(np.nan), src.window_transform(w), src.crs
