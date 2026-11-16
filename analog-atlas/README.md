# Analog Atlas

**Find the place on Earth that tests one subsystem the way the Moon or Mars will.**
NASA Space Apps 2026 · *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*
· Live: https://analog-atlas-five.vercel.app

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

## What the website shows

- **Explore:** a map and a ranked list for the chosen test and target. Each place's rank is shown
  as **"Top X%" of Earth, on what we measure** (rounded up, never overclaiming). The top 25 get a
  **2 km check**: the terrain is re-measured at five 2 km spots (centre and 15 km N, S, E, W) and
  compared with the same patch at the target, because a 55 km cell can average out a mountain range.
  Each row then carries one verdict: **Local slope matches**, **Check first** (not yet confirmed),
  **Local slope differs** or **Poor: fails a limit**; non-matching sites move down the list
  ("Show original order" restores it).
- **Site panel and report:** the same verdict, the rank, the features measured ("2 of 4 features
  measured"), limits and interference, what Earth cannot reproduce, and, for sites the detailed model
  analysed, its percentile and stability ("beats 99% of the sites it analysed, stable in 12/14 runs").
- **Compare:** Earth and target side by side on matched 2 km patches, with a warning when the
  local terrain is much steeper or flatter than the target.
- **References:** four plain questions (does it find NASA's own test sites, is it stable, where do
  the numbers come from, what can it not do), each answered with one table and the same verdict
  scale: **Strong / Moderate / Weak**. Every limit lists its source and whether its number is
  NASA-published or a team value. Full detail folds away under "Technical details".

---

## Run it

```bash
npm install --legacy-peer-deps   # some packages disagree on peer versions; this installs them anyway
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm test           # scoring, limits, coverage, 2 km check, verdict and rank tests
```

Node 18+. No API keys. Python is only needed to rebuild data or plug in a model.

### Deploy (Vercel)

Live at https://analog-atlas-five.vercel.app, redeployed automatically on every push to `main`.
To set it up again: import the repo on Vercel, set **Root Directory** to `analog-atlas` and the
**Install Command** to `npm install --legacy-peer-deps`; `vercel.json` sets the build, SPA rewrites
and caching, and `api/terrain.js` runs as a Node function (the 2 km checks and Compare need it).
On Vercel's free plan, pushes from teammates only deploy when the GitHub repo is public.
A plain static host also works (serve `dist/` with a fallback to `index.html`), but then only the
bundled terrain patches are available.

---

## Model scores (from the KNN-Model engine)

The app ranks with transparent rules and, when present, a model. The model never
overrides strict requirements: **ML ranks, rules gate.** The shipped bundle is the export of the
team's detailed engine in [`../KNN-Model`](../KNN-Model): 6 test/target sets (Moon wheels, landing
hazards and thermal; Mars wheels and landing hazards) with about 25-130 analysed sites each.
To refresh it:

```bash
cd ../KNN-Model && python main.py export-atlas
cd ../analog-atlas && python ml/export_scores.py ../KNN-Model/results/analog_atlas_export/scores.csv \
  --card ../KNN-Model/results/analog_atlas_export/model_card.json \
  --validation ../KNN-Model/results/analog_atlas_export/validation.json
python ml/validate.py
```

Other ways to plug in a model, simplest first:

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

**Multi-site coverage.** Explore → *Multi-site coverage* picks sites one at a time: each step adds
the site (≥ 250 km from the others) that covers the most requirements still open. A cell covers a
requirement when it is within 12 Earth-percentile points of the target AND passes every strict limit,
so conditions needed together are present together. What no site covers is listed: it needs a lab,
chamber or test bed. The engine runs the same check on its 5 km / 20 km squares (References page).

Safety rails: every bundle carries the index fingerprint and the site refuses a bundle built
for another index build; `validate.py` checks ids, sizes and coverage; the References page shows
the model card and leave-one-site-out validation. `ml/train_demo.py` (numpy only) is a stand-in
model for testing the plumbing; it is not the shipped bundle.

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

**Target profiles** (`src/config/targets.json`) for 7 lunar and 5 Martian sites. Each value is
`measured` (computed by our pipeline from NASA data), `verify` (a published mission value) or
`estimate` (placeholder); unknown values score as Unknown. The References page lists every value's status.

