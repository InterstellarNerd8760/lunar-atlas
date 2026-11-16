# Centauri Lunar Atlas

A browser-based 3D Moon explorer built by Weston Rosch as a solo entry for the **Lunar Landing Site Navigator** challenge at NASA Space Apps Mountain View 2026.

**[Launch Lunar Atlas](https://moon.westonrosch.com/)** · **[View the seven-slide demo](https://westonrosch.com/projects/lunar-atlas/slides/)** · **[Read the project write-up](https://westonrosch.com/projects/lunar-atlas/)**

Select a landing site to see how the terrain horizon affects sunlight and direct line of sight to Earth. Compare up to three sites over the same November 14–December 14, 2026 UTC window, or use Free flight and Walk mode to explore the terrain from orbit to eye level.

Lunar Atlas uses NASA LOLA elevation, LROC imagery and terrain models, and JPL Horizons ephemerides. The visibility estimates use six-hour samples and depend on the available terrain resolution. They are intended for exploration and preliminary comparisons.

- [Submission and methodology](docs/SUBMISSION.md)
- [Data sources and processing notes](docs/data-sources.md)
- [Image credits and licenses](docs/CREDITS.md)

Weston led the concept, design, dataset selection, integration, and testing. AI tools assisted with implementation, debugging, research, and documentation. The [submission notes](docs/SUBMISSION.md#ai--super-intelligence-disclosure) describe the assistance in more detail.

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

The checkout includes `public/data/global-height/global-height.f32` and its JSON metadata. Start the local server from the repository root. The viewer renders a cube-sphere quadtree with 33×33-vertex terrain tiles and skirts to minimize LOD cracks, samples the elevation grid, and uses Auto relief (up to ×4 at globe distance and ×1 near the surface) or fixed ×1, ×2, ×3, and ×4.

The viewer also loads the included 4096 × 2048 normalized LROC WAC texture from `public/data/wac-texture.jpg`. Its source and processing details are in `public/data/wac-texture.json`. Choose **WAC imagery** to inspect the map without the Sun and Earth lighting. The viewer reports when the bundled image is unavailable.


This reflectance map uses one wavelength. Missing samples near the poles are filled with mid-gray. To view your earlier WAC morphology mosaic, copy the backed-up image into the checkout and open the legacy view.

```bash
cp ~/Documents/lunar-atlas-local-backup/wac-texture.jpg public/data/wac-texture-legacy.jpg
```

Open [the legacy texture view](http://localhost:8000/?moonTexture=legacy). The viewer uses the bundled map if the legacy image is missing.

## Explore landing sites

**Explore a site** lists every bundled DEM in `public/data/site-dems/index.json`, grouped into Apollo landing sites and south pole terrain. The viewer downloads one site at a time and drapes that grid on the lunar sphere.

Select a site in **Explore a site**. Apollo entries use the LROC NAC elevation crops. South-pole entries with local DEMs use the PGDA LOLA 5 m grids, including Shackleton rim and Connecting ridge. **Shackleton floor** is a separate selectable site at the official Shackleton crater center (89.67°S, 129.78°E), and uses global/south-polar LOLA coverage rather than a dedicated 5 m floor DEM. Its visibility estimates are approximate and should not be mistaken for rim measurements. The 2024 Artemis candidate regions in the catalog are terrain proxies, not selected landing coordinates; NASA's October 2026 update makes Artemis III a 2027 low-Earth-orbit test and Artemis IV the first planned lunar landing in 2028.

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

## Terrain horizon and site comparison

Sunlight and Earth visibility use a 360° terrain horizon instead of a smooth sphere. For each point the viewer ray-marches 150 km outward along every azimuth through the LOLA heights (16 px/deg global grid plus the 80°S polar grid), with lunar curvature, from 2 m above the ground. The 14 sites with a bundled DEM use precomputed profiles in `public/data/horizons.json`, whose near field comes from the PGDA LOLA 5 m or LROC NAC 2 m grid. Rebuild them with `node scripts/build-horizons.mjs`. The panel shows Sunlight, Earth in view, Sun + Earth (solar power and direct-to-Earth radio at once), longest dark, and longest without Earth, each with the smooth-sphere value for comparison. The sky chart draws the terrain skyline. Sun and Earth are treated as points at their centers.

**Compare** in the top bar (or on a site's panel) puts up to three sites side by side over the same Horizons window.

Tests: `node --test tests/horizon.test.mjs`.

## Pin legend and keyboard help

The existing marker geometry (flat ground disc, thin stalk, small sphere) is built entirely in three.js; there are no externally generated pin sprites. **White:** landed spacecraft. **Red:** failed landing impact (Luna 25 likely impact and HAKUTO-R Mission 1 approximate crash). **Hollow white:** mapped future candidate-region proxy. **Dashed gold:** an approximately located landing site, notably Luna 9 and Luna 13. A failed mission's coordinate may also be approximate; see its source note. Missions that never reached the Moon (for example, Peregrine) are not shown as fictitious impact locations. Near-surface pin labels show the actual mission on hover and disappear on pointer exit.

Open the guide with **Help**, **I**, **Shift + /** (question mark), or **F1**; text inputs ignore these shortcuts. Other information windows remain draggable by their Move panel handles, but pin hover labels stay anchored and cannot be dragged.

### Additional planned CLPS region pins (NASA / USGS sourced)

To keep future mission regions discoverable without inventing landing coordinates, the viewer includes three additional **illustrative regional reference pins**: IM-3 at Reiner Gamma (7.39°N, 58.96°W), Draper's CP-12 near Schrödinger basin (74.73°S, 132.93°E), and Firefly Blue Ghost Mission 3 near the Gruithuisen Domes (36.07°N, 39.59°W). **All three coordinates are the named lunar feature centers from the USGS/IAU Gazetteer, not NASA-confirmed lander target coordinates.** Their status is planned, not landed; no extra high-resolution terrain is claimed. See each site writeup and [NASA's CLPS reference](https://www.nasa.gov/reference/commercial-lunar-payload-services/).
