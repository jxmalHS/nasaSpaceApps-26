# Analog ranking: mars_landing_jezero

Lander Vision System / terrain-relative navigation and landing-hazard survey for Jezero Crater. Same weights as the lunar landing mission: crater-like dips, curvature and overall relief matter most. NASA's own baselines here are the Mars 2020 Lander Vision System test spots in Death Valley and the Mojave, so the held-out check asks whether the engine finds them.

Target: **jezero** (16 tiles). Earth sites ranked: 105.

Interference (trees, crops, water... over the mission's limits) would ruin the test: 986 candidate tiles were left out, so each candidate is judged only on its usable ground. Candidates with no usable tile: araguainha, beyenchime_salaaty, bosumtwi_ashanti, brent, calvin, carswell, charlevoix_la_malbaie, chesapeake_bay, chicxulub, clearwater_east, clearwater_east_2, colonia, couture_lac_couture, crooked_creek, decaturville, deep_bay, dellen, des_plaines, dobele, flynn_creek, gardnos, glover_bluff, gow, goyder, granby, holleford, hummeln, ile_rouleau, ilumetsa, iso_naakkima, janisjarvi, kaalijarv, kaluga, kardla, karikkoselka, keurusselka, la_moinerie, lappajarvi, liverpool, lockne, lockne_2, logancha, logoisk, luizi, lumparn, macha, manicouagan, marquez, middlesboro, mien, mishina_gora, mistastin, mizarai, new_quebec_chubb_ungava_pingualuit, nicholson, paasselka, pilot, popigai, presqu_ile, puchezh_katunki, ragozinka, riachao_ring, ritland, rochechouart, rock_elm, saaksjarvi, saarijarvi, saint_martin, serpent_mound, sikhote_alin, siljan, slate_islands, sobolev, soderfjarden, steen_river, steinheim, strangways, suavjarvi, sudbury, suvasvesi_n, suvasvesi_s, tvaren, vargeao_dome, vepriai, vista_alegre, wanapitei, wells_creek, west_hawk, wetumpka, whitecourt, xiuyan. NASA sites and farmland keep all tiles but rank below clean sites if their test tile is interfered. The similarity-only order is `similarity_rank` in ranking.csv.

**Low evidence:** sites judged on fewer than 6 usable 20 km squares (under 2400 km² of usable ground) are marked *low evidence*. Their score rests on too little ground to be reliable, so treat their rank as a lead to check, not a recommendation. Here: santa_fe, santa_marta, tswaing_formerly_pretoria_saltpan, ritland_2, spider, kara, serra_da_cangalha, elbow, foelsche, ries, boltysh, boltysh_2, glasford, kursk, matt_wilson, morasko, campo_del_cielo, beaverhead, kara_kul, neugrund.

| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | hole_in_the_wall | baseline | 0.64 | 69% | 0 / 0 / 0 | clear | high |
| 2 | roter_kamm | candidate | 0.61 | 75% | 0 / 0 / 0 | clear | high |
| 3 | grand_falls_dunes | baseline | 0.61 | 62% | 0 / 0 / 0 | clear | high |
| 4 | barringer_meteor | candidate | 0.60 | 62% | 0 / 0 / 0 | clear | high |
| 5 | eagle_butte | candidate | 0.57 | 62% | 0 / 0 / 0 | clear | high |
| 6 | aouelloul | candidate | 0.55 | 50% | 0 / 0 / 0 | clear | high |
| 7 | maple_creek_white_valley | candidate | 0.55 | 69% | 0 / 0 / 0 | clear | high |
| 8 | chukcha | candidate | 0.54 | 44% | 0 / 0 / 0 | clear | high |
| 9 | sierra_madera | candidate | 0.54 | 62% | 0 / 0 / 0 | clear | high |
| 10 | kelso_dunes | baseline | 0.53 | 44% | 0 / 0 / 0 | clear | high |
| 11 | kalkkop | candidate | 0.53 | 50% | 0 / 0 / 0 | clear | high |
| 12 | santa_fe *(low evidence)* | candidate | 0.53 | 31% | 0 / 0 / 0 | clear | high |
| 13 | flaxman_2 | candidate | 0.52 | 44% | 0 / 0 / 0 | clear | high |
| 14 | amboy | candidate | 0.51 | 31% | 0 / 0 / 0 | clear | high |
| 15 | flaxman | candidate | 0.50 | 31% | 0 / 0 / 0 | clear | high |

## NASA baselines

- hole_in_the_wall: rank 1
- grand_falls_dunes: rank 3
- kelso_dunes: rank 10
- mesquite_flat_dunes: rank 62
- badwater_basin: rank 100
- panamint_valley: rank 102

## Checks

The model is unsupervised (no training labels), so these checks are how it is tested.

- **Held-out NASA sites** (INFO): each NASA site left out of fitting in turn: ranks badwater_basin #100, grand_falls_dunes #3, hole_in_the_wall #1, kelso_dunes #10, mesquite_flat_dunes #63, panamint_valley #103; recall@5 = 33% (random guess: 5%)
- **Negative controls** (farmland must rank in the bottom half on similarity alone, ignoring its crops): **PASS**
- **Stability:** #1 site unchanged in 92% of 12 small changes; on average 4.8 of the top 5 stay in the top 5
- **Simple-method comparison** (agreement ≠ accuracy): top-5 overlap 4/5, Spearman 0.97
- **Mission sensitivity** (PASS): vs mars_rover_jezero Spearman 0.90
- Features skipped (no data at this pixel size): none
- Sites not ranked because a needed measurement is missing (incomplete): avak (hypsometric_integral)

## Multi-site coverage

5 requirements (mandatory rules + every weighted measurement inside the target's own 10-90% range). A site covers a requirement only if one interference-free tile meets it; requirements met together must be met on the same tile. Target range = 10%-90% of the target's tiles. Greedy: each step adds the site covering the most new requirements.

1. **hole_in_the_wall** (rank 1, baseline, tile r00c00) adds: Density of crater-like dips inside the target's range (0.045–0.106 per km²); Curvature inside the target's range (0.0207–0.0534 /km); Relief (highest minus lowest) inside the target's range (431–1.57e+03 m); Hypsometric integral inside the target's range (0.226–0.579); Large-scale bumpiness inside the target's range (6.78–16 m) → 5/5 covered

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
