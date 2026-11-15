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
    "mars_landing_jezero": ("land.hazards", "jezero"),
    "mars_rover_jezero": ("ltv.wheels", "jezero"),
}
# Our NASA sites that are one of the Atlas's analog IDs (both lie in the San Francisco Volcanic Field).
# Mars 2020 Lander Vision System test spots lie in Death Valley National Park and the Mojave National Preserve.
ATLAS_ANALOG_IDS = {"sp_crater_jett3": "sf-volcanic-field", "cinder_lake_crater_field": "sf-volcanic-field",
                    "mesquite_flat_dunes": "death-valley", "badwater_basin": "death-valley",
                    "panamint_valley": "death-valley", "kelso_dunes": "mojave", "hole_in_the_wall": "mojave"}

NOTES = {
    "moon_rover_thermal_south_pole": "Our ltv.thermal score is terrain + yearly temperature range "
                                     "(closest achievable to the Moon), not thermal only.",
    "moon_rover_south_pole": "Our target is a 40 km box at the south pole (incl. Shackleton walls), "
                             "mapped to the nearest Atlas target.",
    "mars_landing_jezero": "Mars: 20 km squares at 500 m pixels (MOLA), terrain shape only.",
    "mars_rover_jezero": "Mars: 20 km squares at 500 m pixels (MOLA): landforms, not the rocks a wheel meets.",
}


def cell_id(lat: float, lon: float) -> int:
    """Atlas cell: 0.5 deg grid, row 0 = 90-89.5 N, col 0 = 180-179.5 W; cell_id = row*720 + col."""
    row = min(int(math.floor((90.0 - lat) / 0.5)), 359)
    col = min(int(math.floor((lon + 180.0) / 0.5)), 719)
    return row * 720 + col


def percentile_from_rank(rank: int, n: int) -> float:
    """Website meaning: share of the OTHER sites this one beats, 0-100 (100 = ranked first)."""
    return 100.0 if n <= 1 else round(100 * (n - rank) / (n - 1), 1)


def _rows_for(mission_name: str, mission, out: Path, summary: dict) -> list[dict]:
    test_id, target_id = ATLAS_MAP[mission_name]
    ranking = pd.read_csv(out / "ranking.csv")
    features = [r.feature for r in mission.mandatory]
    total_runs = summary["checks"]["stability"].get("n_variants")
    # score_percentile: where the site's score sits among the sites analysed in THIS set
    by_score = ranking["score"].rank(ascending=False, method="min").astype(int)
    pct = {s: percentile_from_rank(k, len(ranking)) for s, k in zip(ranking["site"], by_score)}
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
            # extra columns (new): plain counts behind "confidence", and a within-set percentile
            "stable_runs": None if conf is None or not total_runs else round(conf * total_runs),
            "total_runs": total_runs,
            "score_percentile": pct[r.site],
        })
    return rows


PRETTY = {"sp_crater_jett3": "SP Crater (JETT3)", "cinder_lake_crater_field": "Cinder Lake Crater Field",
          "buffalo_park": "Buffalo Park", "meteor_crater": "Meteor Crater", "yucca_flat": "Yucca Flat",
          "mesquite_flat_dunes": "Mesquite Flat Dunes", "badwater_basin": "Badwater Basin",
          "panamint_valley": "Panamint Valley", "kelso_dunes": "Kelso Dunes",
          "hole_in_the_wall": "Hole-in-the-Wall", "grand_falls_dunes": "Grand Falls Dunes"}
POPULATION = ("the {n} Earth sites the engine ranked for this set (not the 78,993 website cells); "
              "percentile = share of the other ranked sites the held-out site beats (100 = first); "
              "rank on similarity alone, before the land-cover ordering")


def _held_out_entry(m: str, s: dict, coords: dict) -> dict:
    """One Trust-page 'loo' entry per (test, target): website ids where the place matches,
    plus every engine site in engine_held_out (most have no website match)."""
    test_id, target_id = ATLAS_MAP[m]
    ho = s["checks"]["held_out_nasa_sites"]
    n = ho.get("n_sites_ranked") or 0
    engine = []
    for h in ho.get("held_out", []):
        lat, lon = coords.get(h["site"], (None, None))
        engine.append({"site": h["site"], "name": PRETTY.get(h["site"], h["site"]), "lat": lat, "lon": lon,
                       "rank": h["rank"], "of": n, "percentile": percentile_from_rank(h["rank"], n),
                       "website_id": ATLAS_ANALOG_IDS.get(h["site"])})
    matched: dict[str, list] = {}
    for e in engine:
        if e["website_id"]:
            matched.setdefault(e["website_id"], []).append(e)
    held_out = [{"site": wid, "percentile": round(statistics.median(x["percentile"] for x in es), 1),
                 "engine_sites": ", ".join(f"{x['name']} {x['percentile']:g}" for x in es)}
                for wid, es in matched.items()]
    entry = {"name": f"Held-out NASA sites ({test_id} / {target_id})", "test_id": test_id,
             "target_id": target_id, "status": "loo", "held_out": held_out,
             "median_percentile": round(statistics.median(e["percentile"] for e in engine), 1) if engine else None,
             "median_over": f"all {len(engine)} engine held-out sites",
             "top5_rate": ho.get("recall_at_5"), "random_top5_rate": ho.get("random_guess_recall_at_5"),
             "population": POPULATION.format(n=n), "engine_held_out": engine}
    if ho.get("status") == "WARN" or n < 20:
        entry["warning"] = (f"Only {n} sites ranked: a random order "
                            f"would put {ho.get('random_guess_recall_at_5', 0):.0%} of them in the top 5. "
                            "Weak evidence.")
    return entry


