# Model thresholds and boundary cases

Use these with the bundled mission presets. Each case changes one input and assumes the other checks pass. Compare sites within the same mission and target. The model exports a continuous two-way weighted nearest-neighbour similarity. It has no calibrated minimum similarity for recommending a site.

## Model presets

| Mission | Tile exclusion limits (maximum fraction) | Mandatory site checks |
|---|---|---|
| moon_rover_south_pole | tree_frac ≤ 0.3, cropland_frac ≤ 0.2, builtup_frac ≤ 0.1, snow_ice_frac ≤ 0.1, water_frac ≤ 0.05 | slope_p90 absolute target difference ≤ 5 deg, frac_steep absolute target difference ≤ 0.1 fraction, rough_small absolute target difference ≤ 3 m |
| moon_rover_mons_mouton | tree_frac ≤ 0.3, cropland_frac ≤ 0.2, builtup_frac ≤ 0.1, snow_ice_frac ≤ 0.1, water_frac ≤ 0.05 | slope_p90 absolute target difference ≤ 5 deg, frac_steep absolute target difference ≤ 0.1 fraction, rough_small absolute target difference ≤ 3 m |
| moon_landing_hazards_south_pole | tree_frac ≤ 0.2, builtup_frac ≤ 0.1, snow_ice_frac ≤ 0.1, water_frac ≤ 0.05 | pit_density absolute target difference ≤ 0.5 per_km2, relief absolute target difference ≤ 150 m |
| moon_rover_thermal_south_pole | tree_frac ≤ 0.3, cropland_frac ≤ 0.2, builtup_frac ≤ 0.1, snow_ice_frac ≤ 0.1, water_frac ≤ 0.05 | slope_p90 absolute target difference ≤ 5 deg, temp_range_mean ≥ 60 K |
| mars_landing_jezero | tree_frac ≤ 0.2, builtup_frac ≤ 0.1, snow_ice_frac ≤ 0.1, water_frac ≤ 0.05 | None specified |
| mars_rover_jezero | tree_frac ≤ 0.3, cropland_frac ≤ 0.2, builtup_frac ≤ 0.1, snow_ice_frac ≤ 0.1, water_frac ≤ 0.05 | None specified |

## Repeatable boundary cases

| Input | Expected result |
|---|---|
| Jezero wheels, tree fraction 0.30 then 0.31 | First tile retained, second excluded. |
| Jezero landing hazards, tree fraction 0.20 then 0.21 | First tile retained, second excluded. |
| Every tile excluded by land cover | No site score exported. |
| 5 then 6 usable tiles | Low evidence at 5, ordinary evidence flag at 6. Neither count establishes hardware suitability. |
| Tile missing 5% then 6% of pixels | Missing-pixel check lets the first through and drops the second. |
| Lunar thermal mandatory annual temperature range 59 then 60 K | Requirement unmet at 59, met at 60. This is a team-set site check. Missing temperature gives unknown. |
| Atlas wheel preset, 9 then 10 snow months | The strict regional rule passes at 9 and fails at 10. |
| Atlas wheel preset, 250 then 251 mm annual precipitation | No rain penalty at 250. At 251 multiply the rules similarity by 0.75. |
| Strict rule fails at a documented precedent site | Show the failure and its exception where applicable. The precedent does not override the result. |
| Jezero thermal | Rules ranking only. No Jezero thermal kNN export. |

The model compares tiles using k = 5 and the site 75th percentile in its forward match. A stability run allows rank movement up to max(1, round(0.05 × ranked site count)). The reruns perturb individual weights by ±20%, double pixel size, or shift the grid. Stability measures sensitivity to those changes.

The Atlas applies regional rules to 0.5° Earth cells. A model land-cover fraction is a tile measurement. For example, 30% tree cover and an NDVI of 0.30 measure different things and must be tested separately. Atlas defaults to requiring data for 50% of the weighted target requirements. Failed soft rules compound.

Sources: `KNN-Model/config/missions.yaml`, `KNN-Model/config/settings.yaml`, `KNN-Model/mission.py`, `analog-atlas/src/lib/scoring.js`. The full Atlas limits per test are in [thresholds.csv](thresholds.csv).
