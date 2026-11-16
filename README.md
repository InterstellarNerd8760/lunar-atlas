# Centauri Lunar Atlas

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

The checkout includes `public/data/global-height/global-height.f32` and its JSON metadata. Start the local server from the repository root. The viewer builds a reduced mesh from the elevation grid and uses Auto relief (up to ×4 at globe distance and ×1 near the surface) or fixed ×1, ×2, ×3, and ×4.

The viewer also loads the included 4096 × 2048 normalized LROC WAC texture from `public/data/wac-texture.jpg`. Its source and processing details are in `public/data/wac-texture.json`. Choose **WAC imagery** to inspect the map without the Sun and Earth lighting. The viewer reports when the bundled image is unavailable.


This reflectance map uses one wavelength. Missing samples near the poles are filled with mid-gray. To view your earlier WAC morphology mosaic, copy the backed-up image into the checkout and open the legacy view.

```bash
cp ~/Documents/lunar-atlas-local-backup/wac-texture.jpg public/data/wac-texture-legacy.jpg
```

Open [the legacy texture view](http://localhost:8000/?moonTexture=legacy). The viewer uses the bundled map if the legacy image is missing.

## Explore landing sites

**Explore a site** lists every bundled DEM in `public/data/site-dems/index.json`, grouped into Apollo landing sites and south pole terrain. The viewer downloads one site at a time and drapes that grid on the lunar sphere.

Select a site in **Explore a site**. Apollo entries use the LROC NAC elevation crops. South-pole entries with local DEMs use the PGDA LOLA 5 m grids, including Shackleton rim and Connecting ridge. **Shackleton floor** is a separate selectable site at the official Shackleton crater center (89.67°S, 129.78°E), and uses global/south-polar LOLA coverage rather than a dedicated 5 m floor DEM. Its visibility estimates are approximate and should not be mistaken for rim measurements. Artemis candidate regions in the catalog are terrain proxies, not selected landing coordinates.

The checkout includes the 2048 px Blue Marble Earth texture and 4096 px NASA SVS star map. Credits are in [public/data/sky/CREDITS.txt](public/data/sky/CREDITS.txt). The star panorama uses a fixed decorative orientation. The time slider continues to drive the Sun and Earth's positions using the included Horizons ephemeris.


## Viewer and visibility

The viewer opens on the globe,
offers Auto relief and fixed ×1–×4 scales, and adds Look at Earth and Stand on
surface. Earth keeps its physical radius and ephemeris range. Detail mesh
vertices use a local center to improve close-range precision.

Select a site or double-click terrain for the visibility panel. Estimates use
Sun and Earth centers above a terrain horizon, sampled every six hours over the bundled
30-day window. The terrain-horizon algorithm uses LOLA heights where available;
small terrain features, disk edges, and transitions between samples are not resolved. Longest darkness may be truncated by the window boundaries.
Site notes cite the Notion-curated NASA, LROC and USGS sources.

The viewer loads site DEMs from `public/data/site-dems/`. The Apollo 11 imagery and south-pole ZIP exports in `data/processed/` are available for future viewer integration.

Validation: JavaScript syntax and whitespace checks passed. Browser acceptance
is pending: the available Chromium process fails to launch in this environment
with an operation-not-permitted socket error. Ground-view appearance, terrain
collision at human height, GPU performance and mobile layout require review.

## Terrain horizon and site comparison

Sunlight and Earth visibility use a 360° terrain horizon instead of a smooth sphere. For each point the viewer ray-marches 150 km outward along every azimuth through the LOLA heights (16 px/deg global grid plus the 80°S polar grid), with lunar curvature, from 2 m above the ground. The 14 sites with a bundled DEM use precomputed profiles in `public/data/horizons.json`, whose near field comes from the PGDA LOLA 5 m or LROC NAC 2 m grid. Rebuild them with `node scripts/build-horizons.mjs`. The panel shows Sunlight, Earth in view, Sun + Earth (solar power and direct-to-Earth radio at once), longest dark, and longest without Earth, each with the smooth-sphere value for comparison. The sky chart draws the terrain skyline. Sun and Earth are treated as points at their centers.

**Compare** in the top bar (or on a site's panel) puts up to three sites side by side over the same Horizons window.

Tests: `node --test tests/horizon.test.mjs`.
