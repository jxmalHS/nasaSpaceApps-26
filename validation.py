"""
validation.py - evidence that the ranking means something.

kNN here is UNSUPERVISED: nothing is trained on "good"/"bad" labels (we only
have ~5 known analogs, far too few to train on). So instead of a train/test
split we test the method in three ways (plus negative controls and stability,
which live in report.py / pipeline.py):

1. Held-out NASA sites - leave one known analog OUT of everything the model
   learns, then check where it ranks. Known analogs landing near the top is the
   closest thing to a test-set score (reported as recall@5 / recall@10).
2. Simple method comparison - a plain "distance to the target's typical
   values" ranking (no nearest neighbours). Agreement only shows consistency,
   NOT that either is right ("agreement != accuracy").
3. Mission sensitivity - two different missions over the same sites should
   give different rankings; if they are almost identical, the mission
   weights aren't doing anything.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from analog_knn import (ROLE_COL, SITE_COL, drop_incomplete, fit_scaler, normalise_weights,
                        run_knn, to_weighted_space)

SMALL_SAMPLE = 20   # below this many ranked sites, recall@k says little - we warn


def held_out_test(table: pd.DataFrame, weights: dict, k: int, quantile: float) -> dict:
    """Leave each NASA baseline out of the fitting, one at a time, and record its rank."""
    baselines = sorted(table.loc[table[ROLE_COL] == "baseline", SITE_COL].unique())
    if not baselines:
        return {"status": "NOT RUN", "reason": "no baseline sites with data"}
    if table.loc[table[ROLE_COL] != "target", SITE_COL].nunique() < 2:
        return {"status": "NOT RUN", "reason": "need at least one other Earth site to fit on"}
    rows = []
    for b in baselines:
        sites = run_knn(table, weights, k=k, site_quantile=quantile, exclude_from_fit=(b,)).sites
        rows.append({"site": b, "rank": int(sites.set_index("site").at[b, "rank"])})
    ranks = np.array([r["rank"] for r in rows])
    n = int(table.loc[table[ROLE_COL] != "target", SITE_COL].nunique())
    out = {"status": "INFO", "n_sites_ranked": n, "held_out": rows,
           "recall_at_5": float((ranks <= 5).mean()), "recall_at_10": float((ranks <= 10).mean()),
           "random_guess_recall_at_5": round(min(5, n) / n, 2)}
    if n < SMALL_SAMPLE:
        out["status"] = "WARN"
        out["warning"] = (f"Only {n} sites ranked: even a random ranking would put "
                          f"{out['random_guess_recall_at_5']:.0%} of sites in the top 5. Weak evidence.")
    return out


def simple_method_ranking(table: pd.DataFrame, weights: dict, quantile: float) -> pd.DataFrame:
    """Rank sites by weighted distance of each tile to the target's MEDIAN tile (no kNN)."""
    features = list(weights)
    clean, _ = drop_incomplete(table, features)
    target = clean[clean[ROLE_COL] == "target"]
    earth = clean[clean[ROLE_COL] != "target"].reset_index(drop=True)
    w = normalise_weights(weights)
    scaler = fit_scaler(earth, features)
    centre = to_weighted_space(target[features].median().to_frame().T, features, scaler, w)
    dist = np.linalg.norm(to_weighted_space(earth, features, scaler, w) - centre, axis=1)
    earth = earth.assign(similarity=np.exp(-dist))
    scores = earth.groupby(SITE_COL)["similarity"].quantile(quantile).sort_values(ascending=False)
    return pd.DataFrame({"site": scores.index, "simple_rank": np.arange(1, len(scores) + 1)})


def method_agreement(knn_sites: pd.DataFrame, simple: pd.DataFrame, top: int = 5) -> dict:
    merged = knn_sites[["site", "rank"]].merge(simple, on="site")
    rho = spearmanr(merged["rank"], merged["simple_rank"]).statistic if len(merged) > 2 else float("nan")
    knn_top = set(merged.nsmallest(top, "rank")["site"])
    simple_top = set(merged.nsmallest(top, "simple_rank")["site"])
    return {"status": "INFO", "label": "agreement ≠ accuracy",
            "top5_overlap": len(knn_top & simple_top), "spearman": float(rho),
            "note": "Two methods agreeing shows consistency, not that either is right."}


def mission_sensitivity(base: pd.DataFrame, others: dict[str, pd.DataFrame], warn_at: float = 0.95) -> dict:
    """Spearman correlation between this mission's ranking and each other mission's."""
    if not others:
        return {"status": "NOT RUN", "reason": "only one mission for this target"}
    rows = []
    for name, other in others.items():
        merged = base[["site", "rank"]].merge(other[["site", "rank"]], on="site", suffixes=("", "_other"))
        rho = spearmanr(merged["rank"], merged["rank_other"]).statistic if len(merged) > 2 else float("nan")
        rows.append({"mission": name, "spearman": float(rho),
                     "too_similar": bool(np.isfinite(rho) and rho >= warn_at)})
    out = {"status": "WARN" if any(r["too_similar"] for r in rows) else "PASS",
           "warn_at": warn_at, "comparisons": rows}
    if out["status"] == "WARN":
        out["warning"] = "Rankings are almost identical across missions: the weights may not be doing much."
    return out
