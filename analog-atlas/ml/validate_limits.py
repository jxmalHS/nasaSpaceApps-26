"""Check every pass/fail limit against the places NASA actually tested:  python ml/validate_limits.py

For each test in src/config/missions.json, every precedent site (src/config/analogs.json) is
checked against each of the test's limits at two scales:

  cell  the site's 0.5 deg (~55 km) Earth-index cell, i.e. what the scorer sees
  site  a ~5 km box at the field coordinates, from NASA GIBS (no login), year 2023:
          vegetation  MODIS_Terra_L3_NDVI_Monthly = MOD13A3 v6.1, 1 km
                      (doi:10.5067/MODIS/MOD13A3.061), annual maximum as in the index
          snow        MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct = MOD10CM v6.1, 0.05 deg
                      (doi:10.5067/MODIS/MOD10CM.061), months with mean snow cover >= 60%
                      (the 60% line of the IGBP "Permanent Snow and Ice" class, MCD12Q1 guide Table 3)
        Rain has no site-scale value: the GIBS GLDAS layer is drawn in ~26 mm/month colour
        steps, too coarse for a 250 mm/yr limit, and finer NASA rain needs an Earthdata login.

A limit is "validated" when no representative precedent (index cell within 60 km) breaks it
at the finest scale available; otherwise each break is listed as an exception with its reason.
Limits are NOT changed here: the Trust page shows the numbers, the evidence and the exceptions.

Writes src/config/limit_checks.json (read by the Trust page).
"""
from __future__ import annotations

import calendar
import concurrent.futures as cf
import io
import json
import re
import statistics
import time
import urllib.request
from datetime import datetime, timezone

from index_io import ROOT, load_index

WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
CMAPS = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/"
HALF = 0.025  # degrees: ~5 km box
YEAR = 2023
SNOW_PCT = 60  # a "snow month": mean snow cover >= 60%, as in the IGBP Permanent Snow and Ice class (MCD12Q1 Table 3)

# Known reasons a precedent breaks a limit, from NASA documentation or the site's geography.
NOTES = {
    ("sf-volcanic-field", "ndvi"): "NASA works on bare cinder patches smaller than MODIS's 1 km pixel, inside a pine-covered volcanic field.",
    ("mojave", "ndvi"): "Spring green-up of desert shrubland puts the field site's yearly peak just above 0.25.",
    ("sf-volcanic-field", "precip_mm"): "Flagstaff-area climate is genuinely wetter than a desert; NASA works there for the volcanic terrain.",
    ("mauna-kea", "precip_mm"): "The 55 km cell includes Hawaii's wet windward slopes; the summit test area is far drier.",
    ("mauna-kea", "ndvi"): "The 55 km cell includes vegetated slopes; the summit field site reads bare at site scale.",
    ("hi-seas", "precip_mm"): "The 55 km cell includes Hawaii's wet windward slopes; the Mauna Loa habitat site is far drier.",
    ("holuhraun", "precip_mm"): "MERRA-2 rain is model-only poleward of 62.5 deg (NASA/TM-2014-104606 Vol. 35) and the cell includes the Vatnajokull glacier.",
    ("holuhraun", "snow_mo"): "The 55 km cell includes the Vatnajokull glacier edge; the lava field itself is snow-covered fewer months.",
    ("haughton-crater", "precip_mm"): "MERRA-2 rain is model-only poleward of 62.5 deg (NASA/TM-2014-104606 Vol. 35); Devon Island is a polar desert.",
    ("haughton-crater", "snow_mo"): "Arctic site: NASA's Haughton-Mars Project works in the short summer window.",
    ("svalbard-bockfjorden", "precip_mm"): "MERRA-2 rain is model-only poleward of 62.5 deg (NASA/TM-2014-104606 Vol. 35).",
    ("mcmurdo-dry-valleys", "snow_mo"): "NASA chose the Dry Valleys for extreme cold; MODIS also flags surrounding glacier ice and polar night.",
    ("tso-kar", "precip_mm"): "High-mountain cell (4,500 m): MERRA-2 at 0.5 deg smooths Ladakh's rain shadow.",
    ("tso-kar", "snow_mo"): "High-mountain cell (4,500 m) includes snowier surrounding peaks.",
    ("rio-tinto", "precip_mm"): "Southern Spain is genuinely wetter than the limit; NASA chose Rio Tinto for its acidic, iron-rich chemistry.",
    ("black-point", "precip_mm"): "Northern Arizona's summer monsoon puts the cell just over the line.",
}


def _cmap(name, kind):
    with urllib.request.urlopen(CMAPS + name, timeout=60) as r:
        x = r.read().decode("utf-8")
    out = {}
    for e in re.findall(r"<ColorMapEntry[^>]*>", x):
        rgb = tuple(int(v) for v in re.search(r'rgb="([^"]+)"', e).group(1).split(","))
        if 'nodata="true"' in e:
            out[rgb] = None
            continue
        src = re.search(r'sourceValue="([^"]+)"', e).group(1)
        if kind == "ndvi":
            lo, hi = (float(v) for v in re.search(r'value="([^"]+)"', e).group(1).strip("[)").split(","))
            out[rgb] = max(0.0, (lo + hi) / 2)  # entries <= 0 (bare, snow, water) are drawn transparent
        else:
            n = int(src.strip("[]").split(",")[0])
            out[rgb] = float(n) if 0 <= n <= 100 else None  # >100 = cloud, night, water flags
    return out


