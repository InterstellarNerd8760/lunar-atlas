import * as THREE from 'three';

// Cube-sphere quadtree. Each of the six faces is a grid of tiles projected onto
// the 1737.4 km sphere, so the poles are ordinary face centers instead of a
// pinched UV seam. Tiles split on screen-space error. A skirt closes cracks
// between levels. Vertex positions are stored relative to the tile center
// (computed in float64) and the depth buffer is logarithmic, so an eye-level
// view does not z-fight or jitter.
//
// Geometry builds are capped per frame on the main thread. A worker would have
// to hold the same multi-megabyte DEMs; two 33×33 tiles a frame stays under a
// few milliseconds and keeps the DEM blend on one code path.

const RADIUS = 1_737_400;
const INV_R = 1 / RADIUS;
const GRID = 32;
const STRIDE = GRID + 1;
const SKIRT_COUNT = GRID * 4;
const VERTS = STRIDE * STRIDE + SKIRT_COUNT;
const MAX_LEVEL = 18;
const MAX_LEAVES = 210;
const PIXEL_TARGET = 8;
// Coarse global postings are still meshed down to this spacing so the horizon
// stays a curve when the camera is low and the only DEM is LOLA 16.
const SMOOTH_FLOOR_M = 36;

const FACES = new Float32Array([
  // uAxis, vAxis, origin — point = origin + uAxis * u + vAxis * v, u,v in [-1, 1]
  0, 0, -1, 0, 1, 0, 1, 0, 0, // +X
  0, 0, 1, 0, 1, 0, -1, 0, 0, // -X
  1, 0, 0, 0, 0, -1, 0, 1, 0, // +Y
  1, 0, 0, 0, 0, 1, 0, -1, 0, // -Y
  1, 0, 0, 0, 1, 0, 0, 0, 1, // +Z
  -1, 0, 0, 0, 1, 0, 0, 0, -1, // -Z
]);

const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aDir;
attribute vec3 aNormal;
attribute float aHeight;
uniform float uRelief;
uniform float uInvRadius;
uniform vec3 uOriginDir;
uniform float uOriginHeight;
varying vec3 vNormal;
varying vec3 vDir;
varying vec3 vLocal;
varying vec3 vView;
void main() {
  float extra = (uRelief - 1.0) * uInvRadius;
  vec3 local = position + aDir * (aHeight * extra) - uOriginDir * (uOriginHeight * extra);
  float nd = dot(aNormal, aDir);
  vec3 tilt = aNormal - aDir * nd;
  float slope = length(tilt);
  float t = uRelief * slope / max(nd, 0.08);
  float inv = inversesqrt(1.0 + t * t);
  vNormal = normalize(aDir * inv + (slope > 1e-5 ? tilt * ((t * inv) / slope) : vec3(0.0)));
  vDir = aDir;
  vLocal = local;
  vec4 viewPos = modelViewMatrix * vec4(local, 1.0);
  vView = viewPos.xyz;
  gl_Position = projectionMatrix * viewPos;
  #include <logdepthbuf_vertex>
}
`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vNormal;
varying vec3 vDir;
varying vec3 vLocal;
varying vec3 vView;
uniform vec3 uOriginDir;
uniform float uRadius;
uniform vec3 uSunView;
uniform vec3 uEarthView;
uniform float uEarthshine;
uniform sampler2D uAlbedo;
uniform sampler2D uPolarS;
uniform sampler2D uPolarN;
uniform float uHasAlbedo;
uniform float uHasPolar;

#define POLE_RHO 0.245575

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

vec3 equirectColor(vec3 dir) {
  float lon = atan(-dir.z, dir.x);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(lon * 0.159154943092 + 0.5, lat * 0.318309886184 + 0.5);
  return texture2D(uAlbedo, uv).rgb;
}

vec3 polarColor(vec3 dir, float south) {
  float cosC = south > 0.5 ? -dir.y : dir.y;
  float c = acos(clamp(cosC, -1.0, 1.0));
  if (c > 0.25) return vec3(-1.0);
  float rho = 2.0 * tan(c * 0.5);
  vec2 horiz = dir.xz;
  float hlen = length(horiz);
  vec2 n = hlen > 1e-5 ? horiz / hlen : vec2(1.0, 0.0);
  vec2 uv = n * (rho / POLE_RHO) * 0.5 + 0.5;
  vec3 southColor = texture2D(uPolarS, uv).rgb;
  vec3 northColor = texture2D(uPolarN, uv).rgb;
  return south > 0.5 ? southColor : northColor;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  vec3 albedo = vec3(0.50, 0.49, 0.47);
  if (uHasAlbedo > 0.5) {
    vec3 equirect = sRGBTransferEOTF(vec4(equirectColor(dir), 1.0)).rgb;
    albedo = equirect;
    if (uHasPolar > 0.5) {
      float lat = degrees(asin(dir.y));
      if (lat < -78.0) {
        vec3 polar = polarColor(dir, 1.0);
        if (polar.r >= 0.0) {
          polar = sRGBTransferEOTF(vec4(polar, 1.0)).rgb;
          albedo = mix(equirect, polar, smoothstep(-78.0, -83.0, lat));
        }
      } else if (lat > 78.0) {
        vec3 polar = polarColor(dir, 0.0);
        if (polar.r >= 0.0) {
          polar = sRGBTransferEOTF(vec4(polar, 1.0)).rgb;
          albedo = mix(equirect, polar, smoothstep(78.0, 83.0, lat));
        }
      }
    }
  }

  vec3 east = cross(vec3(0.0, 1.0, 0.0), dir);
  float eastLen = length(east);
  east = eastLen > 1e-4 ? east / eastLen : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(dir, east);
  vec2 st = vec2(dot(vLocal, east), dot(vLocal, north)) * uRadius;
  st += vec2(atan(uOriginDir.z, uOriginDir.x), asin(clamp(uOriginDir.y, -1.0, 1.0))) * uRadius;

  float distM = length(vView) * uRadius;
  // Drop the grain before it aliases into a horizon checkerboard.
  float detail = 1.0 - smoothstep(180.0, 1100.0, distM);
  float grain = vnoise(st * 0.55);
  albedo *= mix(1.0, 0.88 + 0.22 * grain, detail);

  vec3 N = normalize(mat3(viewMatrix) * normalize(vNormal));
  if (detail > 0.02) {
    float e = 0.6;
    float dx = vnoise(st * 0.55 + vec2(e, 0.0)) - grain;
    float dy = vnoise(st * 0.55 + vec2(0.0, e)) - grain;
    vec3 eastV = normalize(mat3(viewMatrix) * east);
    vec3 northV = normalize(mat3(viewMatrix) * north);
    N = normalize(N + (eastV * dx + northV * dy) * detail * 0.85);
  }

  vec3 V = normalize(-vView);
  vec3 L = normalize(uSunView);
  vec3 E = normalize(uEarthView);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 0.045);
  float nde = max(dot(N, E), 0.0);
  // Lommel-Seeliger: bright limbs, dark terminator, no broad Lambert fill.
  float sunTerm = ndl / (ndl + ndv);
  float earthTerm = nde / (nde + ndv);
  vec3 color = albedo * (
    sunTerm * vec3(1.85, 1.76, 1.58) +
    earthTerm * vec3(0.45, 0.58, 0.95) * uEarthshine +
    vec3(0.022, 0.024, 0.030)
  );
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const bakeVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const bakeFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uMap;
uniform float uSouth;
const float POLE_RHO = 0.245575;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * POLE_RHO;
  float rho = length(p);
  float c = 2.0 * atan(rho * 0.5);
  float s = sin(c);
  float y = uSouth > 0.5 ? -cos(c) : cos(c);
  vec2 n = rho > 1e-6 ? p / rho : vec2(1.0, 0.0);
  vec3 dir = vec3(n.x * s, y, n.y * s);
  float lon = atan(-dir.z, dir.x);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(lon * 0.159154943092 + 0.5, lat * 0.318309886184 + 0.5);
  gl_FragColor = texture2D(uMap, uv);
}
`;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function cubeDir(face, u, v, out) {
  const o = face * 9;
  const x = FACES[o + 6] + FACES[o] * u + FACES[o + 3] * v;
  const y = FACES[o + 7] + FACES[o + 1] * u + FACES[o + 4] * v;
  const z = FACES[o + 8] + FACES[o + 2] * u + FACES[o + 5] * v;
  const len = Math.hypot(x, y, z);
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
}

