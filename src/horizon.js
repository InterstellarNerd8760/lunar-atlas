// Terrain horizon and Sun/Earth visibility for one surface point.
// Pure math with no DOM or three.js dependency so it can be tested in Node.

export const MOON_RADIUS_M = 1_737_400;
const DEG = 180 / Math.PI;

// Distances (m) sampled along each azimuth ray: fine near the observer,
// then growing ~1.5% per step out to maxM.
function rayDistances(minStepM, maxM) {
  const out = [];
  for (let d = minStepM * 1.5; d <= maxM; d += Math.max(minStepM, d * 0.015)) out.push(d);
  return out;
}

export function localFrame(up) {
  const [ux, uy, uz] = up;
  let nx = -uy * ux, ny = 1 - uy * uy, nz = -uy * uz;
  let len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) { nx = 1 - ux * ux; ny = -ux * uy; nz = -ux * uz; len = Math.hypot(nx, ny, nz); }
  nx /= len; ny /= len; nz /= len;
  // east = north × up (matches visibility.js and sky.js azimuths)
  const ex = ny * uz - nz * uy, ey = nz * ux - nx * uz, ez = nx * uy - ny * ux;
  return { north: [nx, ny, nz], east: [ex, ey, ez] };
}

/**
 * 360° terrain horizon around `up` (unit vector, Moon-fixed scene frame).
 * sample(x, y, z) returns height in meters above the 1737.4 km sphere.
 * Returns elevation of the skyline in degrees for `bins` azimuths
 * (bin i is centered on azimuth i * 360 / bins, clockwise from north).
 */
export function horizonProfile(sample, up, { bins = 360, maxM = 150_000, minStepM = 200, observerM = 2 } = {}) {
  const R = MOON_RADIUS_M;
  const { north, east } = localFrame(up);
  const h0 = (sample(up[0], up[1], up[2]) || 0) + observerM;
  const ro = R + h0;
  const distances = rayDistances(minStepM, maxM);
  const cosT = distances.map((d) => Math.cos(d / R));
  const sinT = distances.map((d) => Math.sin(d / R));
  const elevation = new Float32Array(bins);
  const distance = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    const az = (b / bins) * 2 * Math.PI;
    const ca = Math.cos(az), sa = Math.sin(az);
    const hx = north[0] * ca + east[0] * sa;
    const hy = north[1] * ca + east[1] * sa;
    const hz = north[2] * ca + east[2] * sa;
    let best = -Math.PI / 2;
    let bestD = 0;
    for (let k = 0; k < distances.length; k++) {
      const c = cosT[k], s = sinT[k];
      const x = up[0] * c + hx * s, y = up[1] * c + hy * s, z = up[2] * c + hz * s;
      const h = sample(x, y, z);
      if (!(h === h)) continue;
      const r = R + h;
      const angle = Math.atan2(r * c - ro, r * s);
      if (angle > best) { best = angle; bestD = distances[k]; }
    }
    elevation[b] = best * DEG;
    distance[b] = bestD;
  }
  return { bins, elevation, distance, observerHeightM: h0, maxM };
}

export function horizonAt(profile, azimuthDeg) {
  if (!profile) return 0;
  const { bins, elevation } = profile;
  const f = ((((azimuthDeg % 360) + 360) % 360) / 360) * bins;
  const i0 = Math.floor(f) % bins;
  const i1 = (i0 + 1) % bins;
  const t = f - Math.floor(f);
  return elevation[i0] + (elevation[i1] - elevation[i0]) * t;
}

function bodyAngles(body, up, north, east) {
  let dx = body.x - up[0], dy = body.y - up[1], dz = body.z - up[2];
  const len = Math.hypot(dx, dy, dz);
  dx /= len; dy /= len; dz /= len;
  const v = dx * up[0] + dy * up[1] + dz * up[2];
  return {
    elevation: Math.asin(Math.max(-1, Math.min(1, v))) * DEG,
    azimuth: (Math.atan2(dx * east[0] + dy * east[1] + dz * east[2], dx * north[0] + dy * north[1] + dz * north[2]) * DEG + 360) % 360,
  };
}

/**
 * Sun and Earth elevation/azimuth for each ephemeris sample, plus summary
 * metrics against the terrain horizon and the spherical (0°) horizon.
 * positions: [{ utc, sun: {x,y,z}, earth: {x,y,z} }] in Moon radii, Moon-fixed.
 */
export function analyzeTrack(positions, up, profile) {
  const { north, east } = localFrame(up);
  const track = positions.map((sample) => {
    const row = { utc: sample.utc };
    for (const body of ['sun', 'earth']) {
      const a = bodyAngles(sample[body], up, north, east);
      a.horizon = horizonAt(profile, a.azimuth);
      a.up = a.elevation > a.horizon;
      a.upSphere = a.elevation > 0;
      row[body] = a;
    }
    return row;
  });
  return { track, terrain: summarize(track, 'up'), sphere: summarize(track, 'upSphere') };
}

function summarize(track, key) {
  let total = 0, sun = 0, earth = 0, both = 0;
  let dark = 0, longestDark = 0, noEarth = 0, longestNoEarth = 0;
  for (let i = 0; i < track.length - 1; i++) {
    const dt = (track[i + 1].utc - track[i].utc) / 3_600_000;
    const s = track[i].sun[key];
    const e = track[i].earth[key];
    total += dt;
    if (s) sun += dt;
    if (e) earth += dt;
    if (s && e) both += dt;
    dark = s ? 0 : dark + dt;
    noEarth = e ? 0 : noEarth + dt;
    if (dark > longestDark) longestDark = dark;
    if (noEarth > longestNoEarth) longestNoEarth = noEarth;
  }
  const pct = (v) => (total ? (v / total) * 100 : 0);
  return {
    hours: total,
    sunPct: pct(sun),
    earthPct: pct(earth),
    bothPct: pct(both),
    longestDarkH: longestDark,
    longestNoEarthH: longestNoEarth,
  };
}

/**
 * Horizon provider with a per-point cache. Uses a precomputed profile
 * (public/data/horizons.json, fine site DEM near field) when the point is
 * within ~150 m of a bundled DEM center; otherwise ray-marches `sample` live.
 */
export function createHorizonSource({ sample, precomputed = null, label = () => 'LOLA', epoch = () => 1 }) {
  const cache = new Map();
  const sites = (precomputed?.sites || []).map((site) => {
    const [lat, lon] = site.centerLatLon;
    const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
    return { ...site, up: [Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)], elevation: Float32Array.from(site.elevation) };
  });
  const near = Math.cos(150 / MOON_RADIUS_M);
  return {
    get(up) {
      for (const site of sites) {
        if (site.up[0] * up[0] + site.up[1] * up[1] + site.up[2] * up[2] > near) {
          return {
            profile: { bins: site.elevation.length, elevation: site.elevation, observerHeightM: site.observerHeightM },
            source: `site DEM (${site.nearFieldM < 3 ? 'LROC NAC' : 'PGDA LOLA'} ${Math.round(site.nearFieldM)} m) near field + ${label()} out to ${precomputed.maxKm} km`,
          };
        }
      }
      const key = `${epoch()}:${up.map((v) => v.toFixed(7)).join(',')}`;
      let hit = cache.get(key);
      if (!hit) {
        hit = { profile: horizonProfile(sample, up), source: `${label()} out to 150 km` };
        if (cache.size > 64) cache.delete(cache.keys().next().value);
        cache.set(key, hit);
      }
      return hit;
    },
  };
}
