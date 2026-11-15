// Precompute terrain horizon profiles for sites that ship a fine DEM.
// Near field comes from the site DEM (PGDA LOLA 5 m or LROC NAC DTM 2 m),
// everything farther from the same LOLA grids the browser uses.
// Usage: node scripts/build-horizons.mjs  -> public/data/horizons.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createSampler, upFromLatLon } from '../tests/lola-sampler.mjs';
import { horizonProfile, MOON_RADIUS_M as R } from '../src/horizon.js';

const dir = new URL('../public/data/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('site-dems/index.json', dir)));
const base = createSampler();
const BINS = 360;

function loadDem(site) {
  const meta = JSON.parse(readFileSync(new URL(`site-dems/${site.file.replace(/\.f32$/, '.json')}`, dir)));
  const buf = readFileSync(new URL(`site-dems/${site.file}`, dir));
  const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const polar = site.group === 'pgda-lola-5m';
  const [lat, lon] = site.centerLatLon;
  const c = upFromLatLon(lat, lon);
  const north = [-Math.sin(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180), Math.cos(lat * Math.PI / 180), Math.sin(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180)];
  const east = [north[1] * c[2] - north[2] * c[1], north[2] * c[0] - north[0] * c[2], north[0] * c[1] - north[1] * c[0]];
  const [west, south, eastM, northM] = meta.extentM;
  const pw = meta.affine[0], ph = meta.affine[4], W = meta.width, H = meta.height;
  function grid(px, py) {
    const fx = (px - meta.affine[2]) / pw - 0.5, fy = (py - meta.affine[5]) / ph - 0.5;
    if (fx < 0 || fy < 0 || fx > W - 1 || fy > H - 1) return NaN;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
    const v = [data[y0 * W + x0], data[y0 * W + x1], data[y1 * W + x0], data[y1 * W + x1]];
    const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    let s = 0, k = 0;
    for (let i = 0; i < 4; i++) if (v[i] === v[i]) { s += v[i] * w[i]; k += w[i]; }
    return k > 0.5 ? s / k : NaN;
  }
  return function sample(x, y, z) {
    let px, py;
    if (polar) {
      if (y > -0.9) return NaN;
      const t = (1 + y) / (1 - y), sc = (1 + t) * R;
      px = -z * sc; py = x * sc;
    } else {
      const cosC = x * c[0] + y * c[1] + z * c[2];
      if (cosC < 0.99) return NaN;
      const sinC = Math.sqrt(Math.max(0, 1 - cosC * cosC));
      const sc = (sinC > 1e-9 ? Math.acos(Math.min(1, cosC)) / sinC : 1) * R;
      px = (x * east[0] + y * east[1] + z * east[2]) * sc;
      py = (x * north[0] + y * north[1] + z * north[2]) * sc;
    }
    if (px < west || px > eastM || py < south || py > northM) return NaN;
    return grid(px, py);
  };
}

const out = { description: 'Terrain horizon elevation (deg) per azimuth bin, clockwise from north, 2 m observer. Near field from the site DEM, far field from LOLA 16 px/deg + 80S polar grid, 150 km rays, lunar curvature included.', bins: BINS, maxKm: 150, sites: [] };
for (const site of index.sites) {
  const fine = loadDem(site);
  const sample = (x, y, z) => { const h = fine(x, y, z); return h === h ? h : base(x, y, z); };
  const up = upFromLatLon(...site.centerLatLon);
  const t = performance.now();
  const p = horizonProfile(sample, up, { bins: BINS, minStepM: Math.max(10, site.resolutionM * 2) });
  const coarse = horizonProfile(base, up, { bins: BINS });
  out.sites.push({
    id: site.id,
    name: site.name,
    centerLatLon: site.centerLatLon,
    nearFieldM: site.resolutionM,
    observerHeightM: Math.round(p.observerHeightM * 10) / 10,
    elevation: Array.from(p.elevation, (v) => Math.round(v * 100) / 100),
  });
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  console.log(site.id.padEnd(10), `${(performance.now() - t).toFixed(0)} ms`, `fine mean ${mean(p.elevation).toFixed(2)}° max ${Math.max(...p.elevation).toFixed(2)}°`, `coarse mean ${mean(coarse.elevation).toFixed(2)}°`);
}
writeFileSync(new URL('horizons.json', dir), JSON.stringify(out));
