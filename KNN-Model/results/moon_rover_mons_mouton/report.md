# Analog ranking: moon_rover_mons_mouton

Same rover-wheel test as moon_rover_south_pole, but the target is the Mons Mouton plateau (VIPER / IM-2 landing area): the gentler ground a rover would really drive on, instead of a box round the pole that includes Shackleton crater's steep walls. Weights as moon_rover_south_pole (published rover slope limits); ~30 cm rocks NOT measured.

Target: **mons_mouton** (36 tiles). Earth sites ranked: 103.

Interference (trees, crops, water... over the mission's limits) would ruin the test: 4570 candidate tiles were left out, so each candidate is judged only on its usable ground. Candidates with no usable tile: avak, boltysh, boltysh_2, bosumtwi_ashanti, brent, calvin, carswell, charlevoix_la_malbaie, chesapeake_bay, chicxulub, clearwater_east, clearwater_east_2, colonia, couture_lac_couture, crooked_creek, decaturville, deep_bay, dellen, des_plaines, dhala, dobele, flynn_creek, glasford, glover_bluff, gow, goyder, granby, holleford, hummeln, ile_rouleau, ilumetsa, ilyinets, iso_naakkima, janisjarvi, kaalijarv, kaluga, kamensk, kardla, karikkoselka, karla, kentland, keurusselka, la_moinerie, lappajarvi, liverpool, lockne, lockne_2, logancha, logoisk, lonar, luizi, lumparn, macha, manicouagan, manson, middlesboro, mien, mishina_gora, mizarai, morasko, neugrund, newporte, nicholson, paasselka, pilot, popigai, presqu_ile, puchezh_katunki, ragozinka, ries, rio_cuarto, rock_elm, saaksjarvi, saarijarvi, serpent_mound, siljan, slate_islands, sobolev, soderfjarden, steen_river, steinheim, suavjarvi, sudbury, suvasvesi_n, suvasvesi_s, ternovka, tvaren, vargeao_dome, vepriai, viewfield, vista_alegre, wanapitei, wells_creek, west_hawk, wetumpka, whitecourt, xiuyan, zapadnaya, zeleny_gai. NASA sites and farmland keep all tiles but rank below clean sites if their test tile is interfered. The similarity-only order is `similarity_rank` in ranking.csv.

**Low evidence:** sites judged on fewer than 6 usable 5 km squares (under 150 km² of usable ground) are marked *low evidence*. Their score rests on too little ground to be reliable, so treat their rank as a lead to check, not a recommendation. Here: mistastin, rochechouart, serra_da_cangalha, kamensk_2, vredefort, new_quebec_chubb_ungava_pingualuit, sikhote_alin, marquez, strangways, kursk, el_malpais, ames, obolon, saint_martin, ritland, campo_del_cielo, gardnos.

| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | haughton | candidate | 0.66 | 53% | 3 / 0 / 0 | clear | high |
| 2 | monturaqui | candidate | 0.64 | 67% | 3 / 0 / 0 | clear | high |
| 3 | flaxman_2 | candidate | 0.63 | 53% | 3 / 0 / 0 | clear | high |
| 4 | shunak | candidate | 0.63 | 75% | 3 / 0 / 0 | clear | high |
| 5 | flaxman | candidate | 0.62 | 28% | 3 / 0 / 0 | clear | high |
| 6 | araguainha | candidate | 0.61 | 39% | 3 / 0 / 0 | clear | high |
| 7 | goat_paddock | candidate | 0.61 | 42% | 3 / 0 / 0 | clear | high |
| 8 | el_gygytgyn | candidate | 0.60 | 64% | 3 / 0 / 0 | clear | high |
| 9 | red_wing | candidate | 0.60 | 36% | 3 / 0 / 0 | clear | high |
| 10 | eagle_butte | candidate | 0.59 | 50% | 3 / 0 / 0 | clear | high |
| 11 | mistastin *(low evidence)* | candidate | 0.59 | 42% | 3 / 0 / 0 | clear | high |
| 12 | yucca_flat | baseline | 0.59 | 44% | 3 / 0 / 0 | clear | high |
| 13 | bigach | candidate | 0.58 | 44% | 3 / 0 / 0 | clear | high |
| 14 | pisgah_crater | candidate | 0.58 | 44% | 3 / 0 / 0 | clear | high |
| 15 | aorounga | candidate | 0.58 | 39% | 3 / 0 / 0 | clear | high |

## NASA baselines

- yucca_flat: rank 12
- sp_crater_jett3: rank 20
- cinder_lake_crater_field: rank 22
- meteor_crater: rank 56
- buffalo_park: rank 102

## Checks

The model is unsupervised (no training labels), so these checks are how it is tested.

- **Held-out NASA sites** (INFO): each NASA site left out of fitting in turn: ranks buffalo_park #9, cinder_lake_crater_field #25, meteor_crater #57, sp_crater_jett3 #21, yucca_flat #12; recall@5 = 0% (random guess: 5%); typical NASA site beats 80% of the other sites (random: 50%)
  - **Note on agreement with NASA:** weak. The typical NASA site beats 80% of the other sites; 5 sites picked at random do this well 5.7% of the time. NASA chooses field sites for more than terrain: road access, safety, permits and nearness to its teams and towns. This model measures terrain only, so remote craters with closer terrain can outrank NASA's sites. We did not tune the weights to push NASA's sites up: that would fit the model to the answer and make this check meaningless. Top-5 counts get stricter as more sites are added (with 100 sites, top 5 means top 5%); the percentile does not, so it is the fairer comparison between runs.
- **Negative controls** (farmland must rank in the bottom half on similarity alone, ignoring its crops): **PASS**
- **Stability:** #1 site unchanged in 93% of 14 small changes; on average 4.6 of the top 5 stay in the top 5
- **Simple-method comparison** (agreement ≠ accuracy): top-5 overlap 1/5, Spearman 0.94
- **Mission sensitivity** (NOT RUN): only one mission for this target
- Features skipped (no data at this pixel size): none
- Sites not ranked because a needed measurement is missing (incomplete): none

## Multi-site coverage

9 requirements (mandatory rules + every weighted measurement inside the target's own 10-90% range). A site covers a requirement only if one interference-free tile meets it; requirements met together must be met on the same tile. Target range = 10%-90% of the target's tiles. Greedy: each step adds the site covering the most new requirements.

1. **monturaqui** (rank 2, candidate, tile r01c03) adds: slope_p90 within 5 deg of the target; frac_steep within 0.1 fraction of the target; rough_small within 3 m of the target; Share of steep ground inside the target's range (0.0002–0.119); Steepest-10% slope inside the target's range (8.45–15.2°); Average slope inside the target's range (5–9.5°); Density of crater-like dips inside the target's range (0.44–1.08 per km²); Large-scale bumpiness inside the target's range (22.2–39.2 m) → 8/9 covered
2. **haughton** (rank 1, candidate, tile r00c00) adds: Small-scale bumpiness inside the target's range (3.15–4.59 m) → 9/9 covered

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
