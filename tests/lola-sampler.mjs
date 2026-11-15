// Node mirror of terrain.js sampleBaseMeters, for tests and offline checks.
import { readFileSync } from 'node:fs';

const R = 1_737_400;
const dir = new URL('../public/data/', import.meta.url);

function load(base) {
  const meta = JSON.parse(readFileSync(new URL(`${base}.json`, dir)));
  const buf = readFileSync(new URL(`${base}.${meta.encoding === 'int16-le' ? 'i16' : 'f32'}`, dir));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let data;
  if (meta.encoding === 'int16-le') {
    const dn = new Int16Array(ab);
    data = new Float32Array(dn.length);
    for (let i = 0; i < dn.length; i++) data[i] = dn[i] * (meta.scale ?? 1) + (meta.offset ?? 0);
  } else data = new Float32Array(ab);
  const wrapX = Boolean(meta.globalExtentDegrees);
  const g = { data, width: meta.width, height: meta.height, west: meta.affine[2], north: meta.affine[5], pw: meta.affine[0], ph: meta.affine[4], wrapX };
  if (!wrapX) {
    const [w, s, e, n] = meta.extentM;
    Object.assign(g, { south: s, east: e });
    g.outer = Math.max(e - w, n - s) * 0.5;
    g.inner = g.outer - Math.max(Math.abs(meta.affine[0]) * 24, 18_000);
  }
  return g;
}

function sampleGrid({ data, width, height, west, north, pw, ph, wrapX }, x, y) {
  let fx = (x - west) / pw - 0.5;
  let fy = (y - north) / ph - 0.5;
  if (wrapX) fx = ((fx % width) + width) % width;
  else if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) return NaN;
  fy = Math.max(0, Math.min(height - 1, fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const x1 = wrapX ? (x0 + 1) % width : Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  let sum = 0, w = 0;
  const acc = (v, k) => { if (v === v) { sum += v * k; w += k; } };
  acc(data[y0 * width + x0], (1 - tx) * (1 - ty)); acc(data[y0 * width + x1], tx * (1 - ty));
  acc(data[y1 * width + x0], (1 - tx) * ty); acc(data[y1 * width + x1], tx * ty);
  return w > 0 ? sum / w : NaN;
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createSampler({ hi = true } = {}) {
  const global = load(hi ? 'global-height/global-height-hi' : 'global-height/global-height');
  const polar = load('south-pole-lola/south-pole-height');
  return function sample(x, y, z) {
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const lon = Math.atan2(-z, x);
    let h = sampleGrid(global, lon * 180 / Math.PI, lat * 180 / Math.PI);
    if (h !== h) h = 0;
    if (y < -0.9) {
      const t = (1 + y) / (1 - y), sc = (1 + t) * R;
      const px = -z * sc, py = x * sc;
      if (px >= polar.west && px <= polar.east && py >= polar.south && py <= polar.north) {
        const hp = sampleGrid(polar, px, py);
        if (hp === hp) h += (hp - h) * smooth(polar.outer, polar.inner, Math.hypot(px, py));
      }
    }
    return h;
  };
}

export function upFromLatLon(lat, lon) {
  const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
  return [Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)];
}

export function loadPositions() {
  const AU_KM = 149597870.7, RK = 1737.4, d = Math.PI / 180;
  const { samples } = JSON.parse(readFileSync(new URL('lunar-ephemeris.json', dir)));
  const pos = ([az, el, range]) => {
    const h = Math.cos(el * d), s = range * AU_KM / RK;
    return { x: Math.sin(el * d) * s + 1, y: h * Math.cos(az * d) * s, z: -h * Math.sin(az * d) * s };
  };
  return samples.map(([utc, ...v]) => ({ utc: Date.parse(utc), sun: pos(v.slice(0, 3)), earth: pos(v.slice(3, 6)) }));
}
