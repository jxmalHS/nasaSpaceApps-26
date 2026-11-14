# Analog Atlas

**Find the place on Earth that tests one subsystem the way the Moon or Mars will.**
NASA Space Apps 2026 · *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*

Most analog finders ask "which place looks most like Mars overall?". Analog Atlas asks
"where can *this* hardware meet the conditions that will break it, without something else
spoiling the test?" Every condition plays one role per test:

| Role | Meaning | Example (rover wheels, lunar south pole) |
|---|---|---|
| **Target** | Must match or beat the Moon/Mars value; scored in real units | slope, roughness, rock abundance |
| **Ignored** | Allowed to be un-lunar; never touches the score | air temperature |
| **Interference** | Need not match, but must stay under a limit (strict or soft) | snow season, vegetation, wet soil |

Every one of 78,993 real Earth land cells is scored live in a Web Worker, ranked beside
NASA's usual field site, and every result says what Earth cannot reproduce.

---

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm test           # scoring tests on the real index
```

Node 18+. No API keys. Python is only needed to rebuild data or plug in a model.

### Deploy (Vercel)

Import the repo; `vercel.json` sets the build, SPA rewrites and caching. Any static host works
(serve `dist/` with a fallback to `index.html`).

---

## Plugging in the model trained on the other laptop

The app ranks with transparent rules and, when present, a model. The model never
overrides strict requirements: **ML ranks, rules gate.** Three routes, simplest first:

**A. Static bundle (recommended; no server).**

1. On the laptop, copy this repo's `public/data/earth_index.*` and `ml/` folder.
2. Edit only `ml/adapter.py`: `load()` returns your artifact, `predict(model, df, test_id, target)`
   returns scores 0..1 (NaN = cannot score). The expected joblib layout is documented in the file.
3. Run `python ml/run_model.py --card model_card.json` (template: `ml/model_card.example.json`).
   Add `--per-target` if your model is target-specific.
4. `python ml/validate.py`, then commit `public/data/ml/` and redeploy.

Already have a CSV of scores? `python ml/export_scores.py scores.csv --card card.json [--validation v.json] [--agg max|mean] [--snap-km 60]`
(columns `cell_id,test_id,score[,target_id][,uncertainty][,lat,lon]` plus optional detail columns
`confidence, low_evidence, req_met, req_not_met, req_unknown, flags, spot_lat, spot_lon, note, site_name`;
see `ml/examples/`). Sparse models (a few dozen sites) are supported: unscored cells show
"Not analysed in detail", Blend falls back to rules there, and analysed sites get their own list.

**B. Live API.** `uvicorn serve:app --app-dir ml --port 8000`, then build with
`VITE_ML_API=https://your-host`. Same adapter, same encoding.

**C. Nothing.** The app runs on rules alone and says so.

Safety rails: every bundle carries the index fingerprint and the site refuses a bundle built
for another index build; `validate.py` checks ids, sizes and coverage; the Trust page shows the
model card and leave-one-site-out validation. The shipped bundle is a **demo** model
(`ml/train_demo.py`, numpy only) that learns per-test weights from NASA's precedent sites.

Columns, units and order the model must use: `ml/feature_schema.json`. Training table:
`public/data/earth_index.csv.gz` (one row per cell, missing = empty).

---

## Data provenance

All Earth layers are real, 0.5° (~55 km) grids carried over from the team's TerraNova cache:

| Layer | Source |
|---|---|
| Slope, roughness, elevation | AWS Terrarium DEM (SRTM/NASADEM-derived), 1/12° → 0.5° |
| Day–night surface temperature swing | MODIS Terra LST day − night; gaps filled from NASA POWER TS_RANGE (r = 0.92) |
| Mean temperature, seasonal range, precipitation | NASA POWER (MERRA-2) climatology 2001–2020 |
| Vegetation | MODIS NDVI 2023 annual maximum (GIBS) |
| Snow/ice months | MODIS snow cover 2023 (GIBS) |
| Airborne dust | MERRA-2 dust surface mass concentration 2023 (GIBS) |
| Basaltic bedrock | GLiM v1.0 (Hartmann & Moosdorf 2012) |
| Remoteness | Natural Earth 1:10m populated places |
| Low-sun share, longest darkness, air pressure | Computed (solar geometry; barometric formula) |

Planned layers (shown as **Unknown** everywhere until added): rock abundance, soil bearing
strength, depth to ground ice, salts/perchlorate.

Rebuild: `npm run data` (= `pipeline/build_index.py` + `ml/train_demo.py`).

**Target profiles** (`src/config/targets.json`) for 7 lunar and 5 Martian sites are marked
`verify` (published/mission values) or `estimate` (placeholders pending LOLA, Diviner, MOLA,
THEMIS, MEDA/REMS extraction at matched scale). Unknown target values score as Unknown in
Realism mode; in Stress mode a directional feature aims for Earth's extreme and says so.

**Terrain patches** in Compare are synthesized from each site's regional slope and roughness
and labelled *illustrative* until measured DEM windows are added with
`pipeline/make_patches.py` (NASADEM / ASTER / LOLA / HiRISE; body radius passed explicitly).

Imagery: NASA GIBS Blue Marble and ASTER relief tiles, with a bundled Blue Marble copy
when tiles fail. Globe textures: NASA Blue Marble, LRO WAC/LOLA, Viking MDIM, LOLA south polar
mosaic.

---

## What the honest numbers say (see the Trust page)

* Rules place NASA precedent sites at a median **74th percentile** of Earth (43 site–test pairs),
  without being trained on them.
* Some precedent sites fail at cell scale: a 55 km cell around McMurdo's Dry Valleys is mostly
  ice sheet; Mauna Kea's includes the wet windward island. Measured patches fix this.
* Some targets are beyond Earth: no surface reaches the lunar pole's day–night swing or its
  permanent low sun (Earth max ≈ 39% of daylight hours under 10°). The ranking finds Earth's
  extreme and the report prescribes the chamber test.
* Discovery works: for thermal cycling the Mongolian plateau beats the Atacama; for Mars air
  intakes the Qaidam/Tibet plateau ranks first.

---

## Architecture

```
src/config/        features, targets, analogs, missions, limits: one catalogue for app + pipeline + ML
src/lib/scoring.js pure scoring engine (roles, Earth-percentile matching, strict/soft limits, evidence)
src/lib/worker.js  owns the index; scores, ranks, paints rasters, stability, validation, CSV sites
src/lib/store.js   all view state, mirrored in the URL (share = exact restore)
src/components/    EarthMap (MapLibre globe), PlanetGlobe (three.js, polar cap), HomeScene, Relief3D…
src/pages/         Home, Explore, Compare, Report (printable), Trust
pipeline/          build_index.py, make_patches.py, source grids
ml/                adapter.py (edit me), run_model.py, export_scores.py, validate.py, serve.py, train_demo.py
```

Why MapLibre for Earth but three.js for the Moon and Mars: MapLibre tiles are Web Mercator
and stop at ±85°, while every Artemis candidate lies at 84–89.5°S. The lunar globe projects
the LOLA south-polar mosaic onto a cap with exact stereographic UVs instead.

Performance: scoring all cells takes 5–30 ms in the worker; map rasters are painted once per
change into a canvas source; the homepage scene caps pixel ratio, drops resolution when frames
run long and stops when off-screen; the planet globe renders only on interaction.

Accessibility: status is always icon + word + colour; unknown is grey hatching with "?";
every technical term has a plain-language tooltip; the ranked list is a full keyboard and
screen-reader alternative to the globe; reduced motion stops the orbit and tours; the
homepage animation has pause and step controls.
