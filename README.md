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

The checkout includes `public/data/global-height/global-height.f32` and its JSON metadata. Start the local server from the repository root. The viewer builds a reduced mesh from the elevation grid and uses Auto relief (up to ×8 at globe distance, ×1 near the surface and at detailed sites), with a True scale lock.

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


## PR #2 visual and visibility update

Run the existing Python server as before. The viewer defaults to the south pole,
uses Auto relief with a true-scale lock, and adds Look at Earth and Stand on
surface. Earth keeps its physical radius and ephemeris range. Detail mesh
vertices use a local center to improve close-range precision.

Select a site or double-click terrain for the visibility panel. Estimates use
body centers above a spherical horizon, sampled every six hours over the bundled
30-day window. Terrain occlusion, disk edges and transitions between samples are
not resolved. Longest darkness may be truncated by the window boundaries.
Site notes cite the Notion-curated NASA, LROC and USGS sources.

Re-run notebooks/prepare-wac-texture.ipynb in Colab and place its output at
public/data/wac-texture.jpg for the 4096×2048 global texture. The source is the
morphology mosaic with baked illumination; normalized albedo and local site
image crops are still pending. Local crop loading, mission photo galleries,
terrain shadows, century-scale history, and two-site comparison are not included
in this checkpoint. Existing six-hour ephemeris samples are retained.

Validation: JavaScript syntax and whitespace checks passed. Browser acceptance
is pending: the available Chromium process fails to launch in this environment
with an operation-not-permitted socket error. Ground-view appearance, terrain
collision at human height, GPU performance and mobile layout require review.
