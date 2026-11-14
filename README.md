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
pytest                                               # 64 tests, no internet needed
python main.py run --mission lunar_surface_mobility  # results in results/<mission>/report.md
```

The first run streams data for ~200 sites, which is slow on a weak connection. Every site is
saved in `data/cache/`, so later runs (or a restarted run) are fast. Add `--offline` to rank only
the sites already downloaded.

## Status

- ✅ All 5 steps work for the Moon, plus the model checks; 64 tests pass.
- ✅ Temperature that Earth can't reach (the Moon's ~177 K yearly swing) is ranked as "closest achievable", and the report says so.
- ✅ Checked on real data for the 5 sites downloaded so far (the Artemis training sites rank top).
- ⏳ Full real run (~200 sites) not done yet: slow internet.
- ✅ Temperature group (Moon: Diviner; Earth: MODIS via NASA AppEEARS). Example mission `lunar_rover_thermal_terrain` uses terrain + temperature.
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
| `config/` | Settings, sites (with sources) and mission weights |
| `docs/` | More detail: `pipeline.md`, `knn_model.md` |

## Data credits

- Copernicus DEM: *Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.*
- NASA LRO LOLA (LDEM_80S_20M), USGS analog site lists (doi:10.5066/P9J72921, doi:10.5066/P14KSANW), JPL PIA23265, © OpenStreetMap contributors.

*Mission weights are example values, not official NASA requirements. A terrain match does not validate hardware.*
