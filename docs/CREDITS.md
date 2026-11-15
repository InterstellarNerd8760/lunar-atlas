# Credits

## 3D models

| File | Source | License |
| --- | --- | --- |
| `public/models/apollo-lm.glb` | "Apollo Lunar Module", NASA 3D Resources (NASA/Michael D. Carbajal), https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Apollo%20Lunar%20Module | NASA media, no copyright (public domain). See the NASA Images and Media Usage Guidelines. |
| `public/models/nasa-hdu-habitat.glb` | "Habitat Demonstration Unit" parts 1 and 2 (merged), NASA 3D Resources, https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Habitat%20Demonstration%20Unit | NASA media, no copyright (public domain). Scaled to 4 m tall, which is an estimate. |
| `public/models/nasa-sev-rover.glb` | "Space Exploration Vehicle", NASA 3D Resources (NASA/LaRC/Advanced Concepts Lab), https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Space%20Exploration%20Vehicle | NASA media, no copyright (public domain). |

Both files were converted with `@gltf-transform/cli` 4.5: Draco removed, meshopt-compressed, textures resized to 512 px WebP. The SEV was simplified from 605k to about 65k vertices. NASA's use of these models does not imply endorsement.

These models are procedural (built in `src/landers.js` from three.js primitives at approximate real dimensions), because no free, reusable model was available: Starship HLS, Blue Moon MK1 and MK2, the Apollo LRV, the solar tower, the fallback habitat and pressurized rover, the generic robotic lander, and the small rovers. The Artemis base layout is a concept and not a NASA plan.
