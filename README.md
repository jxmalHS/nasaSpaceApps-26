# Planetary Analog Finder (NASA Space Apps 2026)

**Which place on Earth looks most like the Moon (or Mars) for testing a specific piece of equipment?**

This engine compares the *shape* of the ground (slopes, bumpiness, craters) on Earth with a
target area on the Moon, and ranks Earth sites from most to least similar.

## How it works

1. **Pick sites.** Earth sites NASA already uses (the baselines), new candidate sites (USGS impact craters), and flat farmland that *should* score badly (a sanity check).
2. **Stream elevation maps.** Only the needed area is read over the internet: Copernicus DEM for Earth, NASA LOLA for the Moon.
3. **Clean them.** Same map units (metres), the same 100 m pixel size everywhere, and obvious errors removed.
4. **Cut into 5 × 5 km tiles** and measure each tile: slope, steep ground, relief, bumpiness, crater-like dips. Height above "sea level" is never used, because the Moon has no sea level.
5. **Compare (k-nearest neighbours).** For each Earth tile, find the most similar Moon tiles. The mission file decides which measurements matter most.
6. **Rank.** Each site gets a score from 0 to 1, its best tile's location, and which NASA baseline it beats.

## Run it

```powershell
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest                                               # 29 tests, no internet needed
python main.py run --mission lunar_surface_mobility  # results in results/<mission>/
```

The first run streams data for ~200 sites, which is slow on a weak connection. Every site is
saved in `data/cache/`, so later runs (or a restarted run) are fast.

## Status

- ✅ Code complete for the Moon; all tests pass on made-up terrain.
- ⏳ First full run on real data not finished yet (slow internet), so there is no real ranking yet.
- ⏳ Mars: settings and baseline sites exist, but the Mars map reader isn't built yet.

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
| `config/` | Settings, sites (with sources) and mission weights |
| `docs/` | More detail: `pipeline.md`, `knn_model.md` |

## Data credits

- Copernicus DEM: *Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.*
- NASA LRO LOLA (LDEM_80S_20M), USGS analog site lists (doi:10.5066/P9J72921, doi:10.5066/P14KSANW), JPL PIA23265, © OpenStreetMap contributors.

*Mission weights are example values, not official NASA requirements. A terrain match does not validate hardware.*
