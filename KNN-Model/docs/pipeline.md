# Pipeline: the 5 steps

```
python main.py run --mission moon_rover_south_pole             # streams what isn't downloaded yet
python main.py run --mission moon_rover_south_pole --offline   # only sites already downloaded (fast)
```

| Step | What happens | Files |
|---|---|---|
| **1. Mission** | Every condition is sorted into **target** (must match, with a weight), **ignored**, or **interference** (would ruin the test, with a limit). Mandatory pass/fail rules are set here, before ranking. Typos and unsorted conditions are rejected | `config/missions.yaml`, `mission.py` |
| **2. Moon/Mars → numbers** | Moon: LOLA 20 m elevation streamed, averaged to 100 m, cut into 5 km tiles. Mars: MGS MOLA 463 m elevation, 500 m pixels, 20 km tiles. Measured: slope, steep ground, relief, bumpiness, crater-like dips; never absolute height | `sources.py`, `preprocess.py`, `tiles.py`, `features.py` |
| **3. Earth → same numbers** | NASA baselines, USGS crater candidates and farmland controls: Copernicus 30 m elevation, at the same pixel and tile size as the target (100 m / 5 km for the Moon, 500 m / 20 km for Mars). ESA WorldCover land cover per tile for interference | `config/sites.yaml`, `landcover.py` |
| **3b. Temperature** (optional group) | Annual temperature range = hottest day − coldest night, at 1 km. Moon: Diviner polar maps (summer max − winter min). Earth: MODIS MOD11A2 for one year via NASA AppEEARS (`python main.py download-temperature --mission ...`, needs the Earthdata login) | `temperature.py` |
| **4. Rank** | Weighted k-nearest-neighbours, **two-way**: each Earth tile vs the Moon tiles AND each Moon tile vs the site, so a site must resemble the whole Moon area, not one corner. Plus a comparison with every NASA baseline | `analog_knn.py` |
| **5. Report** | Per site: coverage, requirements met / not met / unknown, real-unit differences, interference, confidence, what Earth can't reproduce. Multi-site coverage: which requirements each added site covers, and which no site covers | `report.py`, `coverage.py` |
| **6. Export** | Results converted for the Analog Atlas website (`python main.py export-atlas`): sparse scores, model card, validation | `atlas_export.py` |

## What the report means

