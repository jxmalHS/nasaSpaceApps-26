"""Read the Earth index exactly as the web app does. Shared by the ML scripts.

    from index_io import load_index
    idx = load_index()            # dict: ids, features (n x k float, NaN = missing), columns, meta
    df = idx.to_frame()           # pandas DataFrame if pandas is installed
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"


@dataclass
class EarthIndex:
    ids: np.ndarray            # uint32 cell ids (row*720+col)
    X: np.ndarray              # float64 (n, k), NaN where missing
    columns: list[str]
    lat: np.ndarray
    lon: np.ndarray
    meta: dict

    @property
    def fingerprint(self) -> str:
        """Identifies this exact index build. Score files carry it so a stale file is refused."""
        return hashlib.sha1(self.ids.tobytes()).hexdigest()[:16]

    def col(self, fid: str) -> np.ndarray:
        return self.X[:, self.columns.index(fid)]

    def to_frame(self):
        import pandas as pd  # optional dependency

        df = pd.DataFrame(self.X, columns=self.columns)
        df.insert(0, "lon", self.lon)
        df.insert(0, "lat", self.lat)
        df.insert(0, "cell_id", self.ids)
        return df


def load_index(data_dir: Path = DATA) -> EarthIndex:
    meta = json.loads((data_dir / "earth_index.meta.json").read_text())
    n = meta["n"]
    raw = (data_dir / "earth_index.bin").read_bytes()
    ids = np.frombuffer(raw, dtype=np.uint32, count=n)
    off = 4 * n
    cols, X = [], np.empty((n, len(meta["columns"])))
    for j, c in enumerate(meta["columns"]):
        q = np.frombuffer(raw, dtype=np.uint16, count=n, offset=off).astype(np.float64)
        off += 2 * n
        x = c["min"] + q / 65534.0 * (c["max"] - c["min"])
        x[q == meta["missing_code"]] = np.nan
        X[:, j] = x
        cols.append(c["id"])
    row, col = ids // meta["grid"]["ncol"], ids % meta["grid"]["ncol"]
    lat = 90 - (row + 0.5) * meta["grid"]["cell_deg"]
    lon = -180 + (col + 0.5) * meta["grid"]["cell_deg"]
    return EarthIndex(ids, X, cols, lat, lon, meta)


def quantile_transform(x: np.ndarray, q: list[float]) -> np.ndarray:
    """Map values to their Earth percentile (0..1) using the stored quantile table."""
    qq = np.asarray(q)
    return np.interp(x, qq, np.linspace(0, 1, qq.size))
