"""
atlas_export.py - hand our results to the team's Analog Atlas web app.

Analog Atlas ranks 78,993 Earth land cells (0.5 deg, ~55 km) with fast rules. Our engine
checks ~59 sites in detail. This file translates our results into the Atlas's sparse-score
CSV (read by its ml/export_scores.py), plus a model card and validation file for its Trust
page. Nothing is re-ranked here: it only converts existing results/<mission>/ files.

Outputs (results/analog_atlas_export/):
    scores.csv       - one row per (site, Atlas test, Atlas target)
    model_card.json  - what the model is, what it was built on, its limits
    validation.json  - our checks (held-out NASA sites, farmland controls, stability)
"""
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

import pandas as pd

from mission import MET, NOT_MET, parse_mission
from pipeline import load_config

# Our mission -> (Atlas test_id, Atlas target_id), agreed with the Atlas team.
ATLAS_MAP = {
    "moon_rover_mons_mouton": ("ltv.wheels", "mons-mouton-plateau"),
    "moon_rover_south_pole": ("ltv.wheels", "connecting-ridge"),
    "moon_rover_thermal_south_pole": ("ltv.thermal", "connecting-ridge"),
    "moon_landing_hazards_south_pole": ("land.hazards", "connecting-ridge"),
}
# Our NASA sites that are one of the Atlas's analog IDs (both lie in the San Francisco Volcanic Field).
ATLAS_ANALOG_IDS = {"sp_crater_jett3": "sf-volcanic-field", "cinder_lake_crater_field": "sf-volcanic-field"}
LOO_MISSION = "moon_rover_mons_mouton"     # the rover-realistic target, used for the per-site dots

NOTES = {
    "moon_rover_thermal_south_pole": "Our ltv.thermal score is terrain + yearly temperature range "
                                     "(closest achievable to the Moon), not thermal only.",
    "moon_rover_south_pole": "Our target is a 40 km box at the south pole (incl. Shackleton walls), "
                             "mapped to the nearest Atlas target.",
}


def cell_id(lat: float, lon: float) -> int:
    """Atlas cell: 0.5 deg grid, row 0 = 90-89.5 N, col 0 = 180-179.5 W; cell_id = row*720 + col."""
    row = min(int(math.floor((90.0 - lat) / 0.5)), 359)
    col = min(int(math.floor((lon + 180.0) / 0.5)), 719)
    return row * 720 + col


def _rows_for(mission_name: str, mission, out: Path) -> list[dict]:
    test_id, target_id = ATLAS_MAP[mission_name]
    ranking = pd.read_csv(out / "ranking.csv")
    features = [r.feature for r in mission.mandatory]
    rows = []
    for _, r in ranking.iterrows():
        d = json.loads((out / "sites" / f"{r.site}.json").read_text(encoding="utf-8"))
        status = [q["status"] for q in d["requirements"]]
        req = {s: ";".join(f for f, st in zip(features, status) if st == s) for s in (MET, NOT_MET)}
        unknown = ";".join(f for f, st in zip(features, status) if st not in (MET, NOT_MET))
        conf = d["confidence"]["value"]
        conf = None if conf is None or (isinstance(conf, float) and math.isnan(conf)) else float(conf)
        note = [NOTES.get(mission_name, ""), f"role: {r.role}"]
        if d["interference"]["unknown"]:
            note.append("land cover unknown: " + ", ".join(d["interference"]["unknown"]))
        rows.append({
            "cell_id": cell_id(r.lat, r.lon), "test_id": test_id, "score": round(float(r.score), 4),
            "target_id": target_id,
            "uncertainty": None if conf is None else round(1 - conf, 3),
            "lat": r.lat, "lon": r.lon,
            "confidence": None if conf is None else round(conf, 3),
            "low_evidence": "true" if bool(r.low_evidence) else "false",
            "req_met": req[MET], "req_not_met": req[NOT_MET], "req_unknown": unknown,
            "flags": ";".join(d["interference"]["flagged"]),
            "spot_lat": round(d["test_tile"]["lat"], 4), "spot_lon": round(d["test_tile"]["lon"], 4),
            "note": "; ".join(n for n in note if n),
            "site_name": r.site.replace("_", " ").title(),
        })
    return rows


