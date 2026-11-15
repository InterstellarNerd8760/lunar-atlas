// Lander model overlay: true-scale 3D models at landing sites.
//
// - Apollo sites: NASA's Apollo LM (public/models/apollo-lm.glb, NASA 3D
//   Resources) with the ascent stage hidden, since only the descent stage
//   stayed on the surface. Apollo 15/16/17 also get a Lunar Roving Vehicle.
// - Robotic landings: a procedural lander sized to each mission, plus a rover
//   marker for Lunokhod 1/2, Yutu, Yutu-2 and Pragyan.
// - Artemis candidate regions: CONCEPT hardware only (Starship HLS or Blue Moon,
//   habitat, solar tower, NASA's SEV pressurized rover). Not real hardware or
//   selected sites. Concept models get a cyan tint.
//
// Everything is in metres at true scale. Far away, each site is drawn as a
// constant-size pin instead. GLB files load lazily, only when the camera gets
// within LOAD_KM of a site that needs them.
//
// API: const overlay = createLanderOverlay({ scene, terrain, sites, canvas, modelsDirectory });
//      overlay.update(camera) every frame; overlay.setVisible(bool); overlay.group.

import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/meshopt_decoder.module.js';

// Spark (three.js Gaussian splat renderer), imported lazily only when a slot
// of type "splat" is first needed. Needs the "three/addons/" import-map entry.
const SPARK_URL = 'https://cdn.jsdelivr.net/npm/@sparkjsdev/spark@2.4.0/dist/spark.module.js';

const R = 1_737_400; // Moon radius in metres; the globe radius is 1.
const LOAD_KM = 60; // build site models within this camera distance
const PIN_PX = 18; // on-screen pin height
const MODEL_MIN_PX = 3; // below this, the model is hidden
const PIN_HIDE_PX = 14; // above this model size, the pin is hidden

const COLORS = {
  gold: 0xc9a23c, foil: 0xb08a2e, dark: 0x2a2c31, black: 0x15161a, silver: 0xb9bec7,
  white: 0xe9ebee, steel: 0xcfd5dc, panel: 0x1c2d55, tire: 0x6f6a5f, blue: 0x8fa7c7,
  orange: 0xc87533,
};
const PIN_COLORS = { apollo: 0xf0c75e, robotic: 0xd8dde6, artemis: 0x5fd4ff };

// ---------------------------------------------------------------- CSV ----
export async function loadLandingSites(dataDirectory) {
  const response = await fetch(new URL('landing-sites.csv', dataDirectory));
  if (!response.ok) return [];
  return parseCsv(await response.text());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ''])));
}