def _stability_text(st: dict) -> str:
    ok = [v for v in st.get("variants", []) if "error" not in v]
    same = sum(bool(v.get("top1_same")) for v in ok)
    return (f"top site unchanged in {same} of {len(ok)} small changes; "
            f"{st['mean_top5_survivors']:.2f} of top 5 kept on average")


def _validation(summaries: dict, coords: dict) -> list[dict]:
    out = [_held_out_entry(m, s, coords) for m, s in summaries.items()]
    for m, s in summaries.items():
        test_id, target_id = ATLAS_MAP[m]
        nc, st = s["checks"]["negative_controls"], s["checks"]["stability"]
        out.append({"name": f"Farmland negative controls ({test_id} / {target_id})", "test_id": test_id,
                    "target_id": target_id, "status": nc.get("status"),
                    "rule": "farmland must rank in the bottom half of the engine's sites, on similarity alone",
                    "ranks": ", ".join(f"{x['site']} #{x['rank']}" for x in nc.get("controls", []))})
        if st.get("n_variants"):
            out.append({"name": f"Engine stability ({test_id} / {target_id})", "test_id": test_id,
                        "target_id": target_id, "result": _stability_text(st),
                        "what_changed": "see small_change_definition in the model card"})
        cov = s.get("multi_site_coverage")
        if cov:
            out.append({"name": f"Multi-site coverage ({test_id} / {target_id})", "test_id": test_id,
                        "target_id": target_id, "status": "coverage",
                        "result": (f"{cov['steps'][-1]['covered_so_far'] if cov['steps'] else 0} of "
                                   f"{cov['n_requirements']} requirements covered by {len(cov['steps'])} site(s); "
                                   f"{len(cov['not_covered_by_any_site'])} covered by no site"),
                        "rule": cov["rule"],
                        "steps": [{"site": PRETTY.get(x["site"], x["site"].replace("_", " ").title()),
                                   "role": x["role"], "rank": x["rank"], "lat": x["lat"], "lon": x["lon"],
                                   "adds": x["adds"], "covered_so_far": x["covered_so_far"]} for x in cov["steps"]],
                        "not_covered": cov["not_covered_by_any_site"], "n_requirements": cov["n_requirements"]})
    return out


