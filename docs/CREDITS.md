# Credits

## 3D models

| File | Source | License |
| --- | --- | --- |
| `public/models/apollo-lm.glb` | "Apollo Lunar Module", NASA 3D Resources (NASA/Michael D. Carbajal), https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Apollo%20Lunar%20Module | NASA media, no copyright (public domain). See the NASA Images and Media Usage Guidelines. |
| `public/models/nasa-hdu-habitat.glb` | "Habitat Demonstration Unit" parts 1 and 2 (merged), NASA 3D Resources, https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Habitat%20Demonstration%20Unit | NASA media, no copyright (public domain). Scaled to 4 m tall, which is an estimate. |
| `public/models/nasa-sev-rover.glb` | "Space Exploration Vehicle", NASA 3D Resources (NASA/LaRC/Advanced Concepts Lab), https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Space%20Exploration%20Vehicle | NASA media, no copyright (public domain). |

Both files were converted with `@gltf-transform/cli` 4.5: Draco removed, meshopt-compressed, textures resized to 512 px WebP. The SEV was simplified from 605k to about 65k vertices. NASA's use of these models does not imply endorsement.

These models are procedural (built in `src/landers.js` from three.js primitives at approximate real dimensions), because no free, reusable official model was available: Starship HLS, Blue Moon MK1 and MK2, the Apollo LRV, Surveyor, Lunokhod, the solar tower, the fallback habitat and pressurized rover, the generic robotic lander, and the small rovers. NASA 3D Resources does not publish Surveyor, Lunokhod, or LRV models. The Artemis base layout is a concept and not a NASA plan.

## Gaussian splat

`public/models/starship-hls-budget3d.spz` (opt-in with `?hlsSplat=1`) is a Gaussian splat made with Budget3D / Idol (https://budgetany.github.io/budget3d/, Space `hugging-apps/budget3d-idol`; the Space and model weights are Apache-2.0). The input was the NASA/MSFC artist's concept "Artist's Concepts Depict SpaceX's Starship HLS on the Moon for NASA Artemis" (images.nasa.gov id `11 03 24 artemis 3 on surface`, credit NASA). After generation, the splat was flipped upright, cleaned of floaters, cut to 250k gaussians, scaled to 9 m × 50 m, and recoloured from its front-facing side. Splats are rendered with Spark (`@sparkjsdev/spark`, MIT) from jsDelivr.

## Site photographs

Photographs in `public/data/site-photos/` appear in the site drawer. Captions, credit lines, licenses, and source URLs for every image are also recorded in `public/data/site-photos/index.json`.

### NASA/JSC Apollo surface photographs

Public domain (NASA media).

| File | Photograph | Credit |
| --- | --- | --- |
| `apollo-11.jpg` | Buzz Aldrin at Tranquility Base (AS11-40-5903) | NASA/JSC |
| `apollo-12.jpg` | An Apollo 12 astronaut beside the flag (AS12-47-6897) | NASA/JSC |
| `apollo-14.jpg` | Lunar Module Antares at Fra Mauro (AS14-66-9306) | NASA/JSC |
| `apollo-15.jpg` | James Irwin at the Lunar Roving Vehicle (AS15-86-11603) | NASA/JSC |
| `apollo-16.jpg` | John Young salutes the flag at Descartes (AS16-113-18339) | NASA/JSC |
| `apollo-17.jpg` | Harrison Schmitt beside the flag at Taurus-Littrow (AS17-134-20384) | NASA/JSC |
| `surveyor-3.jpg` | Alan Bean with Surveyor 3; Intrepid on the horizon (AS12-48-7136) | NASA/JSC |

Sources: [images.nasa.gov](https://images.nasa.gov/).

### LROC NAC lander views and Artemis region mosaics

Public domain (NASA/LROC). Credit requested as NASA/GSFC/Arizona State University.

These include LROC Narrow Angle Camera views of Surveyor 1, 5, 6, and 7; Luna 16, 17, 20, 21, 23, and 24; Chang'e 3, 4, 5, and 6; Chandrayaan-3; SLIM; IM-1 Odysseus; IM-2 Athena; and Blue Ghost Mission 1, plus low-Sun NAC mosaics or featured NAC views of the Artemis candidate regions Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, and de Gerlache Rim.

Featured-image pages are on [lroc.im-ldi.com](https://lroc.im-ldi.com/images). Region mosaics are LROC NAC ROI products from [data.lroc.im-ldi.com](https://data.lroc.im-ldi.com/). Luna 13 uses a crop of the bundled LROC WAC EMP mosaic around a historical (not LROC-confirmed) coordinate, because no clearly licensed surface photograph was available.

### Other NASA media

| File | Photograph | Credit | License |
| --- | --- | --- | --- |
| `luna-9.jpg` | First photograph from the lunar surface, 3 February 1966 | National Space Science Data Center / Luna 9 (USSR), published by NASA | Public domain (published by NASA) |
| `artemis3-slater-plain.jpg` | Official map of the nine Artemis III candidate landing regions, including Slater Plain, on an LRO WAC mosaic | NASA (background: LRO WAC mosaic, NASA/GSFC/Arizona State University) | Public domain (NASA media) |

Sources: [First Photo from the Surface of the Moon](https://science.nasa.gov/resource/first-photo-from-the-surface-of-the-moon/) and [NASA Provides Update on Artemis III Moon Landing Regions](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/).

## Named lunar features

Names and coordinates in `public/data/features.json` come from the IAU Working Group for Planetary System Nomenclature, as published in the [USGS Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/). The gazetteer is public domain. This copy was trimmed from the Moon center-point shapefile (LOLA 2011 control network) at [planetarynames.wr.usgs.gov/GIS_Downloads](https://planetarynames.wr.usgs.gov/GIS_Downloads).

Carroll is a proposed name from the Artemis II crew, not an official IAU name. Its location (18.633° N, 86.533° W) and 6 km diameter are from NASA SVS, [How to See the Proposed Carroll Crater](https://svs.gsfc.nasa.gov/5646). NASA also reported the proposal, still to be submitted to the IAU, in [NASA’s Artemis II Crew Eclipses Record for Farthest Human Spaceflight](https://www.nasa.gov/news-release/nasas-artemis-ii-crew-eclipses-record-for-farthest-human-spaceflight/).