function tileEdgeMeters(level) {
  // Parameter width is 2^(1-level); the sphere scale is ~1 at a face center.
  return (2 ** (1 - level)) * RADIUS * 0.82;
}

function directionFromLatLon(latDeg, lonDeg, out) {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const c = Math.cos(lat);
  out[0] = c * Math.cos(lon);
  out[1] = Math.sin(lat);
  out[2] = -c * Math.sin(lon);
}

function latLonFromDirection(x, y, z) {
  return [
    Math.asin(Math.max(-1, Math.min(1, y))) * 180 / Math.PI,
    Math.atan2(-z, x) * 180 / Math.PI,
  ];
}

function stereoForward(x, y, z) {
  // South-polar stereographic, true scale at the pole. Matches the PGDA grids
  // and the 80 m LOLA overview: +x easting, +y northing, meters.
  const t = (1 + y) / (1 - y);
  const scale = (1 + t) * RADIUS;
  return [-z * scale, x * scale];
}

function sampleGrid(grid, x, y) {
  const { data, width, height, west, north, pw, ph, wrapX } = grid;
  let fx = (x - west) / pw - 0.5;
  let fy = (y - north) / ph - 0.5;
  if (wrapX) {
    fx = ((fx % width) + width) % width;
  } else if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) {
    return Number.NaN;
  }
  if (fy < 0) fy = 0;
  if (fy > height - 1) fy = height - 1;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const x1 = wrapX ? (x0 + 1) % width : Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const v00 = data[y0 * width + (wrapX ? x0 % width : x0)];
  const v10 = data[y0 * width + x1];
  const v01 = data[y1 * width + (wrapX ? x0 % width : x0)];
  const v11 = data[y1 * width + x1];
  let sum = 0;
  let weight = 0;
  const acc = (v, w) => {
    if (v === v) {
      sum += v * w;
      weight += w;
    }
  };
  acc(v00, (1 - tx) * (1 - ty));
  acc(v10, tx * (1 - ty));
  acc(v01, (1 - tx) * ty);
  acc(v11, tx * ty);
  return weight > 0 ? sum / weight : Number.NaN;
}

