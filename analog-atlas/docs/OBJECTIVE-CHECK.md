# NASA Space Apps objective check

Reviewed against the five-page team brief and the current local production build, 15 November 2026.

| Objective from brief | Current evidence | Remaining limit |
|---|---|---|
| Homepage Moon orbit | Browser check confirms movement, pause, and reduced-motion behavior in Lite mode. | Sustained 60 fps on the team's minimum-spec laptop still needs a device test. |
| Earth, Moon and Mars exploration | Earth globe/flat projection switch, layers menu, Mars model loading and linked viewers exercised. Earth imagery-only view removes overlays. | The Earth index has more environmental layers than the planetary maps. A new inspection footprint changes terrain and imagery; mission rankings remain tied to a catalogued target. |
| Mission checklist, defaults, weights, and constraints | Subsystem tests, adjustable roles/weights, hard and soft limits, evidence filter, and regional filter are present. Scoring and boundary suites pass. | Scientific validity of team thresholds still requires external field evidence. |
| Candidate discovery and independent recommendations | Ranked Earth list, geographic clusters, cell inspector, limits, shortlist and recommendations. Both Jezero exports loaded in the browser. | A cell centre is exact for the 0.5-degree grid. Hardware tests need a field survey. A model test spot, when supplied, has separate coordinates. |
| Side-by-side comparison and fixed inspection footprint | Two explicitly configured planetary viewers; DEM-based 2 km patches, A/B labels, slope/height selection, profile, keyboard inspector, flicker, CSV and report. A new lunar footprint changed the measured values. | Equal footprint size and a common display grid do not imply equal resolving power. MOLA is about 463 m at the equator and cannot resolve landing rocks. |
| Source attribution and unavailable states | Image service and elevation sources are named separately. The missing-DEM test preserved the other panel and disabled the paired export. NASA POWER returned point climatology for Hami. | Pole and tile-edge coverage varies. Lunar polar overview is elevation relief. Raster products can contain source-interpolated cells. Failure handling cannot identify every possible bad upstream image. |
| Mission state, export, tour and trust | Share restores comparison dimension and flicker. Uploaded CSV cases preserve coordinates and data provenance. Four-step tour, copy controls, vertical criteria rows, site report and References evidence (formerly Trust) are implemented. | Local uploaded rows require the original file on another device. |
| Accessibility, resizing and low-end operation | Browser checks covered keyboard terrain inspection, mobile sheet scrolling, linked Compare at three sizes, labelled controls and reduced motion. | Full screen-reader, contrast, browser/device and frame-rate acceptance remain open. |
| Model coverage | Moon: Connecting Ridge (wheels, hazards, thermal); Mons Mouton Plateau (wheels). Mars: Jezero (wheels, hazards). Other combinations use regional mission rules. | Mars thermal, other target/test kNN exports, local geology and subsurface evidence remain incomplete. |
| Hosting and release | Deployed on Vercel at https://analog-atlas-five.vercel.app (root directory analog-atlas, auto-deploy on push). Smoke test on 15-16 November 2026: all pages, model data and the terrain function at a fresh, unbundled coordinate return 200; the top-25 2 km checks complete in the browser. | The terrain function is slow on the first request after a deploy (cold start); custom Moon/Mars footprints can take ~17 s. |

## Reproducible checks

1. Open Compare with `?cmp=66065&target=connecting-ridge&test=ltv.wheels`. The A panel is centred on 44.25 N, 92.75 E near Hami. The default B panel is at 89.45 S, 137.50 W. Rounded mean slopes are 1.8 and 9.0 degrees.
2. Set the inspection patch to 89.46 S, 137.50 W. B mean slope becomes about 9.3 degrees; A stays at 1.8. Export the CSV and inspect both centres, grid spacings and product links.
3. Switch B to Jezero. Its MOLA source and coarser sampling are shown. For a failed live request at an uncached coordinate expect “Measured terrain unavailable”, no paired profile, and a disabled paired CSV.
4. For an independent API check, request `/api/terrain?body=earth&lat=-24.25&lon=-69.25`. Expect a finite 128 × 128 grid, 2000 m extent, matching coordinates, and an AWS terrain source. Cases outside supported coverage return an error.
5. Run `npm.cmd test` and `npm.cmd run build` in analog-atlas. Run `python -m pytest -q` in KNN-Model with its requirements installed.
