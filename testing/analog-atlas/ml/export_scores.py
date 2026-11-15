"""Package model scores for the web app.

From the laptop, after running your trained model over earth_index.csv.gz:

    python ml/export_scores.py my_scores.csv --card my_model_card.json [--validation my_validation.json]

my_scores.csv columns (header required; extra columns are optional):
    cell_id,test_id,score[,target_id][,uncertainty][,lat,lon]
    [,confidence][,low_evidence][,req_met][,req_not_met][,req_unknown][,flags][,spot_lat][,spot_lon][,note][,site_name]
    [,stable_runs][,total_runs][,score_percentile]
  * cell_id      from earth_index.csv.gz
  * test_id      a test id from src/config/missions.json, e.g. ltv.wheels
  * score        0..1, higher = better analog. Leave empty for "cannot score".
  * target_id    optional; a target id from targets.json, or "any" (default)
  * uncertainty  optional 0..1, higher = less sure (e.g. 1 - stability confidence)
  * lat, lon     optional site position; used to snap rows whose cell_id is not a land cell
  * detail columns (all optional, shown in the site panel when the model scored that cell):
      confidence 0..1 · low_evidence true/false · req_met/req_not_met/req_unknown "a;b;c"
      flags "a;b" · spot_lat/spot_lon (recommended test spot) · note text · site_name text
      stable_runs/total_runs (confidence = stable_runs / total_runs)
      score_percentile 0..100 (share of the other sites analysed in the same set this one out-scores)

Several rows for the same (cell, test, target): the highest score is kept, and its detail
row with it (--agg mean to average instead). Rows for cells outside the land index are
snapped to the nearest land cell within --snap-km (default 60) when lat/lon are given;
otherwise they are reported and dropped. Cells absent from the CSV get no model score:
the app labels them "not analysed by the model" and never treats them as 0.

Writes public/data/ml/manifest.json and one uint8 file per (test, target). Run
`python ml/validate.py` afterwards; the app refuses a bundle built for another index.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

from index_io import DATA, ROOT, EarthIndex, load_index

OUT = DATA / "ml"
MISSING = 255


def _test_ids() -> set[str]:
    m = json.loads((ROOT / "src" / "config" / "missions.json").read_text())
    return {t["id"] for s in m["systems"] for t in s["tests"]}


def _target_ids() -> set[str]:
    return {t["id"] for t in json.loads((ROOT / "src" / "config" / "targets.json").read_text())["targets"]} | {"any"}


def write_bundle(idx: EarthIndex, scores: dict, card: dict, validation: list | None = None, uncert: dict | None = None, details: dict | None = None) -> None:
    """scores: {(test_id, target_id): float array aligned to the index, NaN = cannot score}."""
    OUT.mkdir(parents=True, exist_ok=True)
    for old in list(OUT.glob("*.bin")) + list(OUT.glob("*.details.json")):
        old.unlink()
    sets = []
    for (test_id, target_id), s in sorted(scores.items()):
        s = np.asarray(s, dtype=np.float64)
        if s.shape != (idx.ids.size,):
            raise ValueError(f"{test_id}/{target_id}: expected {idx.ids.size} scores, got {s.shape}")
        if np.nanmin(s) < 0 or np.nanmax(s) > 1:
            raise ValueError(f"{test_id}/{target_id}: scores must be within 0..1")
        q = np.full(s.size, MISSING, np.uint8)
        ok = np.isfinite(s)
        q[ok] = np.round(s[ok] * 254).astype(np.uint8)
        name = f"{test_id}__{target_id}.bin"
        (OUT / name).write_bytes(q.tobytes())
        entry = {"test_id": test_id, "target_id": target_id, "file": f"ml/{name}", "dtype": "uint8", "scale": 254, "missing": MISSING,
                 "coverage": round(float(ok.mean()), 4)}
        if uncert and (test_id, target_id) in uncert:
            u = np.asarray(uncert[(test_id, target_id)])
            uq = np.full(u.size, MISSING, np.uint8)
            uok = np.isfinite(u)
            uq[uok] = np.round(np.clip(u[uok], 0, 1) * 254).astype(np.uint8)
            uname = f"{test_id}__{target_id}.unc.bin"
            (OUT / uname).write_bytes(uq.tobytes())
            entry["uncertainty_file"] = f"ml/{uname}"
        if details and details.get((test_id, target_id)):
            dname = f"{test_id}__{target_id}.details.json"
            (OUT / dname).write_text(json.dumps(details[(test_id, target_id)], separators=(",", ":")))
            entry["details_file"] = f"ml/{dname}"
        entry["scored_cells"] = int(ok.sum())
        entry["sparse"] = bool(ok.mean() < 0.5)
        sets.append(entry)
    manifest = {
        "schema_version": 1,
        "index_fingerprint": idx.fingerprint,
        "index_rows": int(idx.ids.size),
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": card,
        "sets": sets,
        "validation": validation or [],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(sets)} score sets to {OUT} (index {idx.fingerprint})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scores_csv")
    ap.add_argument("--card", required=True, help="JSON model card: name, version, kind, trained_on, inputs, limits")
    ap.add_argument("--validation", help="optional JSON list shown on the Trust page")
    ap.add_argument("--agg", choices=["max", "mean"], default="max", help="several sites in one cell: keep the best (default) or average")
    ap.add_argument("--snap-km", type=float, default=60.0, help="snap off-index rows with lat/lon to the nearest land cell within this distance")
    a = ap.parse_args()

    idx = load_index()
    pos = {int(c): i for i, c in enumerate(idx.ids)}
    tests, targets = _test_ids(), _target_ids()
    rad = np.radians
    xyz = lambda la, lo: np.c_[np.cos(rad(la)) * np.cos(rad(lo)), np.cos(rad(la)) * np.sin(rad(lo)), np.sin(rad(la))]
    land_xyz = xyz(idx.lat, idx.lon)
    best: dict = {}          # (test, target, i) -> list of (score, row)
    dropped, snapped = [], []
    with open(a.scores_csv, newline="") as fh:
        for n, row in enumerate(csv.DictReader(fh), start=2):
            t, tg = row["test_id"].strip(), (row.get("target_id") or "any").strip()
            if t not in tests or tg not in targets:
                raise SystemExit(f"line {n}: unknown test_id/target_id {t}/{tg}. Valid tests: {sorted(tests)}; targets: {sorted(targets)}")
            if row["score"].strip() == "":
                continue
            v = float(row["score"])
            if not 0 <= v <= 1:
                raise SystemExit(f"line {n}: score {v} outside 0..1. Rescale before exporting.")
            i = pos.get(int(row["cell_id"]))
            if i is None and row.get("lat") and row.get("lon"):
                d = 2 * 6371.0 * np.arcsin(np.clip(np.linalg.norm(land_xyz - xyz(float(row["lat"]), float(row["lon"])), axis=1) / 2, 0, 1))
                j = int(np.argmin(d))
                if d[j] <= a.snap_km:
                    i = j
                    snapped.append((row.get("site_name") or row["cell_id"], int(idx.ids[j]), round(float(d[j]), 1)))
            if i is None:
                dropped.append(row.get("site_name") or row["cell_id"])
                continue
            best.setdefault((t, tg, i), []).append((v, row))
    if snapped:
        print(f"snapped {len(snapped)} rows to the nearest land cell: " + "; ".join(f"{s0} -> {c} ({k} km)" for s0, c, k in snapped))
    if dropped:
        print(f"WARNING dropped {len(dropped)} rows not on any land cell (add lat/lon or raise --snap-km): {dropped[:10]}")
    scores = defaultdict(lambda: np.full(idx.ids.size, np.nan))
    unc, details, merged = {}, defaultdict(dict), 0
    for (t, tg, i), rows in best.items():
        merged += len(rows) > 1
        rows.sort(key=lambda r: r[0], reverse=True)
        v = float(np.mean([r[0] for r in rows])) if a.agg == "mean" else rows[0][0]
        top = rows[0][1]
        scores[(t, tg)][i] = v
        if top.get("uncertainty"):
            unc.setdefault((t, tg), np.full(idx.ids.size, np.nan))[i] = float(top["uncertainty"])
        det = {}
        for k in ("confidence", "spot_lat", "spot_lon", "score_percentile"):
            if top.get(k):
                det[k] = float(top[k])
        for k in ("stable_runs", "total_runs"):
            if top.get(k):
                det[k] = int(float(top[k]))
        if top.get("uncertainty"):
            det["uncertainty"] = float(top["uncertainty"])
        if top.get("low_evidence"):
            det["low_evidence"] = top["low_evidence"].strip().lower() in ("1", "true", "yes", "y")
        for k in ("req_met", "req_not_met", "req_unknown", "flags"):
            if top.get(k):
                det[k] = [x.strip() for x in top[k].split(";") if x.strip()]
        for k in ("note", "site_name"):
            if top.get(k):
                det[k] = top[k].strip()
        if len(rows) > 1:
            det["sites_in_cell"] = len(rows)
            det["aggregation"] = a.agg
        if det:
            details[(t, tg)][str(int(idx.ids[i]))] = det
    if merged:
        print(f"{merged} cells had several sites; kept the {'mean' if a.agg == 'mean' else 'highest'} score")
    card = json.loads(open(a.card).read())
    card.setdefault("demo", False)
    validation = json.loads(open(a.validation).read()) if a.validation else []
    write_bundle(idx, dict(scores), card, validation, unc, dict(details))


if __name__ == "__main__":
    main()
