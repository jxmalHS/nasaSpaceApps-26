"""Tests for atlas_export.py: our results -> the Analog Atlas sparse-score CSV."""
import json

import pandas as pd

import atlas_export
import pipeline
from test_pipeline import fake_project  # noqa: F401  (pytest fixture)


def test_cell_id_matches_the_atlas_grid():
    assert atlas_export.cell_id(89.9, -179.9) == 0                     # row 0, col 0
    assert atlas_export.cell_id(89.9, 180.0) == 719                    # lon 180 clamped to the last column
    assert atlas_export.cell_id(-90.0, -179.9) == 359 * 720            # lat -90 clamped to the last row
    assert atlas_export.cell_id(35.0333, -111.017) == 109 * 720 + 137  # Meteor Crater


def test_export_converts_results_without_reranking(fake_project, monkeypatch):  # noqa: F811
    monkeypatch.setitem(atlas_export.ATLAS_MAP, "moon_rover_south_pole", ("ltv.wheels", "connecting-ridge"))
    out = pipeline.run_mission("moon_rover_south_pole", fake_project, run_stability=False)
    dest = atlas_export.export_atlas(fake_project)
    scores = pd.read_csv(dest / "scores.csv")
    ranking = pd.read_csv(out / "ranking.csv")

    assert len(scores) == len(ranking)                                 # one row per ranked site
    assert scores["score"].between(0, 1).all()
    assert set(scores["test_id"]) == {"ltv.wheels"} and set(scores["target_id"]) == {"connecting-ridge"}
    assert scores.set_index("site_name")["score"].round(4).to_dict() == \
        ranking.set_index(ranking["site"].str.replace("_", " ").str.title())["score"].round(4).to_dict()
    card = json.loads((dest / "model_card.json").read_text())
    assert {"name", "version", "kind", "trained_on", "limits"} <= set(card) and card["demo"] is False
    assert {"score_definition", "confidence_definition", "small_change_definition", "low_evidence_rule"} <= set(card)

    # Trust-page shape: one 'loo' entry per (test, target), percentiles 0-100, website ids only in held_out
    val = json.loads((dest / "validation.json").read_text())
    loo = [e for e in val if e.get("status") == "loo"]
    assert [(e["test_id"], e["target_id"]) for e in loo] == [("ltv.wheels", "connecting-ridge")]
    e = loo[0]
    assert all(h["site"] == "sf-volcanic-field" for h in e["held_out"])   # only places the website knows
    assert {x["site"] for x in e["engine_held_out"]} == {"meteor_crater", "buffalo_park"}
    assert all(0 <= x["percentile"] <= 100 for x in e["engine_held_out"]) and "population" in e


def test_percentile_means_share_of_other_sites_beaten():
    assert atlas_export.percentile_from_rank(1, 32) == 100.0
    assert atlas_export.percentile_from_rank(32, 32) == 0.0
    assert atlas_export.percentile_from_rank(4, 32) == 90.3          # beats 28 of the other 31
    assert atlas_export.percentile_from_rank(1, 1) == 100.0
