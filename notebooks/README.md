# Terrain processing

Use Colab or Kaggle to unpack, inspect, resample, and render lunar data. Store competition processing notebooks here as they are developed.

[Shackleton practice notebook](https://colab.research.google.com/drive/1pC35ZiWHl9imydAMvjatC1AvtXfOHzja?usp=drive_link) covers the PGDA Site04 DEM, raster inspection, cropping, resampling, and exporting an 8-bit preview and metadata. Keep it as a reference for the new processing workflow.

Keep raw downloads and intermediate files in the hosted runtime or in the ignored `data/raw/` and `data/work/` folders locally. Export compact app assets to `public/data/`.

## Terrain notebooks

Each one runs on a free CPU runtime in Colab or Kaggle (turn on Internet on Kaggle), writes float32 grids plus JSON sidecars in the same format as `public/data/global-height`, and zips the result for download.

| Notebook | Data | Output |
| --- | --- | --- |
| [prepare-sldem-band.ipynb](https://colab.research.google.com/github/InterstellarNerd8760/lunar-atlas/blob/proxima/terrain-notebooks/notebooks/prepare-sldem-band.ipynb) | SLDEM2015 (LOLA + Kaguya TC), 60°S–60°N, [PGDA product 54](https://pgda.gsfc.nasa.gov/products/54). Default source is the 128 px/deg global JP2 (495 MB); 256 and 512 px/deg regional files are optional. | `sldem/index.json` plus `sldem/tiles/lat±YY_lon±XXX.f32/json`, 15° tiles at 512 px (~890 m/px) by default |
| [prepare-south-pole-sites.ipynb](https://colab.research.google.com/github/InterstellarNerd8760/lunar-atlas/blob/proxima/terrain-notebooks/notebooks/prepare-south-pole-sites.ipynb) | LOLA 5 m/px site DEMs, [PGDA product 78](https://pgda.gsfc.nasa.gov/products/78): Site01, 04, 06, 07, 11, 20, 20v2, 23, 42 by default (27 sites in the catalog), plus the PDS 80 m polar LDEM for horizon context | `lola-sites/index.json` plus `lola-sites/<site>/<site>-height` and `<site>-context` |
| [prepare-shackleton-site.ipynb](https://colab.research.google.com/github/InterstellarNerd8760/lunar-atlas/blob/proxima/terrain-notebooks/notebooks/prepare-shackleton-site.ipynb) | PGDA Site04 (Shackleton rim) 5 m/px DEM and slope, plus the PDS 80 m polar LDEM | `shackleton/shackleton-site`, `-detail` (full 5 m), `-slope`, `-context`, `index.json` |
| [prepare-landing-sites.ipynb](https://colab.research.google.com/github/InterstellarNerd8760/lunar-atlas/blob/proxima/terrain-notebooks/notebooks/prepare-landing-sites.ipynb) | Every site in `public/data/landing-sites.csv` (Apollo, Luna, Surveyor, Chang'e, Chandrayaan-3, SLIM, IM-1/2, Blue Ghost 1, Artemis III regions). Ground from PGDA 5 m, LOLA polar, or SLDEM2015 512; horizon from LOLA polar or LDEM_64; optional LROC NAC 2 m DTM | `landing-sites/index.json` plus `<site>/<site>-ground` (12 km), `-horizon` (200 km, 512 px), `-nac` (2 km), centered on the landing point |
| [prepare-textures.ipynb](https://colab.research.google.com/github/InterstellarNerd8760/lunar-atlas/blob/proxima/terrain-notebooks/notebooks/prepare-textures.ipynb) | NASA Blue Marble Next Generation (Earth) and NASA SVS Deep Star Maps 2020 (stars) | `textures/earth-2048.jpg`, `earth-4096.jpg`, `stars-4096.jpg`, `stars-8192.jpg`, `CREDITS.txt` |

Polar outputs are in south polar stereographic meters (see `crsWkt`, `affine`, and `extentM` in each JSON) and also list `centerLatLon`, `latRange`, and `lonRange`.

Landing-site grids use a site-centered azimuthal equidistant projection (`+proj=aeqd`, x east, y north, meters), so the center pixel is the landing point.