function makeIndex() {
  const indices = [];
  const gi = (row, col) => row * STRIDE + col;
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const i00 = gi(row, col);
      const i10 = gi(row, col + 1);
      const i01 = gi(row + 1, col);
      const i11 = gi(row + 1, col + 1);
      // cross(du, dv) points outward on every face (see cube-face check).
      indices.push(i00, i10, i01, i10, i11, i01);
    }
  }
  const perim = [];
  for (let col = 0; col < GRID; col++) perim.push(gi(0, col));
  for (let row = 0; row < GRID; row++) perim.push(gi(row, GRID));
  for (let col = GRID; col > 0; col--) perim.push(gi(GRID, col));
  for (let row = GRID; row > 0; row--) perim.push(gi(row, 0));
  const A = [0, 0, 0];
  const B = [0, 0, 0];
  cubeDir(0, -1, -1, A);
  cubeDir(0, -1 + 2 / GRID, -1, B);
  const sA = A.map((v) => v * 0.99);
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const e2 = [sA[0] - A[0], sA[1] - A[1], sA[2] - A[2]];
  const normal = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
  const away = [mid[0] - 1, mid[1], mid[2]];
  const flip = normal[0] * away[0] + normal[1] * away[1] + normal[2] * away[2] < 0;
  const base = STRIDE * STRIDE;
  for (let k = 0; k < perim.length; k++) {
    const k2 = (k + 1) % perim.length;
    const a = perim[k];
    const b = perim[k2];
    const sa = base + k;
    const sb = base + k2;
    if (flip) indices.push(a, sa, b, b, sa, sb);
    else indices.push(a, b, sa, b, sb, sa);
  }
  return new THREE.BufferAttribute(new Uint16Array(indices), 1);
}

