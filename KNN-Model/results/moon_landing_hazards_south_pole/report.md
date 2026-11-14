# Analog ranking: moon_landing_hazards_south_pole

Lander hazard-detection cameras / landing-site survey: crater-like dips, curvature and overall relief matter most; fine slope detail matters less.

Target: **lunar_south_pole** (64 tiles). Earth sites ranked: 38.

Interference (trees, crops, water... over the mission's limits) would ruin the test: 1077 candidate tiles were left out, so each candidate is judged only on its usable ground. Candidates with no usable tile: araguainha, avak, chicxulub, clearwater_east, deep_bay, dellen, flynn_creek, goyder, kaalijarv, la_moinerie, lappajarvi, mishina_gora, mizarai, pilot, puchezh_katunki, ragozinka, sikhote_alin, siljan, tvaren, west_hawk, wetumpka. NASA sites and farmland keep all tiles but rank below clean sites if their test tile is interfered. The similarity-only order is `similarity_rank` in ranking.csv.

**Low evidence:** sites judged on fewer than 6 usable 5 km squares (under 150 km² of usable ground) are marked *low evidence*. Their score rests on too little ground to be reliable, so treat their rank as a lead to check, not a recommendation. Here: steinheim, vargeao_dome, serra_da_cangalha, el_malpais, vepriai, strangways.

| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | jabal_qidr_harrat_khaybar | candidate | 0.39 | 14% | 1 / 1 / 0 | clear | high |
| 2 | cinder_lake_crater_field | baseline | 0.39 | 12% | 1 / 1 / 0 | clear | high |
| 3 | sp_crater_jett3 | baseline | 0.38 | 16% | 1 / 1 / 0 | clear | high |
| 4 | hverfjall | candidate | 0.36 | 12% | 1 / 1 / 0 | clear | high |
| 5 | pisgah_crater | candidate | 0.35 | 12% | 1 / 1 / 0 | clear | high |
| 6 | holuhraun | candidate | 0.35 | 11% | 1 / 1 / 0 | clear | high |
| 7 | lunar_crater_nevada | candidate | 0.35 | 3% | 1 / 1 / 0 | clear | high |
| 8 | yucca_flat | baseline | 0.35 | 11% | 1 / 1 / 0 | clear | high |
| 9 | amboy_crater | candidate | 0.33 | 9% | 1 / 1 / 0 | clear | high |
| 10 | cloud_creek | candidate | 0.32 | 6% | 1 / 1 / 0 | clear | high |
| 11 | flaxman | candidate | 0.31 | 3% | 1 / 1 / 0 | clear | high |
| 12 | valley_of_fires_carrizozo | candidate | 0.31 | 9% | 1 / 1 / 0 | clear | high |
| 13 | ouarkziz | candidate | 0.28 | 3% | 1 / 1 / 0 | clear | high |
| 14 | tin_bider | candidate | 0.27 | 5% | 1 / 1 / 0 | clear | high |
| 15 | steinheim *(low evidence)* | candidate | 0.27 | 0% | 1 / 1 / 0 | clear | high |

## NASA baselines

- cinder_lake_crater_field: rank 2
- sp_crater_jett3: rank 3
- yucca_flat: rank 8
- meteor_crater: rank 18
- buffalo_park: rank 38

## Checks

The model is unsupervised (no training labels), so these checks are how it is tested.

- **Held-out NASA sites** (INFO): each NASA site left out of fitting in turn: ranks buffalo_park #1, cinder_lake_crater_field #3, meteor_crater #19, sp_crater_jett3 #4, yucca_flat #8; recall@5 = 60% (random guess: 13%)
- **Negative controls** (farmland must rank in the bottom half on similarity alone, ignoring its crops): **PASS**
- **Stability:** #1 site unchanged in 92% of 12 small changes; on average 4.7 of the top 5 stay in the top 5
- **Simple-method comparison** (agreement ≠ accuracy): top-5 overlap 4/5, Spearman 0.93
- **Mission sensitivity** (PASS): vs moon_rover_south_pole Spearman 0.90; vs moon_rover_thermal_south_pole Spearman 0.90
- Features skipped (no data at this pixel size): none
- Sites not ranked because a needed measurement is missing (incomplete): none

## What Earth cannot reproduce

- Gravity: about 1/6 of Earth's (~1.62 vs 9.81 m/s^2), so wheel loads, sinkage and dust behaviour differ.
- Vacuum: no atmosphere; Earth sites have air, wind and weathering.
- Radiation: no magnetic field or atmosphere shielding the lunar surface.
- Temperatures: lunar day/night and permanently shadowed temperatures need thermal-vacuum chambers.
- Regolith: lunar soil grains, cohesion and electrostatic dust differ from Earth soils.
- Lighting: very low sun angles and long shadows at the lunar poles.

## Disclaimer

A terrain match does not validate hardware. It only shows the ground shape resembles the target at this scale. Subsystem performance (e.g. wheel slip and sinkage) needs separate soil, load and environmental testing.

## Data credits

- Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.
- © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC-BY 4.0)
- Diviner polar temperatures: Williams et al. (2019), Seasonal polar temperatures on the Moon, JGR Planets 124, 2505-2521
- MODIS MOD11A2 v061 land surface temperature (Wan, Hook, Hulley 2021), via NASA AppEEARS
