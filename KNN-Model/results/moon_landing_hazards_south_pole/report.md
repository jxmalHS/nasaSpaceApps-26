# Analog ranking: moon_landing_hazards_south_pole

Lander hazard-detection cameras / landing-site survey: crater-like dips, curvature and overall relief matter most; fine slope detail matters less.

Target: **lunar_south_pole** (64 tiles). Earth sites ranked: 127.

Interference (trees, crops, water... over the mission's limits) would ruin the test: 3919 candidate tiles were left out, so each candidate is judged only on its usable ground. Candidates with no usable tile: araguainha, avak, bosumtwi_ashanti, brent, carswell, charlevoix_la_malbaie, chesapeake_bay, chicxulub, clearwater_east, clearwater_east_2, colonia, couture_lac_couture, crooked_creek, decaturville, deep_bay, dellen, des_plaines, flynn_creek, gardnos, gow, goyder, holleford, hummeln, ile_rouleau, ilumetsa, iso_naakkima, janisjarvi, kaalijarv, kardla, karikkoselka, keurusselka, la_moinerie, lappajarvi, liverpool, lockne, lockne_2, logancha, luizi, lumparn, macha, manicouagan, marquez, middlesboro, mien, mishina_gora, mizarai, neugrund, nicholson, paasselka, pilot, popigai, presqu_ile, puchezh_katunki, ragozinka, rochechouart, saaksjarvi, saarijarvi, serpent_mound, sikhote_alin, siljan, slate_islands, sobolev, soderfjarden, steen_river, suavjarvi, sudbury, suvasvesi_n, suvasvesi_s, tvaren, wanapitei, wells_creek, west_hawk, wetumpka, whitecourt, xiuyan. NASA sites and farmland keep all tiles but rank below clean sites if their test tile is interfered. The similarity-only order is `similarity_rank` in ranking.csv.

**Low evidence:** sites judged on fewer than 6 usable 5 km squares (under 150 km² of usable ground) are marked *low evidence*. Their score rests on too little ground to be reliable, so treat their rank as a lead to check, not a recommendation. Here: steinheim, foelsche, vargeao_dome, vista_alegre, new_quebec_chubb_ungava_pingualuit, kaluga, mistastin, logoisk, serra_da_cangalha, rock_elm, ritland, el_malpais, riachao_ring, vepriai, morasko, glover_bluff, calvin, strangways, saint_martin.

| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | monturaqui | candidate | 0.34 | 16% | 1 / 1 / 0 | clear | high |
| 2 | jabal_qidr_harrat_khaybar | candidate | 0.34 | 12% | 1 / 1 / 0 | clear | high |
| 3 | cinder_lake_crater_field | baseline | 0.34 | 14% | 1 / 1 / 0 | clear | high |
| 4 | sp_crater_jett3 | baseline | 0.33 | 16% | 1 / 1 / 0 | clear | high |
| 5 | hverfjall | candidate | 0.30 | 11% | 1 / 1 / 0 | clear | high |
| 6 | yucca_flat | baseline | 0.30 | 9% | 1 / 1 / 0 | clear | high |
| 7 | pisgah_crater | candidate | 0.30 | 12% | 1 / 1 / 0 | clear | high |
| 8 | santa_fe | candidate | 0.30 | 6% | 1 / 1 / 0 | clear | high |
| 9 | lunar_crater_nevada | candidate | 0.29 | 5% | 1 / 1 / 0 | clear | high |
| 10 | holuhraun | candidate | 0.29 | 11% | 1 / 1 / 0 | clear | high |
| 11 | amboy | candidate | 0.29 | 9% | 1 / 1 / 0 | clear | high |
| 12 | amboy_crater | candidate | 0.29 | 9% | 1 / 1 / 0 | clear | high |
| 13 | eagle_butte | candidate | 0.28 | 6% | 1 / 1 / 0 | clear | high |
| 14 | beaverhead | candidate | 0.28 | 5% | 1 / 1 / 0 | clear | high |
| 15 | shunak | candidate | 0.26 | 6% | 1 / 1 / 0 | clear | high |

## NASA baselines

- cinder_lake_crater_field: rank 3
- sp_crater_jett3: rank 4
- yucca_flat: rank 6
- meteor_crater: rank 43
- buffalo_park: rank 127

## Checks

The model is unsupervised (no training labels), so these checks are how it is tested.

- **Held-out NASA sites** (INFO): each NASA site left out of fitting in turn: ranks buffalo_park #1, cinder_lake_crater_field #3, meteor_crater #44, sp_crater_jett3 #5, yucca_flat #7; recall@5 = 60% (random guess: 4%)
- **Negative controls** (farmland must rank in the bottom half on similarity alone, ignoring its crops): **PASS**
- **Stability:** #1 site unchanged in 83% of 12 small changes; on average 4.9 of the top 5 stay in the top 5
- **Simple-method comparison** (agreement ≠ accuracy): top-5 overlap 2/5, Spearman 0.88
- **Mission sensitivity** (PASS): vs moon_rover_south_pole Spearman 0.54; vs moon_rover_thermal_south_pole Spearman 0.56
- Features skipped (no data at this pixel size): none
- Sites not ranked because a needed measurement is missing (incomplete): none

## Multi-site coverage

7 requirements (mandatory rules + every weighted measurement inside the target's own 10-90% range). A site covers a requirement only if one interference-free tile meets it; requirements met together must be met on the same tile. Target range = 10%-90% of the target's tiles. Greedy: each step adds the site covering the most new requirements.

1. **pisgah_crater** (rank 7, candidate, tile r04c01) adds: pit_density within 0.5 per_km2 of the target; Density of crater-like dips inside the target's range (0.4–1.39 per km²); Curvature inside the target's range (0.211–0.431 /km); Relief (highest minus lowest) inside the target's range (444–2.48e+03 m); Hypsometric integral inside the target's range (0.334–0.667); Large-scale bumpiness inside the target's range (17.2–60.7 m) → 6/7 covered
2. **beaverhead** (rank 14, candidate, tile r04c01) adds: relief within 150 m of the target → 7/7 covered

**Not covered by any Earth site here** (needs a lab, chamber or engineered testbed, or more sites): none

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