function grayTexture() {
  const data = new Uint8Array([140, 138, 132, 255]);
  const texture = new THREE.DataTexture(data, 1, 1);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export async function createTerrain({ scene, renderer, dataDirectory, demCatalog = [] }) {
  const global = await loadRaster(new URL('global-height/global-height', dataDirectory), true);
  if (!global) throw new Error('Global LOLA elevation files are missing from public/data/global-height/.');
  const polar = await loadRaster(new URL('south-pole-lola/south-pole-height', dataDirectory), false);

  const dems = demCatalog.map((site) => prepareDem(site)).filter(Boolean);
  const loaded = [];
  let heightEpoch = 1;
  let relief = 1;
  const pending = new Set();

  const sharedIndex = makeIndex();
  const fallback = grayTexture();
  const uniforms = {
    uRelief: { value: 1 },
    uInvRadius: { value: INV_R },
    uRadius: { value: RADIUS },
    uOriginDir: { value: new THREE.Vector3(1, 0, 0) },
    uOriginHeight: { value: 0 },
    uSunView: { value: new THREE.Vector3(1, 0.2, 0.3) },
    uEarthView: { value: new THREE.Vector3(-1, 0.1, 0.2) },
    uEarthshine: { value: 0.02 },
    uAlbedo: { value: fallback },
    uPolarS: { value: fallback },
    uPolarN: { value: fallback },
    uHasAlbedo: { value: 0 },
    uHasPolar: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true,
  });

  const tiles = new Map();
  const leaves = new Set();
  const queue = [];
  const roots = [];
  const scratch = [0, 0, 0];
  const sunScratch = new THREE.Vector3();
  const earthScratch = new THREE.Vector3();
  let drawn = 0;
  let frame = 0;
  let statsMaxLevel = 0;
  let statsMaxScore = 0;
  let statsNear = '';
  let forcedLevel = -1;

  function sampleMeters(x, y, z) {
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const lon = Math.atan2(-z, x);
    let h = sampleGrid(global, lon * 180 / Math.PI, lat * 180 / Math.PI);
    if (h !== h) h = 0;
    if (polar && y < -0.9) {
      const [px, py] = stereoForward(x, y, z);
      if (px >= polar.west && px <= polar.east && py >= polar.south && py <= polar.north) {
        const hp = sampleGrid(polar, px, py);
        if (hp === hp) {
          const rho = Math.hypot(px, py);
          const w = smoothstep(polar.outer, polar.inner, rho);
          h += (hp - h) * w;
        }
      }
    }
    for (let i = 0; i < loaded.length; i++) {
      h = blendDem(loaded[i], x, y, z, h);
    }
    return h;
  }

  function blendDem(dem, x, y, z, h) {
    let px;
    let py;
    if (dem.polar) {
      if (y > -0.55) return h;
      [px, py] = stereoForward(x, y, z);
    } else {
      const cosC = x * dem.cx + y * dem.cy + z * dem.cz;
      if (cosC <= 0.15) return h;
      const sinC = Math.sqrt(Math.max(0, 1 - cosC * cosC));
      const scale = (sinC > 1e-6 ? Math.acos(Math.min(1, cosC)) / sinC : 1) * RADIUS;
      px = (x * dem.ex + y * dem.ey + z * dem.ez) * scale;
      py = (x * dem.nx + y * dem.ny + z * dem.nz) * scale;
    }
    const edge = Math.min(px - dem.west, dem.east - px, py - dem.south, dem.north - py);
    if (edge <= 0) return h;
    const hs = sampleGrid(dem, px, py);
    if (hs !== hs) return h;
    return h + (hs - h) * smoothstep(0, dem.margin, edge);
  }

  function makeTile(face, level, ix, iy, parent) {
    const denom = 2 ** level;
    const tile = {
      face,
      level,
      ix,
      iy,
      parent,
      u0: -1 + (2 * ix) / denom,
      u1: -1 + (2 * (ix + 1)) / denom,
      v0: -1 + (2 * iy) / denom,
      v1: -1 + (2 * (iy + 1)) / denom,
      children: null,
      split: false,
      geometry: null,
      mesh: null,
      originDir: new THREE.Vector3(),
      originHeight: 0,
      halfAngle: 0,
      visible: true,
      score: 0,
      epoch: 0,
      queued: false,
    };
    cubeDir(face, (tile.u0 + tile.u1) / 2, (tile.v0 + tile.v1) / 2, scratch);
    tile.originDir.set(scratch[0], scratch[1], scratch[2]);
    const centerHeight = sampleMeters(scratch[0], scratch[1], scratch[2]);
    tile.originHeight = centerHeight === centerHeight ? centerHeight : 0;
    const cx = scratch[0];
    const cy = scratch[1];
    const cz = scratch[2];
    let maxAng = 0;
    for (const u of [tile.u0, tile.u1]) {
      for (const v of [tile.v0, tile.v1]) {
        cubeDir(face, u, v, scratch);
        const d = Math.max(-1, Math.min(1, cx * scratch[0] + cy * scratch[1] + cz * scratch[2]));
        maxAng = Math.max(maxAng, Math.acos(d));
      }
    }
    tile.halfAngle = maxAng * 1.02;
    tiles.set(`${face}/${level}/${ix}/${iy}`, tile);
    return tile;
  }

  function surfaceOf(tile) {
    return 1 + (tile.originHeight || 0) * relief * INV_R;
  }

  function visibleFrom(tile, camera) {
    const cam = camera.position;
    const len = Math.max(cam.length(), 1e-6);
    const dot = tile.originDir.dot(cam) / len;
    const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
    const surface = surfaceOf(tile);
    // Basins sit inside the unit sphere, so a camera at eye height can have
    // length < 1. The horizon is measured from the local surface, not r = 1.
    const eye = Math.max(len - surface, 1.5 * INV_R);
    const horizon = len < surface * 1.05
      ? Math.sqrt(2 * eye / Math.max(surface, 0.5))
      : Math.acos(Math.max(-1, Math.min(1, surface / len)));
    return ang < horizon + tile.halfAngle * 1.35 + 0.003;
  }

  function distanceMeters(tile, camera) {
    const cam = camera.position;
    const len = cam.length();
    const surface = surfaceOf(tile);
    const dot = Math.max(-1, Math.min(1, tile.originDir.dot(cam) / Math.max(len, 1e-6)));
    const ang = Math.acos(dot);
    const clamped = Math.max(0, ang - tile.halfAngle);
    const dist = Math.sqrt(Math.max(0, len * len + surface * surface - 2 * len * surface * Math.cos(clamped)));
    return Math.max(dist * RADIUS, 0.5);
  }

  function finestSpacing(tile) {
    let data = global.resolutionM;
    const lat = Math.asin(Math.max(-1, Math.min(1, tile.originDir.y))) * 180 / Math.PI;
    if (polar && lat < -79) data = Math.min(data, polar.resolutionM);
    for (let i = 0; i < loaded.length; i++) {
      const dem = loaded[i];
      if (overlaps(tile, dem)) data = Math.min(data, dem.resolutionM);
    }
    // Oversample a coarse posting so shading stays smooth, but never finer than a real DEM.
    return data <= SMOOTH_FLOOR_M ? data * 0.85 : Math.min(data * 0.9, SMOOTH_FLOOR_M);
  }

  function splitScore(tile, camera) {
    if (forcedLevel >= 0) return tile.level < forcedLevel ? 5 : 0;
    if (!tile.visible || tile.level >= MAX_LEVEL) return 0;
    const spacing = tileEdgeMeters(tile.level) / GRID;
    if (spacing <= finestSpacing(tile)) return 0;
    const dist = distanceMeters(tile, camera);
    const fov = camera.fov * Math.PI / 180;
    const pixelsHigh = Math.max(renderer.domElement.clientHeight || 800, 1);
    const metersPerPixel = dist * 2 * Math.tan(fov * 0.5) / pixelsHigh;
    return (spacing / Math.max(metersPerPixel, 1e-4)) / PIXEL_TARGET;
  }

  function overlaps(tile, dem) {
    const ang = Math.acos(Math.max(-1, Math.min(1, tile.originDir.dot(dem.center))));
    return ang < tile.halfAngle + dem.radiusAngle + 0.01;
  }

  function placeMesh(tile) {
    const scale = 1 + tile.originHeight * relief * INV_R;
    tile.mesh.position.copy(tile.originDir).multiplyScalar(scale);
  }

  function disposeTile(tile) {
    if (!tile.mesh) return;
    scene.remove(tile.mesh);
    tile.geometry.index = null;
    tile.geometry.dispose();
    tile.geometry = null;
    tile.mesh = null;
  }

  function buildTile(tile) {
    const positions = new Float32Array(VERTS * 3);
    const dirs = new Float32Array(VERTS * 3);
    const dir64 = new Float64Array(VERTS * 3);
    const normals = new Float32Array(VERTS * 3);
    const heights = new Float32Array(VERTS);
    const n = GRID;
    for (let row = 0; row <= n; row++) {
      const v = tile.v0 + (tile.v1 - tile.v0) * (row / n);
      for (let col = 0; col <= n; col++) {
        const u = tile.u0 + (tile.u1 - tile.u0) * (col / n);
        cubeDir(tile.face, u, v, scratch);
        const index = row * STRIDE + col;
        dir64[index * 3] = scratch[0];
        dir64[index * 3 + 1] = scratch[1];
        dir64[index * 3 + 2] = scratch[2];
        dirs[index * 3] = scratch[0];
        dirs[index * 3 + 1] = scratch[1];
        dirs[index * 3 + 2] = scratch[2];
        let h = sampleMeters(scratch[0], scratch[1], scratch[2]);
        if (h !== h) h = 0;
        heights[index] = h;
      }
    }
    cubeDir(tile.face, (tile.u0 + tile.u1) / 2, (tile.v0 + tile.v1) / 2, scratch);
    tile.originDir.set(scratch[0], scratch[1], scratch[2]);
    let originH = sampleMeters(scratch[0], scratch[1], scratch[2]);
    if (originH !== originH) originH = 0;
    tile.originHeight = originH;
    const ox = tile.originDir.x * (1 + originH * INV_R);
    const oy = tile.originDir.y * (1 + originH * INV_R);
    const oz = tile.originDir.z * (1 + originH * INV_R);
    // A deep skirt becomes a visible trench. 20 m hides fine-LOD cracks; coarser
// cracks are sub-pixel at the distance where those tiles stay on screen.
// Coarse tiles meet exactly. A skirt there only draws a dark crease.
    const skirt = tile.level < 7 ? 0 : 20;

    const step = Math.max(tileEdgeMeters(tile.level) / GRID, 40) * INV_R;
    const probe = [0, 0, 0];
    for (let row = 0; row <= n; row++) {
      for (let col = 0; col <= n; col++) {
        const index = row * STRIDE + col;
        const dx = dir64[index * 3];
        const dy = dir64[index * 3 + 1];
        const dz = dir64[index * 3 + 2];
        // Geographic slope so normals agree across cube-face borders.
        let ex = dz;
        let ez = -dx;
        let el = Math.hypot(ex, ez);
        if (el < 1e-6) { ex = 1; ez = 0; el = 1; }
        ex /= el;
        ez /= el;
        const nx = dy * ez - dz * 0;
        const ny = dz * ex - dx * ez;
        const nz = dx * 0 - dy * ex;
        const push = (dirx, diry, dirz) => {
          const px = dx + dirx * step;
          const py = dy + diry * step;
          const pz = dz + dirz * step;
          const plen = Math.hypot(px, py, pz);
          probe[0] = px / plen;
          probe[1] = py / plen;
          probe[2] = pz / plen;
          let h = sampleMeters(probe[0], probe[1], probe[2]);
          if (h !== h) h = heights[index];
          return h;
        };
        const slopeE = (push(ex, 0, ez) - heights[index]) / (step * RADIUS);
        const slopeN = (push(nx, ny, nz) - heights[index]) / (step * RADIUS);
        let nnx = dx - ex * slopeE - nx * slopeN;
        let nny = dy - 0 * slopeE - ny * slopeN;
        let nnz = dz - ez * slopeE - nz * slopeN;
        const nl = Math.hypot(nnx, nny, nnz) || 1;
        normals[index * 3] = nnx / nl;
        normals[index * 3 + 1] = nny / nl;
        normals[index * 3 + 2] = nnz / nl;
        const s = 1 + heights[index] * INV_R;
        positions[index * 3] = dir64[index * 3] * s - ox;
        positions[index * 3 + 1] = dir64[index * 3 + 1] * s - oy;
        positions[index * 3 + 2] = dir64[index * 3 + 2] * s - oz;
      }
    }

    const perim = [];
    for (let col = 0; col < n; col++) perim.push(0 * STRIDE + col);
    for (let row = 0; row < n; row++) perim.push(row * STRIDE + n);
    for (let col = n; col > 0; col--) perim.push(n * STRIDE + col);
    for (let row = n; row > 0; row--) perim.push(row * STRIDE + 0);
    for (let k = 0; k < perim.length; k++) {
      const src = perim[k];
      const index = STRIDE * STRIDE + k;
      dirs[index * 3] = dirs[src * 3];
      dirs[index * 3 + 1] = dirs[src * 3 + 1];
      dirs[index * 3 + 2] = dirs[src * 3 + 2];
      normals[index * 3] = normals[src * 3];
      normals[index * 3 + 1] = normals[src * 3 + 1];
      normals[index * 3 + 2] = normals[src * 3 + 2];
      heights[index] = heights[src] - skirt;
      dir64[index * 3] = dir64[src * 3];
      dir64[index * 3 + 1] = dir64[src * 3 + 1];
      dir64[index * 3 + 2] = dir64[src * 3 + 2];
      const s = 1 + heights[index] * INV_R;
      positions[index * 3] = dir64[index * 3] * s - ox;
      positions[index * 3 + 1] = dir64[index * 3 + 1] * s - oy;
      positions[index * 3 + 2] = dir64[index * 3 + 2] * s - oz;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
    geometry.setAttribute('aNormal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
    geometry.setIndex(sharedIndex);
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      2 * Math.sin(Math.min(tile.halfAngle, 1.15)) + skirt * INV_R + 0.002,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = true;
    mesh.onBeforeRender = () => {
      uniforms.uOriginDir.value.copy(tile.originDir);
      uniforms.uOriginHeight.value = tile.originHeight;
    };
    tile.geometry = geometry;
    tile.mesh = mesh;
    tile.epoch = heightEpoch;
    placeMesh(tile);
    scene.add(mesh);
  }

  function canDisplay(tile) {
    if (!tile.visible && !tile.split) return true;
    if (tile.geometry) return true;
    return Boolean(tile.split && tile.children.every(canDisplay));
  }

  const draw = [];
  function collectDraw(tile) {
    if (!tile.visible && !tile.split) return;
    if (tile.split && tile.children.every(canDisplay)) {
      for (let i = 0; i < tile.children.length; i++) collectDraw(tile.children[i]);
      return;
    }
    if (tile.geometry && tile.visible) draw.push(tile);
  }

  function refresh(tile, camera) {
    tile.visible = visibleFrom(tile, camera);
    tile.score = splitScore(tile, camera);
    if (tile.split) {
      for (let i = 0; i < 4; i++) refresh(tile.children[i], camera);
    }
  }

  function enqueue(tile) {
    if (tile.queued || tile.geometry || !tile.visible) return;
    tile.queued = true;
    queue.push(tile);
  }

  function splitOne() {
    let best = null;
    for (const leaf of leaves) {
      if (leaf.score <= 1) continue;
      if (!best || leaf.score > best.score) best = leaf;
    }
    if (!best || leaves.size + 3 > MAX_LEAVES) return;
    if (forcedLevel < 0 && queue.length > 12) return;
    const kids = [0, 1, 2, 3].map((q) => makeTile(
      best.face,
      best.level + 1,
      best.ix * 2 + (q & 1),
      best.iy * 2 + (q >> 1),
      best,
    ));
    best.children = kids;
    best.split = true;
    leaves.delete(best);
    for (let i = 0; i < kids.length; i++) leaves.add(kids[i]);
  }

  function mergePass() {
    const groups = new Map();
    for (const leaf of leaves) {
      if (!leaf.parent) continue;
      const list = groups.get(leaf.parent);
      if (list) list.push(leaf);
      else groups.set(leaf.parent, [leaf]);
    }
    let merged = 0;
    for (const [parent, kids] of groups) {
      if (kids.length !== 4 || kids.some((kid) => kid.split)) continue;
      if (forcedLevel >= 0 && parent.level < forcedLevel) continue;
      if (!kids.every((kid) => kid.score < 0.58)) continue;
      for (let i = 0; i < kids.length; i++) {
        const kid = kids[i];
        leaves.delete(kid);
        disposeTile(kid);
        tiles.delete(`${kid.face}/${kid.level}/${kid.ix}/${kid.iy}`);
      }
      parent.children = null;
      parent.split = false;
      leaves.add(parent);
      merged++;
      if (merged > 12) break;
    }
  }

  function stale(tile) {
    if (!tile.geometry || tile.epoch === heightEpoch) return false;
    for (let i = 0; i < loaded.length; i++) {
      if (loaded[i].epoch > tile.epoch && overlaps(tile, loaded[i])) return true;
    }
    return false;
  }

  for (let face = 0; face < 6; face++) {
    const root = makeTile(face, 0, 0, 0, null);
    roots.push(root);
    leaves.add(root);
    buildTile(root);
  }

  function considerLoads(camera) {
    const cam = camera.position;
    let nearest = null;
    let nearestDist = Infinity;
    for (let i = 0; i < dems.length; i++) {
      const dem = dems[i];
      const dist = cam.distanceTo(dem.center) * RADIUS;
      if (!dem.pinned && dist < nearestDist) {
        nearest = dem;
        nearestDist = dist;
      }
      if (dem.pinned && !dem.data && !dem.loading) {
        dem.loading = fetchDem(dem).finally(() => {
          dem.loading = null;
        });
      }
    }
    // One nearby DEM besides the selected site. Several south-pole grids sit
    // inside the same 160 km, and each one is 16–40 MB.
    if (nearest && nearestDist < 180_000 && !nearest.data && !nearest.loading) {
      nearest.loading = fetchDem(nearest).finally(() => {
        nearest.loading = null;
      });
    }
    if (loaded.length > 2) {
      const ranked = loaded.slice().sort((a, b) => cam.distanceTo(b.center) - cam.distanceTo(a.center));
      while (loaded.length > 2) {
        const drop = ranked.find((dem) => !dem.pinned && loaded.includes(dem));
        if (!drop) break;
        drop.data = null;
        loaded.splice(loaded.indexOf(drop), 1);
        ranked.splice(ranked.indexOf(drop), 1);
        heightEpoch++;
      }
    }
  }

  async function fetchDem(dem) {
    pending.add(dem);
    try {
      const base = new URL(`site-dems/${dem.file}`, dataDirectory);
      const metaUrl = new URL(base.href.replace(/\.f32$/, '.json'));
      const [buffer, meta] = await Promise.all([
        fetch(base).then((response) => {
          if (!response.ok) throw new Error(`DEM ${dem.id} failed`);
          return response.arrayBuffer();
        }),
        fetch(metaUrl).then((response) => response.json()),
      ]);
      if (buffer.byteLength !== meta.width * meta.height * 4) throw new Error(`DEM ${dem.id} size mismatch`);
      dem.width = meta.width;
      dem.height = meta.height;
      dem.data = new Float32Array(buffer);
      dem.west = meta.extentM[0];
      dem.south = meta.extentM[1];
      dem.east = meta.extentM[2];
      dem.north = meta.extentM[3];
      dem.pw = meta.affine[0];
      dem.ph = meta.affine[4];
      dem.resolutionM = meta.resolutionM || dem.resolutionM;
      const span = Math.max(dem.east - dem.west, dem.north - dem.south);
      dem.margin = Math.min(Math.max(span * 0.16, 80), 2000);
      dem.polar = /stereographic/i.test(meta.projection || '');
      if (!dem.polar) bindAeqd(dem, meta.centerLatLon || dem.centerLatLon);
      dem.epoch = ++heightEpoch;
      if (!loaded.includes(dem)) loaded.push(dem);
      loaded.sort((a, b) => b.resolutionM - a.resolutionM);
    } catch (error) {
      console.warn(error);
    } finally {
      pending.delete(dem);
    }
  }

  function update(camera, lighting) {
    frame++;
    uniforms.uRelief.value = relief;
    if (lighting) {
      sunScratch.copy(lighting.sun).transformDirection(camera.matrixWorldInverse);
      earthScratch.copy(lighting.earth).transformDirection(camera.matrixWorldInverse);
      uniforms.uSunView.value.copy(sunScratch);
      uniforms.uEarthView.value.copy(earthScratch);
      uniforms.uEarthshine.value = 0.07 * lighting.earthshine;
    }
    considerLoads(camera);
    const camLen = camera.position.length();
    if (camLen > 1.7) {
      const distM = (camLen - 1) * RADIUS;
      const fov = camera.fov * Math.PI / 180;
      const pixelsHigh = Math.max(renderer.domElement.clientHeight || 700, 1);
      const spacingWanted = distM * 2 * Math.tan(fov / 2) / pixelsHigh * PIXEL_TARGET;
      let level = 0;
      while (level < 4 && tileEdgeMeters(level) / GRID > spacingWanted) level++;
      forcedLevel = level;
    } else {
      forcedLevel = -1;
    }
    for (const root of roots) refresh(root, camera);
    mergePass();
    for (const root of roots) refresh(root, camera);
    const splitBudget = forcedLevel >= 0 ? 8 : 1;
    for (let i = 0; i < splitBudget; i++) splitOne();
    for (const leaf of leaves) {
      leaf.visible = visibleFrom(leaf, camera);
      leaf.score = splitScore(leaf, camera);
      if (stale(leaf)) {
        disposeTile(leaf);
        leaf.epoch = 0;
      }
      enqueue(leaf);
    }
    queue.sort((a, b) => a.score - b.score);
    const budget = frame < 10 ? 4 : 3;
    let built = 0;
    while (built < budget && queue.length) {
      const tile = queue.pop();
      tile.queued = false;
      if (!leaves.has(tile) || tile.geometry || !tile.visible) continue;
      buildTile(tile);
      built++;
    }
    draw.length = 0;
    for (const root of roots) collectDraw(root);
    const show = new Set(draw);
    for (const tile of tiles.values()) {
      if (tile.mesh) tile.mesh.visible = show.has(tile);
    }
    for (const tile of show) placeMesh(tile);
    drawn = show.size;
    let maxLevel = 0;
    let maxScore = 0;
    let nearest = Infinity;
    let nearestInfo = '';
    for (const leaf of leaves) {
      if (leaf.level > maxLevel) maxLevel = leaf.level;
      if (leaf.score > maxScore) maxScore = leaf.score;
      const dist = distanceMeters(leaf, camera);
      if (dist < nearest) {
        nearest = dist;
        nearestInfo = `${leaf.level}/${leaf.visible ? 1 : 0}/${leaf.score.toFixed(1)}/${Math.round(dist)}`;
      }
    }
    statsMaxLevel = maxLevel;
    statsMaxScore = maxScore;
    statsNear = nearestInfo;
  }

  function setRelief(next) {
    relief = next;
    uniforms.uRelief.value = next;
    for (const tile of tiles.values()) {
      if (tile.mesh) placeMesh(tile);
    }
  }

  function setAlbedo(texture) {
    if (!texture) return;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    uniforms.uAlbedo.value = texture;
    uniforms.uHasAlbedo.value = 1;
    bakePoles(texture);
  }

  function bakePoles(texture) {
    const previousTarget = renderer.getRenderTarget();
    const previousTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    const bakeMaterial = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uSouth: { value: 1 } },
      vertexShader: bakeVert,
      fragmentShader: bakeFrag,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMaterial);
    const bakeScene = new THREE.Scene();
    bakeScene.add(quad);
    const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const makeTarget = () => {
      const target = new THREE.WebGLRenderTarget(1024, 1024, {
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: true,
        depthBuffer: false,
        stencilBuffer: false,
      });
      target.texture.colorSpace = THREE.LinearSRGBColorSpace;
      target.texture.wrapS = THREE.ClampToEdgeWrapping;
      target.texture.wrapT = THREE.ClampToEdgeWrapping;
      return target;
    };
    const south = makeTarget();
    const north = makeTarget();
    renderer.setRenderTarget(south);
    renderer.render(bakeScene, bakeCamera);
    bakeMaterial.uniforms.uSouth.value = 0;
    renderer.setRenderTarget(north);
    renderer.render(bakeScene, bakeCamera);
    renderer.setRenderTarget(previousTarget);
    renderer.toneMapping = previousTone;
    quad.geometry.dispose();
    bakeMaterial.dispose();
    uniforms.uPolarS.value = south.texture;
    uniforms.uPolarN.value = north.texture;
    uniforms.uHasPolar.value = 1;
  }

  function preloadSite(id) {
    const dem = dems.find((entry) => entry.id === id);
    if (!dem) return Promise.resolve(false);
    dem.pinned = true;
    for (const other of dems) {
      if (other !== dem) other.pinned = false;
    }
    if (dem.data) return Promise.resolve(true);
    if (!dem.loading) dem.loading = fetchDem(dem).finally(() => { dem.loading = null; });
    return dem.loading.then(() => true);
  }

  function surfaceRadius(position) {
    const len = position.length() || 1;
    const h = sampleMeters(position.x / len, position.y / len, position.z / len);
    return 1 + h * relief * INV_R;
  }

  function raycast(origin, direction) {
    const o = origin;
    const d = direction;
    const maxR = 1.012 + 12000 * Math.max(relief, 1) * INV_R;
    const minR = 0.985;
    const enter = raySphere(o, d, maxR);
    if (!enter) return null;
    const exit = raySphere(o, d, minR);
    let lo = Math.max(enter.tEnter, 0);
    let hi = exit ? Math.max(exit.tExit, lo + 1e-4) : enter.tExit;
    const f = (t) => {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const len = Math.hypot(x, y, z);
      if (len < 1e-6) return -1;
      return len - (1 + sampleMeters(x / len, y / len, z / len) * relief * INV_R);
    };
    if (f(lo) <= 0) return new THREE.Vector3(o.x + d.x * lo, o.y + d.y * lo, o.z + d.z * lo);
    if (f(hi) > 0) return null;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid;
      else hi = mid;
    }
    return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
  }

  return {
    update,
    setRelief,
    setAlbedo,
    preloadSite,
    setWireframe(on) { material.wireframe = Boolean(on); },
    surfaceRadius,
    raycast,
    sampleMeters(direction) {
      const len = direction.length() || 1;
      return sampleMeters(direction.x / len, direction.y / len, direction.z / len);
    },
    directionFromLatLon(lat, lon, target) {
      directionFromLatLon(lat, lon, scratch);
      target.set(scratch[0], scratch[1], scratch[2]);
    },
    latLonFromDirection,
    get relief() { return relief; },
    stats() {
      return {
        tiles: drawn,
        leaves: leaves.size,
        queue: queue.length,
        dems: loaded.length,
        pendingDems: pending.size,
        relief,
        maxLevel: statsMaxLevel,
        maxScore: Number(statsMaxScore.toFixed(2)),
        near: statsNear,
      };
    },
  };
}