- **Score** (0–1): half "site → Moon" (do the site's tiles look like Moon tiles?) and half "Moon → site" (does every part of the Moon area find a match in the site?), weighted by the mission.
- **Incomplete**: a site missing a measurement the mission needs (e.g. no temperature yet) is listed as incomplete, never ranked on less data.
- **Covers**: share of the Moon area's variety the site reproduces. High score + low coverage = it only matches part of the target.
- **Test tile**: the 5 km tile we'd recommend testing in: a tile free of interference first, then the most mandatory requirements met, then the most similar.
- **Requirements**: checked at the test tile. *Unknown* (no data) never counts as met.
- **Interference**: trees, crops, water... over the mission's limit would ruin the test. Candidate tiles over a limit are left out, so a candidate is judged only on its usable ground (candidates with no usable tile are listed, not ranked). NASA sites and farmland are yardsticks: they keep all tiles, but rank below clean sites if their test tile is interfered. Shows *unknown* when land cover wasn't available, never "clear". `similarity_rank` in ranking.csv is the order on similarity alone.
- **Confidence**: share of 14 small changes the site's rank survives (each weight ±20%, pixels 2× bigger, tiles shifted half a tile). High ≥ 80%, medium ≥ 50%.
- **Negative controls**: farmland must rank in the bottom half on similarity alone (its crops would push it down anyway, so the final rank can't test the model); otherwise the report says FAIL.
- **Two Moon targets**: `lunar_south_pole` (40 km box at the pole, includes Shackleton crater's steep walls) and `mons_mouton` (30 km box on the VIPER / IM-2 landing plateau, the gentler ground a rover would actually drive). Mission `moon_rover_mons_mouton` is the wheels test on the second one.

## How the model is tested (`validation.py`)

kNN here is **unsupervised**: nothing is trained on "good"/"bad" labels, because only ~5 known
analogs exist (far too few to train on). Instead of a train/test split, the method is tested by:

| Check | What it shows |
|---|---|
| **Held-out NASA sites** | Each NASA site is left out of fitting in turn; where does it rank? Reported as the share of other sites each NASA site beats (percentile), the median over NASA sites, and how often 5 randomly picked sites would do as well, which gives a Strong (≤ 1%), Moderate (≤ 5%) or Weak verdict. Recall@5 / @10 are kept, but they get stricter as more sites are added. Warns when there are too few sites |
| **Negative controls** | Farmland must rank in the bottom half |
| **Stability** | 14 small changes (weights ±20%, 2× pixels, half-tile shift): does the #1 site / top 5 survive? |
| **Simple-method comparison** | A plain "distance to the target's typical values" ranking. Agreement shows consistency, **not** accuracy |
| **Mission sensitivity** | Two missions on the same sites should rank differently; near-identical rankings mean the weights aren't doing much |

## Outputs (`results/<mission>/`)

| File | Contents |
|---|---|
| `report.md` | Human-readable summary: top sites, baselines, checks, what Earth can't reproduce |
| `ranking.csv` | One row per site: rank, score, coverage, test tile, requirements, interference, confidence |
| `sites/<site>.json` | Full per-site report, including real-unit differences ("4.0° gentler than the target") |
| `tiles.csv`, `target_tiles.csv` | Every tile's measurements (for maps) |
| `site_stats.csv` | Tiles kept / dropped and spikes removed per site |
| `summary.json` | Mission, target profile, weights used, checks, failed sites, credits |
| `../analog_atlas_export/` | `scores.csv`, `model_card.json`, `validation.json` for the website (from `export-atlas`) |

## Settings (`config/settings.yaml`)

| | Moon | Mars |
|---|---|---|
| Pixel size | 100 m | 500 m |
| Tile size | 5 km | 20 km |
| Box around each Earth site | 30 km | 60 km |

## Data sources and credits

- **Earth elevation:** Copernicus DEM GLO-30. *Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.*
- **Earth land cover:** ESA WorldCover 2021. *© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium* (CC-BY 4.0).
- **Moon:** LOLA LDEM_80S_20M (NASA PDS, MIT LOLA archive).
- **Mars:** MGS MOLA DEM 463 m (Smith et al. 2001, JGR 106(E10), doi:10.1029/2000JE001364; USGS Astrogeology mosaic).
- **Moon temperature:** Diviner polar maps, Williams et al. (2019), *Seasonal polar temperatures on the Moon*, JGR Planets 124, 2505-2521.
- **Earth temperature:** MODIS MOD11A2 v061 (Wan, Hook, Hulley 2021), via NASA AppEEARS.
- **Sites:** USGS Known Terrestrial Analog Sites (Hunter 2020, doi:10.5066/P9J72921); USGS LGRS Artemis training grids (McClernan 2024, doi:10.5066/P14KSANW); JPL PIA23265 (Mars 2020 test spots); © OpenStreetMap contributors (ODbL) for named-place coordinates.

## Known limits

- Minerals have no data module yet, and rocks, soil strength, ground ice and salts have no Earth map.
- Temperature: no Earth site reaches lunar temperature ranges (Moon ~180 K typical vs Earth deserts far less), so the temperature group ranks Earth sites by "closest achievable". Absolute lunar temperatures stay in "what Earth can't reproduce".
- Mars has no temperature group and no pass/fail rules: NASA's Mars landing and rover limits are set at 2 m-1 km, finer than the 500 m pixels.
- Earth temperature exists for 25 sites so far: most NASA AppEEARS downloads timed out, so the thermal mission ranks fewer sites than the terrain missions.
- No coordinates found for JETT5, JETT2 Iceland or the Mojave lava tube; they're left out.
- The USGS crater list includes buried craters with little surface expression.
- The first full run streams ~200 sites; on a slow connection that takes hours. Use `--offline` for what's already downloaded.
- Weights and limits in `config/missions.yaml` are example values, not NASA requirements.
