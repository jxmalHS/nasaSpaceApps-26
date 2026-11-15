# Analog ranking: mars_rover_jezero

Rover wheels / mobility at Jezero Crater. Weighted toward slope, as the lunar rover missions. At 500 m pixels this compares landforms (crater floor, delta, rim), not the rocks and ripples a wheel meets; rough_small (500 m scale) cannot be measured and frac_steep uses VIPER's 15 deg line, which 500 m Mars slopes almost never reach, so both are ignored.

Target: **jezero** (16 tiles). Earth sites ranked: 87.

Interference (trees, crops, water... over the mission's limits) would ruin the test: 1143 candidate tiles were left out, so each candidate is judged only on its usable ground. Candidates with no usable tile: ames, boltysh, boltysh_2, bosumtwi_ashanti, brent, calvin, carswell, charlevoix_la_malbaie, chesapeake_bay, chicxulub, clearwater_east, clearwater_east_2, colonia, couture_lac_couture, crooked_creek, decaturville, deep_bay, dellen, des_plaines, dhala, dobele, elbow, flynn_creek, gardnos, glasford, glover_bluff, gow, goyder, granby, holleford, hummeln, ile_rouleau, ilumetsa, ilyinets, iso_naakkima, janisjarvi, kaalijarv, kaluga, kamensk, kamensk_2, kardla, karikkoselka, karla, kentland, keurusselka, kursk, la_moinerie, lappajarvi, liverpool, lockne, lockne_2, logancha, logoisk, lonar, luizi, lumparn, macha, manicouagan, manson, marquez, middlesboro, mien, mishina_gora, mizarai, morasko, new_quebec_chubb_ungava_pingualuit, newporte, nicholson, obolon, paasselka, pilot, popigai, presqu_ile, puchezh_katunki, ragozinka, ries, rio_cuarto, ritland, rochechouart, rock_elm, saaksjarvi, saarijarvi, saint_martin, serpent_mound, serra_da_cangalha, sikhote_alin, siljan, slate_islands, sobolev, soderfjarden, steen_river, steinheim, strangways, suavjarvi, sudbury, suvasvesi_n, suvasvesi_s, ternovka, tvaren, vargeao_dome, vepriai, vista_alegre, wanapitei, wells_creek, west_hawk, wetumpka, whitecourt, xiuyan, zapadnaya, zeleny_gai. NASA sites and farmland keep all tiles but rank below clean sites if their test tile is interfered. The similarity-only order is `similarity_rank` in ranking.csv.

**Low evidence:** sites judged on fewer than 6 usable 20 km squares (under 2400 km² of usable ground) are marked *low evidence*. Their score rests on too little ground to be reliable, so treat their rank as a lead to check, not a recommendation. Here: ritland_2, carancas, eagle_butte, riachao_ring, santa_fe, vredefort, beyenchime_salaaty, araguainha, tswaing_formerly_pretoria_saltpan, kara, viewfield, flaxman, foelsche, flaxman_2, haviland, mistastin, campo_del_cielo, beaverhead, kara_kul, neugrund, avak.

| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | hole_in_the_wall | baseline | 0.83 | 94% | 0 / 0 / 0 | clear | high |
| 2 | grand_falls_dunes | baseline | 0.77 | 69% | 0 / 0 / 0 | clear | high |
| 3 | roter_kamm | candidate | 0.77 | 69% | 0 / 0 / 0 | clear | high |
| 4 | spider | candidate | 0.77 | 75% | 0 / 0 / 0 | clear | high |
| 5 | amboy | candidate | 0.76 | 88% | 0 / 0 / 0 | clear | high |
| 6 | ouarkziz | candidate | 0.76 | 69% | 0 / 0 / 0 | clear | high |
| 7 | aouelloul | candidate | 0.74 | 50% | 0 / 0 / 0 | clear | high |
| 8 | shunak | candidate | 0.74 | 62% | 0 / 0 / 0 | clear | high |
| 9 | barringer_meteor | candidate | 0.74 | 69% | 0 / 0 / 0 | clear | high |
| 10 | chukcha | candidate | 0.74 | 69% | 0 / 0 / 0 | clear | high |
| 11 | ritland_2 *(low evidence)* | candidate | 0.74 | 81% | 0 / 0 / 0 | clear | high |
| 12 | kalkkop | candidate | 0.73 | 69% | 0 / 0 / 0 | clear | high |
| 13 | piccaninny | candidate | 0.72 | 69% | 0 / 0 / 0 | clear | high |
| 14 | carancas *(low evidence)* | candidate | 0.72 | 62% | 0 / 0 / 0 | clear | high |
| 15 | maple_creek_white_valley | candidate | 0.71 | 56% | 0 / 0 / 0 | clear | high |

## NASA baselines

- hole_in_the_wall: rank 1
- grand_falls_dunes: rank 2
- kelso_dunes: rank 19
- mesquite_flat_dunes: rank 53
- badwater_basin: rank 79
- panamint_valley: rank 81

## Checks

The model is unsupervised (no training labels), so these checks are how it is tested.

- **Held-out NASA sites** (INFO): each NASA site left out of fitting in turn: ranks badwater_basin #83, grand_falls_dunes #2, hole_in_the_wall #1, kelso_dunes #20, mesquite_flat_dunes #56, panamint_valley #85; recall@5 = 33% (random guess: 6%)
- **Negative controls** (farmland must rank in the bottom half on similarity alone, ignoring its crops): **PASS**
- **Stability:** #1 site unchanged in 80% of 10 small changes; on average 4.5 of the top 5 stay in the top 5
- **Simple-method comparison** (agreement ≠ accuracy): top-5 overlap 2/5, Spearman 0.94
- **Mission sensitivity** (PASS): vs mars_landing_jezero Spearman 0.88
- Features skipped (no data at this pixel size): none
- Sites not ranked because a needed measurement is missing (incomplete): none

## Multi-site coverage

4 requirements (mandatory rules + every weighted measurement inside the target's own 10-90% range). A site covers a requirement only if one interference-free tile meets it; requirements met together must be met on the same tile. Target range = 10%-90% of the target's tiles. Greedy: each step adds the site covering the most new requirements.

1. **hole_in_the_wall** (rank 1, baseline, tile r00c00) adds: Steepest-10% slope inside the target's range (2.8–10.2°); Average slope inside the target's range (1.51–4.14°); Large-scale bumpiness inside the target's range (6.78–16 m); Density of crater-like dips inside the target's range (0.045–0.106 per km²) → 4/4 covered

**Not covered by any Earth site here** (needs a lab, chamber or engineered testbed, or more sites): none

## What Earth cannot reproduce

- Gravity: about 38% of Earth's (3.73 vs 9.81 m/s^2), so wheel loads, sinkage, dust and landing loads differ.
- Atmosphere: thin CO2 air, 6.36 mb at mean radius (4.0-8.7 mb by season) vs ~1013 mb on Earth: parachutes, heat flow, dust lifting and drills behave differently.
- Radiation: no global magnetic field and a thin atmosphere let more radiation reach the surface.
- Temperatures: ~214 K average; 184-242 K daily range at Viking 1. Earth deserts are far warmer: needs thermal chambers.
- Regolith chemistry: oxidising, perchlorate-bearing Martian soil has no natural Earth equivalent at scale.
- Scale of the comparison: 500 m pixels and 20 km tiles see landforms, not the rocks a wheel or lander foot meets.

## Disclaimer

A terrain match does not validate hardware. It only shows the ground shape resembles the target at this scale. Subsystem performance (e.g. wheel slip and sinkage) needs separate soil, load and environmental testing.

## Data credits

- Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.
- © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC-BY 4.0)
- Mars MGS MOLA DEM 463 m: Smith et al. (2001), Mars Orbiter Laser Altimeter: experiment summary after the first year of global mapping of Mars, JGR 106(E10); mosaic by USGS Astrogeology
