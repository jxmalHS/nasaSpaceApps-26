"""One command on the laptop: score every test with your model and write the web bundle.

    python ml/run_model.py --card model_card.json [--per-target] [--validation validation.json]

Uses adapter.load() / adapter.predict(). With --per-target the model is called once per
(test, target) pair the test applies to; otherwise once per test with target=None.
Then commit public/data/ml/ (or upload it to the deployed site's /data/ml/).
"""
from __future__ import annotations

import argparse
import json

import adapter
from export_scores import write_bundle
from index_io import ROOT, load_index


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--card", required=True)
    ap.add_argument("--per-target", action="store_true")
    ap.add_argument("--validation")
    a = ap.parse_args()
    idx = load_index()
    df = idx.to_frame()
    model = adapter.load()
    missions = json.loads((ROOT / "src" / "config" / "missions.json").read_text())
    targets = json.loads((ROOT / "src" / "config" / "targets.json").read_text())["targets"]
    scores = {}
    for s in missions["systems"]:
        for t in s["tests"]:
            if a.per_target:
                for tg in targets:
                    if tg["body"] in t["bodies"]:
                        scores[(t["id"], tg["id"])] = adapter.predict(model, df, t["id"], tg)
            else:
                scores[(t["id"], "any")] = adapter.predict(model, df, t["id"], None)
            print("scored", t["id"])
    card = json.loads(open(a.card).read())
    validation = json.loads(open(a.validation).read()) if a.validation else []
    write_bundle(idx, scores, card, validation)


if __name__ == "__main__":
    main()
