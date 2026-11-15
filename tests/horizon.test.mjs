import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeTrack, createHorizonSource, horizonAt, horizonProfile } from '../src/horizon.js';
import { createSampler, loadPositions, upFromLatLon } from './lola-sampler.mjs';

const positions = loadPositions();
const sample = createSampler();
const precomputed = JSON.parse(readFileSync(new URL('../public/data/horizons.json', import.meta.url)));
const source = createHorizonSource({ sample, precomputed });
const run = (lat, lon) => {
  const up = upFromLatLon(lat, lon);
  return analyzeTrack(positions, up, source.get(up).profile);
};

test('smooth sphere horizon dips just below 0° for a 2 m observer', () => {
  const p = horizonProfile(() => 0, upFromLatLon(10, 20), { bins: 36 });
  for (const v of p.elevation) assert.ok(v < 0 && v > -0.2, `elevation ${v}`);
  assert.ok(Math.abs(horizonAt(p, 5) - p.elevation[0]) < 1e-6);
});

test('Shackleton floor stays dark', () => {
  const r = run(-89.67, 129.78);
  assert.ok(r.terrain.sunPct < 5, `sun ${r.terrain.sunPct}`);
  assert.ok(r.sphere.sunPct > 90);
});

test('far-side landers never see Earth', () => {
  for (const [lat, lon] of [[-45.4561, 177.5885], [-41.6385, -153.9852]]) {
    const r = run(lat, lon);
    assert.equal(r.terrain.earthPct, 0);
    assert.equal(r.terrain.bothPct, 0);
  }
});

test('Apollo 11 keeps Earth in view and matches the sphere for sunlight', () => {
  const r = run(0.67416, 23.47314);
  assert.equal(r.terrain.earthPct, 100);
  assert.ok(Math.abs(r.terrain.sunPct - r.sphere.sunPct) < 3);
});

test('precomputed profiles are used near bundled DEM centers', () => {
  const hit = source.get(upFromLatLon(-85.9948, -0.2358));
  assert.match(hit.source, /site DEM/);
  assert.equal(hit.profile.elevation.length, precomputed.bins);
});

test('both % never exceeds either body', () => {
  const r = run(-86.7639, -22.777);
  assert.ok(r.terrain.bothPct <= Math.min(r.terrain.sunPct, r.terrain.earthPct) + 1e-9);
});
