# Analog Atlas

**Every analog is partial. Find the part your hardware needs.**

NASA Space Apps Challenge 2026 · Doha · Challenge: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*

- **Live site:** https://analog-atlas-five.vercel.app
- **Team Sailor Moon:** Adrian C · Ivan F · Klyde M · Jamal S · Nathan T

---

## The problem

Before hardware goes to the Moon or Mars, NASA tests it on Earth at "analog" sites: lava fields in
Arizona, the Mojave Desert, Death Valley, the Canadian Arctic. There are only a handful of these sites,
and they were mostly chosen from experience. No place on Earth matches the Moon on everything, and a
place that is good for testing rover wheels can be useless for testing batteries in the cold.

## What we built

Pick **what you are testing** (for example, rover wheel traction) and **where it is going** (for
example, the Moon's south pole or Jezero crater on Mars). Analog Atlas then:

1. **Ranks places on Earth for that one test**, not for "Moon-likeness" in general.
2. **Says what each place can and cannot reproduce**, and which parts need a lab or a chamber
   (gravity, vacuum, the lunar day–night temperature swing).
3. **Shows how far to trust the ranking**: every result is checked against NASA's own field sites,
   and weak results are shown, not hidden.

## How it works

A funnel with three levels:

| Level | What happens | Scale |
|---|---|---|
| 1. Screen the planet | The website scores **78,993** land squares against the target using open NASA/ESA data. Pass/fail limits remove places that would spoil the test (snow, plants, rain). | 55 km squares |
| 2. Close-up check | The top 25 places are re-measured at five 2 km spots and compared with the target. Places that only look right from far away are flagged "wrong up close" and moved down. | 2 km patches |
| 3. Detailed model | Our engine compares **100–200 candidate sites** with real Moon or Mars terrain using a weighted nearest-neighbour model. | 5 km (Moon), 20 km (Mars) |

The model is **unsupervised**: there are only 5–6 known NASA field sites per mission, far too few to
train on. Weights come from published rover limits (for example, NASA VIPER's 15° slope limit), and
the Moon and Earth are always compared at the same physical scale.

## Results (and how we checked them)

NASA's own field sites are hidden from the model, then we see where they land and how often randomly
picked places would do as well.

| Test | NASA's sites beat | Random luck does as well | Verdict |
|---|---|---|---|
| Moon landing-hazard detection | 97% of 127 sites | 3 times in 10,000 | **Strong** |
| Moon rover thermal | 88% of 25 sites | about 1 time in 55 | Moderate |
| Moon rover wheels | 74–80% of 103 sites | 6–12% | Weak |
| Mars landing / rover (Jezero) | 66% / 57% | 18% / 35% | Weak |

- On Mars, NASA's Mars 2020 test site **Hole-in-the-Wall** (Mojave) ranks **#1** for both landing and
  rover, but NASA's salt-flat sites in Death Valley rank low, so overall agreement is weak.
- **Why the rover results are weak:** NASA also picks sites for road access and logistics. Its sites
  are about 43 km from a town of 10,000+; our best terrain matches are about 134 km away. We did not
  tune the model to push NASA's sites up, because that would make the check meaningless.
- **Stable:** the #1 site stays #1 in 10–14 of 12–14 small changes, for every model test.
- **Negative controls pass:** farmland, included on purpose, ranks in the bottom half every time.
- **Reproducible:** re-running on the same data gives identical rankings.

The website's **References** page shows all of this with sources, including every pass/fail limit,
where its number comes from (4 of 8 are NASA-published values; the other 4 are labelled team values),
and how NASA's own sites fare against it.

## Limits

- Earth cannot reproduce gravity (0.17 g on the Moon), vacuum, radiation or the lunar day–night
  temperature swing. The tool says which tests need a lab instead.
- Rankings use 55 km squares, which can hide small sites; the 2 km check catches the worst cases.
  Rocks under about 30 cm are below our resolution.
- Rock abundance, soil strength, ground ice and salts have no global Earth map yet. They show as
  unknown, never as a pass.
- Terrain is not the only reason NASA picks a site; access, safety and permits are not measured.

## NASA data used

- **LRO LOLA** lunar elevation (LDEM_80S_20M, LDEM_80S_80M, LDEM_16) and patches via PDS Geosciences
- **LRO Diviner** lunar surface temperature (polar seasonal maps, Williams et al. 2019)
- **MGS MOLA** Mars elevation, 463 m (Smith et al. 2001, doi:10.1029/2000JE001364; USGS Astrogeology mosaic)
- **MODIS** land surface temperature (MOD11A2, via NASA AppEEARS), NDVI and snow cover (via NASA GIBS)
- **NASA POWER / MERRA-2** climatology (temperature, precipitation) and MERRA-2 dust
- **NASA GIBS** Blue Marble and ASTER imagery; globe textures from Blue Marble, LRO WAC/LOLA, Viking MDIM
- NASA field-campaign records for the validation sites (Artemis/JETT, D-RATS, Mars 2020 Lander Vision System tests)

## Other data and resources

- **Copernicus DEM GLO-30** (ESA/EU; © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018)
- **ESA WorldCover** 2021 land cover (CC BY 4.0)
- **AWS Terrain Tiles** (Terrarium; SRTM/NASADEM-derived) for Earth slope, roughness and 2 km patches
- **USGS** terrestrial analog site lists (doi:10.5066/P9J72921, doi:10.5066/P14KSANW)
- **GLiM v1.0** rock types (Hartmann & Moosdorf 2012), **Natural Earth** places and borders
- **OpenStreetMap** (© OpenStreetMap contributors) for site coordinates

NASA does not endorse this project. Each dataset's own terms of use apply.

## Repository

| Folder | What it is |
|---|---|
| [`analog-atlas/`](analog-atlas/) | The website (React + Vite): planet-wide screening, 2 km checks, site reports, References page. See its [README](analog-atlas/README.md). |
| [`KNN-Model/`](KNN-Model/) | The detailed model (Python): downloads Moon, Mars and Earth data, compares sites, validates against NASA sites, exports results to the website. See its [README](KNN-Model/README.md). |

### Run it

Website (Node 18+, no API keys):

```bash
cd analog-atlas
npm install --legacy-peer-deps
npm run dev        # http://localhost:5173
npm test
```

Model (Python 3, tested on 3.14; the first run downloads data for about 200 sites):

```bash
cd KNN-Model
python -m venv venv
venv/Scripts/activate            # Windows; on macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
pytest
python main.py run --mission moon_landing_hazards_south_pole
python main.py export-atlas      # hand results to the website
```

Temperature downloads (`python main.py download-temperature ...`) need a free NASA Earthdata login.

## Use of AI

Claude (Anthropic) was used as a coding assistant to write and test parts of the model and the
website, and to help draft documentation. Design decisions, data choices and validation were
directed and reviewed by the team. Commits made with its help are marked "Co-Authored-By: Claude".
