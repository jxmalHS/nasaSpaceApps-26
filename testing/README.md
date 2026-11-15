# testing/ — next version of KNN-Model and analog-atlas (to be merged)

Copies of `../KNN-Model` and `../analog-atlas` with the next round of changes, kept separate so the
originals stay stable until this is merged. Everything here runs on its own.

## What is new
**Engine (`KNN-Model/`)**
- Mars: Jezero Crater target from NASA MGS MOLA 463 m (500 m pixels, 20 km tiles); two missions,
  `mars_landing_jezero` and `mars_rover_jezero`; 199 Earth sites (6 Mars 2020 Lander Vision System
  test spots, 190 USGS impact craters, farmland controls). No pass/fail rules on Mars: NASA's numbers
  are set at 2 m - 1 km (sources quoted in `config/missions.yaml`).
- Multi-site coverage (`coverage.py`): which requirements each additional site covers, what none covers.
- Full rerun on all downloaded sites (204 Moon, 199 Mars). Results in `results/`; see each report.md.
  The thermal mission still has its old 10-site results (needs an Earthdata login to rerun).

**Website (`analog-atlas/`)**
- Target slope/roughness for all 12 targets and Moon south-pole temperatures measured from LOLA, MOLA
  and Diviner at the Earth index's scale (`pipeline/measure_targets.py`, `pipeline/apply_targets.py`).
- Multi-site coverage button in Explore; Trust page sections for engine coverage and target-value sources.
- Engine results for all 5 missions imported (incl. Mars); Death Valley added as a landing-test precedent.

## Run
```powershell
cd testing/KNN-Model
python -m venv venv; venv\Scripts\Activate.ps1; pip install -r requirements.txt
pytest                                   # 77 tests

cd ../analog-atlas
npm install --legacy-peer-deps
npm run dev -- --port 5199               # http://localhost:5199
npm test                                 # 38 tests
```
The engine's downloaded data (`KNN-Model/data/cache/`) is not in git; `python main.py download ...`
re-creates it (about 30 min Moon, 1 h Mars).
