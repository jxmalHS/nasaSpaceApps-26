"""Demo model: learn per-test feature weights from NASA's historical analog choices.

    python ml/train_demo.py

This is a stand-in so the whole ML route works end to end before the real model
(trained on the separate laptop) is dropped in. It is deliberately simple and honest:

  * Features are the test's measured target + interference features, mapped to their
    Earth percentile so units do not dominate.
  * Weights are learned from the precedent sites of each test: features on which the
    documented sites agree closely get more weight (inverse variance across sites).
  * A cell's score is its best kernel similarity to any precedent site.
  * Validation holds each precedent site out, refits on the rest and records the
    percentile at which the held-out site is retrieved. Tests with a single precedent
    cannot be validated and say so.

Writes public/data/ml/ through export_scores.write_bundle, the same function the
laptop's real model uses, so the frontend cannot tell the two apart except by the
model card.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from export_scores import write_bundle
from index_io import ROOT, load_index, quantile_transform

CFG = ROOT / "src" / "config"
SIGMA = 0.18


def fit_weights(P: np.ndarray) -> np.ndarray:
    if P.shape[0] < 2:
        return np.ones(P.shape[1]) / P.shape[1]
    var = np.nanvar(P, axis=0)
    w = 1.0 / (var + 0.01)
    w = np.where(np.isfinite(w), w, 0)
    return w / w.sum()


def score(Z: np.ndarray, P: np.ndarray, w: np.ndarray) -> np.ndarray:
    best = np.zeros(Z.shape[0])
    for p in P:
        d = (Z - p) ** 2
        ok = np.isfinite(d)
        wk = np.where(ok, w, 0.0)
        wsum = wk.sum(axis=1)
        dist = np.where(ok, d, 0).dot(w) / np.maximum(wsum, 1e-9)
        s = np.exp(-dist / (2 * SIGMA**2))
        s[wsum < 0.5] = np.nan  # too little evidence to score this cell
        best = np.fmax(best, s)
    return best


def main() -> None:
    idx = load_index()
    features = {f["id"]: f for f in json.loads((CFG / "features.json").read_text())["features"]}
    missions = json.loads((CFG / "missions.json").read_text())
    cells = idx.meta["analog_cells"]
    qtab = {c["id"]: c["q"] for c in idx.meta["columns"]}

    scores, validation = {}, []
    for system in missions["systems"]:
        for t in system["tests"]:
            feats = [f for f in list(t["target"]) + list(t["interference"]) if f in qtab]
            if not t["baseline"] or not feats:
                validation.append({"test_id": t["id"], "status": "no_precedent", "note": "No documented field site to learn from."})
                continue
            Z = np.column_stack([quantile_transform(idx.col(f), qtab[f]) for f in feats])
            rows = [cells[b]["index"] for b in t["baseline"] if cells[b]["offset_km"] <= 60]
            if not rows:
                validation.append({"test_id": t["id"], "status": "no_precedent", "note": "Precedent sites fall outside the land index."})
                continue
            P = Z[rows]
            w = fit_weights(P)
            s = score(Z, P, w)
            scores[(t["id"], "any")] = s

            entry = {"test_id": t["id"], "features": feats, "weights": dict(zip(feats, np.round(w, 3).tolist())), "precedents": len(rows)}
            if len(rows) < 2:
                entry.update(status="single_precedent", note="One precedent site: nothing to hold out.")
            else:
                held = []
                for k, r in enumerate(rows):
                    rest = [x for i, x in enumerate(rows) if i != k]
                    s_k = score(Z, Z[rest], fit_weights(Z[rest]))
                    valid = s_k[np.isfinite(s_k)]
                    pct = float((valid < s_k[r]).mean() * 100) if np.isfinite(s_k[r]) else None
                    held.append({"site": [b for b in t["baseline"] if cells[b]["index"] == r][0], "percentile": None if pct is None else round(pct, 1)})
                p = [h["percentile"] for h in held if h["percentile"] is not None]
                entry.update(status="loo", held_out=held, median_percentile=round(float(np.median(p)), 1) if p else None,
                             top5_rate=round(float(np.mean([x >= 95 for x in p])), 2) if p else None)
            validation.append(entry)
            print(f"{t['id']:16s} {entry['status']:16s} {entry.get('median_percentile', '')}")

    card = {
        "name": "Precedent-similarity (demo)",
        "version": "0.1.0-demo",
        "kind": "kernel similarity to documented NASA field sites, weights learned per test",
        "trained_on": "Documented precedent sites in src/config/analogs.json and the 0.5° Earth index",
        "inputs": "Earth percentile of each measured target and interference feature",
        "limits": "Learns what NASA already chose, so it rewards look-alikes of known sites. That is the opposite of discovery, which is why the app shows it next to the rule-based score, never instead of it.",
        "demo": True,
    }
    write_bundle(idx, scores, card, validation)


if __name__ == "__main__":
    main()