def _fetch(layer, lat, lon, month, px):
    q = (f"{WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS={layer}&STYLES=&SRS=EPSG:4326"
         f"&BBOX={lon - HALF},{lat - HALF},{lon + HALF},{lat + HALF}&WIDTH={px}&HEIGHT={px}"
         f"&FORMAT=image/png&TIME={YEAR}-{month:02d}-01")
    from PIL import Image
    err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(q, timeout=90) as r:
                return Image.open(io.BytesIO(r.read())).convert("RGBA")
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{layer} {lat},{lon} {YEAR}-{month:02d}: {err}")


def _site_value(site, key, layers):
    layer, cmap, px = layers[key]
    monthly = []
    for m in range(1, 13):
        img = _fetch(layer, site["lat"], site["lon"], m, px)
        vals = [cmap[p[:3]] for p in img.getdata() if p[:3] in cmap and cmap[p[:3]] is not None]
        monthly.append(statistics.median(vals) if vals else None)
    ok = [v for v in monthly if v is not None]
    if key == "ndvi":
        return (round(max(ok), 3) if ok else None), monthly
    return sum(1 for v in ok if v >= SNOW_PCT), monthly  # snow months


def main() -> None:
    idx = load_index()
    cells = idx.meta["analog_cells"]
    missions = json.loads((ROOT / "src" / "config" / "missions.json").read_text(encoding="utf-8"))
    analogs = {a["id"]: a for a in json.loads((ROOT / "src" / "config" / "analogs.json").read_text(encoding="utf-8"))["sites"]}
    layers = {
        "ndvi": ("MODIS_Terra_L3_NDVI_Monthly", _cmap("MODIS_L3_NDVI.xml", "ndvi"), 6),
        "snow_mo": ("MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct", _cmap("MODIS_NDSI_Snow_Cover.xml", "snow"), 4),
    }
    used = sorted({b for s in missions["systems"] for t in s["tests"] for b in t["baseline"]})
    site_scale = {}
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(_site_value, analogs[sid], key, layers): (sid, key) for sid in used for key in layers}
        for f in cf.as_completed(futs):
            sid, key = futs[f]
            value, monthly = f.result()
            site_scale.setdefault(sid, {})[key] = {"value": value, "monthly": monthly}

    checks = []
    for s in missions["systems"]:
        for t in s["tests"]:
            for fid, lim in (t.get("interference") or {}).items():
                rows, exceptions = [], []
                for sid in t["baseline"]:
                    c = cells[sid]
                    cell_v = float(idx.col(fid)[c["index"]])
                    cell_v = None if cell_v != cell_v else round(cell_v, 3)
                    site_v = site_scale.get(sid, {}).get(fid, {}).get("value")
                    ok = lambda v: None if v is None else (v <= lim["v"] if lim["op"] == "<=" else v >= lim["v"])
                    best = site_v if site_v is not None else cell_v
                    row = {"site": sid, "cell": cell_v, "site_scale": site_v, "representative": c["offset_km"] <= 60,
                           "passes_cell": ok(cell_v), "passes_site": ok(site_v), "passes": ok(best)}
                    rows.append(row)
                    # Every disagreement with a NASA precedent is kept as a tagged exception (limits stay strict):
                    #   field-site  breaks the limit at the field site itself (rule vs NASA practice)
                    #   cell-only   the app's 55 km cell breaks it, but the field site passes (data scale)
                    #   cell        the cell breaks it and no finer NASA data exists to check (rain)
                    if row["representative"]:
                        kind = ("field-site" if row["passes_site"] is False else
                                "cell-only" if row["passes_cell"] is False and row["passes_site"] is True else
                                "cell" if row["passes_cell"] is False else None)
                        if kind:
                            exceptions.append({"site": sid, "kind": kind, "cell": cell_v, "site_scale": site_v,
                                               "value": site_v if kind != "cell" else cell_v,
                                               "scale": "cell" if kind == "cell" else "site",
                                               "reason": NOTES.get((sid, fid), "")})
                reps = [r for r in rows if r["representative"]]
                verdict = ("no precedent" if not reps else "validated" if not exceptions else "validated with exceptions")
                checks.append({"test_id": t["id"], "feature": fid, "op": lim["op"], "v": lim["v"], "hard": bool(lim.get("hard")),
                               "verdict": verdict, "precedents": rows, "exceptions": exceptions})
    out = {
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "method": ("Each limit is checked against the sites NASA actually used for that test. Vegetation and snow are "
                   f"re-measured at the field coordinates (~5 km box, {YEAR}) from NASA GIBS: MOD13A3 v6.1 NDVI "
                   "(doi:10.5067/MODIS/MOD13A3.061, annual maximum) and MOD10CM v6.1 snow cover "
                   "(doi:10.5067/MODIS/MOD10CM.061, months with mean cover >= 60%, the IGBP permanent-snow line). Rain uses the 0.5 deg cell "
                   "(NASA POWER / MERRA-2): no finer NASA rain product is available without a login. "
                   "Sites whose index cell is over 60 km away are not counted."),
        "site_scale": site_scale,
        "checks": checks,
    }
    path = ROOT / "src" / "config" / "limit_checks.json"
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    n_exc = sum(len(c["exceptions"]) for c in checks)
    kinds = {k: sum(e["kind"] == k for c in checks for e in c["exceptions"]) for k in ("field-site", "cell-only", "cell")}
    print(f"exception kinds: {kinds}")
    print(f"wrote {path.name}: {len(checks)} limit checks, "
          f"{sum(c['verdict'] == 'validated' for c in checks)} validated, {n_exc} exceptions")
    for c in checks:
        if c["exceptions"]:
            print(f"  {c['test_id']:13s} {c['feature']:9s} {c['op']}{c['v']:<5} {'HARD' if c['hard'] else 'soft'}: "
                  + "; ".join(f"{e['site']}={e['value']} ({e['scale']})" for e in c["exceptions"]))


if __name__ == "__main__":
    main()
