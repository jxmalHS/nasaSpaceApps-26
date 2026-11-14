"""
report.py - step 5 of the pipeline: an honest report for every site.

For each Earth site:
    what it covers        - target_coverage: share of the Moon area's variety it reproduces
    test tile             - the 5 km tile we'd recommend testing in: a tile free of interference
                            if there is one, then the most mandatory requirements met, then
                            the most similar
    requirements          - met / not met / unknown at the test tile (unknown is never a pass)
    differences           - real-unit gaps to the target, e.g. "4.2 deg steeper than the target"
    interference          - land-cover flags at the test tile
    confidence            - how often its rank survives small changes (see pipeline.stability)
    cannot reproduce      - what no Earth site can copy (gravity, vacuum, ...)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from features import FEATURE_INFO
from landcover import check_limits
from mission import MET, NOT_MET, UNKNOWN, Mission

UNIT_TEXT = {"deg": "°", "fraction": "", "unitless": "", "m": " m", "1/km": " /km", "per_km2": " per km²"}


def target_profile(target_tiles: pd.DataFrame) -> dict[str, float]:
    """The target's typical value (median over its tiles) for every terrain feature."""
    return {f: float(target_tiles[f].median()) for f in FEATURE_INFO if f in target_tiles}


def difference_statement(feature: str, diff: float | None) -> str:
    """e.g. 'Steepest-10% slope is 4.2° steeper than the target'."""
    unit, label, more, less = FEATURE_INFO[feature]
    if diff is None or not np.isfinite(diff):
        return f"{label}: unknown (no data)"
    if abs(diff) < 1e-9:
        return f"{label} matches the target"
    return f"{label} is {abs(diff):.3g}{UNIT_TEXT.get(unit, ' ' + unit)} {more if diff > 0 else less} than the target"


def requirement_statuses(tile: dict, mission: Mission, profile: dict) -> list[str]:
    return [r.check(tile.get(r.feature, np.nan), profile.get(r.feature, np.nan)) for r in mission.mandatory]


CLEAN, INTERFERENCE_UNKNOWN, INTERFERED = 0, 1, 2


def interference_level(tile: dict, limits: dict) -> int:
    """0 = clean, 1 = unknown (no land-cover data), 2 = over a limit (would ruin the test)."""
    flagged, unknown = check_limits(tile, limits)
    return INTERFERED if flagged else INTERFERENCE_UNKNOWN if unknown else CLEAN


def choose_test_tile(site_tiles: pd.DataFrame, mission: Mission, profile: dict) -> pd.Series:
    """The tile to test in. Trees, crops or water over the limit would ruin the test, so a
    clean tile always wins; then the most mandatory requirements met; then the most similar."""
    n_met = site_tiles.apply(lambda t: requirement_statuses(t.to_dict(), mission, profile).count(MET), axis=1)
    level = site_tiles.apply(lambda t: interference_level(t.to_dict(), mission.interference), axis=1)
    order = pd.DataFrame({"level": level, "n_met": n_met, "similarity": site_tiles["similarity"]})
    best = order.sort_values(["level", "n_met", "similarity"], ascending=[True, False, False]).index[0]
    return site_tiles.loc[best]


def site_details(site: str, site_tiles: pd.DataFrame, mission: Mission, profile: dict) -> dict:
    """Requirements, differences and interference for one site, at its test tile."""
    test = choose_test_tile(site_tiles, mission, profile)
    t = test.to_dict()
    reqs = []
    for r, status in zip(mission.mandatory, requirement_statuses(t, mission, profile)):
        anywhere = [r.check(v, profile.get(r.feature, np.nan)) for v in site_tiles[r.feature]] \
            if r.feature in site_tiles else [UNKNOWN]
        reqs.append({"requirement": r.describe(), "status": status,
                     "value": _num(t.get(r.feature)), "target": _num(profile.get(r.feature)),
                     "met_somewhere_on_site": MET in anywhere})
    diffs = []
    for f in FEATURE_INFO:
        v, tv = _num(t.get(f)), _num(profile.get(f))
        d = v - tv if v is not None and tv is not None else None
        diffs.append({"feature": f, "unit": FEATURE_INFO[f][0], "mission_role": mission.role_of(f),
                      "target": tv, "test_tile": v, "site_median": _num(site_tiles[f].median()),
                      "difference": d, "statement": difference_statement(f, d)})
    flagged, unknown = check_limits(t, mission.interference)
    return {"test_tile": t, "requirements": reqs, "differences": diffs,
            "interference": {"flagged": flagged, "unknown": unknown,
                             "level": interference_level(t, mission.interference),
                             "values": {f: _num(t.get(f)) for f in mission.interference}}}


def _num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if np.isfinite(v) else None


def confidence_label(c: float | None) -> str:
    if c is None or not np.isfinite(c):
        return "unknown"
    return "high" if c >= 0.8 else "medium" if c >= 0.5 else "low"


def negative_control_check(ranking: pd.DataFrame, rank_col: str = "rank") -> dict:
    """Farmland controls must rank in the bottom half; if not, something is wrong.

    Run on the similarity-only rank: farmland is always pushed down for its crops
    (interference), so the final rank would pass even if the terrain model were broken."""
    n = len(ranking)
    ctrl = ranking[ranking["role"] == "negative_control"]
    if ctrl.empty:
        return {"status": "NOT RUN", "reason": "no negative controls"}
    rows = [{"site": r.site, "rank": int(r[rank_col]), "bottom_half": bool(r[rank_col] > n / 2)}
            for _, r in ctrl.iterrows()]
    return {"status": "PASS" if all(r["bottom_half"] for r in rows) else "FAIL", "controls": rows}


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=_json_default), encoding="utf-8")


