"""Plug your laptop-trained model in here. This is the ONLY file you need to edit.

The rest of the pipeline (export_scores.py for the static route, serve.py for the
live route) calls these two functions.

Contract
--------
load()                       -> any object. Called once.
predict(model, df, test_id, target) -> numpy array of len(df), values 0..1, NaN = cannot score.

  df      pandas DataFrame from earth_index (columns: cell_id, lat, lon, and every
          feature id in ml/feature_schema.json, in the units listed there; NaN = missing).
  test_id e.g. "ltv.wheels" (src/config/missions.json)
  target  dict from src/config/targets.json, or None for target-agnostic models.

Keep missing inputs missing. If your model cannot score a row, return NaN for it:
the app shows that as Unknown, never as a pass.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

MODEL_PATH = Path(__file__).with_name("model.joblib")  # copy your artifact here


def load():
    if MODEL_PATH.exists():
        import joblib  # scikit-learn / xgboost / lightgbm pipelines

        return joblib.load(MODEL_PATH)
    return None  # no artifact yet: predict() falls back to a transparent baseline


def predict(model, df, test_id: str, target: dict | None) -> np.ndarray:
    if model is not None:
        # Expected artifact (save it on the laptop with joblib.dump):
        #   {"features": ["slope_deg", "rough_m", ...],      # columns you trained on, in order
        #    "models": {"ltv.wheels": estimator, ...}}         # anything with predict_proba or predict
        est = model["models"].get(test_id)
        if est is None:
            return np.full(len(df), np.nan)               # model has nothing to say about this test
        X = df[model["features"]]
        out = np.full(len(df), np.nan)
        ok = X.notna().all(axis=1).to_numpy()             # never impute silently
        if ok.any():
            pred = est.predict_proba(X[ok])[:, 1] if hasattr(est, "predict_proba") else est.predict(X[ok])
            out[ok] = np.clip(pred, 0, 1)
        return out
    # Fallback: inverse rank of distance to the target on the features it defines.
    if target is None:
        return np.full(len(df), np.nan)
    feats = [f for f, v in target["f"].items() if f in df.columns and v.get("v") is not None]
    if not feats:
        return np.full(len(df), np.nan)
    Z = df[feats].rank(pct=True).to_numpy()
    t = np.array([(df[f] <= target["f"][f]["v"]).mean() for f in feats])
    d = np.sqrt(np.nanmean((Z - t) ** 2, axis=1))
    return 1 - np.clip(d, 0, 1)