def _card(summaries: dict, n_sites: int, settings: dict) -> dict:
    stab, knn = settings["stability"], settings["knn"]
    metrics = {}
    for m, s in summaries.items():                 # one line per set, never pooled
        test_id, target_id = ATLAS_MAP[m]
        ho, st = s["checks"]["held_out_nasa_sites"], s["checks"]["stability"]
        if ho.get("recall_at_5") is not None:
            metrics[f"held-out NASA sites in top 5 ({test_id} / {target_id})"] = (
                f"{ho['recall_at_5']:.0%} (random order: {ho['random_guess_recall_at_5']:.0%}; "
                f"{ho['n_sites_ranked']} sites ranked)")
        if st.get("n_variants"):
            metrics[f"stability ({test_id} / {target_id})"] = _stability_text(st)
    metrics["nasa_sites_for_validation"] = "5 for the Moon (Artemis training sites), 6 for Mars (Mars 2020 Lander Vision System test spots + Grand Falls dunes)"
    n_runs = sorted({s["checks"]["stability"].get("n_variants") for s in summaries.values()} - {None})
    min_tiles = knn.get("min_usable_tiles", 6)
    return {
        "name": "Two-way weighted kNN (analog engine)", "version": "1.1.0",
        "kind": "Unsupervised weighted k-nearest-neighbour on relief (Moon: 100 m, Mars: 500 m), two-way matching",
        "trained_on": f"Copernicus GLO-30 + ESA WorldCover 2021 (+ MODIS MOD11A2 for thermal) vs "
                      f"LOLA LDEM_80S_20M (+ Diviner for thermal) for the Moon and MGS MOLA 463 m for Mars; "
                      f"{n_sites} Earth sites; no labels",
        "inputs": "Moon: 5 km squares at 100 m pixels; Mars: 20 km squares at 500 m pixels (MOLA's resolution). "
                  "Slope, steep share, roughness, crater-like dips; "
                  "mission weights; no absolute elevation",
        "limits": f"Sparse: {n_sites} sites of 78,993 cells; unscored cells are 'not analysed', never 0. "
                  "Candidates whose every square breaks a land-cover limit (forest, crops, water) "
                  "were rejected and are not exported. "
                  "~30 cm rocks invisible at 100 m (Moon) or 500 m (Mars). Only 5-6 NASA sites per world to validate on: checks show the "
                  "ranking is sensible, not proven. Pass/fail limits always come from the Atlas rules.",
        "score_definition": (
            f"Similarity, 0-1. Each square is compared with the target's squares: d = weighted "
            f"distance after scaling every measurement by Earth's typical spread (1 unit = one interquartile "
            f"range); similarity = exp(-d). Score = 0.5 x (the {knn['site_quantile']:.0%} percentile of the "
            f"site's square similarities, each vs its {knn['k']} nearest target squares) + 0.5 x (average over "
            f"target squares of exp(-distance to the site's closest square)). 1.0 = identical to the target on "
            f"every weighted measurement. No Earth site gets close to the lunar south pole (steeper than any site), so "
            f"about 0.6 is a strong match. NOT on the same scale as rule scores."),
        "score_comparability": ("Compare scores within one test/target set only: each set has its own target, "
                                "weights and Earth scaling, so 0.5 in one set is not 0.5 in another. "
                                "score_percentile (0-100) = share of the other sites analysed in the same "
                                "set that this site out-scores."),
        "confidence_definition": (
            f"Stability, not certainty: confidence = stable_runs / total_runs. A run is one small change "
            f"(see small_change_definition); 'stable' = the site's rank moved by at most "
            f"max(1, {stab['rank_tolerance_frac']:.0%} of the sites ranked) places. 100% = stable in every run. "
            f"uncertainty = 1 - confidence. Suggested label: 'Stable in 14/14 runs'."),
        "small_change_definition": (
            f"One change at a time: each weighted measurement's weight x{1 + stab['weight_change']:g} and "
            f"x{1 - stab['weight_change']:g} (2 runs per measurement), pixels {stab['alt_resolution_factor']}x "
            f"bigger (Moon 100 m -> {100 * stab['alt_resolution_factor']} m, Mars 500 m -> {500 * stab['alt_resolution_factor']} m), and the square grid shifted by half a "
            f"square. total_runs = 2 x (weighted measurements) + 2 = {' or '.join(str(r) for r in n_runs)} "
            f"(it depends on how many measurements the mission weighs). Not the same as the "
            f"website's +/-30% x 30 weight jitter."),
        "low_evidence_rule": (f"low_evidence = true when the site has fewer than {min_tiles} usable "
                              f"squares (Moon: 5 km, under {min_tiles * 25} km2; Mars: 20 km, under {min_tiles * 400} km2; left after removing squares with missing "
                              "data or over a land-cover limit): a lead to check, not a recommendation."),
        "aggregation": "Several sites in one cell: keep the highest score (--agg max), as the importer does.",
        "demo": False,
        "metrics": metrics,
    }


def export_atlas(root: Path) -> Path:
    """Write scores.csv, model_card.json and validation.json for Analog Atlas."""
    settings, sites_cfg, missions = load_config(root)
    coords = {s["name"]: (s["lat"], s["lon"]) for s in sites_cfg["earth_sites"]}
    rows, summaries, missing = [], {}, []
    for name in ATLAS_MAP:
        out = root / "results" / name
        if not (out / "ranking.csv").exists():
            missing.append(name)
            continue
        summaries[name] = json.loads((out / "summary.json").read_text(encoding="utf-8"))
        rows += _rows_for(name, parse_mission(name, missions[name]), out, summaries[name])
    if not rows:
        raise FileNotFoundError("No results to export: run `python main.py run --mission ...` first")
    dest = root / "results" / "analog_atlas_export"
    dest.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(dest / "scores.csv", index=False)
    n_sites = len({(r["lat"], r["lon"]) for r in rows})
    (dest / "model_card.json").write_text(json.dumps(_card(summaries, n_sites, settings), indent=2),
                                          encoding="utf-8")
    (dest / "validation.json").write_text(json.dumps(_validation(summaries, coords), indent=2), encoding="utf-8")
    if missing:
        print("Not exported (no results yet): " + ", ".join(missing))
    return dest
