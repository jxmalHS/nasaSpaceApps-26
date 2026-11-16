# Planetary Analog Finder (NASA Space Apps 2026)

**Which place on Earth looks most like the Moon (or Mars) for testing a specific piece of equipment?**

This engine compares the *shape* of the ground (slopes, bumpiness, craters) on Earth with a
target area on the Moon or Mars, and ranks Earth sites from most to least similar.

## How it works (5 steps)

1. **Pick a subsystem** (e.g. lunar rover wheels) and sort every condition into **target** (must match: slope, bumpiness), **ignored** (does not matter for this test: temperature) or **interference** (would ruin the test: trees, snow, water). Pass/fail requirements are set here too.
2. **Turn the target into numbers**: Moon from NASA LOLA elevation (100 m pixels, 5 × 5 km tiles), Mars from NASA MGS MOLA (500 m pixels, 20 × 20 km tiles: MOLA's resolution): slope, steep ground, bumpiness, crater-like dips.
3. **Turn Earth sites into the same numbers, at the same scale**: NASA's analog sites (the baseline: Artemis training sites for the Moon, Mars 2020 Lander Vision System test spots for Mars), the 190 USGS impact craters and hand-picked volcanic/lava fields (candidates) and farmland that *should* score badly (a sanity check). Land cover from ESA WorldCover gives the interference checks.
4. **Rank** with weighted nearest-neighbour search, comparing each site with the Moon target and with NASA's sites.
5. **Report each site honestly:** what it covers, requirements met / not met / unknown, interference risks, confidence, and what Earth can't reproduce. **Multi-site coverage** (`coverage.py`) then picks sites one at a time: which requirements each additional site covers, and which no Earth site covers (those need a lab or chamber).

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
pytest                                               # 82 tests, no internet needed
python main.py download --mission moon_rover_south_pole --count 300   # all 204 Moon-comparison sites
python main.py download --mission mars_landing_jezero --count 300     # all 199 Mars-comparison sites
python main.py run --mission moon_rover_south_pole --offline          # results in results/<mission>/report.md
python main.py run --mission mars_landing_jezero --offline
python main.py export-atlas                         # hand results to the Analog Atlas web app
```

The first run streams data for ~200 sites, which is slow on a weak connection. Every site is
saved in `data/cache/`, so later runs (or a restarted run) are fast. Add `--offline` to rank only
the sites already downloaded.

## Status (November 2026)

**Working**

- All five steps run for the Moon and Mars, together with the validation checks and multi-site
  coverage; 82 tests pass.
- Full run: all 204 Moon-comparison sites downloaded with no failures. Per mission, 103-127 are ranked;
  the rest are excluded for a reason the report lists (about 75-99 craters are covered everywhere by
  forest, farmland or water; 2 lie under the sea: Mjølnir and Montagnais).
- Temperature (Moon: Diviner; Earth: MODIS via NASA AppEEARS). The example mission
  `moon_rover_thermal_south_pole` combines terrain and temperature over 25 sites. Temperatures beyond
  Earth's range (the Moon's ~177 K yearly swing) are ranked as "closest achievable", and the report says so.
- Two-way matching: a site must resemble the whole target area, not one corner of it.
- Mars: Jezero Crater from NASA MOLA (500 m pixels, 20 km tiles), 199 Earth sites and two missions
  (`mars_landing_jezero`, `mars_rover_jezero`). There are no pass/fail rules on Mars, because NASA's
  published limits are set at 2 m-1 km, finer than any global map.

**Results against NASA's own sites** (each NASA site is held out of fitting in turn)

- **Landing** (`moon_landing_hazards_south_pole`): the typical NASA site beats 97% of the other 127 sites;
  random picks do as well 0.03% of the time. 3 of 5 NASA sites are in the top 5.
- **Rovers**: the typical NASA site beats 74-80% of 103 sites, and none makes the top 5. Many impact craters
  match the south pole's slopes better than NASA's Arizona training sites, which were chosen for geology and
  logistics as well as slope. **Haughton Crater** (NASA's Haughton-Mars Project), entered only as an ordinary
  USGS crater, ranks #1 for Mons Mouton and #4 for the south pole: the engine finds a NASA-used site on its own.
- **Thermal**: the typical NASA site beats 88% of 25 sites (random picks: 1.8%).

**Not built yet**

- Minerals (NASA EMIT), Mars temperature, and Earth maps of rocks, soil strength, ground ice and salts.
- Temperature for the remaining Earth sites (NASA AppEEARS downloads timed out for most of them).

## Files

| File | What it does |
|---|---|
| `main.py` | Command you run |
| `pipeline.py` | Runs all the steps in order |
| `sources.py` | Streams elevation data (Copernicus for Earth, LOLA for the Moon, MOLA for Mars) |
| `preprocess.py` | Cleans and resamples |
| `tiles.py` | Cuts tiles |
| `features.py` | Terrain measurements |
| `analog_knn.py` | The k-nearest-neighbours comparison |
| `mission.py` | Step 1: checks a mission's target / ignored / interference sorting and requirements |
| `landcover.py` | Interference conditions (trees, crops, snow, water...) from ESA WorldCover |
| `report.py` | Step 5: requirements, differences, confidence, report files |
| `validation.py` | Model checks: held-out NASA sites, simple-method comparison, mission sensitivity |
| `temperature.py` | Temperature group: annual range from Diviner (Moon) and MODIS via AppEEARS (Earth) |
| `coverage.py` | Multi-site coverage: which requirements each additional site covers; what no site covers |
| `charts.py` | Two simple PNG charts: the ranking, and "how close to the target" per top site |
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
- NASA LRO LOLA (LDEM_80S_20M); NASA MGS MOLA DEM 463 m (Smith et al. 2001, JGR 106(E10), doi:10.1029/2000JE001364; USGS Astrogeology mosaic); USGS analog site lists (doi:10.5066/P9J72921, doi:10.5066/P14KSANW), JPL PIA23265, © OpenStreetMap contributors.

*Mission weights are example values, not official NASA requirements. A terrain match does not validate hardware.*
