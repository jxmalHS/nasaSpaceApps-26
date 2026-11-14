# Analog ranking: moon_rover_mons_mouton

Same rover-wheel test as moon_rover_south_pole, but the target is the Mons Mouton plateau (VIPER / IM-2 landing area): the gentler ground a rover would really drive on, instead of a box round the pole that includes Shackleton crater's steep walls. Weights as moon_rover_south_pole (published rover slope limits); ~30 cm rocks NOT measured.

Target: **mons_mouton** (36 tiles). Earth sites ranked: 32.

Interference (trees, crops, water... over the mission's limits) would ruin the test: 1221 candidate tiles were left out, so each candidate is judged only on its usable ground. Candidates with no usable tile: avak, chicxulub, clearwater_east, deep_bay, dellen, flynn_creek, goyder, ilyinets, kaalijarv, kentland, la_moinerie, lappajarvi, mishina_gora, mizarai, pilot, puchezh_katunki, ragozinka, ries, siljan, steinheim, tvaren, vargeao_dome, vepriai, west_hawk, wetumpka, zapadnaya, zeleny_gai. NASA sites and farmland keep all tiles but rank below clean sites if their test tile is interfered. The similarity-only order is `similarity_rank` in ranking.csv.

**Low evidence:** sites judged on fewer than 6 usable 5 km squares (under 150 km² of usable ground) are marked *low evidence*. Their score rests on too little ground to be reliable, so treat their rank as a lead to check, not a recommendation. Here: serra_da_cangalha, sikhote_alin, strangways, el_malpais, ames.

| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | flaxman | candidate | 0.65 | 25% | 3 / 0 / 0 | clear | high |
| 2 | araguainha | candidate | 0.64 | 31% | 3 / 0 / 0 | clear | high |
| 3 | yucca_flat | baseline | 0.64 | 42% | 3 / 0 / 0 | clear | high |
| 4 | pisgah_crater | candidate | 0.62 | 39% | 3 / 0 / 0 | clear | high |
| 5 | valley_of_fires_carrizozo | candidate | 0.60 | 39% | 3 / 0 / 0 | clear | high |
| 6 | sp_crater_jett3 | baseline | 0.59 | 19% | 3 / 0 / 0 | clear | high |
| 7 | cinder_lake_crater_field | baseline | 0.59 | 22% | 3 / 0 / 0 | clear | high |
| 8 | matt_wilson | candidate | 0.59 | 17% | 3 / 0 / 0 | clear | high |
| 9 | jabal_qidr_harrat_khaybar | candidate | 0.59 | 22% | 3 / 0 / 0 | clear | high |
| 10 | lunar_crater_nevada | candidate | 0.57 | 17% | 3 / 0 / 0 | clear | high |
| 11 | ouarkziz | candidate | 0.57 | 28% | 3 / 0 / 0 | clear | high |
| 12 | hverfjall | candidate | 0.55 | 11% | 3 / 0 / 0 | clear | high |
| 13 | serra_da_cangalha *(low evidence)* | candidate | 0.55 | 11% | 3 / 0 / 0 | clear | high |
| 14 | amboy_crater | candidate | 0.55 | 19% | 3 / 0 / 0 | clear | high |
| 15 | holuhraun | candidate | 0.54 | 14% | 3 / 0 / 0 | clear | high |

## NASA baselines

- yucca_flat: rank 3
- sp_crater_jett3: rank 6
- cinder_lake_crater_field: rank 7
- meteor_crater: rank 19
- buffalo_park: rank 31

## Checks

The model is unsupervised (no training labels), so these checks are how it is tested.

- **Held-out NASA sites** (INFO): each NASA site left out of fitting in turn: ranks buffalo_park #4, cinder_lake_crater_field #9, meteor_crater #20, sp_crater_jett3 #7, yucca_flat #3; recall@5 = 40% (random guess: 16%)
- **Negative controls** (farmland must rank in the bottom half on similarity alone, ignoring its crops): **PASS**
- **Stability:** #1 site unchanged in 86% of 14 small changes; on average 4.9 of the top 5 stay in the top 5
- **Simple-method comparison** (agreement ≠ accuracy): top-5 overlap 3/5, Spearman 0.90
- **Mission sensitivity** (NOT RUN): only one mission for this target
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
