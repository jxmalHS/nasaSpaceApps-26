"""
coverage.py - multi-site coverage: which requirements does each additional site cover?

One Earth site rarely reproduces everything a mission needs. This answers:

    "If we test at site A, which requirements are covered? What does adding site B cover
     that A did not? What does no Earth site cover (=> lab, chamber or engineered testbed)?"

Requirements (decided before ranking, from the mission):
    - every mandatory rule in missions.yaml (e.g. "slope_p90 within 5 deg of the target")
    - every weighted target measurement: "inside the target's own range", i.e. between the
      10th and 90th percentile of the target's tiles. A value the target itself has is a
      fair test value; anything outside it is too gentle or too extreme.

Conditions needed together must be present at the same place, so a site covers a set of
requirements only if ONE of its tiles meets all of them, and that tile must be free of
interference (trees, crops, water... over the mission's limits). Missing data never counts
as met. Farmland controls are never proposed.

Greedy selection: start with nothing covered; repeatedly add the (site, tile) that covers the
most still-uncovered requirements (ties go to the better-ranked site); stop when no site adds
anything. Greedy is not guaranteed to find the smallest set, but each step is explainable.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import report
from features import FEATURE_INFO
from mission import MET, Mission

LOW_Q, HIGH_Q = 0.10, 0.90


def requirements(mission: Mission, target_tiles: pd.DataFrame) -> list[dict]:
    """Every requirement as {id, text, test(tile, profile) -> bool}."""
    profile = report.target_profile(target_tiles)
    reqs = []
    for r in mission.mandatory:
        reqs.append({"id": r.id, "text": r.describe(), "kind": "mandatory",
                     "test": lambda t, r=r: r.check(t.get(r.feature, np.nan), profile.get(r.feature, np.nan)) == MET})
    for f in mission.weights:
        if f not in target_tiles or target_tiles[f].notna().sum() == 0:
            continue
        lo, hi = (float(target_tiles[f].quantile(q)) for q in (LOW_Q, HIGH_Q))
        unit = report.UNIT_TEXT.get(FEATURE_INFO[f][0], " " + FEATURE_INFO[f][0])
        reqs.append({"id": f"{f}_in_target_range", "kind": "target_range", "feature": f, "low": lo, "high": hi,
                     "text": f"{FEATURE_INFO[f][1]} inside the target's range ({lo:.3g}–{hi:.3g}{unit})",
                     "test": lambda t, f=f, lo=lo, hi=hi: bool(np.isfinite(t.get(f, np.nan)) and lo <= t[f] <= hi)})
    return reqs


def greedy_cover(tiles: pd.DataFrame, ranking: pd.DataFrame, mission: Mission,
                 target_tiles: pd.DataFrame, max_sites: int = 5) -> dict:
    """Pick sites one at a time until no site adds a requirement. See the module docstring."""
    reqs = requirements(mission, target_tiles)
    rank = dict(zip(ranking["site"], ranking["rank"]))
    roles = dict(zip(ranking["site"], ranking["role"]))
    options = []                                    # (site, tile_id, set of requirement ids met)
    for _, t in tiles.iterrows():
        if roles.get(t["site"]) not in ("candidate", "baseline"):
            continue
        d = t.to_dict()
        if report.interference_level(d, mission.interference) != report.CLEAN:
            continue
        met = frozenset(q["id"] for q in reqs if q["test"](d))
        if met:
            options.append((t["site"], t["tile_id"], float(t["lat"]), float(t["lon"]), met))
    best_single = {}
    for site, _, _, _, met in options:
        best_single[site] = max(best_single.get(site, 0), len(met))

    covered, steps, used_sites = set(), [], set()
    while len(steps) < max_sites:
        pick = None
        for site, tid, lat, lon, met in options:
            if site in used_sites:
                continue
            gain = len(met - covered)
            key = (gain, -rank.get(site, 1e9))
            if gain > 0 and (pick is None or key > pick[0]):
                pick = (key, site, tid, lat, lon, met)
        if pick is None:
            break
        _, site, tid, lat, lon, met = pick
        new = sorted(met - covered)
        covered |= met
        used_sites.add(site)
        steps.append({"site": site, "role": roles[site], "rank": int(rank[site]), "tile_id": tid,
                      "lat": round(lat, 4), "lon": round(lon, 4),
                      "adds": [q["text"] for q in reqs if q["id"] in new],
                      "covered_so_far": len(covered)})
    text = {q["id"]: q["text"] for q in reqs}
    return {"requirements": [{k: v for k, v in q.items() if k != "test"} for q in reqs],
            "n_requirements": len(reqs), "steps": steps,
            "not_covered_by_any_site": [text[i] for i in text if i not in covered],
            "best_single_site": max(best_single.items(), key=lambda kv: (kv[1], -rank.get(kv[0], 1e9)),
                                    default=(None, 0)),
            "rule": (f"A site covers a requirement only if one interference-free tile meets it; requirements met "
                     f"together must be met on the same tile. Target range = {LOW_Q:.0%}-{HIGH_Q:.0%} of the "
                     f"target's tiles. Greedy: each step adds the site covering the most new requirements.")}


def markdown(cov: dict) -> list[str]:
    """Report section."""
    L = ["", "## Multi-site coverage", "",
         f"{cov['n_requirements']} requirements (mandatory rules + every weighted measurement inside the "
         "target's own 10-90% range). " + cov["rule"], ""]
    if not cov["steps"]:
        L.append("No interference-free tile of any site meets any requirement.")
    for i, s in enumerate(cov["steps"], 1):
        L.append(f"{i}. **{s['site']}** (rank {s['rank']}, {s['role']}, tile {s['tile_id']}) adds: "
                 + "; ".join(s["adds"]) + f" → {s['covered_so_far']}/{cov['n_requirements']} covered")
    L += ["", "**Not covered by any Earth site here** (needs a lab, chamber or engineered testbed, or more sites): "
          + ("; ".join(cov["not_covered_by_any_site"]) or "none")]
    return L
