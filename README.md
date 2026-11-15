# Lunar Atlas

A browser-based Moon explorer for comparing sunlight and Earth visibility at lunar sites.

## Local development

Install Python 3 and Git. If you already have a checkout, open Terminal and run:

```bash
cd ~/Documents/lunar-atlas &&
  git pull --ff-only origin main &&
  python3 -m http.server 8000
```

Use the folder where you cloned the repository. If a pull reports that an untracked `public/data/wac-texture.jpg` would be overwritten, stop the server with Ctrl+C, back up and move that local file out of the repository, then rerun `git pull --ff-only origin main`. For example, run the following from the repository root:

```bash
mkdir -p ~/Documents/lunar-atlas-local-backup
mv -n public/data/wac-texture.jpg ~/Documents/lunar-atlas-local-backup/
git pull --ff-only origin main
```

For a fresh checkout, run:

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

The checkout includes `public/data/global-height/global-height.f32` and its JSON metadata. Start the local server from the repository root. The viewer builds a reduced mesh from the elevation grid and uses Auto relief (up to ×3 at globe distance, ×1 near the surface and at detailed sites), with a True scale lock.

The viewer also loads the included 4096 × 2048 normalized LROC WAC texture from `public/data/wac-texture.jpg`. Its source and processing details are in `public/data/wac-texture.json`. The globe uses grayscale terrain if the texture is unavailable.


This reflectance map uses one wavelength. Missing samples near the poles are filled with mid-gray. To view your earlier WAC morphology mosaic, copy the backed-up image into the checkout and open the legacy view.

```bash
cp ~/Documents/lunar-atlas-local-backup/wac-texture.jpg public/data/wac-texture-legacy.jpg
```

Open [the legacy texture view](http://localhost:8000/?moonTexture=legacy). The regular URL uses the bundled map.

## Explore landing sites

**Explore a site** lists every bundled DEM in `public/data/site-dems/index.json`, grouped into Apollo landing sites and south pole terrain. The viewer downloads one site at a time and drapes that grid on the lunar sphere.

Select a site in **Explore a site**. Apollo entries use the LROC NAC elevation crops. South-pole entries use the PGDA LOLA 5 m grids, including Shackleton rim and Connecting ridge. Artemis candidate regions in that catalog are terrain proxies, not selected landing coordinates.

The checkout includes the 2048 px Blue Marble Earth texture and 4096 px NASA SVS star map. Credits are in [public/data/sky/CREDITS.txt](public/data/sky/CREDITS.txt). The star panorama uses a fixed decorative orientation. The time slider continues to drive the Sun and Earth's positions using the included Horizons ephemeris.


## Viewer and visibility

The viewer opens on the globe,
uses Auto relief with a true-scale lock, and adds Look at Earth and Stand on
surface. Earth keeps its physical radius and ephemeris range. Detail mesh
vertices use a local center to improve close-range precision.

Select a site or double-click terrain for the visibility panel. Estimates use
body centers above a spherical horizon, sampled every six hours over the bundled
30-day window. Terrain occlusion, disk edges and transitions between samples are
not resolved. Longest darkness may be truncated by the window boundaries.
Site notes cite the Notion-curated NASA, LROC and USGS sources.

The viewer loads site DEMs from `public/data/site-dems/`. The Apollo 11 imagery and south-pole ZIP exports in `data/processed/` are available for future viewer integration.

Validation: JavaScript syntax and whitespace checks passed. Browser acceptance
is pending: the available Chromium process fails to launch in this environment
with an operation-not-permitted socket error. Ground-view appearance, terrain
collision at human height, GPU performance and mobile layout require review.