- **Slope and roughness, all 12 targets: measured** at the Earth index's own scale (55.6 km cell,
  9.27 km roughness pixels) from LOLA (`LDEM_80S_80M` near the south pole, `LDEM_16` elsewhere) and
  MOLA 463 m. The method was first checked on 12 Earth cells against the index: roughness tracks it
  closely (r = 0.97, scaled ×0.76 for the different DEM); slope is looser (r = 0.76, ±40%).
- **Moon south-pole temperatures (6 targets): measured** from Diviner polar seasonal maps
  (Williams et al. 2019), averaged over the same cell: day–night swing, mean (surface) temperature,
  seasonal range.
- Rebuild: `python pipeline/measure_targets.py --check` (Earth calibration), then
  `python pipeline/measure_targets.py` and `python pipeline/apply_targets.py` (needs `rasterio`).

What changed because of it: the old placeholders were mostly local values. At the Earth cells'
scale the polar Moon targets are gentle (1–3°) but very rough (280–360 m, beyond 99% of Earth
cells), so rugged mountain cells now rank higher for wheel tests there. The old 125 K "seasonal
range" was really the day–night extreme; the measured seasonal range is 2–33 K (the Moon's axis
tilts only 1.5°).

**Measured terrain in Compare.** A 2 × 2 km footprint is sampled from AWS Terrarium (Earth), LRO LOLA (Moon) or MGS MOLA (Mars). The 128 × 128 display grid uses bilinear interpolation. Each panel lists its source and native grid spacing. The 12 catalogue targets and the Hami example ship with measured patches. Other coordinates use `GET /api/terrain?body=earth&lat=44.25&lon=92.75`, served by Vite in development and preview, and a Node function on Vercel. Use `analog-atlas` as the Vercel project root. Plain static hosting serves bundled patches only. Run `node scripts/cache-terrain.mjs` to refresh them. When terrain acquisition fails, the affected panel shows unavailable and paired export is disabled.

Imagery: NASA GIBS Blue Marble and ASTER relief tiles, with a bundled Blue Marble copy
when tiles fail. Globe textures: NASA Blue Marble, LRO WAC/LOLA, Viking MDIM, LOLA south polar
mosaic.

---

## Limits and their sources

**Full threshold table:** [`docs/THRESHOLDS.md`](docs/THRESHOLDS.md) (also `docs/thresholds.csv` for
Excel): every website and engine limit, its NASA reference and its tagged NASA-site exceptions.
It is generated (`npm run thresholds`) and `npm test` fails if it is out of date.
**Tests:** `tests/limits.test.mjs` pins every threshold, checks each one cites its NASA source
(with the verified quotes), checks the scorer's boundaries (at the limit passes, just over fails,
soft = ×0.75), and checks that every NASA-site disagreement is listed with the right tag.
If you change a limit on purpose: update `PINNED` in that test, run `python ml/validate_limits.py`
and `npm run thresholds`.

Each test's hard limits (fail) and soft limits (score × 0.75 and a warning) live in
`src/config/missions.json`. Every limit carries `src` (source ids) and `basis` (why this
number), and the `sources` block holds the full citations. The References page renders the same
table ("Limits and their sources"), so the docs and the scorer cannot disagree.

| Limit | Used as | Basis | Source |
|---|---|---|---|
| Vegetation (NDVI) ≤ 0.30 | wheels, boots, comms, lights, regolith, ice digging, solar, fission | Top of NASA's shrub/grassland range (0.2–0.3). Solar and fission were 0.35, now 0.30 | [1] |
| Vegetation (NDVI) ≤ 0.25 | navigation, dust, suit dust, intake, water, spectrometers, landing | Inside the 0.2–0.3 range. Not 0.2: the layer is the annual maximum over a 55 km cell, and 0.2 would fail NASA's own Mojave site (0.22 on its cell; 0.28 at the field site, listed as an exception) | [1] |
| Rain/snow ≤ 250 mm/yr | thermal, dust, suit dust, intake, regolith, habitat thermal (strict); wheels, boots, drills, fission (soft) | NASA's desert figure (about 250 mm). **Conflict:** the same NASA page also says most deserts get less than 300 mm; 250 is the stricter of the two. Wheels, boots, drills and fission were 300 mm, now 250 | [2], [5] |
| Rain/snow ≤ 400 / 500 mm/yr | ice digging, foundations / solar, spectrometers (soft) | No NASA number exists. Checked against NASA sites: McMurdo and Haughton pass; HI-SEAS, Svalbard, Mauna Kea and Holuhraun break it on their 55 km cells (exceptions listed on the References page) | [5], [9] |
| Snow ≤ 9 months | wheels, boots, regolith, landing (strict) | MODIS land cover counts snow on ≥ 60% of the area for 10+ months as *permanent* snow and ice. NASA campaigns last one to two weeks (JETT5, D-RATS 2022), so a short snow-free window is enough | [3], [4], [6] |
| Snow ≤ 6 months | navigation, thermal, habitat thermal, foundations (soft) | No NASA number exists. Checked against NASA sites: the snowiest NASA field sites (Holuhraun, Svalbard) read 6 months at the field site, so 6 matches them. Exception: McMurdo (thermal tests) | [4], [9] |
| Airborne dust ≤ 60 µg/m³ | navigation (soft) | No NASA number exists. Checked against NASA sites: every NASA field site reads 51 µg/m³ or less in MERRA-2, so 60 rejects none | [7], [9] |