function raySphere(origin, direction, radius) {
  const b = origin.dot(direction);
  const c = origin.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return { tEnter: -b - s, tExit: -b + s };
}

async function loadRaster(base, required) {
  const metaResponse = await fetch(new URL(`${base.pathname}.json`, base));
  const dataResponse = await fetch(new URL(`${base.pathname}.f32`, base));
  if (!metaResponse.ok || !dataResponse.ok) {
    if (required) return null;
    return null;
  }
  const meta = await metaResponse.json();
  const buffer = await dataResponse.arrayBuffer();
  if (buffer.byteLength !== meta.width * meta.height * 4) {
    throw new Error(`${base.pathname} does not match its metadata.`);
  }
  const extent = meta.extentM || [
    meta.affine[2],
    meta.affine[5] + meta.affine[4] * meta.height,
    meta.affine[2] + meta.affine[0] * meta.width,
    meta.affine[5],
  ];
  const grid = {
    data: new Float32Array(buffer),
    width: meta.width,
    height: meta.height,
    west: meta.affine[2],
    north: meta.affine[5],
    pw: meta.affine[0],
    ph: meta.affine[4],
    south: Math.min(extent[1], extent[3]),
    east: Math.max(extent[0], extent[2]),
    wrapX: Boolean(meta.globalExtentDegrees),
    resolutionM: meta.globalExtentDegrees
      ? Math.abs(meta.affine[4]) * (Math.PI / 180) * RADIUS
      : Math.abs(meta.affine[0]),
    outer: 0,
    inner: 0,
  };
  if (!grid.wrapX && /stereographic|polar/i.test(meta.projection || meta.crsWkt || '')) {
    const span = Math.max(grid.east - grid.west, grid.north - grid.south);
    grid.outer = span * 0.5;
    grid.inner = grid.outer - Math.max(grid.resolutionM * 24, 18_000);
  }
  return grid;
}

