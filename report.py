"""
report.py - step 5 of the pipeline: an honest report for every site.

For each Earth site:
    what it covers        - target_coverage: share of the Moon area's variety it reproduces
    test tile             - the 5 km tile we'd recommend testing in: the one meeting the most
                            mandatory requirements (ties: the most similar)
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


def choose_test_tile(site_tiles: pd.DataFrame, mission: Mission, profile: dict) -> pd.Series:
    """The tile meeting the most mandatory requirements; ties go to the most similar tile."""
    n_met = site_tiles.apply(lambda t: requirement_statuses(t.to_dict(), mission, profile).count(MET), axis=1)
    order = pd.DataFrame({"n_met": n_met, "similarity": site_tiles["similarity"]})
    return site_tiles.loc[order.sort_values(["n_met", "similarity"], ascending=False).index[0]]


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


def negative_control_check(ranking: pd.DataFrame) -> dict:
    """Farmland controls must rank in the bottom half; if not, something is wrong."""
    n = len(ranking)
    ctrl = ranking[ranking["role"] == "negative_control"]
    if ctrl.empty:
        return {"status": "NOT RUN", "reason": "no negative controls"}
    rows = [{"site": r.site, "rank": int(r["rank"]), "bottom_half": bool(r["rank"] > n / 2)}
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


def markdown_report(ranking: pd.DataFrame, summary: dict, cannot: list[str], disclaimer: str,
                    top: int = 15) -> str:
    """A short human-readable report (e.g. for the pitch)."""
    L = [f"# Analog ranking: {summary['mission']}", "", summary.get("description", ""), "",
         f"Target: **{summary['target']}** ({summary['target_tiles']} tiles). "
         f"Earth sites ranked: {summary['earth_sites_ranked']}.", "",
         "| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |",
         "|---|---|---|---|---|---|---|---|"]
    for _, r in ranking.head(top).iterrows():
        L.append(f"| {r['rank']} | {r.site} | {r.role} | {r.score:.2f} | {r.target_coverage:.0%} | "
                 f"{r.req_met} / {r.req_not_met} / {r.req_unknown} | {interference_text(r)} | "
                 f"{r.confidence_label} |")
    base = ranking[ranking.role == "baseline"]
    L += ["", "## NASA baselines", ""] + [f"- {r.site}: rank {r['rank']}" for _, r in base.iterrows()]
    nc = summary["checks"]["negative_controls"]
    st = summary["checks"]["stability"]
    L += ["", "## Checks", "",
          f"- Negative controls (farmland must rank in the bottom half): **{nc['status']}**",
          f"- Stability: #1 site unchanged in {st['top1_unchanged_share']:.0%} of {st['n_variants']} "
          f"small changes; on average {st['mean_top5_survivors']:.1f} of the top 5 stay in the top 5"
          if st.get("n_variants") else "- Stability: not run",
          f"- Features skipped (no data at this pixel size): {', '.join(summary['features_skipped_no_data']) or 'none'}",
          "", "## What Earth cannot reproduce", ""] + [f"- {c}" for c in cannot]
    L += ["", "## Disclaimer", "", disclaimer, "", "## Data credits", ""] + [f"- {a}" for a in summary["attribution"]]
    return "\n".join(L) + "\n"
