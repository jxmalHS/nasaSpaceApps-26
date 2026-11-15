# Analog ranking: moon_rover_thermal_south_pole

Rover field test needing BOTH a strong terrain match and the widest temperature swings Earth can offer (thermal cycling of wheels, motors and batteries). Terrain counts about twice as much as temperature.

Target: **lunar_south_pole** (64 tiles). Earth sites ranked: 25.

Interference (trees, crops, water... over the mission's limits) would ruin the test: 4570 candidate tiles were left out, so each candidate is judged only on its usable ground. Candidates with no usable tile: avak, boltysh, boltysh_2, bosumtwi_ashanti, brent, calvin, carswell, charlevoix_la_malbaie, chesapeake_bay, chicxulub, clearwater_east, clearwater_east_2, colonia, couture_lac_couture, crooked_creek, decaturville, deep_bay, dellen, des_plaines, dhala, dobele, flynn_creek, glasford, glover_bluff, gow, goyder, granby, holleford, hummeln, ile_rouleau, ilumetsa, ilyinets, iso_naakkima, janisjarvi, kaalijarv, kaluga, kamensk, kardla, karikkoselka, karla, kentland, keurusselka, la_moinerie, lappajarvi, liverpool, lockne, lockne_2, logancha, logoisk, lonar, luizi, lumparn, macha, manicouagan, manson, middlesboro, mien, mishina_gora, mizarai, morasko, neugrund, newporte, nicholson, paasselka, pilot, popigai, presqu_ile, puchezh_katunki, ragozinka, ries, rio_cuarto, rock_elm, saaksjarvi, saarijarvi, serpent_mound, siljan, slate_islands, sobolev, soderfjarden, steen_river, steinheim, suavjarvi, sudbury, suvasvesi_n, suvasvesi_s, ternovka, tvaren, vargeao_dome, vepriai, viewfield, vista_alegre, wanapitei, wells_creek, west_hawk, wetumpka, whitecourt, xiuyan, zapadnaya, zeleny_gai. NASA sites and farmland keep all tiles but rank below clean sites if their test tile is interfered. The similarity-only order is `similarity_rank` in ranking.csv.

**Low evidence:** sites judged on fewer than 6 usable 5 km squares (under 150 km² of usable ground) are marked *low evidence*. Their score rests on too little ground to be reliable, so treat their rank as a lead to check, not a recommendation. Here: el_malpais, ames.

| # | Site | Role | Score | Covers | Requirements met / not / unknown | Interference | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | lunar_crater_nevada | candidate | 0.52 | 19% | 2 / 0 / 0 | clear | high |
| 2 | cinder_lake_crater_field | baseline | 0.51 | 9% | 1 / 1 / 0 | clear | high |
| 3 | sp_crater_jett3 | baseline | 0.48 | 6% | 2 / 0 / 0 | clear | high |
| 4 | el_malpais *(low evidence)* | candidate | 0.41 | 5% | 1 / 1 / 0 | clear | high |
| 5 | valley_of_fires_carrizozo | candidate | 0.41 | 0% | 1 / 1 / 0 | clear | high |
| 6 | yucca_flat | baseline | 0.40 | 0% | 1 / 1 / 0 | clear | high |
| 7 | meteor_crater | baseline | 0.39 | 0% | 1 / 1 / 0 | clear | high |
| 8 | pisgah_crater | candidate | 0.36 | 0% | 1 / 1 / 0 | clear | high |
| 9 | amboy | candidate | 0.35 | 0% | 1 / 1 / 0 | clear | high |
| 10 | amboy_crater | candidate | 0.35 | 0% | 1 / 1 / 0 | clear | high |
| 11 | jabal_qidr_harrat_khaybar | candidate | 0.35 | 0% | 1 / 1 / 0 | clear | high |
| 12 | hverfjall | candidate | 0.33 | 0% | 1 / 1 / 0 | clear | high |
| 13 | holuhraun | candidate | 0.31 | 0% | 1 / 1 / 0 | clear | high |
| 14 | amguid | candidate | 0.28 | 0% | 1 / 1 / 0 | clear | high |
| 15 | agoudal | candidate | 0.27 | 0% | 1 / 1 / 0 | clear | high |

## NASA baselines

- cinder_lake_crater_field: rank 2
- sp_crater_jett3: rank 3
- yucca_flat: rank 6
- meteor_crater: rank 7
- buffalo_park: rank 24

## Checks

The model is unsupervised (no training labels), so these checks are how it is tested.

- **Held-out NASA sites** (INFO): each NASA site left out of fitting in turn: ranks buffalo_park #4, cinder_lake_crater_field #2, meteor_crater #8, sp_crater_jett3 #3, yucca_flat #7; recall@5 = 60% (random guess: 20%); typical NASA site beats 88% of the other sites (random: 50%)
  - **Note on agreement with NASA:** moderate. The typical NASA site beats 88% of the other sites; 5 sites picked at random do this well 1.8% of the time. NASA chooses field sites for more than terrain: road access, safety, permits and nearness to its teams and towns. This model measures terrain only, so remote craters with closer terrain can outrank NASA's sites. We did not tune the weights to push NASA's sites up: that would fit the model to the answer and make this check meaningless. Top-5 counts get stricter as more sites are added (with 100 sites, top 5 means top 5%); the percentile does not, so it is the fairer comparison between runs.
- **Negative controls** (farmland must rank in the bottom half on similarity alone, ignoring its crops): **PASS**
- **Stability:** #1 site unchanged in 100% of 14 small changes; on average 4.6 of the top 5 stay in the top 5
- **Simple-method comparison** (agreement ≠ accuracy): top-5 overlap 2/5, Spearman 0.68
- **Mission sensitivity** (PASS): vs moon_rover_south_pole Spearman 0.14; vs moon_landing_hazards_south_pole Spearman 0.60
- Features skipped (no data at this pixel size): none
- **Closest achievable:** temp_range_mean: the target's typical value (176.9) is beyond anything on Earth here (22.1–72.0), so sites are ranked on how close they get to it. No Earth site reproduces the real value.
- Sites not ranked because a needed measurement is missing (incomplete): beaverhead (temp_range_mean), beyenchime_salaaty (temp_range_mean), bigach (temp_range_mean), boxhole (temp_range_mean), campo_del_cielo (temp_range_mean), carancas (temp_range_mean), chiyli (temp_range_mean), chukcha (temp_range_mean), cloud_creek (temp_range_mean), connolly_basin (temp_range_mean), dalgaranga (temp_range_mean), eagle_butte (temp_range_mean), el_gygytgyn (temp_range_mean), elbow (temp_range_mean), flaxman (temp_range_mean), flaxman_2 (temp_range_mean), foelsche (temp_range_mean), gardnos (temp_range_mean), glikson (temp_range_mean), goat_paddock (temp_range_mean), gosses_bluff (temp_range_mean), gweni_fada (temp_range_mean), haughton (temp_range_mean), haviland (temp_range_mean), henbury (temp_range_mean), jebel_waqf_as_suwwan (temp_range_mean), kalkkop (temp_range_mean), kamensk_2 (temp_range_mean), kamil (temp_range_mean), kara (temp_range_mean), kara_kul (temp_range_mean), kelly_west (temp_range_mean), kgagodi (temp_range_mean), kursk (temp_range_mean), lawn_hill (temp_range_mean), maple_creek_white_valley (temp_range_mean), marquez (temp_range_mean), matt_wilson (temp_range_mean), mistastin (temp_range_mean), monturaqui (temp_range_mean), morokweng (temp_range_mean), mount_toondina (temp_range_mean), new_quebec_chubb_ungava_pingualuit (temp_range_mean), oasis (temp_range_mean), obolon (temp_range_mean), odessa (temp_range_mean), ouarkziz (temp_range_mean), piccaninny (temp_range_mean), red_wing (temp_range_mean), riachao_ring (temp_range_mean), ritland (temp_range_mean), rochechouart (temp_range_mean), roter_kamm (temp_range_mean), saint_martin (temp_range_mean), santa_fe (temp_range_mean), santa_marta (temp_range_mean), saqqar (temp_range_mean), serra_da_cangalha (temp_range_mean), shoemaker_formerly_teague (temp_range_mean), shunak (temp_range_mean), sierra_madera (temp_range_mean), sikhote_alin (temp_range_mean), spider (temp_range_mean), strangways (temp_range_mean), tabun_khara_obo (temp_range_mean), talemzane_maadna (temp_range_mean), tenoumer (temp_range_mean), tin_bider (temp_range_mean), tookoonooka (temp_range_mean), tswaing_formerly_pretoria_saltpan (temp_range_mean), upheaval_dome (temp_range_mean), veevers (temp_range_mean), vredefort (temp_range_mean), wabar (temp_range_mean), wolfe_creek (temp_range_mean), woodleigh (temp_range_mean), yarrabubba (temp_range_mean), zhamanshin (temp_range_mean)

## Multi-site coverage

8 requirements (mandatory rules + every weighted measurement inside the target's own 10-90% range). A site covers a requirement only if one interference-free tile meets it; requirements met together must be met on the same tile. Target range = 10%-90% of the target's tiles. Greedy: each step adds the site covering the most new requirements.

1. **lunar_crater_nevada** (rank 1, candidate, tile r00c01) adds: slope_p90 within 5 deg of the target; temp_range_mean >= 60 K; Average slope inside the target's range (5.31–24.4°); Steepest-10% slope inside the target's range (9.26–32.2°); Share of steep ground inside the target's range (0.00132–0.875); Large-scale bumpiness inside the target's range (17.2–60.7 m) → 6/8 covered
2. **cinder_lake_crater_field** (rank 2, baseline, tile r01c05) adds: Small-scale bumpiness inside the target's range (2.5–4.92 m) → 7/8 covered

**Not covered by any Earth site here** (needs a lab, chamber or engineered testbed, or more sites): Annual temperature range inside the target's range (88.2–201 K)

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