Weights (`w`) are team judgement: no NASA dataset publishes analog weights. The rover slope
reasoning follows VIPER's 15° normal / 25–30° maximum slopes [8].

1. NASA Earth Observatory, "Measuring Vegetation (NDVI & EVI)", 30 Aug 2000. https://science.nasa.gov/earth/earth-observatory/measuring-vegetation-ndvi-evi . Quote: "Very low values of NDVI (0.1 and below) correspond to barren areas of rock, sand, or snow. Moderate values represent shrub and grassland (0.2 to 0.3)". Caveat on the same page: the values "are representative of actual values, but real vegetation is much more varied."
2. NASA Science, "Mission: Biomes – Desert". https://science.nasa.gov/kids/earth/mission-biomes/biodesert . Quotes: "Deserts get about 250 millimeters (10 inches) of rain per year" and "Most deserts receive less than 300 mm a year".
3. Sulla-Menashe & Friedl, MODIS Collection 6.1 Land Cover Type (MCD12Q1) Product User Guide, Table 3 (IGBP legend), NASA LP DAAC. https://lpdaac.usgs.gov/documents/1409/MCD12_User_Guide_V61.pdf
4. Hall & Riggs (2021), MODIS/Terra Snow Cover Daily L3 Global 500m SIN Grid, Version 61 (MOD10A1), NASA NSIDC DAAC. https://doi.org/10.5067/MODIS/MOD10A1.061 . Riggs, Hall & Román (2019), MODIS Snow Products Collection 6.1 User Guide v1.0.
5. Reichle & Liu (2014), "Observation-Corrected Precipitation Estimates in GEOS-5", NASA/TM-2014-104606 Vol. 35, §3.1.4 and §4. https://gmao.gsfc.nasa.gov/pubs/docs/Reichle734.pdf . Quote: "MERRA-2 is forced with its own, model-generated precipitation at high latitudes, with the corrected precipitation data over low latitudes, and with a combination of the two between 42.5º and 62.5º latitude." NASA POWER (https://power.larc.nasa.gov/docs/methodology/): "Meteorological parameters continue to be based upon MERRA-2".
6. NASA D-RATS 2022 Test Report (NTRS 20230017073, XM-23-003), p. 6: October 2022, Black Point Lava Flow, "plan and execute 2 weeks of consecutive field-testing". https://ntrs.nasa.gov/citations/20230017073 . NASA SVS 14583: JETT5 was "a week-long moonwalk simulation in the San Francisco Volcanic Field" (13–17 May 2024). https://svs.gsfc.nasa.gov/14583
7. NASA GMAO MERRA-2 aerosol diagnostics M2TMNXAER v5.12.4 (DUSMASS), NASA GES DISC. https://www.earthdata.nasa.gov/data/catalog/ges-disc-m2tmnxaer-5.12.4
8. NASA, VIPER Lunar Operations. https://science.nasa.gov/mission/viper/lunar-operations/
9. Precedent-site check, `ml/validate_limits.py`: NASA GIBS, MOD13A3 v6.1 monthly NDVI, 1 km (https://doi.org/10.5067/MODIS/MOD13A3.061) and MOD10CM v6.1 monthly snow cover, 0.05° (https://doi.org/10.5067/MODIS/MOD10CM.061), 2023, ~5 km box at each NASA field site.

### Checked against the places NASA actually tested

`python ml/validate_limits.py` (needs `pillow`) checks every limit against each test's NASA
precedent sites and writes `src/config/limit_checks.json`, which the References page shows.
Vegetation and snow are re-measured at the field coordinates from NASA GIBS (MOD13A3, MOD10CM; a
snow month = mean cover ≥ 60%, the IGBP permanent-snow line);
rain uses the 55 km cell, because no finer NASA rain product is available without a login.

Result (Nov 2026): 14 of 38 limit checks agree with every NASA site. The limits are kept
strict on purpose, and all 32 disagreements are listed as tagged exceptions (References page,
"Limits and their sources", and the site panel of each NASA site):

| Tag | Meaning | Count |
|---|---|---|
| EXCEPTION · field site | breaks the limit at the field site itself (NASA site-scale data) | 10 |
| EXCEPTION · 55 km cell only | the cell breaks it, the field site passes | 6 |
| EXCEPTION · cell, unverified | the cell breaks it; no finer NASA data to check (rain) | 16 |

Main ones:

- **San Francisco Volcanic Field** reads NDVI 0.43 even at 1 km: NASA works on bare cinder
  patches smaller than a MODIS pixel inside a pine-covered field.
- **Mojave** reads NDVI 0.28 at the field site, above the 0.25 limit for navigation and landing.
- **Rain at high latitude** (Haughton, Holuhraun, Svalbard): NASA's MERRA-2 rain is model-only
  poleward of 62.5° (NASA/TM-2014-104606 Vol. 35), and those cells include wetter terrain.
- **Holuhraun** fails snow on its 55 km cell (10 months, glacier included) but passes at the
  lava field itself (6 months), so it is tagged EXCEPTION · 55 km cell only.

**Known conflicts in the sources themselves:** NASA gives two desert rain figures (about 250 mm and
under 300 mm); NASA's NDVI ranges are "representative" values, while this layer is the yearly
maximum; the engine's tree limit uses ESA WorldCover's tree class, not the IGBP canopy-cover
definition it is compared with.

## What the honest numbers say (see the References page)

* **Website rules vs NASA's own sites:** for each of the 20 tests, NASA's precedent sites are scored
  without the rules ever seeing them. Verdicts (how often random places would do as well): 0 Strong,
  3 Moderate (rover wheels, ice excavation, landing hazards), 17 Weak. Most tests have only 1-4
  NASA sites, too few to prove more.
* **Detailed model vs NASA's own sites:** lunar landing hazards is **Strong** (NASA's sites beat 97%
  of 127 analysed sites; random picks do this 3 times in 10,000); thermal is Moderate (88% of 25);
  rover wheels and Mars are Weak. NASA also chooses sites for road access and logistics, which
  neither ranking measures, and nothing was tuned to make NASA's sites win.
