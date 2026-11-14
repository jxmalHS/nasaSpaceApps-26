# Pipeline: from raw elevation data to a ranking

```
python main.py run --mission lunar_surface_mobility
```

## Steps

| # | Step | File | What happens |
|---|---|---|---|
| 1 | Sites | `config/sites.yaml`, `data/baselines/` | Baselines, negative controls and USGS crater candidates, each with a cited location |
| 2 | Stream | `sources.py` | Reads only the needed area: Copernicus DEM (Earth), LOLA 20 m (Moon). Saved to `data/cache/` so it streams only once |
| 3 | Clean | `preprocess.py` | Metric map projection (UTM / polar), average down to 100 m, remove spikes. Gaps stay empty |
| 4 | Tiles | `tiles.py` | 5 × 5 km tiles; tiles over 5% missing are dropped and counted |
| 5 | Measure | `features.py` | Slope, steepness, relief, bumpiness, curvature, crater-like dips. Never absolute height |
| 6 | Compare | `analog_knn.py` | kNN against the target tiles, see `docs/knn_model.md` |

## Settings (`config/settings.yaml`)

| | Moon | Mars |
|---|---|---|
| Pixel size | 100 m | 500 m |
| Tile size | 5 km | 20 km |
| Box around each Earth site | 30 km | 60 km |

## Outputs (`results/<mission>/`)

| File | Contents |
|---|---|
| `ranking.csv` | One row per Earth site: rank, score, coverage, best tile, nearest baseline, source |
| `tiles.csv` | Every Earth tile with its measurements and similarity (for maps) |
| `target_tiles.csv` | The target tiles' measurements |
| `site_stats.csv` | Tiles kept / dropped and spikes removed per site |
| `summary.json` | Weights used, skipped features, failed sites, attribution |

## Data sources and credits

- **Earth:** Copernicus DEM GLO-30. Required notice: *Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.*
- **Moon:** LOLA LDEM_80S_20M (NASA PDS, MIT LOLA archive).
- **Sites:** USGS Known Terrestrial Analog Sites (Hunter 2020, doi:10.5066/P9J72921); USGS LGRS Artemis training grids (McClernan 2024, doi:10.5066/P14KSANW); JPL PIA23265 (Mars 2020 test spots); OpenStreetMap (© OpenStreetMap contributors, ODbL) for named-place coordinates.

## Known limits

- Mars needs a MOLA reader and a target area; only its settings and baselines exist so far.
- No coordinates found for JETT5, JETT2 Iceland or the Mojave lava tube; they're left out.
- The USGS crater list includes buried craters with little surface expression.
- First run streams ~200 sites; on a slow connection that takes a while. Re-runs use the cache.
- Weights in `config/missions.yaml` are example values, not NASA requirements.