def _json_default(o):
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return str(o)


def interference_text(r) -> str:
    """'clear' only when every condition was checked; missing data is shown, never hidden."""
    flagged = r.get("interference_flags") or ""
    unknown = r.get("interference_unknown") or ""
    if flagged:
        return f"⚠️ {flagged}" + (f" (unknown: {unknown})" if unknown else "")
    return f"unknown ({unknown})" if unknown else "clear"


def _low_evidence_line(summary: dict) -> str:
    n, km = summary.get("min_usable_tiles", 6), summary.get("tile_km", 5)
    sites = summary.get("low_evidence_sites", [])
    return (f"**Low evidence:** sites judged on fewer than {n} usable {km:g} km squares (under "
            f"{n * km * km:g} km² of usable ground) are marked *low evidence*. Their score rests on too "
            "little ground to be reliable, so treat their rank as a lead to check, not a "
            f"recommendation. Here: {', '.join(sites) or 'none'}.")


def markdown_report(ranking: pd.DataFrame, summary: dict, cannot: list[str], disclaimer: str,
                    top: int = 15) -> str:
    """A short human-readable report (e.g. for the pitch)."""
    L = [f"# Analog ranking: {summary['mission']}", "", summary.get("description", ""), "",
         f"Target: **{summary['target']}** ({summary['target_tiles']} tiles). "
         f"Earth sites ranked: {summary['earth_sites_ranked']}.", "",
         "Interference (trees, crops, water... over the mission's limits) would ruin the test: "
         f"{summary.get('candidate_tiles_blocked_by_interference', 0)} candidate tiles were left out, "
         "so each candidate is judged only on its usable ground. Candidates with no usable tile: "
         f"{', '.join(summary.get('candidates_blocked_everywhere', [])) or 'none'}. NASA sites and "
         "farmland keep all tiles but rank below clean sites if their test tile is interfered. "
         "The similarity-only order is `similarity_rank` in ranking.csv.", "",
         _low_evidence_line(summary), "",
         "| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |",
         "|---|---|---|---|---|---|---|---|"]
    for _, r in ranking.head(top).iterrows():
        low = " *(low evidence)*" if r.get("low_evidence", False) else ""
        L.append(f"| {r['rank']} | {r.site}{low} | {r.role} | {r.score:.2f} | {r.target_coverage:.0%} | "
                 f"{r.req_met} / {r.req_not_met} / {r.req_unknown} | {interference_text(r)} | "
                 f"{r.confidence_label} |")
    base = ranking[ranking.role == "baseline"]
    L += ["", "## NASA baselines", ""] + [f"- {r.site}: rank {r['rank']}" for _, r in base.iterrows()]
    checks = summary["checks"]
    nc, st = checks["negative_controls"], checks["stability"]
    ho, ag, ms = checks["held_out_nasa_sites"], checks["simple_method_agreement"], checks["mission_sensitivity"]
    L += ["", "## Checks", "",
          "The model is unsupervised (no training labels), so these checks are how it is tested.", "",
          f"- **Held-out NASA sites** ({ho['status']}): "
          + (f"each NASA site left out of fitting in turn: ranks "
             f"{', '.join(f'{h['site']} #{h['rank']}' for h in ho['held_out'])}; "
             f"recall@5 = {ho['recall_at_5']:.0%} (random guess: {ho['random_guess_recall_at_5']:.0%})"
             + (f". ⚠️ {ho['warning']}" if ho.get("warning") else "")
             if ho["status"] != "NOT RUN" else ho["reason"]),
          f"- **Negative controls** (farmland must rank in the bottom half on similarity alone, "
          f"ignoring its crops): **{nc['status']}**",
          f"- **Stability:** #1 site unchanged in {st['top1_unchanged_share']:.0%} of {st['n_variants']} "
          f"small changes; on average {st['mean_top5_survivors']:.1f} of the top 5 stay in the top 5"
          if st.get("n_variants") else "- **Stability:** not run",
          f"- **Simple-method comparison** ({ag['label']}): top-5 overlap {ag['top5_overlap']}/5, "
          f"Spearman {ag['spearman']:.2f}",
          f"- **Mission sensitivity** ({ms['status']}): "
          + ("; ".join(f"vs {c['mission']} Spearman {c['spearman']:.2f}" for c in ms["comparisons"])
             if ms.get("comparisons") else ms.get("reason", ""))
          + (f". ⚠️ {ms['warning']}" if ms.get("warning") else ""),
          f"- Features skipped (no data at this pixel size): {', '.join(summary['features_skipped_no_data']) or 'none'}",
          *[f"- **Closest achievable:** {f}: the target's typical value ({c['target_median']:.1f}) is beyond "
            f"anything on Earth here ({c['earth_min']:.1f}–{c['earth_max']:.1f}), so sites are ranked on how "
            f"close they get to it. No Earth site reproduces the real value."
            for f, c in summary.get("closest_achievable", {}).items()],
          "- Sites not ranked because a needed measurement is missing (incomplete): "
          + (", ".join(f"{i['site']} ({', '.join(i['missing'])})" for i in summary.get("earth_sites_incomplete", []))
             or "none"),
          "", "## What Earth cannot reproduce", ""] + [f"- {c}" for c in cannot]
    L += ["", "## Disclaimer", "", disclaimer, "", "## Data credits", ""] + [f"- {a}" for a in summary["attribution"]]
    return "\n".join(L) + "\n"
