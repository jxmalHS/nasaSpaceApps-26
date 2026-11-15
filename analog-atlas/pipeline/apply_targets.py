"""Copy the measured target values (pipeline/target_terrain.json) into src/config/targets.json.

    python pipeline/measure_targets.py --check   # once: Earth calibration
    python pipeline/measure_targets.py           # measure every target
    python pipeline/apply_targets.py             # write them into the website's target profiles

Each measured value gets s = "measured", src = where it came from, and was = the old placeholder
(kept so the change is visible). Values the pipeline cannot measure are left untouched.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ROOT / "src" / "config" / "targets.json"
MEASURED = ROOT / "pipeline" / "target_terrain.json"
COMMENT = ("'measured' = computed by our pipeline from NASA data at the Earth index's scale "
           "(pipeline/measure_targets.py; 'was' keeps the old placeholder); ")


def terrain_source(t: dict) -> str:
    if t["body"] == "mars":
        return "MGS MOLA 463 m"
    return "LOLA LDEM_80S_80M" if t["lat"] <= -83 else "LOLA LDEM_16"


def main() -> None:
    raw = TARGETS.read_text(encoding="utf-8")
    T = json.loads(raw)
    M = json.loads(MEASURED.read_text(encoding="utf-8"))
    cal = M["calibration"]
    changed = 0
    for t in T["targets"]:
        m = M["targets"][t["id"]]
        src = terrain_source(t)
        vals = {f: (m[f], f"{src}, measured at the Earth index's scale ({M['cell_km']} km cell; "
                           f"{M['rough_px_km']} km roughness pixels), x{cal[f]['factor']} Earth calibration")
                for f in ("slope_deg", "rough_m")}
        if "temperature" in m:
            for f in ("lst_dtr_K", "t_mean_C", "t_range_K"):
                vals[f] = (m["temperature"][f], m["temperature"]["source"])
        for f, (v, s) in vals.items():
            old = t["f"].get(f, {})
            was = old.get("was", old.get("v")) if old.get("s") == "measured" else old.get("v")
            t["f"][f] = {"v": v, "s": "measured", "was": was, "src": s}
            changed += 1
        notes = [f"Terrain (slope, roughness): {src}, measured at Earth-index scale"]
        if "temperature" in m:
            notes.append("Temperatures: Diviner polar seasonal maps (Williams et al. 2019), cell mean")
        t["sources"] = notes + [s for s in t["sources"] if s not in notes and not s.startswith(("Terrain (slope", "Temperatures: Diviner"))]
    if COMMENT not in T["_comment"]:
        T["_comment"] = T["_comment"].replace("'verify' = published", COMMENT + "'verify' = published")
    T["measurement"] = {"method": M["method"], "cell_km": M["cell_km"], "rough_px_km": M["rough_px_km"],
                        "calibration": cal, "script": "pipeline/measure_targets.py"}
    TARGETS.write_text(json.dumps(T, indent=1, ensure_ascii=False) + ("\n" if raw.endswith("\n") else ""),
                       encoding="utf-8")
    print(f"{changed} values written to {TARGETS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
