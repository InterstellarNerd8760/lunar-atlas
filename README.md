# Lunar Atlas

A browser-based Moon explorer for comparing sunlight and Earth visibility at lunar sites.

## Local development

Install Python 3 and Git. If you already have a checkout, open Terminal and run:

```bash
cd ~/Documents/lunar-atlas-pr2
git pull --ff-only origin main
python3 -m http.server 8000
```

Use your actual checkout path if it differs. For a fresh checkout, run:

```bash
git clone https://github.com/InterstellarNerd8760/lunar-atlas.git
cd lunar-atlas
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in your browser. Keep the terminal open while using the viewer and press Ctrl+C to stop the server. Run the command from the directory containing `index.html`. The browser loads Three.js from a CDN, so it needs an internet connection.

- `src/` contains the browser entry point, Moon scene module, and styles.
- `notebooks/` is for offline terrain processing in Colab or Kaggle.
- `data/raw/` and `data/work/` are local folders for downloads and intermediate files.
- `public/data/` holds processed assets the browser can load.
- `docs/data-sources.md` records planned inputs and asset provenance.


## Show the global LOLA terrain

The checkout includes `public/data/global-height/global-height.f32` and its JSON metadata. Start the local server from the repository root. The viewer builds a reduced mesh from the elevation grid and uses Auto relief (up to ×8 at globe distance, ×1 near the surface and at detailed sites), with a True scale lock.

The viewer also loads the included 4096 × 2048 normalized LROC WAC texture from `public/data/wac-texture.jpg`. Its source and processing details are in `public/data/wac-texture.json`. The globe uses grayscale terrain if the texture is unavailable.


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


## Viewer and visibility

The viewer defaults to the south pole,
uses Auto relief with a true-scale lock, and adds Look at Earth and Stand on
surface. Earth keeps its physical radius and ephemeris range. Detail mesh
vertices use a local center to improve close-range precision.

Select a site or double-click terrain for the visibility panel. Estimates use
body centers above a spherical horizon, sampled every six hours over the bundled
30-day window. Terrain occlusion, disk edges and transitions between samples are
not resolved. Longest darkness may be truncated by the window boundaries.
Site notes cite the Notion-curated NASA, LROC and USGS sources.

The site DEMs in `public/data/site-dems/` and the Apollo 11 and south-pole ZIPs in `data/processed/` are available for integration. The viewer currently loads the optional site and sky archives described above.

Validation: JavaScript syntax and whitespace checks passed. Browser acceptance
is pending: the available Chromium process fails to launch in this environment
with an operation-not-permitted socket error. Ground-view appearance, terrain
collision at human height, GPU performance and mobile layout require review.