def _validation(summaries: dict) -> list[dict]:
    out = []
    for m, s in summaries.items():
        test_id, target_id = ATLAS_MAP[m]
        c = s["checks"]
        ho, nc, st = c["held_out_nasa_sites"], c["negative_controls"], c["stability"]
        out.append({"name": f"Held-out NASA sites ({m})", "test_id": test_id, "target_id": target_id,
                    "status": ho.get("status"), "recall_at_5": ho.get("recall_at_5"),
                    "random_recall_at_5": ho.get("random_guess_recall_at_5"),
                    "sites_ranked": ho.get("n_sites_ranked"),
                    "ranks": ", ".join(f"{h['site']} #{h['rank']}" for h in ho.get("held_out", [])),
                    "warning": ho.get("warning", ho.get("reason", ""))})
        out.append({"name": f"Farmland negative controls ({m})", "test_id": test_id, "target_id": target_id,
                    "status": nc.get("status"), "rule": "farmland must rank in the bottom half on similarity",
                    "ranks": ", ".join(f"{x['site']} #{x['rank']}" for x in nc.get("controls", []))})
        if st.get("n_variants"):
            out.append({"name": f"Stability ({m})", "test_id": test_id, "target_id": target_id,
                        "small_changes": st["n_variants"],
                        "top1_unchanged_share": round(st["top1_unchanged_share"], 3),
                        "mean_top5_survivors": round(st["mean_top5_survivors"], 2)})
    s = summaries.get(LOO_MISSION)
    if s:                                     # per-site dots in the Atlas precedent table
        ho = s["checks"]["held_out_nasa_sites"]
        n = ho.get("n_sites_ranked") or 0
        pct = [100 * (n - h["rank"]) / (n - 1) for h in ho.get("held_out", [])
               if h["site"] in ATLAS_ANALOG_IDS and n > 1]
        if pct:
            p = round(statistics.median(pct), 1)
            out.append({"test_id": ATLAS_MAP[LOO_MISSION][0], "target_id": ATLAS_MAP[LOO_MISSION][1],
                        "status": "loo", "held_out": [{"site": "sf-volcanic-field", "percentile": p}],
                        "median_percentile": p, "top5_rate": ho.get("recall_at_5"),
                        "note": "sf-volcanic-field = median of SP Crater (JETT3) and Cinder Lake, each held out"})
    return out


def _card(summaries: dict, n_sites: int) -> dict:
    # One line per mission: pooling them would mix a 32-site check with an 11-site one.
    metrics = {}
    for m, s in summaries.items():
        ho = s["checks"]["held_out_nasa_sites"]
        if ho.get("recall_at_5") is not None:
            metrics[f"recall_at_5 ({m})"] = (f"{ho['recall_at_5']:.2f} vs {ho['random_guess_recall_at_5']:.2f} "
                                             f"random, {ho['n_sites_ranked']} sites")
    metrics["stability_checks"] = max((s["checks"]["stability"].get("n_variants") or 0) for s in summaries.values())
    metrics["nasa_sites_for_validation"] = 5
    return {
        "name": "Two-way weighted kNN (analog engine)", "version": "1.0.0",
        "kind": "Unsupervised weighted k-nearest-neighbour on 100 m relief, two-way matching",
        "trained_on": f"Copernicus GLO-30 + ESA WorldCover 2021 (+ MODIS MOD11A2 for thermal) vs "
                      f"LOLA LDEM_80S_20M (+ Diviner for thermal); {n_sites} Earth sites; no labels",
        "inputs": "5 km squares at 100 m pixels: slope, steep share, roughness, crater-like dips; "
                  "mission weights; no absolute elevation",
        "limits": f"Sparse: {n_sites} sites of 78,993 cells; unscored cells are 'not analysed', never 0. "
                  "Candidates whose every 5 km square breaks a land-cover limit (forest, crops, water) "
                  "were rejected and are not exported. "
                  "~30 cm rocks invisible at 100 m. Only 5 NASA sites to validate on: checks show the "
                  "ranking is sensible, not proven. Pass/fail limits always come from the Atlas rules.",
        "demo": False,
        "metrics": metrics,
    }


def export_atlas(root: Path) -> Path:
    """Write scores.csv, model_card.json and validation.json for Analog Atlas."""
    _, _, missions = load_config(root)
    rows, summaries, missing = [], {}, []
    for name in ATLAS_MAP:
        out = root / "results" / name
        if not (out / "ranking.csv").exists():
            missing.append(name)
            continue
        rows += _rows_for(name, parse_mission(name, missions[name]), out)
        summaries[name] = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    if not rows:
        raise FileNotFoundError("No results to export: run `python main.py run --mission ...` first")
    dest = root / "results" / "analog_atlas_export"
    dest.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(dest / "scores.csv", index=False)
    n_sites = len({(r["lat"], r["lon"]) for r in rows})
    (dest / "model_card.json").write_text(json.dumps(_card(summaries, n_sites), indent=2), encoding="utf-8")
    (dest / "validation.json").write_text(json.dumps(_validation(summaries), indent=2), encoding="utf-8")
    if missing:
        print("Not exported (no results yet): " + ", ".join(missing))
    return dest
