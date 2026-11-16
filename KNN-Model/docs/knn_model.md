# The k-nearest-neighbours analog model

**File:** `analog_knn.py` · **Main function:** `run_knn(tiles, weights, k=5)`

## What it does

NASA wants to test equipment (for example rover wheels) on Earth before using it on
the Moon or Mars. This model answers:

> *Which Earth sites look most like the target area on the Moon or Mars, judged only
> on the measurements that matter for this particular test?*

It compares **tiles**: square pieces of ground (e.g. 5 × 5 km) that have already been
measured. It ranks Earth sites by how closely their tiles match the target's tiles.

This model only does the comparison. Loading the maps, cleaning them and cutting
them into tiles are earlier steps in the pipeline.

## The idea, without the maths

Imagine you have photos of 30 people from a sports team (the **target**) and a crowd
of strangers. You want to find strangers who could pass as team members, judging
only on height and build, not hair colour.

For each stranger you:

1. **Measure the same things** for everyone (height, build).
2. **Decide what matters more.** Maybe height counts double.
3. **Find the 5 team members they resemble most** and check how close those 5 are.
4. **Score them:** the closer those 5 team members, the better the match.

Replace "people" with "tiles of ground" and "height and build" with "slope and
roughness", and that is this model. **k** is the "5": how many closest matches we
average.

## Input

### 1. The tile table (a pandas DataFrame)

One row per tile.

| Column | Required? | Meaning |
|---|---|---|
| `site` | yes | Which place the tile belongs to, e.g. `moon_south_pole_A` |
| `role` | yes | `target` (Moon/Mars area to copy), `baseline` (a site NASA already uses), `candidate` (a new Earth site), or `negative_control` (a site that *should* score badly, as a sanity check) |
| one column per measurement | yes | e.g. `slope_mean`, `rough_small`. Must be numbers |
| `tile_id`, `lat`, `lon` | optional | If present, reported for each site's best tile |

All tiles of one site must have the same role.

### 2. The weights (a dictionary)

Which measurements matter for this test, and how much:

```python
weights = {"slope_mean": 1.0, "slope_p90": 1.5, "rough_small": 1.0}
```

- Only the **ratio** between weights matters. `{a: 2, b: 1}` gives the same result as `{a: 1, b: 0.5}`.
- A measurement **not in the dictionary is ignored**. That is how a mission says "temperature doesn't matter for this test".
- Weights must be above 0.

### 3. Settings

| Setting | Default | Meaning |
|---|---|---|
| `k` | 5 | How many of the closest target tiles to average. Higher = smoother, less sensitive to one odd tile |
| `site_quantile` | 0.75 | Which percentile of a site's tile scores becomes the site score (see step 5) |

## How it works, step by step

**Step 0: Check the input.** Typos in column names, zero weights, unknown roles, or a
site with two different roles stop the program with a clear message.

**Step 1: Drop tiles with missing values.** A tile with any missing measurement is
removed and **counted**, never filled in with a guess. A guessed number could make a
site look better or worse than it really is.

**Step 2: Put measurements on a common scale.** Slope is in degrees, roughness in
metres. Their raw numbers can't be compared directly, so each measurement is rescaled:
subtract Earth's typical (median) value and divide by Earth's typical spread (the
range of the middle 50% of values). After this, a difference of 1.0 means "one normal
amount of variation on Earth" for every measurement.

This uses Earth tiles only, so "normal" means *Earth's* natural variety.

**Step 3: Apply the weights.** Each rescaled value is multiplied by the square root of
its weight. The square root is there because the distance formula squares every
difference, and squaring the square root gives back the weight exactly:

```
distance = √( w₁·diff₁² + w₂·diff₂² + … )
```

That is a weighted average difference: important measurements count more.

**Step 4: Find the nearest neighbours.** For every Earth tile, find the **k** target
tiles that resemble it most and average the distance to them. Then turn the distance
into a **similarity** between 0 and 1:

```
similarity = e^(−distance)      distance 0 → 1.0 (identical)   distance 1 → 0.37   distance 3 → 0.05
```

**Step 5: Score each site.** The score is a two-way match, half from each direction
(`two_way_weight = 0.5`):

- **Site → target** (`site_to_moon_score`): the **75th percentile** of the site's tile
  similarities, meaning "a quarter of this site's tiles are at least this good". Not the best
  tile (one lucky tile would decide everything) and not the average (a few poor tiles at the
  edge would unfairly drag a good site down).
- **Target → site** (`moon_to_site_score`): for every target tile, how close the site's
  nearest tile is, averaged over the target. A site that matches only one corner of the
  target scores low here.

