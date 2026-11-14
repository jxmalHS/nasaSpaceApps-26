"""Check an ML bundle before deploying:  python ml/validate.py

Fails loudly if the bundle was built for another index build, if a file is the wrong
size, if test/target ids do not exist, or if a set scores almost nothing.
"""
from __future__ import annotations

import json
import sys

import numpy as np

from index_io import DATA, ROOT, load_index


def main() -> int:
    idx = load_index()
    man = json.loads((DATA / "ml" / "manifest.json").read_text())
    m = json.loads((ROOT / "src" / "config" / "missions.json").read_text())
    tests = {t["id"] for s in m["systems"] for t in s["tests"]}
    targets = {t["id"] for t in json.loads((ROOT / "src" / "config" / "targets.json").read_text())["targets"]} | {"any"}
    errors = []
    if man["index_fingerprint"] != idx.fingerprint:
        errors.append(f"index fingerprint {man['index_fingerprint']} != current {idx.fingerprint}: re-export scores against this index")
    for key in ("name", "version", "kind", "trained_on", "limits"):
        if key not in man["model"]:
            errors.append(f"model card is missing '{key}'")
    for s in man["sets"]:
        f = DATA / s["file"]
        if s["test_id"] not in tests or s["target_id"] not in targets:
            errors.append(f"{s['file']}: unknown test/target id")
        if not f.exists() or f.stat().st_size != idx.ids.size:
            errors.append(f"{s['file']}: expected {idx.ids.size} bytes")
            continue
        q = np.frombuffer(f.read_bytes(), np.uint8)
        cov = float((q != s["missing"]).mean())
        n_ok = int((q != s["missing"]).sum())
        if n_ok == 0:
            errors.append(f"{s['file']}: no cells scored")
        kind = "sparse" if cov < 0.5 else "dense"
        print(f"ok  {s['test_id']:16s} {s['target_id']:20s} {n_ok:6d} cells ({cov:.2%}, {kind})")
        if s.get("details_file") and not (DATA / s["details_file"]).exists():
            errors.append(f"{s['details_file']} listed but missing")
    for e in errors:
        print("ERROR", e)
    print("bundle valid" if not errors else f"{len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
