# Planetary Analog Finder (NASA Space Apps 2026)

**Which place on Earth looks most like the Moon (or Mars) for testing a specific piece of equipment?**

This engine compares the *shape* of the ground (slopes, bumpiness, craters) on Earth with a
target area on the Moon, and ranks Earth sites from most to least similar.

## How it works (5 steps)

1. **Pick a subsystem** (e.g. lunar rover wheels) and sort every condition into ✅ **target** (must match: slope, bumpiness), ⚪ **ignored** (doesn't matter for this test: temperature), or ⚠️ **interference** (would ruin the test: trees, snow, water). Pass/fail requirements are set here too.
2. **Turn the Moon site into numbers** from NASA LOLA elevation data: slope, steep ground, bumpiness, crater-like dips, cut into 5 × 5 km tiles.
3. **Turn Earth sites into the same numbers, at the same scale** (100 m pixels): NASA's analog sites (the baseline), USGS impact craters and hand-picked volcanic/lava fields (candidates) and farmland that *should* score badly (a sanity check). Land cover from ESA WorldCover gives the interference checks.
4. **Rank** with weighted nearest-neighbour search, comparing each site with the Moon target and with NASA's sites.
5. **Report each site honestly:** what it covers, requirements met / not met / unknown, interference risks, confidence, and what Earth can't reproduce.

Height above "sea level" is never used, because the Moon has no sea level. Missing data is always "unknown", never a pass.

**Is it ML?** Yes: unsupervised nearest-neighbour search. There is no training on labels (only ~5 known
analog sites exist, too few to train on), so it is tested instead with held-out NASA sites, farmland
negative controls, stability checks, a simple-method comparison and mission sensitivity
(see `docs/pipeline.md`).

## Run it

```powershell
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest                                               # 67 tests, no internet needed
python main.py run --mission moon_rover_south_pole  # results in results/<mission>/report.md
python main.py export-atlas                         # hand results to the Analog Atlas web app
```

The first run streams data for ~200 sites, which is slow on a weak connection. Every site is
saved in `data/cache/`, so later runs (or a restarted run) are fast. Add `--offline` to rank only
the sites already downloaded.

## Status

- ✅ All 5 steps work for the Moon, plus the model checks; 67 tests pass.
- ✅ Temperature that Earth can't reach (the Moon's ~177 K yearly swing) is ranked as "closest achievable", and the report says so.
- ✅ Checked on real data for the 5 sites downloaded so far (the Artemis training sites rank top).
- ⏳ Full real run (~200 sites) not done yet: slow internet.
- ✅ Temperature group (Moon: Diviner; Earth: MODIS via NASA AppEEARS). Example mission `moon_rover_thermal_south_pole` uses terrain + temperature.
- ✅ Two-way matching: a site must resemble the whole Moon area, not one corner of it.
- ⏳ Not built yet: minerals, Mars.

## Files

| File | What it does |
|---|---|
| `main.py` | Command you run |
| `pipeline.py` | Runs all the steps in order |
| `sources.py` | Streams elevation data |
| `preprocess.py` | Cleans and resamples |
| `tiles.py` | Cuts tiles |
| `features.py` | Terrain measurements |
| `analog_knn.py` | The k-nearest-neighbours comparison |
| `mission.py` | Step 1: checks a mission's target / ignored / interference sorting and requirements |
| `landcover.py` | Interference conditions (trees, crops, snow, water...) from ESA WorldCover |
| `report.py` | Step 5: requirements, differences, confidence, report files |
| `validation.py` | Model checks: held-out NASA sites, simple-method comparison, mission sensitivity |
| `temperature.py` | Temperature group: annual range from Diviner (Moon) and MODIS via AppEEARS (Earth) |
| `charts.py` | Two simple PNG charts: the ranking, and "how close to the Moon" per top site |
| `atlas_export.py` | Converts results into the Analog Atlas web app's sparse-score CSV + model card + validation |
| `config/` | Settings, sites (with sources) and mission weights |
| `docs/` | More detail: `pipeline.md`, `knn_model.md` |

