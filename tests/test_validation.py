"""Tests for the held-out, simple-method and mission-sensitivity checks."""
import numpy as np
import pandas as pd
import pytest

import validation
from analog_knn import run_knn

W = {"slope_mean": 1.0, "rough_small": 0.5}


def site(name, role, slope, rough, n=8, seed=0):
    rng = np.random.default_rng(seed)
    return pd.DataFrame({"site": name, "role": role, "tile_id": [f"t{i}" for i in range(n)],
                         "slope_mean": slope + rng.normal(0, 0.5, n),
                         "rough_small": rough + rng.normal(0, 0.5, n)})


@pytest.fixture
def table():
    parts = [site("moon", "target", 9, 8, n=20, seed=1),
             site("nasa_a", "baseline", 9.2, 7.9, seed=2), site("nasa_b", "baseline", 8.5, 8.5, seed=3),
             site("farm", "negative_control", 0.2, 0.1, seed=4)]
    parts += [site(f"crater_{i}", "candidate", 2 + 2 * i, 1 + 2 * i, seed=10 + i) for i in range(6)]
    return pd.concat(parts, ignore_index=True)


def test_exclude_from_fit_changes_only_the_scaler(table):
    a = run_knn(table, W).sites.set_index("site")
    b = run_knn(table, W, exclude_from_fit=("nasa_a",)).sites.set_index("site")
    assert "nasa_a" in b.index                                 # still scored, just not fitted on
    assert set(a.index) == set(b.index)


def test_held_out_nasa_sites_rank_high(table):
    out = validation.held_out_test(table, W, k=5, quantile=0.75)
    assert {h["site"] for h in out["held_out"]} == {"nasa_a", "nasa_b"}
    assert out["recall_at_5"] == 1.0
    assert out["status"] == "WARN"                             # only 9 sites: says so loudly


def test_held_out_without_baselines():
    t = pd.concat([site("moon", "target", 9, 8), site("c", "candidate", 5, 5)], ignore_index=True)
    assert validation.held_out_test(t, W, 5, 0.75)["status"] == "NOT RUN"


def test_simple_method_and_agreement(table):
    simple = validation.simple_method_ranking(table, W, 0.75)
    assert simple.iloc[-1]["site"] == "farm" or simple.set_index("site").at["farm", "simple_rank"] > 5
    agree = validation.method_agreement(run_knn(table, W).sites, simple)
    assert agree["label"] == "agreement ≠ accuracy" and 0 <= agree["top5_overlap"] <= 5


def test_mission_sensitivity_flags_identical_rankings(table):
    base = run_knn(table, W).sites
    assert validation.mission_sensitivity(base, {"same": base})["status"] == "WARN"
    assert validation.mission_sensitivity(base, {})["status"] == "NOT RUN"
