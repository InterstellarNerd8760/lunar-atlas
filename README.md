# Lunar Atlas

A browser-based Moon explorer for comparing sunlight and Earth visibility at lunar sites.

## Local development

Run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000`.

- `src/` contains the browser entry point, Moon scene module, and styles.
- `notebooks/` is for offline terrain processing in Colab or Kaggle.
- `data/raw/` and `data/work/` are local folders for downloads and intermediate files.
- `public/data/` holds processed assets the browser can load.
- `docs/data-sources.md` records planned inputs and asset provenance.


## Show the global LOLA terrain

The checkout includes `public/data/global-height/global-height.f32` and its JSON metadata. Start the local server from the repository root. The viewer builds a reduced mesh from the elevation grid and uses true-scale ×1 relief.

The WAC texture notebook is [`notebooks/prepare-wac-texture.ipynb`](notebooks/prepare-wac-texture.ipynb). Run it in Colab, download `wac-texture.jpg`, and place it beside the LOLA files in `public/data/`. The Three.js viewer uses the texture when that file is present and otherwise keeps the grayscale terrain view.


## Add the site terrain and sky assets

From the repository root, extract the supplied archives into `public/data/`. Replace the paths in this example with the paths to your downloads.

```sh
unzip "/path/to/lola-sites(1).zip" -d public/data
unzip "/path/to/landing-sites.zip" -d public/data
unzip "/path/to/textures(1).zip" -d public/data
```

Select a site in **Explore a site**. The viewer downloads that site's terrain when selected. Historical sites can include an LROC NAC close-up. Artemis III entries in the archive use the coordinates of terrain proxies. The five included proxies and four skipped regions are recorded in `public/data/landing-sites/index.json`.

The viewer uses the 2048 px Blue Marble Earth texture and 4096 px NASA SVS star map. Credits are in `public/data/textures/CREDITS.txt`. The star panorama uses a fixed decorative orientation. The time slider continues to drive the Sun and Earth's positions using the included Horizons ephemeris.

For a static deployment with these optional layers, include the extracted directories in the published files.