// ------------------------------------------------- procedural builder ----
// Merges primitives into one vertex-coloured, non-indexed geometry, so each
// procedural model is a single draw call.
class Builder {
  constructor() { this.parts = []; this.m = new THREE.Matrix4(); }
  add(geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    this.m.compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    );
    g.applyMatrix4(this.m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    return this;
  }
  box(w, h, d, color, pos, rot) { return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot); }
  cyl(rTop, rBottom, h, color, pos, seg = 12, rot) {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, pos, rot);
  }
  // Cylinder strut from point a to point b.
  strut(a, b, r, color, seg = 5) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const g = new THREE.CylinderGeometry(r, r, dir.length(), seg).toNonIndexed();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.applyQuaternion(q);
    g.translate(...va.add(vb).multiplyScalar(0.5).toArray());
    return this.add(g, color);
  }
  // n legs from (r0, y0) on the body to footpads at radius r1 on the ground.
  legs(n, r0, y0, r1, color, padR = 0.25, strutR = 0.05, phase = Math.PI / 4) {
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      this.strut([cx * r0, y0, cz * r0], [cx * r1, padR * 0.3, cz * r1], strutR, color);
      this.cyl(padR, padR, padR * 0.3, color, [cx * r1, padR * 0.15, cz * r1], 8);
    }
    return this;
  }
  build() {
    let count = 0;
    for (const g of this.parts) count += g.attributes.position.count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    let o = 0;
    for (const g of this.parts) {
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
      col.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
}

// All dimensions in metres; +Y up, origin on the ground at the vehicle centre.
const PROCEDURAL = {
  // Starship HLS: ~9 m diameter, ~50 m tall.
  starshipHLS() {
    const b = new Builder();
    b.cyl(4.5, 4.5, 38, COLORS.white, [0, 4 + 19, 0], 20);
    b.cyl(4.52, 4.52, 2.2, COLORS.dark, [0, 36.5, 0], 20); // airlock and window band
    b.add(new THREE.ConeGeometry(4.5, 8, 20), COLORS.white, [0, 46, 0]);
    b.cyl(4.2, 4.5, 2, COLORS.dark, [0, 3, 0], 20); // aft skirt
    for (let i = 0; i < 6; i++) { // mid-body landing thrusters
      const a = (i / 6) * Math.PI * 2;
      b.box(0.8, 1.2, 0.8, COLORS.dark, [Math.cos(a) * 4.6, 39, Math.sin(a) * 4.6]);
    }
    b.legs(6, 4.2, 4, 5.6, COLORS.steel, 0.7, 0.25, 0);
    return b.build();
  },
  // Blue Moon MK1 cargo lander: ~8 m tall, ~3.1 m wide.
  blueMoonMK1() {
    const b = new Builder();
    b.cyl(1.55, 1.55, 4.6, COLORS.white, [0, 1.4 + 2.3, 0], 16);
    b.add(new THREE.ConeGeometry(1.55, 1.9, 16), COLORS.white, [0, 6 + 0.95, 0]);
    b.cyl(0.4, 0.4, 0.4, COLORS.dark, [0, 7.85, 0], 8);
    b.cyl(0.35, 0.75, 1.1, COLORS.dark, [0, 0.85, 0], 12); // engine bell
    b.box(3.2, 0.06, 1.0, COLORS.panel, [0, 4.2, 1.6]);
    b.legs(4, 1.4, 2.2, 2.6, COLORS.steel, 0.35, 0.09);
    return b.build();
  },
  // Blue Moon MK2 crewed lander: ~16 m tall, ~7 m wide.
  blueMoonMK2() {
    const b = new Builder();
    b.cyl(3.0, 3.0, 6.5, COLORS.white, [0, 2.2 + 3.25, 0], 18); // propellant section
    b.cyl(3.05, 3.05, 0.6, COLORS.blue, [0, 8.9, 0], 18);
    b.cyl(2.0, 2.6, 4.2, COLORS.white, [0, 9.2 + 2.1, 0], 16); // crew cabin
    b.add(new THREE.ConeGeometry(2.0, 2.6, 16), COLORS.white, [0, 13.4 + 1.3, 0]);
    b.box(0.9, 1.6, 0.4, COLORS.dark, [0, 11, 2.35]); // hatch
    b.box(6.6, 0.08, 1.6, COLORS.panel, [0, 7.0, 3.3]); // solar array
    b.cyl(0.5, 1.1, 1.6, COLORS.dark, [0, 1.3, 0], 12);
    b.legs(4, 2.8, 3.0, 3.5, COLORS.steel, 0.5, 0.15);
    return b.build();
  },
  // Apollo Lunar Roving Vehicle: 3.1 x 2.3 x 1.14 m, 0.82 m wheels.
  apolloLRV() {
    const b = new Builder();
    b.box(1.2, 0.12, 3.0, COLORS.silver, [0, 0.55, 0]); // chassis
    for (const x of [-1.03, 1.03]) for (const z of [-1.15, 1.15]) {
      b.cyl(0.41, 0.41, 0.23, COLORS.tire, [x, 0.41, z], 12, [0, 0, Math.PI / 2]);
      b.box(0.3, 0.04, 0.9, COLORS.orange, [x, 0.86, z]); // fender
      b.strut([x * 0.55, 0.55, z * 0.85], [x, 0.41, z], 0.03, COLORS.dark);
    }
    for (const x of [-0.32, 0.32]) {
      b.box(0.5, 0.06, 0.5, COLORS.silver, [x, 0.75, -0.1]); // seats
      b.box(0.5, 0.45, 0.05, COLORS.silver, [x, 0.98, -0.37]);
    }
    b.strut([0, 0.6, 0.55], [0, 1.0, 0.5], 0.03, COLORS.dark); // console post
    b.box(0.35, 0.25, 0.08, COLORS.dark, [0, 1.06, 0.5]);
    b.box(1.0, 0.35, 0.5, COLORS.gold, [0, 0.82, 1.15]); // forward chassis kit
    return b.build();
  },
  // Surface habitat concept: 4 m x 8 m horizontal cylinder on legs.
  baseHabitat() {
    const b = new Builder();
    b.cyl(2, 2, 8, COLORS.white, [0, 3, 0], 16, [Math.PI / 2, 0, 0]);
    b.add(new THREE.SphereGeometry(2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.white, [0, 3, 4], [Math.PI / 2, 0, 0], [1, 0.35, 1]);
    b.add(new THREE.SphereGeometry(2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.white, [0, 3, -4], [-Math.PI / 2, 0, 0], [1, 0.35, 1]);
    b.cyl(0.8, 0.8, 0.6, COLORS.dark, [0, 3, 4.9], 12, [Math.PI / 2, 0, 0]); // docking port
    for (const x of [-1.4, 1.4]) for (const z of [-3, 3]) {
      b.strut([x, 1.6, z], [x * 1.25, 0.1, z], 0.1, COLORS.steel);
      b.cyl(0.35, 0.35, 0.1, COLORS.steel, [x * 1.25, 0.05, z], 8);
    }
    return b.build();
  },
  // Vertical solar array tower concept: 10 m tall.
  solarTower() {
    const b = new Builder();
    b.cyl(0.15, 0.2, 10, COLORS.steel, [0, 5, 0], 8);
    b.box(2.4, 6, 0.08, COLORS.panel, [0, 6.8, 0.2]);
    b.box(2.5, 0.08, 0.1, COLORS.steel, [0, 3.8, 0.2]);
    b.box(2.5, 0.08, 0.1, COLORS.steel, [0, 9.8, 0.2]);
    b.legs(3, 0.2, 1.4, 1.6, COLORS.steel, 0.25, 0.07, 0);
    b.box(1, 0.6, 0.8, COLORS.white, [0, 0.4, 0]);
    return b.build();
  },
  // Pressurized rover concept, 6 x 3 x 3 m. Fallback if the NASA SEV GLB fails.
  pressurizedRover() {
    const b = new Builder();
    b.box(2.6, 1.9, 5.4, COLORS.white, [0, 1.9, 0]);
    b.box(2.2, 0.6, 0.1, COLORS.dark, [0, 2.3, 2.71]);
    b.box(2.8, 0.25, 6, COLORS.silver, [0, 0.85, 0]);
    for (const x of [-1.3, 1.3]) for (const z of [-2.2, 0, 2.2]) {
      b.cyl(0.55, 0.55, 0.35, COLORS.tire, [x, 0.55, z], 12, [0, 0, Math.PI / 2]);
    }
    return b.build();
  },
  // Generic robotic lander, unit span and height. Scaled per mission.
  roboticLander() {
    const b = new Builder();
    b.cyl(0.24, 0.24, 0.42, COLORS.foil, [0, 0.55, 0], 8); // body
    b.box(0.5, 0.04, 0.32, COLORS.panel, [0, 0.79, 0]); // top deck panel
    b.cyl(0.1, 0.13, 0.12, COLORS.dark, [0, 0.28, 0], 8); // engine
    b.strut([0.1, 0.78, -0.1], [0.12, 0.98, -0.12], 0.012, COLORS.silver);
    b.add(new THREE.ConeGeometry(0.1, 0.05, 10, 1, true), COLORS.silver, [0.12, 0.99, -0.12], [Math.PI, 0, 0]);
    b.legs(4, 0.2, 0.42, 0.46, COLORS.silver, 0.05, 0.012);
    return b.build();
  },
  // Generic small rover, unit length, width and height. Scaled per rover.
  smallRover() {
    const b = new Builder();
    b.box(0.7, 0.35, 0.8, COLORS.foil, [0, 0.55, 0]);
    b.box(1.0, 0.03, 0.9, COLORS.panel, [0, 0.76, 0]);
    b.strut([0.2, 0.75, 0.3], [0.2, 1.0, 0.3], 0.03, COLORS.silver);
    b.box(0.2, 0.1, 0.1, COLORS.dark, [0.2, 0.98, 0.32]);
    for (const x of [-0.42, 0.42]) for (const z of [-0.38, 0, 0.38]) {
      b.cyl(0.17, 0.17, 0.12, COLORS.tire, [x, 0.17, z], 10, [0, 0, Math.PI / 2]);
    }
    return b.build();
  },
};

// Builds one procedural model as a mesh (for previews and debugging).
export function buildProceduralModel(name, concept = false) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.65, metalness: 0.15 });
  if (concept) { material.color.set(0xbfefff); material.emissive.set(0x0b3a4a); }
  return new THREE.Mesh(PROCEDURAL[name](), material);
}

