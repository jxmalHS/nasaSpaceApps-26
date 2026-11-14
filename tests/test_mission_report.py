"""Step 1 (mission sorting) and step 5 (report) on small made-up inputs."""
import numpy as np
import pandas as pd
import pytest

import report
from mission import MET, NOT_MET, UNKNOWN, Requirement, parse_mission

ALL_IGNORED = ["slope_std", "relief", "hypsometric_integral", "curvature_abs_mean", "rough_large",
               "pit_density", "slope_mean", "frac_steep", "grass_shrub_frac", "bare_frac",
               "tree_frac", "cropland_frac", "builtup_frac", "snow_ice_frac", "water_frac"]


def raw(**over):
    base = {"body": "moon", "target": "t",
            "features": {"target": {"slope_p90": 1.0, "rough_small": 0.5}, "ignored": list(ALL_IGNORED)},
            "mandatory": [{"feature": "slope_p90", "max_abs_diff": 5, "unit": "deg"}]}
    base.update(over)
    return base


def test_valid_mission():
    m = parse_mission("m", raw())
    assert m.role_of("slope_p90") == "target" and m.role_of("relief") == "ignored"


@pytest.mark.parametrize("change, message", [
    (lambda r: r["features"]["target"].update(slope_p9=1.0), "unknown condition"),
    (lambda r: r["features"]["ignored"].remove("relief"), "not sorted"),
    (lambda r: r["features"]["ignored"].append("slope_p90"), "two categories"),
    (lambda r: r["features"]["target"].update(rough_small=0), "above 0"),
    (lambda r: r["mandatory"][0].update(unit="m"), "should be 'deg'"),
    (lambda r: r["features"].update(interference={"tree_frac": {"below": 1}}) or
     r["features"]["ignored"].remove("tree_frac"), "needs a limit"),
])
def test_mission_mistakes_are_caught(change, message):
    r = raw()
    change(r)
    with pytest.raises(ValueError, match=message):
        parse_mission("m", r)


def test_requirement_rules():
    within = Requirement("slope_p90", "max_abs_diff", 5, "deg")
    assert within.check(12, 10) == MET and within.check(20, 10) == NOT_MET
    assert within.check(np.nan, 10) == UNKNOWN and within.check(12, np.nan) == UNKNOWN
    assert Requirement("rough_small", "max", 2, "m").check(1, None) == MET


def test_difference_statements_use_real_units():
    assert report.difference_statement("slope_p90", 4.2) == "Steepest-10% slope is 4.2° steeper than the target"
    assert report.difference_statement("rough_small", -1.5) == "Small-scale bumpiness is 1.5 m smoother than the target"
    assert "unknown" in report.difference_statement("relief", None)


def test_test_tile_prefers_requirements_over_similarity():
    m = parse_mission("m", raw())
    tiles = pd.DataFrame({"tile_id": ["a", "b"], "slope_p90": [40.0, 21.0], "similarity": [0.9, 0.5]})
    chosen = report.choose_test_tile(tiles, m, {"slope_p90": 20.0})
    assert chosen["tile_id"] == "b"                    # b meets the slope rule; a is more similar but fails


def test_missing_land_cover_is_never_shown_as_clear():
    assert report.interference_text({"interference_flags": "", "interference_unknown": "tree_frac"}) \
        == "unknown (tree_frac)"
    assert report.interference_text({"interference_flags": "", "interference_unknown": ""}) == "clear"
    assert report.interference_text({"interference_flags": "cropland_frac", "interference_unknown": ""}) \
        == "⚠️ cropland_frac"


def test_negative_control_check():
    good = pd.DataFrame({"site": ["a", "b", "c", "farm"], "role": ["candidate"] * 3 + ["negative_control"],
                         "rank": [1, 2, 3, 4]})
    assert report.negative_control_check(good)["status"] == "PASS"
    bad = good.assign(rank=[4, 2, 3, 1])
    assert report.negative_control_check(bad)["status"] == "FAIL"
