# Analog ranking: moon_rover_thermal_south_pole

Rover field test needing BOTH a strong terrain match and the widest temperature swings Earth can offer (thermal cycling of wheels, motors and batteries). Terrain counts about twice as much as temperature.

Target: **lunar_south_pole** (64 tiles). Earth sites ranked: 10.

Interference (trees, crops, water... over the mission's limits) would ruin the test: 1221 candidate tiles were left out, so each candidate is judged only on its usable ground. Candidates with no usable tile: avak, chicxulub, clearwater_east, deep_bay, dellen, flynn_creek, goyder, ilyinets, kaalijarv, kentland, la_moinerie, lappajarvi, mishina_gora, mizarai, pilot, puchezh_katunki, ragozinka, ries, siljan, steinheim, tvaren, vargeao_dome, vepriai, west_hawk, wetumpka, zapadnaya, zeleny_gai. NASA sites and farmland keep all tiles but rank below clean sites if their test tile is interfered. The similarity-only order is `similarity_rank` in ranking.csv.

**Low evidence:** sites judged on fewer than 6 usable 5 km squares (under 150 km² of usable ground) are marked *low evidence*. Their score rests on too little ground to be reliable, so treat their rank as a lead to check, not a recommendation. Here: ames.

| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | cinder_lake_crater_field | baseline | 0.53 | 20% | 1 / 1 / 0 | clear | high |
| 2 | sp_crater_jett3 | baseline | 0.50 | 17% | 2 / 0 / 0 | clear | high |
| 3 | yucca_flat | baseline | 0.43 | 11% | 1 / 1 / 0 | clear | high |
| 4 | meteor_crater | baseline | 0.40 | 6% | 1 / 1 / 0 | clear | high |
| 5 | garden_city_kansas | negative_control | 0.23 | 0% | 0 / 2 / 0 | clear | high |
| 6 | acraman | candidate | 0.20 | 0% | 0 / 2 / 0 | clear | high |
| 7 | ames *(low evidence)* | candidate | 0.20 | 0% | 0 / 2 / 0 | clear | high |
| 8 | araguainha | candidate | 0.11 | 0% | 0 / 2 / 0 | clear | high |
| 9 | buffalo_park | baseline | 0.43 | 11% | 2 / 0 / 0 | ⚠️ tree_frac, water_frac | high |
| 10 | ames_iowa | negative_control | 0.35 | 5% | 1 / 1 / 0 | ⚠️ cropland_frac | high |

## NASA baselines

- cinder_lake_crater_field: rank 1
- sp_crater_jett3: rank 2
- yucca_flat: rank 3
- meteor_crater: rank 4
- buffalo_park: rank 9

## Checks

The model is unsupervised (no training labels), so these checks are how it is tested.

- **Held-out NASA sites** (WARN): each NASA site left out of fitting in turn: ranks buffalo_park #3, cinder_lake_crater_field #1, meteor_crater #5, sp_crater_jett3 #2, yucca_flat #4; recall@5 = 100% (random guess: 50%). ⚠️ Only 10 sites ranked: even a random ranking would put 50% of sites in the top 5. Weak evidence.
- **Negative controls** (farmland must rank in the bottom half on similarity alone, ignoring its crops): **PASS**
- **Stability:** #1 site unchanged in 100% of 14 small changes; on average 5.0 of the top 5 stay in the top 5
- **Simple-method comparison** (agreement ≠ accuracy): top-5 overlap 5/5, Spearman 0.87
- **Mission sensitivity** (PASS): vs moon_rover_south_pole Spearman 0.75; vs moon_landing_hazards_south_pole Spearman 0.76
- Features skipped (no data at this pixel size): none
- **Closest achievable:** temp_range_mean: the target's typical value (176.9) is beyond anything on Earth here (22.1–66.6), so sites are ranked on how close they get to it. No Earth site reproduces the real value.
- Sites not ranked because a needed measurement is missing (incomplete): amboy_crater (temp_range_mean), b_p_structure (temp_range_mean), carancas (temp_range_mean), chiyli (temp_range_mean), cloud_creek (temp_range_mean), el_malpais (temp_range_mean), flaxman (temp_range_mean), holuhraun (temp_range_mean), hverfjall (temp_range_mean), jabal_qidr_harrat_khaybar (temp_range_mean), kelly_west (temp_range_mean), lunar_crater_nevada (temp_range_mean), matt_wilson (temp_range_mean), odessa (temp_range_mean), ouarkziz (temp_range_mean), pisgah_crater (temp_range_mean), serra_da_cangalha (temp_range_mean), sikhote_alin (temp_range_mean), strangways (temp_range_mean), tin_bider (temp_range_mean), valley_of_fires_carrizozo (temp_range_mean), wolfe_creek (temp_range_mean)

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