// Model slots. Each slot has a true-scale target size (metres) and a
// procedural fallback. A slot uses a GLB file when public/models/models.json
// lists one for it; drop a new GLB in public/models/, add it to the manifest,
// and it replaces the fallback with no code change. Manifest entries can
// override height / length / rotationY (degrees) / ascentCut.
const SLOTS = {
  apolloLM: { height: 7.04, ascentCut: 0.46, fallback: ['roboticLander', 9.4, 3.2] },
  apolloLRV: { length: 3.1, fallback: ['apolloLRV'] },
  starshipHLS: { height: 50, fallback: ['starshipHLS'] },
  blueMoonMK1: { height: 8, fallback: ['blueMoonMK1'] },
  blueMoonMK2: { height: 16, fallback: ['blueMoonMK2'] },
  habitat: { height: 4, fallback: ['baseHabitat'] },
  solarTower: { height: 10, fallback: ['solarTower'] },
  pressurizedRover: { length: 6, fallback: ['pressurizedRover'] },
  // Robotic landers: [span, height] of the landed hardware, rough public figures.
  luna9: { height: 0.9, fallback: ['roboticLander', 1.6, 0.9] },
  surveyor: { height: 3.0, fallback: ['roboticLander', 4.3, 3.0] },
  lunaLander: { height: 2.0, fallback: ['roboticLander', 4.0, 2.0] }, // Luna 16/20/23/24 descent stage
  lunokhodLander: { height: 1.6, fallback: ['roboticLander', 4.0, 1.6] }, // Luna 17/21
  change3: { height: 2.8, fallback: ['roboticLander', 4.0, 2.8] }, // Chang'e 3/4
  change5: { height: 2.6, fallback: ['roboticLander', 4.5, 2.6] }, // Chang'e 5/6 lander
  vikram: { height: 1.6, fallback: ['roboticLander', 3.0, 1.6] },
  slim: { height: 2.4, fallback: ['roboticLander', 2.7, 2.4] },
  novaC: { height: 4.3, fallback: ['roboticLander', 3.8, 4.3] }, // IM-1 / IM-2
  blueGhost: { height: 2.0, fallback: ['roboticLander', 3.5, 2.0] },
  genericLander: { height: 2.0, fallback: ['roboticLander', 3.0, 2.0] },
  // Rovers: [width, height, length].
  lunokhod: { length: 2.3, fallback: ['smallRover', 1.6, 1.35, 2.3] },
  yutu: { length: 1.5, fallback: ['smallRover', 1.0, 1.1, 1.5] },
  pragyan: { length: 0.92, fallback: ['smallRover', 0.75, 0.85, 0.92] },
};
const LANDER_SLOT = [
  [/^luna-9$/, 'luna9'], [/^surveyor/, 'surveyor'], [/^luna-(17|21)$/, 'lunokhodLander'],
  [/^luna-/, 'lunaLander'], [/^change-[34]$/, 'change3'], [/^change-[56]$/, 'change5'],
  [/^chandrayaan/, 'vikram'], [/^slim$/, 'slim'], [/^im-/, 'novaC'], [/^blue-ghost/, 'blueGhost'],
];
const ROVER_SLOT = {
  'luna-17': 'lunokhod', 'luna-21': 'lunokhod', 'change-3': 'yutu', 'change-4': 'yutu', 'chandrayaan-3': 'pragyan',
};
const LRV_SITES = new Set(['apollo-15', 'apollo-16', 'apollo-17']);

