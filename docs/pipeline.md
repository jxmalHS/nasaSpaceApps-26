# Pipeline: the 5 steps

```
python main.py run --mission lunar_surface_mobility             # streams what isn't downloaded yet
python main.py run --mission lunar_surface_mobility --offline   # only sites already downloaded (fast)
```

| Step | What happens | Files |
|---|---|---|
| **1. Mission** | Every condition is sorted into **target** (must match, with a weight), **ignored**, or **interference** (would ruin the test, with a limit). Mandatory pass/fail rules are set here, before ranking. Typos and unsorted conditions are rejected | `config/missions.yaml`, `mission.py` |
| **2. Moon → numbers** | LOLA 20 m elevation streamed, averaged to 100 m, cut into 5 km tiles, measured (slope, steep ground, relief, bumpiness, crater-like dips; never absolute height) | `sources.py`, `preprocess.py`, `tiles.py`, `features.py` |
| **3. Earth → same numbers** | NASA baselines, USGS crater candidates and farmland controls: Copernicus 30 m elevation, same 100 m pixels and 5 km tiles. ESA WorldCover land cover per tile for interference | `config/sites.yaml`, `landcover.py` |
| **3b. Temperature** (optional group) | Annual temperature range = hottest day − coldest night, at 1 km. Moon: Diviner polar maps (summer max − winter min). Earth: MODIS MOD11A2 for one year via NASA AppEEARS (`python main.py download-temperature --mission ...`, needs the Earthdata login) | `temperature.py` |
| **4. Rank** | Weighted k-nearest-neighbours, **two-way**: each Earth tile vs the Moon tiles AND each Moon tile vs the site, so a site must resemble the whole Moon area, not one corner. Plus a comparison with every NASA baseline | `analog_knn.py` |
| **5. Report** | Per site: coverage, requirements met / not met / unknown, real-unit differences, interference, confidence, what Earth can't reproduce | `report.py` |

## What the report means

- **Score** (0–1): half "site → Moon" (do the site's tiles look like Moon tiles?) and half "Moon → site" (does every part of the Moon area find a match in the site?), weighted by the mission.
- **Incomplete**: a site missing a measurement the mission needs (e.g. no temperature yet) is listed as incomplete, never ranked on less data.
- **Covers**: share of the Moon area's variety the site reproduces. High score + low coverage = it only matches part of the target.
- **Test tile**: the 5 km tile we'd recommend testing in: the one meeting the most mandatory requirements, ties going to the most similar tile.
- **Requirements**: checked at the test tile. *Unknown* (no data) never counts as met.
- **Interference**: land cover over the mission limit at the test tile. Shows *unknown* when land cover wasn't available, never "clear".
- **Confidence**: share of 14 small changes the site's rank survives (each weight ±20%, pixels 2× bigger, tiles shifted half a tile). High ≥ 80%, medium ≥ 50%.
- **Negative controls**: farmland must rank in the bottom half; otherwise the report says FAIL.

## How the model is tested (`validation.py`)

kNN here is **unsupervised**: nothing is trained on "good"/"bad" labels, because only ~5 known
analogs exist (far too few to train on). Instead of a train/test split, the method is tested by:

| Check | What it shows |
|---|---|
| **Held-out NASA sites** | Each NASA site is left out of fitting in turn; where does it rank? Reported as recall@5 / recall@10 next to what a random ranking would score. Warns when there are too few sites for this to mean much |
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
- **Moon temperature:** Diviner polar maps, Williams et al. (2019), *Seasonal polar temperatures on the Moon*, JGR Planets 124, 2505-2521.
- **Earth temperature:** MODIS MOD11A2 v061 (Wan, Hook, Hulley 2021), via NASA AppEEARS.
- **Sites:** USGS Known Terrestrial Analog Sites (Hunter 2020, doi:10.5066/P9J72921); USGS LGRS Artemis training grids (McClernan 2024, doi:10.5066/P14KSANW); JPL PIA23265 (Mars 2020 test spots); © OpenStreetMap contributors (ODbL) for named-place coordinates.

## Known limits

- Minerals have no data module yet.
- Temperature: no Earth site reaches lunar temperature ranges (Moon ~180 K typical vs Earth deserts far less), so the temperature group ranks Earth sites by "closest achievable". Absolute lunar temperatures stay in "what Earth can't reproduce".
- Mars: settings and baselines only; the MOLA reader and a Mars target aren't built.
- No coordinates found for JETT5, JETT2 Iceland or the Mojave lava tube; they're left out.
- The USGS crater list includes buried craters with little surface expression.
- The first full run streams ~200 sites; on a slow connection that takes hours. Use `--offline` for what's already downloaded.
- Weights and limits in `config/missions.yaml` are example values, not NASA requirements.
