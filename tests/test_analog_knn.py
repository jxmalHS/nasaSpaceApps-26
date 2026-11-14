"""Tests for analog_knn.py, using small made-up tile tables (no real data needed)."""
import numpy as np
import pandas as pd
import pytest

from analog_knn import run_knn

WEIGHTS = {"slope_mean": 1.0, "rough_small": 0.5}


def make_site(name, role, slope, rough, n=10, spread=0.5, seed=0):
    """n tiles for one site, scattered around a given slope and roughness."""
    rng = np.random.default_rng(seed)
    return pd.DataFrame({
        "site": name, "role": role,
        "tile_id": [f"{name}_{i}" for i in range(n)],
        "slope_mean": slope + rng.normal(0, spread, n),
        "rough_small": rough + rng.normal(0, spread, n),
        "temperature": rng.normal(250, 50, n),          # deliberately not in WEIGHTS
    })


@pytest.fixture
def tiles():
    return pd.concat([
        make_site("moon", "target", 9.0, 8.0, n=20, seed=1),
        make_site("good_candidate", "candidate", 9.2, 7.9, seed=2),
        make_site("far_candidate", "candidate", 25.0, 30.0, seed=3),
        make_site("baseline_A", "baseline", 7.0, 6.0, seed=4),
        make_site("baseline_B", "baseline", 3.0, 2.0, seed=5),
        make_site("farmland", "negative_control", 0.2, 0.1, seed=6),
    ], ignore_index=True)


def test_docs_example_runs():
    tiles = pd.DataFrame({
        "site": ["moon_A"] * 3 + ["baseline_B"] * 2 + ["candidate_X"] * 2,
        "role": ["target"] * 3 + ["baseline"] * 2 + ["candidate"] * 2,
        "slope_mean": [8.0, 9.5, 7.2, 6.1, 7.0, 8.3, 9.0],
        "rough_small": [7.5, 8.1, 6.9, 5.0, 5.6, 7.7, 8.4],
    })
    result = run_knn(tiles, weights=WEIGHTS, k=2)
    assert list(result.sites["rank"]) == [1, 2]
    assert set(result.sites["site"]) == {"baseline_B", "candidate_X"}


def test_closest_site_ranks_first_and_controls_rank_low(tiles):
    sites = run_knn(tiles, WEIGHTS).sites.set_index("site")
    assert sites.loc["good_candidate", "rank"] == 1
    assert sites.loc["farmland", "rank"] > len(sites) / 2
    assert "moon" not in sites.index                     # the target is never ranked
    assert sites["score"].between(0, 1).all()


def test_ignored_measurement_has_no_effect(tiles):
    a = run_knn(tiles, WEIGHTS).sites
    changed = tiles.copy()
    changed["temperature"] *= 100                         # temperature is not in WEIGHTS
    b = run_knn(changed, WEIGHTS).sites
    pd.testing.assert_frame_equal(a, b)


def test_only_weight_ratio_matters(tiles):
    a = run_knn(tiles, {"slope_mean": 2.0, "rough_small": 1.0}).sites
    b = run_knn(tiles, {"slope_mean": 1.0, "rough_small": 0.5}).sites
    pd.testing.assert_frame_equal(a, b)


def test_same_input_same_output(tiles):
    pd.testing.assert_frame_equal(run_knn(tiles, WEIGHTS).sites, run_knn(tiles, WEIGHTS).sites)


def test_missing_values_are_dropped_and_counted(tiles):
    tiles.loc[tiles["site"] == "good_candidate", "slope_mean"] = [np.nan, np.nan] + [9.0] * 8
    row = run_knn(tiles, WEIGHTS).sites.set_index("site").loc["good_candidate"]
    assert row["n_tiles_dropped"] == 2 and row["n_tiles_used"] == 8


def test_baselines_never_compared_with_themselves(tiles):
    result = run_knn(tiles, WEIGHTS)
    own = result.tiles[result.tiles["site"] == "baseline_A"]
    assert own["distance_to_baseline:baseline_A"].isna().all()
    sites = result.sites.set_index("site")
    assert sites.loc["baseline_A", "nearest_baseline"] == "baseline_B"
    assert "baseline_A" not in sites.loc["baseline_A", "closer_than_baselines"]
    assert sites.loc["good_candidate", "closer_than_baselines"] == "baseline_A, baseline_B"


def test_best_tile_location_is_reported(tiles):
    result = run_knn(tiles, WEIGHTS)
    row = result.sites.set_index("site").loc["good_candidate"]
    own = result.tiles[result.tiles["site"] == "good_candidate"]
    assert row["best_tile_tile_id"] == own.loc[own["similarity"].idxmax(), "tile_id"]


def test_coverage_catches_partial_match():
    """A site matching only the smooth part of a mixed target gets low coverage."""
    mixed_target = pd.concat([make_site("moon", "target", 15.0, 15.0, n=15, seed=1),   # cratered
                              make_site("moon", "target", 3.0, 3.0, n=5, seed=2)])      # smooth spots
    tiles = pd.concat([
        mixed_target,
        make_site("smooth_only", "candidate", 3.0, 3.0, seed=3),
        make_site("full_match", "candidate", 15.0, 15.0, n=15, seed=4),
        make_site("full_match", "candidate", 3.0, 3.0, n=5, seed=5),
    ], ignore_index=True)
    sites = run_knn(tiles, WEIGHTS).sites.set_index("site")
    assert sites.loc["full_match", "target_coverage"] > sites.loc["smooth_only", "target_coverage"]
    assert sites.loc["smooth_only", "target_coverage"] <= 0.5


@pytest.mark.parametrize("change, message", [
    (lambda t: t.drop(columns="slope_mean"), "missing these columns"),
    (lambda t: t.assign(role=t["role"].replace("candidate", "maybe")), "Unknown role"),
    (lambda t: t.assign(role=np.where(t.index == 0, "baseline", t["role"])), "different roles"),
    (lambda t: t[t["role"] != "target"], "No usable target tiles"),
])
def test_bad_input_gives_clear_error(tiles, change, message):
    with pytest.raises(ValueError, match=message):
        run_knn(change(tiles), WEIGHTS)


def test_bad_weights_and_settings(tiles):
    with pytest.raises(ValueError, match="above 0"):
        run_knn(tiles, {"slope_mean": 0.0})
    with pytest.raises(ValueError, match="No weights"):
        run_knn(tiles, {})
    with pytest.raises(ValueError, match="k must be"):
        run_knn(tiles, WEIGHTS, k=0)