function slotRadius(slot) {
  const f = SLOTS[slot].fallback;
  if (f[0] === 'roboticLander') return Math.max(f[1], f[2]) / 2;
  if (f[0] === 'smallRover') return f[3] / 2;
  return { apolloLRV: 1.9, starshipHLS: 5.6, blueMoonMK1: 2.6, blueMoonMK2: 3.6, baseHabitat: 5.5, solarTower: 1.7, pressurizedRover: 3.2 }[f[0]] || 3;
}

function classify(row) {
  const lat = Number.parseFloat(row.lat);
  const lon = Number.parseFloat(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (/^Artemis region:/i.test(row.name)) return 'artemis';
  if (/crewed/i.test(row.kind)) return 'apollo';
  if (/landing/i.test(row.kind)) return 'robotic';
  return null;
}

// ------------------------------------------------------------ overlay ----
export function createLanderOverlay({ scene, terrain, sites, canvas, modelsDirectory, renderer = null }) {
  const group = new THREE.Group();
  group.name = 'lander-overlay';
  scene.add(group);

  const materials = {
    real: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.65, metalness: 0.15 }),
    concept: new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.1,
      color: 0xbfefff, emissive: 0x0b3a4a, emissiveIntensity: 1,
    }),
  };
  const geometries = new Map();
  const procedural = (name) => {
    if (!geometries.has(name)) geometries.set(name, PROCEDURAL[name]());
    return geometries.get(name);
  };

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let manifest = {};
  const manifestReady = fetch(new URL('models.json', modelsDirectory))
    .then((r) => (r.ok ? r.json() : {}))
    .then((json) => { manifest = json.models || {}; })
    .catch(() => {});
  const glbCache = new Map();
  function loadGlb(slot) {
    if (!glbCache.has(slot)) {
      const spec = { ...SLOTS[slot], ...manifest[slot] };
      glbCache.set(slot, loader.loadAsync(new URL(spec.file, modelsDirectory).href).then((gltf) => {
        const root = gltf.scene;
        if (spec.rotationY) root.rotation.y = (spec.rotationY * Math.PI) / 180;
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const s = spec.height ? spec.height / size.y : spec.length / Math.max(size.x, size.z);
        const wrapper = new THREE.Group();
        root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        wrapper.add(root);
        wrapper.scale.setScalar(s);
        wrapper.updateMatrixWorld(true);
        if (spec.ascentCut) {
          // Hide meshes centred above the descent stage (the ascent stage left).
          const cut = size.y * s * spec.ascentCut;
          const mb = new THREE.Box3();
          root.traverse((o) => {
            if (!o.isMesh) return;
            mb.setFromObject(o);
            if ((mb.min.y + mb.max.y) / 2 > cut) o.visible = false;
          });
        }
        root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
        return wrapper;
      }));
    }
    return glbCache.get(slot);
  }

  // Gaussian splat slots (manifest "type": "splat"). The splat file must
  // already be in metres, +Y up, origin on the ground at the vehicle centre.
  // Spark hangs with the app camera's huge near/far range (0.4 m to 900 Moon
  // radii), so splats live in their own scene and are drawn in a second pass
  // with a camera clipped to 0.5 m .. 300 km. That pass skips depth testing,
  // so a splat can show through terrain in front of it; it is only drawn
  // when its site is within LOAD_KM.
  let sparkPromise = null;
  const splatScene = new THREE.Scene();
  const splatCamera = new THREE.PerspectiveCamera();
  const splatProxies = [];
  function loadSplat(slot, holder) {
    if (!renderer) return Promise.reject(new Error('splats need the WebGLRenderer'));
    if (!sparkPromise) {
      sparkPromise = import(SPARK_URL).then((spark) => {
        splatScene.add(new spark.SparkRenderer({ renderer, enableLod: false, depthTest: false }));
        return spark;
      });
    }
    return sparkPromise.then(async (spark) => {
      const splat = new spark.SplatMesh({ url: new URL(manifest[slot].file, modelsDirectory).href });
      await splat.initialized;
      splat.frustumCulled = false;
      const proxy = new THREE.Group();
      proxy.matrixAutoUpdate = false;
      proxy.add(splat);
      splatScene.add(proxy);
      splatProxies.push({ proxy, holder });
      return splat;
    });
  }

  function renderSplats(camera) {
    if (!visible || !splatProxies.length || !renderer) return;
    let any = false;
    for (const { proxy, holder } of splatProxies) {
      let shown = holder.visible;
      for (let o = holder.parent; o && shown; o = o.parent) shown = o.visible;
      proxy.visible = shown;
      if (shown) { proxy.matrix.copy(holder.matrixWorld); proxy.matrixWorldNeedsUpdate = true; any = true; }
    }
    if (!any) return;
    splatCamera.copy(camera);
    splatCamera.near = 0.5 / R;
    splatCamera.far = 300_000 / R;
    splatCamera.updateProjectionMatrix();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(splatScene, splatCamera);
    renderer.autoClear = autoClear;
  }

  // A slot's model: the manifest GLB if there is one, else the procedural fallback.
  function slotObject(slot, concept) {
    const holder = new THREE.Group();
    const useFallback = () => {
      const [name, ...dims] = SLOTS[slot].fallback;
      let m;
      if (name === 'roboticLander') m = mesh(name, dims[0], dims[1], dims[0]);
      else if (name === 'smallRover') m = mesh(name, dims[0], dims[1], dims[2]);
      else m = mesh(name);
      m.material = concept ? materials.concept : materials.real;
      holder.add(m);
    };
    manifestReady.then(() => {
      // The Budget3D HLS splat is opt-in (?hlsSplat=1): Spark froze headless
      // Chrome (SwiftShader) once the splat was on screen in the app, so it
      // stays off until it has been checked on a real GPU.
      const splatSlot = `${slot}Splat`;
      if (manifest[splatSlot]?.file && new URLSearchParams(window.location.search).get('hlsSplat') === '1') {
        manifest[slot] = manifest[splatSlot];
      }
      if (!manifest[slot]?.file) return useFallback();
      if (manifest[slot].type === 'splat') {
        return loadSplat(slot, holder).catch((error) => {
          console.warn(`Splat model ${slot} unavailable, using the procedural fallback`, error);
          useFallback();
        });
      }
      return loadGlb(slot).then((model) => {
        const copy = model.clone();
        if (concept) copy.traverse((o) => { if (o.isMesh) o.material = tintedConcept(o.material); });
        holder.add(copy);
      }).catch((error) => {
        console.warn(`Lander model ${slot} unavailable, using the procedural fallback`, error);
        useFallback();
      });
    });
    return holder;
  }

  // One entry per site with coordinates.
  const entries = [];
  let artemisIndex = 0;
  for (const row of sites) {
    const type = classify(row);
    if (!type) continue;
    const lat = Number.parseFloat(row.lat);
    const lon = Number.parseFloat(row.lon);
    const up = new THREE.Vector3();
    terrain.directionFromLatLon(lat, lon, up);
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
    if (north.lengthSq() < 1e-8) north.set(1, 0, 0).addScaledVector(up, -up.x);
    north.normalize();
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    const basis = new THREE.Matrix4().makeBasis(east, up, north.clone().negate());
    const entry = {
      id: row.id, name: row.name, type, lat, lon, up, east, north,
      quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
      variant: type === 'artemis' ? (artemisIndex++ % 2 === 0 ? 'hls' : 'bluemoon') : null,
      anchor: null, parts: [], built: false, radiusM: 6, seatedAt: -1, pinRadius: 1,
    };
    entries.push(entry);
  }

  // Pins: one instanced mesh, constant screen size, unlit.
  const pinGeometry = (() => {
    const b = new Builder();
    b.cyl(0.07, 0.07, 0.75, 0xffffff, [0, 0.375, 0], 5);
    b.add(new THREE.OctahedronGeometry(0.3), 0xffffff, [0, 1.0, 0]);
    return b.build();
  })();
  const pins = new THREE.InstancedMesh(pinGeometry, new THREE.MeshBasicMaterial({ vertexColors: true }), entries.length);
  pins.frustumCulled = false;
  pins.name = 'lander-pins';
  entries.forEach((e, i) => pins.setColorAt(i, new THREE.Color(PIN_COLORS[e.type])));
  if (pins.instanceColor) pins.instanceColor.needsUpdate = true;
  group.add(pins);

  function addPart(entry, object, x, z, radius, concept = false) {
    // x = metres east, z = metres north of the site coordinate.
    const holder = new THREE.Group();
    holder.position.set(x, 0, -z);
    holder.add(object);
    entry.anchor.add(holder);
    entry.parts.push({ holder, x, z, radius });
    entry.seatedAt = -1;
  }
  const conceptTints = new Map();
  function tintedConcept(material) {
    if (!conceptTints.has(material)) {
      const m = material.clone();
      if (m.emissive) { m.emissive.set(0x0b3a4a); m.emissiveIntensity = 1; }
      conceptTints.set(material, m);
    }
    return conceptTints.get(material);
  }
  const mesh = (name, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(procedural(name), materials.real);
    m.scale.set(sx, sy, sz);
    m.frustumCulled = false;
    return m;
  };

  function build(entry) {
    entry.built = true;
    entry.anchor = new THREE.Group();
    entry.anchor.name = `lander-${entry.id}`;
    entry.anchor.quaternion.copy(entry.quaternion);
    entry.anchor.matrixAutoUpdate = true;
    group.add(entry.anchor);
    const put = (slot, x, z, concept = false) => addPart(entry, slotObject(slot, concept), x, z, slotRadius(slot));
    if (entry.type === 'apollo') {
      entry.radiusM = 5;
      put('apolloLM', 0, 0);
      if (LRV_SITES.has(entry.id)) put('apolloLRV', 14, -9);
    } else if (entry.type === 'robotic') {
      const slot = LANDER_SLOT.find(([re]) => re.test(entry.id))?.[1] || 'genericLander';
      entry.radiusM = slotRadius(slot);
      put(slot, 0, 0);
      if (ROVER_SLOT[entry.id]) put(ROVER_SLOT[entry.id], 6, 4);
    } else {
      entry.radiusM = entry.variant === 'hls' ? 25 : 8;
      if (entry.variant === 'hls') put('starshipHLS', 0, 0, true);
      else {
        put('blueMoonMK2', 0, 0, true);
        put('blueMoonMK1', -32, 16, true);
      }
      put('habitat', 42, 8, true);
      put('solarTower', 58, 24, true);
      put('solarTower', 62, 17, true);
      put('pressurizedRover', 34, -12, true);
    }
  }

  // Seat the anchor and each part on the terrain. Each part sits at the lowest
  // terrain point under its footprint, so no leg floats.
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  function surfaceAt(entry, x, z) {
    tmp.copy(entry.up)
      .addScaledVector(entry.east, x / R)
      .addScaledVector(entry.north, z / R);
    return terrain.surfaceRadius(tmp);
  }
  function seat(entry) {
    const base = terrain.surfaceRadius(entry.up);
    entry.baseRadius = base;
    if (!entry.anchor) return;
    entry.anchor.position.copy(entry.up).multiplyScalar(base);
    entry.anchor.scale.setScalar(1 / R);
    for (const part of entry.parts) {
      const r = part.radius * 0.8;
      let lowest = surfaceAt(entry, part.x, part.z);
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        lowest = Math.min(lowest, surfaceAt(entry, part.x + dx, part.z + dz));
      }
      part.holder.position.y = (lowest - base) * R - 0.05;
    }
  }

  let visible = true;
  let frame = 0;
  let lastRelief = null;
  let lastDems = null;
  const dummy = new THREE.Object3D();
  const camLocal = new THREE.Vector3();

  function update(camera) {
    if (!visible) return;
    frame++;
    const relief = terrain.relief;
    const dems = terrain.stats?.().dems;
    const reseatAll = relief !== lastRelief || dems !== lastDems || frame % 120 === 0;
    lastRelief = relief;
    lastDems = dems;
    const pxHigh = Math.max(canvas.clientHeight || 700, 1);
    const pxPerRad = pxHigh / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (reseatAll || e.baseRadius === undefined) seat(e);
      tmp2.copy(e.up).multiplyScalar(e.baseRadius);
      const dist = Math.max(camera.position.distanceTo(tmp2), 1e-9);
      const distM = dist * R;
      const modelPx = (e.radiusM * 2 / distM) * pxPerRad;
      if (!e.built && distM < LOAD_KM * 1000) { build(e); seat(e); }
      const showModel = e.built && modelPx >= MODEL_MIN_PX && distM < LOAD_KM * 1000;
      if (e.anchor) {
        e.anchor.visible = showModel;
        if (showModel) {
          // Hide a part the camera is standing inside (site views put the eye
          // at the catalog coordinate, which is where the lander is).
          camLocal.copy(camera.position).sub(tmp2).multiplyScalar(R);
          for (const part of e.parts) {
            const px = e.east.dot(camLocal) - part.x;
            const pz = e.north.dot(camLocal) - part.z;
            const h = Math.hypot(px, pz);
            part.holder.visible = !(h < part.radius * 0.9 && e.up.dot(camLocal) < part.radius * 2.5);
          }
        }
      }
      const showPin = !showModel || modelPx < PIN_HIDE_PX;
      const pinScale = showPin ? (PIN_PX / pxPerRad) * dist : 0;
      dummy.position.copy(tmp2);
      dummy.quaternion.copy(e.quaternion);
      dummy.scale.setScalar(Math.max(pinScale, 1e-12));
      dummy.updateMatrix();
      pins.setMatrixAt(i, dummy.matrix);
    }
    pins.instanceMatrix.needsUpdate = true;
  }

  function setVisible(on) {
    visible = Boolean(on);
    group.visible = visible;
  }

  return { group, update, renderSplats, setVisible, get visible() { return visible; }, entries };
}

// Small self-contained toggle (checkbox + "L" key). Devin can move this into
// the layers menu later: it only calls overlay.setVisible().
export function createLanderToggle(container, overlay) {
  const label = document.createElement('label');
  label.className = 'lander-toggle';
  label.title = 'Show 3D lander models at landing sites (L). Artemis models are concepts, not real hardware.';
  label.style.cssText = 'position:absolute;z-index:2;left:0.85rem;bottom:5.6rem;display:flex;align-items:center;gap:0.4rem;'
    + 'padding:0.35rem 0.6rem;border:1px solid #333948;border-radius:8px;background:#10141de8;color:#e5e8ef;'
    + 'font:0.8rem system-ui,sans-serif;backdrop-filter:blur(8px);cursor:pointer;';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = overlay.visible;
  label.append(box, document.createTextNode('Lander models (L) · cyan = Artemis concept'));
  box.addEventListener('change', () => overlay.setVisible(box.checked));
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyL' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const t = event.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName))) return;
    if (document.pointerLockElement) return; // free flight owns the keyboard
    box.checked = !box.checked;
    overlay.setVisible(box.checked);
  });
  container.append(label);
  return label;
}
