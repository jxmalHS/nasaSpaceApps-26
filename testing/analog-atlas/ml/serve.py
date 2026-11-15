"""Live ranking endpoint (optional route B).

    pip install -r ml/requirements.txt
    uvicorn serve:app --app-dir ml --port 8000

Then build the web app with VITE_ML_API=http://localhost:8000 (or your host).
The browser sends test and target ids only; scores come back aligned to the index
order as base64 uint8 (255 = cannot score), the same encoding as the static bundle.
"""
from __future__ import annotations

import base64
import json
import os
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import adapter
from index_io import ROOT, load_index

app = FastAPI(title="Analog Atlas ranking", version="1")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("ALLOW_ORIGINS", "*").split(","), allow_methods=["*"], allow_headers=["*"])

IDX = load_index()
DF = IDX.to_frame()
MODEL = adapter.load()
TARGETS = {t["id"]: t for t in json.loads((ROOT / "src" / "config" / "targets.json").read_text())["targets"]}


class RankRequest(BaseModel):
    test_id: str
    target_id: str | None = None


@app.get("/health")
def health():
    return {"ok": True, "rows": int(IDX.ids.size), "index_fingerprint": IDX.fingerprint, "model_loaded": MODEL is not None}


@app.get("/model-card")
def model_card():
    p = ROOT / "ml" / "model_card.json"
    return json.loads(p.read_text()) if p.exists() else {"name": "adapter fallback", "version": "0", "demo": True,
                                                        "kind": "rank distance to target", "trained_on": "none", "limits": "Not a trained model."}


@lru_cache(maxsize=128)
def _scores(test_id: str, target_id: str | None) -> bytes:
    s = np.asarray(adapter.predict(MODEL, DF, test_id, TARGETS.get(target_id or "")), dtype=float)
    if s.shape != (len(DF),):
        raise HTTPException(500, "adapter.predict returned the wrong length")
    q = np.full(s.size, 255, np.uint8)
    ok = np.isfinite(s)
    q[ok] = np.round(np.clip(s[ok], 0, 1) * 254).astype(np.uint8)
    return q.tobytes()


@app.post("/rank")
def rank(req: RankRequest):
    raw = _scores(req.test_id, req.target_id)
    return {"index_fingerprint": IDX.fingerprint, "scale": 254, "missing": 255, "scores_b64": base64.b64encode(raw).decode()}