The best tile is kept anyway, so we can say *where* in the site to test.

**Closest achievable.** When the target is beyond anything on Earth for a measurement
(e.g. the Moon's yearly temperature swing), `cap_to_earth` clips the target to Earth's range
for that measurement, so sites are ranked on how close they get, and the report says so.

**Step 6: Compare with NASA's baselines.** Two questions per site:
- *Which NASA baseline does it resemble most?* (`nearest_baseline`). A baseline is never compared with itself.
- *Is it closer to the target than each baseline?* (`closer_than_baselines`)

**Step 7: Target coverage** (reported, not part of the score). See Known issues below.

The model uses no randomness, so the same input always gives the same output.

## Output

`run_knn` returns a `KnnResult` with:

### `result.sites`: one row per Earth site, best first

| Column | Meaning |
|---|---|
| `rank` | 1 = best match |
| `site`, `role` | From the input |
| `score` | 0–1, the site's overall similarity to the target (higher = better): the two-way blend |
| `site_to_moon_score`, `moon_to_site_score` | The two halves of the score (Step 5) |
| `best_tile_similarity` | Similarity of the single best tile |
| `best_tile_tile_id`, `best_tile_lat`, `best_tile_lon` | Where the best tile is (only if those columns were in the input) |
| `target_coverage` | 0–1, share of the target's variety this site reproduces |
| `n_tiles_used` | Tiles that went into the score |
| `n_tiles_dropped` | Tiles removed for missing values |
| `nearest_baseline` | The NASA baseline this site resembles most (empty for a baseline when there is no *other* baseline to compare with) |
| `closer_than_baselines` | Baselines this site beats (comma-separated, empty if none) |

### `result.tiles`: one row per Earth tile

All input columns, plus `distance_to_target`, `similarity`, and one
`distance_to_baseline:<name>` column per baseline. Useful for drawing maps.

### Also included
`result.features_used`, `result.weights` (scaled to add up to 1), `result.k`, and
`result.capped` (which measurements were clipped to Earth's range, and by how much).

## Example

The numbers below are **invented** just to show how to call the model. They are not real measurements.

```python
import pandas as pd
from analog_knn import run_knn

tiles = pd.DataFrame({
    "site": ["moon_A"] * 3 + ["baseline_B"] * 2 + ["candidate_X"] * 2,
    "role": ["target"] * 3 + ["baseline"] * 2 + ["candidate"] * 2,
    "slope_mean":  [8.0, 9.5, 7.2,   6.1, 7.0,   8.3, 9.0],
    "rough_small": [7.5, 8.1, 6.9,   5.0, 5.6,   7.7, 8.4],
})

result = run_knn(tiles, weights={"slope_mean": 1.0, "rough_small": 0.5}, k=2)
print(result.sites)
```

## Known issues and open decisions

1. **The "gentlest corner" problem (addressed).** If the target area is mixed (mostly
   cratered, with a few smooth spots), a smooth Earth site could score well by matching only
   the smooth spots. The target → site half of the score (Step 5) penalises this, and
   `target_coverage` is still reported so it stays visible.
2. **Not every analog is a terrain analog.** Some NASA analog sites are analogs for
   their chemistry (e.g. Lake Salda), not their ground shape. A site should only be a
   baseline for missions that match what it was actually used for.
3. **Baseline coordinates.** The NASA Analog Explorer lists place names only, with no
   coordinates. The area used for each baseline must come from a cited source.
4. **Same pixel size required.** Slope and roughness change with pixel size. All
   tiles compared together must be measured at the same pixel size and tile size
   (Moon: 100 m pixels, 5 km tiles; Mars: 500 m pixels, 20 km tiles). This model
   can't check that; the earlier pipeline steps must make sure of it.
5. **A terrain match does not validate hardware.** Matching ground shape says nothing
   about soil strength, gravity, vacuum or temperature, all of which still need
   their own testing.

## Words used

| Word | Meaning |
|---|---|
| **Tile** | A square piece of ground, measured as one unit |
| **Feature / measurement** | One number describing a tile, e.g. average slope |
| **k-nearest neighbours (kNN)** | Finding the k most similar items to a given item |
| **Distance** | How different two tiles are. 0 = identical |
| **Similarity** | Distance turned into 0–1. 1 = identical |
| **Weight** | How much a measurement matters for this test |
| **Percentile** | The 75th percentile is the value that 75% of values are below |
| **Baseline** | An Earth site NASA already uses: our yardstick |
| **Negative control** | A site expected to score badly. If it scores well, something is wrong |
