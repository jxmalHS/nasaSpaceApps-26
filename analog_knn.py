"""
analog_knn.py - a basic k-nearest-neighbours (kNN) model for finding Earth analogs.

THE QUESTION IT ANSWERS
    "Which Earth sites look most like a Moon (or Mars) target area,
     judged on the measurements that matter for one specific test?"

WHAT GOES IN
    A table (pandas DataFrame) where every row is one TILE: a square piece of
    ground (e.g. 5 x 5 km) that has already been measured. Columns:

        site   - which place the tile belongs to, e.g. "moon_south_pole_A"
        role   - "target"           : tile from the Moon/Mars area we want to copy
                 "baseline"         : tile from a site NASA already uses (the yardstick)
                 "candidate"        : tile from a new Earth site we are testing
                 "negative_control" : tile from a site that SHOULD score badly
                                      (e.g. flat farmland) - a sanity check
        one column per measurement, e.g. slope_mean, rough_small, ...
        optional: tile_id, lat, lon  - copied into the results if present

    Plus a dictionary of WEIGHTS saying which measurements matter for this test
    and how much, e.g. {"slope_mean": 1.0, "rough_small": 0.5}.
    Any measurement NOT in the weights is ignored.

WHAT COMES OUT
    - one row per Earth tile: how close it is to the target
    - one row per Earth site: its score, its rank, its best tile, and how it
      compares with the NASA baseline sites

HOW IT WORKS, IN SHORT (full explanation in docs/knn_model.md)
    1. Put every measurement on a common scale, so degrees and metres can be
       compared fairly.
    2. Multiply each measurement by its importance (weight).
    3. For each Earth tile, find the k most similar target tiles and average
       the distance to them. Small distance = good match.
    4. Turn distance into a similarity between 0 and 1 and summarise per site.

This file only does the comparison. Loading maps, cleaning them and cutting
them into tiles happens in earlier steps of the pipeline.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import RobustScaler

# Names of the two columns every input table must have.
SITE_COL = "site"
ROLE_COL = "role"

# Allowed values in the "role" column. Everything except "target" is on Earth.
ROLES = ("target", "baseline", "candidate", "negative_control")

# Optional columns that, if present, are copied over for the best tile of each site
# (so the frontend can show where on the map the best spot is).
OPTIONAL_TILE_COLS = ("tile_id", "lat", "lon")


@dataclass
class KnnResult:
    """Everything the model produces, kept together in one object."""

    tiles: pd.DataFrame          # one row per Earth tile, with its distances and similarity
    sites: pd.DataFrame          # one row per Earth site, ranked best first
    features_used: list[str]     # the measurements that were compared
    weights: dict[str, float]    # the weights after scaling them to add up to 1
    k: int                       # how many neighbours were averaged


# --------------------------------------------------------------------------
# Step 0: check the input before doing anything
# --------------------------------------------------------------------------
def check_input(tiles: pd.DataFrame, weights: dict[str, float], k: int,
                site_quantile: float) -> list[str]:
    """Stop early with a clear message if the input can't be used.

    Catching mistakes here (a typo in a column name, a zero weight, a site
    labelled with two different roles) is much easier than debugging strange
    rankings later. Returns the list of measurements to compare.
    """
    if not weights:
        raise ValueError("No weights given: say which measurements matter, e.g. {'slope_mean': 1.0}")

    needed = [SITE_COL, ROLE_COL, *weights]
    missing = [c for c in needed if c not in tiles.columns]
    if missing:
        raise ValueError(f"The tile table is missing these columns: {missing}")

    bad_roles = set(tiles[ROLE_COL].unique()) - set(ROLES)
    if bad_roles:
        raise ValueError(f"Unknown role(s) {sorted(bad_roles)}. Allowed roles: {ROLES}")

    # A weight of 0 would mean "ignore this", which is done by leaving the
    # measurement out of the dictionary. Negative weights make no sense.
    for name, w in weights.items():
        if not w > 0:
            raise ValueError(f"Weight for '{name}' must be above 0 (leave it out to ignore it)")

    # Every tile of one site must have the same role, otherwise the site
    # would be both "the thing we copy" and "the thing we test".
    roles_per_site = tiles.groupby(SITE_COL)[ROLE_COL].nunique()
    mixed = roles_per_site[roles_per_site > 1].index.tolist()
    if mixed:
        raise ValueError(f"These sites have tiles with different roles: {mixed}")

    if k < 1:
        raise ValueError("k must be at least 1")
    if not 0.0 <= site_quantile <= 1.0:
        raise ValueError("site_quantile must be between 0 and 1")

    return list(weights)


# --------------------------------------------------------------------------
# Step 1: remove tiles with missing measurements (never guess them)
# --------------------------------------------------------------------------
def drop_incomplete(tiles: pd.DataFrame, features: list[str]) -> tuple[pd.DataFrame, dict[str, int]]:
    """Remove tiles that have a missing value in any measurement we compare.

    We never fill in missing values: a guessed number could make a site look
    better or worse than it really is. Instead we count how many tiles each
    site lost, so the report can say so.
    """
    has_gap = tiles[features].isna().any(axis=1)
    dropped = tiles.loc[has_gap, SITE_COL].value_counts().to_dict()
    clean = tiles.loc[~has_gap].reset_index(drop=True)   # renumber rows 0, 1, 2, ...
    return clean, dropped


# --------------------------------------------------------------------------
# Step 2: put all measurements on a common, weighted scale
# --------------------------------------------------------------------------
def normalise_weights(weights: dict[str, float]) -> dict[str, float]:
    """Scale the weights so they add up to 1.

    Only the RATIO between weights matters ({a: 2, b: 1} means the same as
    {a: 1, b: 0.5}). Making them add up to 1 keeps distances comparable
    between different missions.
    """
    total = sum(weights.values())
    return {name: w / total for name, w in weights.items()}


def fit_scaler(earth: pd.DataFrame, features: list[str]) -> RobustScaler:
    """Learn what a "normal" spread of each measurement looks like on Earth.

    Why this is needed: slope is in degrees (0-90) and roughness in metres
    (could be 0-100+). Without rescaling, the measurement with the biggest
    numbers would dominate every distance.

    RobustScaler subtracts the median and divides by the interquartile range
    (the spread of the middle 50% of values). After this, a difference of 1.0
    means "one typical spread of Earth terrain", for every measurement.
    It is "robust" because a few extreme tiles (e.g. a cliff) barely change it.

    It is fitted on EARTH tiles only, so the scale describes Earth's natural
    variety. The same scale is then applied to the target tiles.
    """
    return RobustScaler().fit(earth[features].to_numpy(dtype=float))


def to_weighted_space(df: pd.DataFrame, features: list[str], scaler: RobustScaler,
                      weights: dict[str, float]) -> np.ndarray:
    """Turn tile measurements into points ready for distance comparison.

    Each value is rescaled (see fit_scaler), then multiplied by the SQUARE ROOT
    of its weight. Why the square root: the distance formula squares every
    difference, so the square root turns back into exactly "weight x squared
    difference". The final distance is then:

        distance = sqrt( w1 * diff1^2 + w2 * diff2^2 + ... )

    i.e. a weighted average difference, where important measurements count more.
    """
    scaled = scaler.transform(df[features].to_numpy(dtype=float))
    w = np.array([weights[f] for f in features])
    return scaled * np.sqrt(w)


# --------------------------------------------------------------------------
# Step 3: the k-nearest-neighbours part
# --------------------------------------------------------------------------
def mean_distance_to_k_nearest(reference: np.ndarray, query: np.ndarray, k: int) -> np.ndarray:
    """For every query point, average the distance to its k closest reference points.

    Example with k = 5: for one Earth tile, find the 5 target tiles that
    resemble it most and average how far away they are. Using 5 neighbours
    instead of 1 means a single odd target tile can't make a match look good.

    If there are fewer than k reference points, all of them are used.
    """
    k = min(k, len(reference))
    finder = NearestNeighbors(n_neighbors=k).fit(reference)
    distances, _ = finder.kneighbors(query)    # shape: (number of query points, k)
    return distances.mean(axis=1)


def add_baseline_distances(earth_tiles: pd.DataFrame, earth_space: np.ndarray,
                           k: int) -> list[str]:
    """Measure how close each Earth tile is to each NASA baseline site.

    This is the second reference point: besides "how close to the Moon?",
    we ask "which already-used NASA site does this resemble most?".
    One new column is added per baseline: distance_to_baseline:<name>.

    A baseline site is never compared with itself (that distance would be 0
    and meaningless), so those cells are left empty (NaN).
    """
    baselines = sorted(earth_tiles.loc[earth_tiles[ROLE_COL] == "baseline", SITE_COL].unique())
    for b in baselines:
        is_b = (earth_tiles[SITE_COL] == b).to_numpy()
        d = mean_distance_to_k_nearest(earth_space[is_b], earth_space, k)
        d[is_b] = np.nan
        earth_tiles[f"distance_to_baseline:{b}"] = d
    return baselines


def target_coverage(target_space: np.ndarray, earth_space: np.ndarray,
                    earth_sites: np.ndarray) -> dict[str, float]:
    """How much of the target's VARIETY each Earth site reproduces (0 to 1).

    Why this exists: kNN scores each Earth tile against its closest target
    tiles. If the target area is mixed (mostly cratered, a few smooth spots),
    a smooth Earth site can score well by matching only the smooth spots.
    Coverage catches that: it is the share of target tiles that have a close
    match somewhere in the Earth site.

    "Close" means within the typical gap between neighbouring target tiles
    (the 90th percentile of each target tile's distance to its nearest
    other target tile), so the threshold comes from the target itself.

    Reported separately; it does NOT change the score (open decision).
    """
    if len(target_space) < 2:
        return {}  # need at least two target tiles to measure their spacing
    gaps, _ = NearestNeighbors(n_neighbors=2).fit(target_space).kneighbors(target_space)
    radius = np.percentile(gaps[:, 1], 90)   # column 0 is each tile's distance to itself (0)

    coverage = {}
    for site in np.unique(earth_sites):
        site_points = earth_space[earth_sites == site]
        nearest, _ = NearestNeighbors(n_neighbors=1).fit(site_points).kneighbors(target_space)
        coverage[site] = float((nearest[:, 0] <= radius).mean())
    return coverage


# --------------------------------------------------------------------------
# Step 4: summarise tiles into one score per site
# --------------------------------------------------------------------------
def summarise_sites(earth_tiles: pd.DataFrame, baselines: list[str], site_quantile: float,
                    coverage: dict[str, float], dropped: dict[str, int]) -> pd.DataFrame:
    """One row per Earth site, ranked from best (rank 1) to worst.

    score: the site_quantile (default 75th percentile) of its tiles' similarity.
        Why not the best tile? One lucky tile would decide everything.
        Why not the average? A few poor tiles at the edge of an area would
        drag a good site down. The 75th percentile means "a quarter of this
        site's tiles are at least this good": a fair middle ground.
    best tile: the single most similar tile, kept so we can say WHERE to test.
    """
    rows = []
    for site, group in earth_tiles.groupby(SITE_COL, sort=True):
        best = group.loc[group["similarity"].idxmax()]
        row = {
            "site": site,
            "role": group[ROLE_COL].iloc[0],
            "score": float(group["similarity"].quantile(site_quantile)),
            "best_tile_similarity": float(best["similarity"]),
            "target_coverage": coverage.get(site, np.nan),
            "n_tiles_used": len(group),
            "n_tiles_dropped": int(dropped.get(site, 0)),
        }
        for col in OPTIONAL_TILE_COLS:
            if col in group.columns:
                row[f"best_tile_{col}"] = best[col]

        # Which NASA baseline does this site resemble most? (median over its tiles)
        typical = {b: group[f"distance_to_baseline:{b}"].median() for b in baselines if b != site}
        row["nearest_baseline"] = min(typical, key=typical.get) if typical else None
        rows.append(row)

    sites = pd.DataFrame(rows)

    # "Closer to the target than baseline X?" -> list every baseline this site beats.
    score_of = dict(zip(sites["site"], sites["score"]))
    sites["closer_than_baselines"] = [
        ", ".join(b for b in baselines if b != s and score_of[s] > score_of[b])
        for s in sites["site"]
    ]

    # Rank: highest score first; ties broken alphabetically so results never shuffle.
    sites = sites.sort_values(["score", "site"], ascending=[False, True]).reset_index(drop=True)
    sites.insert(0, "rank", np.arange(1, len(sites) + 1))
    return sites


# --------------------------------------------------------------------------
# The one function to call
# --------------------------------------------------------------------------
def run_knn(tiles: pd.DataFrame, weights: dict[str, float], k: int = 5,
            site_quantile: float = 0.75) -> KnnResult:
    """Rank Earth sites by how closely they match the target, for one mission.

    tiles         : the tile table described at the top of this file
    weights       : {measurement: importance}; anything not listed is ignored
    k             : how many nearest target tiles to average (default 5)
    site_quantile : which percentile of tile similarity becomes the site score

    Nothing here is random, so the same input always gives the same output.
    """
    features = check_input(tiles, weights, k, site_quantile)
    clean, dropped = drop_incomplete(tiles, features)

    target = clean[clean[ROLE_COL] == "target"]
    earth = clean[clean[ROLE_COL] != "target"].reset_index(drop=True)
    if target.empty:
        raise ValueError("No usable target tiles (none given, or all had missing values)")
    if earth.empty:
        raise ValueError("No usable Earth tiles (none given, or all had missing values)")

    w = normalise_weights(weights)
    scaler = fit_scaler(earth, features)
    target_space = to_weighted_space(target, features, scaler, w)
    earth_space = to_weighted_space(earth, features, scaler, w)

    # Distance from each Earth tile to the target, turned into a 0-1 similarity.
    # exp(-distance): distance 0 -> similarity 1 (identical); bigger distance -> closer to 0.
    earth_tiles = earth.copy()
    earth_tiles["distance_to_target"] = mean_distance_to_k_nearest(target_space, earth_space, k)
    earth_tiles["similarity"] = np.exp(-earth_tiles["distance_to_target"])

    baselines = add_baseline_distances(earth_tiles, earth_space, k)
    coverage = target_coverage(target_space, earth_space, earth_tiles[SITE_COL].to_numpy())
    sites = summarise_sites(earth_tiles, baselines, site_quantile, coverage, dropped)

    return KnnResult(tiles=earth_tiles, sites=sites, features_used=features, weights=w, k=k)
