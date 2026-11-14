"""
mission.py - step 1 of the pipeline: a mission sorts EVERY condition into

    target       - must match the Moon/Mars target (has a weight)
    ignored      - doesn't matter for this test
    interference - would ruin the test (Earth only, e.g. trees, snow); has limits

plus MANDATORY requirements: pass/fail rules that are set BEFORE ranking, e.g.
"steepest-10% slope within 5 degrees of the target".

Typos, missing conditions, wrong units and contradictions stop the program
with a clear message.
"""
from __future__ import annotations

import difflib
from dataclasses import dataclass, field

import numpy as np

from features import FEATURE_INFO
from landcover import LANDCOVER_FEATURES

# Conditions with no data module yet. A mission may IGNORE them; using them as
# targets or requirements is allowed but they will always be "unknown".
PLANNED = {"surface_temperature": "K", "minerals": "various"}

UNITS = {**{f: info[0] for f, info in FEATURE_INFO.items()},
         **{f: "fraction" for f in LANDCOVER_FEATURES}, **PLANNED}
RULES = ("max_abs_diff", "max", "min")
MET, NOT_MET, UNKNOWN = "met", "not_met", "unknown"


@dataclass(frozen=True)
class Requirement:
    feature: str
    rule: str           # max_abs_diff (compared with the target) | max | min (fixed limits)
    limit: float
    unit: str

    @property
    def id(self) -> str:
        return f"{self.feature}_{self.rule}"

    def describe(self) -> str:
        if self.rule == "max_abs_diff":
            return f"{self.feature} within {self.limit:g} {self.unit} of the target"
        return f"{self.feature} {'<=' if self.rule == 'max' else '>='} {self.limit:g} {self.unit}"

    def check(self, value: float, target: float) -> str:
        """met / not_met / unknown. Missing data is unknown, and unknown never counts as met."""
        if value is None or not np.isfinite(value):
            return UNKNOWN
        if self.rule == "max_abs_diff":
            if target is None or not np.isfinite(target):
                return UNKNOWN
            return MET if abs(value - target) <= self.limit else NOT_MET
        ok = value <= self.limit if self.rule == "max" else value >= self.limit
        return MET if ok else NOT_MET


@dataclass
class Mission:
    name: str
    description: str
    body: str
    target: str
    weights: dict[str, float]
    ignored: list[str]
    interference: dict[str, dict]
    mandatory: list[Requirement] = field(default_factory=list)

    def role_of(self, feature: str) -> str:
        if feature in self.weights:
            return "target"
        if feature in self.interference:
            return "interference"
        return "ignored"


def _known(name: str, where: str) -> None:
    if name not in UNITS:
        hint = difflib.get_close_matches(name, UNITS, n=2)
        raise ValueError(f"{where}: unknown condition '{name}'" + (f" (did you mean {hint}?)" if hint else ""))


def parse_mission(name: str, raw: dict) -> Mission:
    """Check a mission from missions.yaml and turn it into a Mission."""
    feats = raw.get("features") or {}
    weights = {k: float(v) for k, v in (feats.get("target") or {}).items()}
    ignored = list(feats.get("ignored") or [])
    interference = dict(feats.get("interference") or {})
    if not weights:
        raise ValueError(f"{name}: features.target needs at least one weighted condition")

    for f, w in weights.items():
        _known(f, f"{name}.target")
        if not w > 0:
            raise ValueError(f"{name}: weight of '{f}' must be above 0 (put it under 'ignored' instead)")
        if f in PLANNED:
            raise ValueError(f"{name}: '{f}' has no data module yet, so it can't be a weighted target")
    for f in ignored:
        _known(f, f"{name}.ignored")
    for f, lim in interference.items():
        _known(f, f"{name}.interference")
        if not lim or set(lim) - {"max", "min"}:
            raise ValueError(f"{name}: interference '{f}' needs a limit like {{max: 0.3}}")

    groups = [set(weights), set(ignored), set(interference)]
    both = (groups[0] & groups[1]) | (groups[0] & groups[2]) | (groups[1] & groups[2])
    if both:
        raise ValueError(f"{name}: conditions listed in two categories: {sorted(both)}")
    # Step 1 says EVERY condition is sorted, so nothing with data may be left out.
    unsorted = sorted((set(FEATURE_INFO) | set(LANDCOVER_FEATURES)) - set().union(*groups))
    if unsorted:
        raise ValueError(f"{name}: these conditions are not sorted into target/ignored/interference: {unsorted}")

    mandatory = []
    for i, r in enumerate(raw.get("mandatory") or []):
        rules = [k for k in RULES if k in r]
        if len(rules) != 1:
            raise ValueError(f"{name}.mandatory[{i}]: give exactly one of {RULES}")
        _known(r.get("feature", ""), f"{name}.mandatory[{i}]")
        if r.get("unit") != UNITS[r["feature"]]:
            raise ValueError(f"{name}.mandatory[{i}]: unit '{r.get('unit')}' should be '{UNITS[r['feature']]}'")
        mandatory.append(Requirement(r["feature"], rules[0], float(r[rules[0]]), r["unit"]))

    return Mission(name, raw.get("description", ""), raw["body"], raw["target"],
                   weights, ignored, interference, mandatory)