function prepareDem(site) {
  if (!site.file || !site.centerLatLon) return null;
  const [lat, lon] = site.centerLatLon;
  const centerArr = [0, 0, 0];
  directionFromLatLon(lat, lon, centerArr);
  const center = new THREE.Vector3(centerArr[0], centerArr[1], centerArr[2]);
  const span = (site.width || 1) * (site.resolutionM || 5);
  return {
    id: site.id,
    file: site.file,
    resolutionM: site.resolutionM || 5,
    centerLatLon: site.centerLatLon,
    center,
    radiusAngle: (span * 0.75) / RADIUS + 0.004,
    span,
    polar: site.group === 'pgda-lola-5m',
    data: null,
    loading: null,
    pinned: false,
    epoch: 0,
    margin: 400,
    west: 0,
    south: 0,
    east: 0,
    north: 0,
    pw: 1,
    ph: -1,
    width: site.width,
    height: site.height,
  };
}

function bindAeqd(dem, centerLatLon) {
  const [latDeg, lonDeg] = centerLatLon;
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const cosLat = Math.cos(lat);
  dem.cx = cosLat * Math.cos(lon);
  dem.cy = Math.sin(lat);
  dem.cz = -cosLat * Math.sin(lon);
  dem.ex = -Math.sin(lon);
  dem.ey = 0;
  dem.ez = -Math.cos(lon);
  // north = center × east
  dem.nx = dem.cy * dem.ez - dem.cz * dem.ey;
  dem.ny = dem.cz * dem.ex - dem.cx * dem.ez;
  dem.nz = dem.cx * dem.ey - dem.cy * dem.ex;
  dem.center.set(dem.cx, dem.cy, dem.cz);
}
