import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

// Resolve the browser CDN imports locally without network requests.
let source = readFileSync(new URL('../src/landers.js', import.meta.url), 'utf8')
  .replace("'three'", JSON.stringify(import.meta.resolve('three')))
  .replace(/https:\/\/cdn.jsdelivr.net\/npm\/three@0.180.0\/examples\/jsm\/([^']+)/g,
    (_, path) => import.meta.resolve('three/addons/' + path));
const { createLanderOverlay } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('models reseat on height-grid changes, not periodically on unchanged terrain', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  try {
    let radius = 1;
    let samples = 0;
    const terrain = {
      relief: 1, heightsEpoch: 1,
      stats: () => ({ dems: 0 }),
      surfaceRadius: () => { samples++; return radius; },
      directionFromLatLon: (lat, lon, out) => out.set(1, 0, 0),
    };
    const overlay = createLanderOverlay({
      scene: new THREE.Scene(), terrain,
      sites: [{ id: 'surveyor-1', name: 'Surveyor 1', kind: 'robotic landing', lat: '0', lon: '0' }],
      canvas: { clientHeight: 700 }, modelsDirectory: new URL('../public/models/', import.meta.url),
      showPins: false,
    });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1.001, 0, 0);
    overlay.update(camera);
    const previousSamples = samples;
    for (let i = 0; i < 121; i++) overlay.update(camera);
    assert.equal(samples, previousSamples);
    radius = 1.00001;
    terrain.heightsEpoch++;
    overlay.update(camera);
    assert.equal(overlay.entries[0].anchor.position.x, radius);
    assert.ok(samples > previousSamples);
    overlay.setVisible(false);
    assert.equal(overlay.group.visible, false);
    await new Promise(resolve => setImmediate(resolve));
  } finally { globalThis.fetch = originalFetch; }
});