* **Stability:** in the detailed model the #1 site stays #1 in 10-14 of 12-14 small changes for
  every set.
* **Scale matters:** the rules' raw #1 for rover wheels at the lunar south pole, near Khorugh
  (Afghanistan), is 3.5x steeper than the target at 2 km (31.5° vs 9.0° mean slope); the 2 km check
  flags it and moves it down. Some precedent sites fail at cell scale for the same reason: a 55 km
  cell around McMurdo's Dry Valleys is mostly ice sheet; Mauna Kea's includes the wet windward island.
* **Some targets are beyond Earth:** no surface reaches the lunar pole's day–night swing or its
  permanent low sun (Earth max ≈ 39% of daylight hours under 10°). The ranking finds Earth's
  extreme and the report prescribes the chamber test.

---

## Architecture

```
src/config/        features, targets, analogs, missions, limits: one catalogue for app + pipeline + ML
src/lib/scoring.js pure scoring engine (roles, Earth-percentile matching, strict/soft limits, evidence)
src/lib/worker.js  owns the index; scores, ranks, paints rasters, stability, validation, CSV sites
src/lib/store.js   all view state, mirrored in the URL (share = exact restore)
src/lib/localCheck.js  2 km check (5 spots per cell, top 25) and the one-verdict-per-site rule
src/lib/verdict.js     References verdict scale (Strong / Moderate / Weak); rank.js: "Top X%"
src/components/    EarthMap (MapLibre globe), PlanetGlobe (three.js, polar cap), HomeScene, Relief3D…
src/pages/         Home, Explore, Compare, Report (printable), References (Trust.jsx; /trust still works)
api/terrain.js     Node function for measured 2 km terrain patches (Vercel; Vite dev/preview reuse it)
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