## Limits and their sources

Full notes are in the comments of `config/missions.yaml`. In short:

| Rule | Value | Basis |
|---|---|---|
| Steep ground | over 15° | VIPER's normal driving limit [1] |
| Rover slope weights | `frac_steep` > `slope_p90` > `slope_mean` | Ordered by how directly each ties to VIPER (15° normal, 25–30° maximum) [1] and Apollo rover limits (NASA SP-350 ch. 14.8: slopes above 25°; NASA SP-4214 ch. 13-3: 30 cm obstacles; Jacob et al., LPSC 2026, NTRS 20250011301: Apollo 15/16 maximum slopes 22.1°/24.7°) |
| Trees per 5 km tile | ≤ 30% | The IGBP Savanna / Woody Savanna boundary in NASA's MODIS land-cover legend [2] |
| Trees (landing) | ≤ 20% | Team value, stricter than [2] so cameras see bare ground |
| Crops / buildings / snow-ice / water | ≤ 20% / 10% / 10% / 5% | Team values, well below the IGBP class lines (60% / 30% / 60% / 60%) [2] |
| "Within X of the target" tolerances | 5°, 0.10, 3 m, 0.5 /km², 150 m | **No NASA source.** See "Origin of the tolerances" below |
| Thermal swing | ≥ 60 K | **No NASA source.** Context only, not verified against NASA documents: Earth's widest swings are reported near 80 K, the Moon's equatorial swing near 300 K |
| Low evidence | fewer than 6 usable 5 km squares | Team value |

### Origin of the tolerances (checked Nov 2026)

The "within X of the target" rules (`mandatory:` in `config/missions.yaml`) and the 60 K
thermal minimum were added in commits `cfd0298`, `c47f29e` and `21ff392` (co-authored with an
AI assistant), labelled from the start as *example values chosen by the engine team, not
official NASA requirements*. No source was ever attached; the later sourcing commit
(`9771f78`) covered the weights only. NASA publishes absolute limits (VIPER: 15° normal,
25-30° maximum), not tolerances around a target, so none of these numbers comes from NASA.

Measured at each NASA baseline's official coordinates (nearest 5 km tile, `results/*/tiles.csv`):

| Rule | NASA sites that break it |
|---|---|
| Landing: relief within 150 m | all 5 (they differ by 266-894 m) |
| Landing: crater-like dips within 0.5 /km² | 4 of 5 (only SP Crater passes) |
| South-pole rover: steepest-10% slope within 5° | 4 of 5 (only Cinder Lake passes) |
| Mons Mouton rover: all three rules | 3 of 5 (SP Crater and Yucca Flat pass all) |
| Thermal: day-night swing at least 60 K | 3 of 5 (SP Crater 59.5, Yucca Flat 57.4, Buffalo Park 52.8 K) |
| Trees at most 30% | Cinder Lake (81%) and Buffalo Park (59%): their 5 km tiles include forest |

These rules do not change the ranking: they pick the recommended 5 km tile and fill the
"requirements met / not met" lines (also shown in the website's site panel). Recalibrating
them to the spread of NASA's own sites would need a re-run of the engine.

Land cover itself comes from ESA WorldCover 2021. The NASA legend [2] is used only to place
the class boundaries.

1. NASA, VIPER Lunar Operations. https://science.nasa.gov/mission/viper/lunar-operations/
2. Sulla-Menashe & Friedl, MODIS Collection 6.1 Land Cover Type (MCD12Q1) Product User Guide, Table 3 (IGBP legend), NASA LP DAAC. https://lpdaac.usgs.gov/documents/1409/MCD12_User_Guide_V61.pdf

## Data credits

- Copernicus DEM: *Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.*
- NASA LRO LOLA (LDEM_80S_20M), USGS analog site lists (doi:10.5066/P9J72921, doi:10.5066/P14KSANW), JPL PIA23265, © OpenStreetMap contributors.

*Mission weights are example values, not official NASA requirements. A terrain match does not validate hardware.*
