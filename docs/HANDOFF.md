# Lunar Atlas handoff (Nov 14, 2026)

This file is for whoever picks the project up next (Codex, Devin, or a person). It covers the current state, the data files, and how the terrain layers blend.

## Current state

- `main` has the cube-sphere quadtree LOD terrain (PR #4): 6 faces, screen-space-error splitting, skirts, float64 tile origins, log depth, a Lommel-Seeliger shader with earthshine, procedural micro-relief, and stereographic polar caps for the WAC texture.
- PR #5 (merged) added the ×1–×4 relief buttons and fixes the WAC imagery display.
- PR #7 (merged into main) built on PR #5. It added:
  1. A native-resolution global LOLA grid that loads in the background.
  2. SLDEM2015 regional terrain, 160 km across, around all six Apollo sites, so the 2–5 m NAC DTMs no longer drop straight into the ~10 km startup grid.
  3. Loader support for int16 height files and a separate cache for regional grids.
- Not done (from Codex's lost session): the LOD-independent normal fix and the horizon grain shimmer fix. See "Next steps."
- Run it with `python3 -m http.server 8000` from the repo root, then open `http://localhost:8000`.

## Height data files

All grids store heights in meters above a 1,737.4 km sphere, row-major, north row first. Every file has a `.json` sidecar with `width`, `height`, `encoding`, `affine`, and source and credit info.

- `encoding: "float32-le"` means `.f32` files with NaN for no data.
- `encoding: "int16-le"` means `.i16` files where `height_m = DN * scale + offset` (scale is 0.5 here, so 0.5 m steps). These grids have no no-data value.

| Layer | File(s) | Grid | Post spacing | Size |
|---|---|---|---|---|
| Global, startup | `public/data/global-height/global-height.f32` | 1024×512, simple cylindrical, 180 W to 180 E | ~10.7 km | 2.0 MB |
| Global, hi-res | `public/data/global-height/global-height-hi.i16` | 5760×2880 (LOLA LDEM_16, native), same extent | ~474 m | 33.2 MB |
| South pole | `public/data/south-pole-lola/` | south polar stereographic | see its json | existing |
| Apollo regional | `public/data/site-regions/apollo-{11,12,14,15,16,17}/*-region.i16` + `index.json` | 1280×1280, azimuthal equidistant on the site, ±80 km | 125 m (SLDEM2015 256 ppd ≈ 118 m) | 3.3 MB each, 19.7 MB total |
| Site DTMs | `public/data/site-dems/<id>/` + `index.json` | NAC DTMs: 4 km aeqd crops at 2 m (5 m for Apollo 17). PGDA 5 m grids at the south pole. | 2–5 m | existing |

Rebuild the new layers with `scripts/build_terrain_layers.py`, which needs only numpy:

```
curl -O https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_16.IMG
python3 scripts/build_terrain_layers.py --ldem LDEM_16.IMG   # REBUILD=1 to redo existing regions
```

The script reads SLDEM2015 from the 11 GB global 256 ppd file using HTTP range requests, one row at a time. Each site downloads about 8 MB.

## How the layers blend (`src/terrain.js`, `sampleMeters`)

The height at a point is computed in this order, finest layer last:

1. **Global grid**, bilinear. The 1024×512 grid is used at startup. `global-height-hi` is fetched right after `createTerrain` finishes, decoded to Float32, and swapped into the same `global` object. Every cached tile is then marked `evicted` so it rebuilds with the new heights.
2. **South-pole LOLA overview**, blended in by distance from the pole (existing code).
3. **Loaded DEMs**, from coarsest to finest (`loaded` is sorted by `resolutionM`, largest first). Each one runs `blendDem`: `h += (dem - h) * w`, with `w = smoothstep(0, margin, distance to the grid edge)` (a cosine-like ramp), multiplied by a void feather for NaN holes.
   - Regional SLDEM crops use `margin = 20% of span`, which is 32 km. A regional grid fully replaces the global grid only within 48 km of the site. Over the outer 32 km it fades into the global grid.
   - Site DTMs keep their existing margin (25% of span, 1 km for the 4 km crops). They fade into the regional grid underneath them instead of into the 10 km global grid.
4. **Micro-relief grain**, faded out only by the fine site DTMs. The 125 m regional grids still get the grain.

**Loading and cache:**

- Fine DTMs are unchanged. The selected site is pinned, and one more DTM loads if it's within 180 km. At most two stay loaded.
- Regional grids are separate. The nearest region loads once the camera is within 400 km of its site. At most two stay loaded, and the farthest is evicted first.
- Both caches use `evict(cam, region, limit)` in `considerLoads`.

## Verified (node, with three@0.180.0 and a file-backed `fetch` stub)

- `node --check src/terrain.js` passes.
- The hi-res global grid swaps in (Apollo 14 global-only height changes from −1058.5 to −1049.4 m).
- At all six Apollo sites:
  - The center height matches the site DTM `siteHeightM` within 0.5 m.
  - A point 30 km east matches the regional SLDEM value within 4 m (the gap is micro-relief). The old global-only value was off by up to 186 m (Apollo 15).
- With 2 fine DTMs and 2 regions loaded, `stats().dems` is 4, so the cache limits hold.
- No in-browser visual check has been done yet. Look at the Apollo 15 and 17 seams in Chrome first.

## Next steps

1. Visual check at each Apollo site with relief at ×1 and ×4. If the 32 km regional feather still shows a seam, raise `span * 0.2` in `fetchDem`.
2. Normals: `buildTile` takes slopes with `step = max(tile edge / GRID, 40 m)`, so shading changes with LOD. Use a fixed step instead, about the finest data spacing under the tile, to stop it.
3. Grain shimmer: fade the `grain()` octaves in the fragment shader by `fwidth(pm)` and distance.
4. SLDEM2015 regional crops for the other preset sites (outside ±60° only LOLA is available). The same script works if you add ids to `SITES`.
5. Then UI (KSP-style), the visibility panel polish, and the submission (Sun Nov 15, 11:59 PM PT).

## Lander model overlay (`src/landers.js`)

This overlay draws 3D models of the hardware at each landing site in `public/data/landing-sites.csv`. Every model is at true scale, in metres.

- **Apollo 11–17:** NASA's Apollo LM model (`public/models/apollo-lm.glb`, from NASA 3D Resources). The ascent stage is hidden because only the descent stage stayed on the Moon. Apollo 15, 16 and 17 also get a procedural Lunar Roving Vehicle (3.1 × 2.3 × 1.14 m, 0.82 m wheels) about 17 m from the LM.
- **Robotic landings:** a procedural lander sized from the `LANDER_DIMS` table (span and height per mission). Lunokhod 1 and 2, Yutu, Yutu-2 and Pragyan get a small rover marker 7 m away. The real rovers drove much farther.
- **Artemis regions with coordinates:** concept hardware only, tinted cyan. The regions alternate between a Starship HLS (9 × 50 m) and a Blue Moon MK2 (7 × 16 m) with an MK1 cargo lander (3.1 × 8 m). Each region also gets NASA's Habitat Demonstration Unit (`public/models/nasa-hdu-habitat.glb`, scaled to 4 m tall), two 10 m solar towers, and NASA's Space Exploration Vehicle (`public/models/nasa-sev-rover.glb`, scaled to 6 m long) as the pressurized rover. None of this is a real selected site or real hardware.

**Models are slots.** Each model type is a slot in `SLOTS` (in `landers.js`) with a true-scale target size and a procedural fallback. `public/models/models.json` maps slots to GLB files. To swap in a better model, add the GLB to `public/models/`, add `"slotName": { "file": "x.glb" }` to the manifest (optionally with `height` / `length` in metres or `rotationY` in degrees), and credit it in `docs/CREDITS.md`. The loader scales it to the target size and puts it on the ground, with no code change. Slots: apolloLM, apolloLRV, starshipHLS, blueMoonMK1, blueMoonMK2, habitat, solarTower, pressurizedRover, luna9, surveyor, lunaLander, lunokhodLander, change3, change5, vikram, slim, novaC, blueGhost, genericLander, lunokhod, yutu, pragyan.

**How it works:** each site gets an anchor at `terrain.surfaceRadius()`, oriented to local up (X east, Y up, Z south), with scale `1 / R`. Each part sits at the lowest terrain point under its footprint, so no legs float. Sites are re-seated when the relief scale or the number of loaded DEMs changes. Models are built, and GLBs fetched, only when the camera comes within 60 km of a site. When a model would be under about 14 px on screen, the site shows a constant-size pin instead (gold for Apollo, white for robotic, cyan for concept). A part the camera is standing inside is hidden, because the site views put the eye right at the catalog coordinate.

**API:** `createLanderOverlay({ scene, terrain, sites, canvas, modelsDirectory })` returns `{ group, update(camera), setVisible(bool), visible, entries }`. `loadLandingSites(dataDirectory)` parses the CSV.

**Toggle:** it's on by default. Use the "Lander models (L)" checkbox at the bottom left, the `L` key, or `?landers=0` in the URL. `createLanderToggle(container, overlay)` is self-contained and only calls `overlay.setVisible()`, so it can move into the layers menu. The wiring in `moon.js` is about 20 lines: one import, the create call after the sky, and `landers?.update(camera)` before render.

Model credits are in `docs/CREDITS.md`.

**HLS splat (opt-in):** `?hlsSplat=1` swaps the procedural Starship HLS for the Budget3D Gaussian splat (`starship-hls-budget3d.spz`, 3.8 MB). It's drawn by Spark, lazy-loaded from the CDN, in a second pass with its own camera range and no depth test. In headless SwiftShader the page froze once the splat came on screen, so it's off by default until someone checks it on a real GPU.

### Site pins share the overlay pin style

The DOM site pins in `src/sites.js` use the lander overlay's pin look: a thin stalk with a diamond head, coloured by group (gold for Apollo, white for robotic landers, cyan outline for Artemis regions). They keep the 32 px button hit area (the stalk foot sits on the site), the label chip, and selection. Because the app draws these pins itself, `moon.js` passes `showPins: false` to `createLanderOverlay`, so the overlay's instanced 3D pins stay hidden. Standalone users of `landers.js` still get them by default.
