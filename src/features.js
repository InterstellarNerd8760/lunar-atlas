import * as THREE from 'three';
import { el } from './ui.js';

const MOON_RADIUS_KM = 1_737.4;
const MAX_LABELS = 28;
const TYPE_RANK = {
  Oceanus: 0, Mare: 1, Palus: 2, Sinus: 3, Lacus: 4, Mons: 5, Rupes: 6, Vallis: 7, Crater: 8,
};

function typeGroup(type) {
  if (type === 'Oceanus' || type === 'Mare') return 'mare';
  if (type === 'Lacus' || type === 'Sinus' || type === 'Palus') return 'sea';
  if (type === 'Mons' || type === 'Rupes' || type === 'Vallis') return 'range';
  return 'crater';
}

function scaleKm(feature) {
  // Proposed or hand-placed names can be small; give them a readable zoom range.
  const floor = feature.status === 'proposed' ? 40 : 8;
  return Math.max(feature.diameter_km || 0, feature.label_scale_km || 0, floor);
}

function visibilityWindow(feature) {
  const d = scaleKm(feature);
  const group = typeGroup(feature.type);
  const kMax = group === 'mare' ? (d >= 400 ? 70 : 22)
    : group === 'sea' ? (d >= 250 ? 28 : 16)
    : group === 'range' ? 24
    : (d >= 80 ? 28 : 16);
  const kMin = group === 'mare' ? 0.08 : group === 'sea' ? 0.12 : 0.2;
  return { minKm: d * kMin, maxKm: d * kMax };
}

function fadeAt(altitudeKm, minKm, maxKm) {
  if (altitudeKm <= minKm || altitudeKm >= maxKm) return 0;
  const span = Math.log(maxKm) - Math.log(minKm);
  const t = (Math.log(altitudeKm) - Math.log(minKm)) / span;
  const edge = 0.18;
  if (t < edge) return t / edge;
  if (t > 1 - edge) return (1 - t) / edge;
  return 1;
}

function fontSize(feature) {
  const d = scaleKm(feature);
  const group = typeGroup(feature.type);
  if (feature.type === 'Oceanus') return 26;
  if (group === 'mare') return Math.round(16 + Math.min(8, (d / 1400) * 8));
  if (group === 'sea') return d > 200 ? 14 : 12;
  if (group === 'range') return d > 300 ? 14 : 12;
  if (feature.status === 'proposed') return 13;
  return Math.round(10 + Math.min(5, (d / 250) * 5));
}

function labelSize(feature, text) {
  const size = fontSize(feature);
  return { w: Math.max(24, text.length * size * 0.58 + 8), h: size * 1.25 + 6 };
}

export function createFeatureLabels(container, features, { onSelect } = {}) {
  const layer = el('div', { class: 'feature-labels', 'aria-label': 'Named lunar features' });
  const pool = Array.from({ length: MAX_LABELS }, () => {
    const button = el('button', { type: 'button', class: 'feature-label', hidden: true });
    button.addEventListener('click', () => {
      const feature = button._feature;
      if (feature) onSelect?.(feature);
    });
    layer.append(button);
    return button;
  });
  container.append(layer);

  const items = features.map((feature) => {
    const window = visibilityWindow(feature);
    return {
      feature,
      window,
      group: typeGroup(feature.type),
      size: fontSize(feature),
      box: labelSize(feature, feature.name),
      direction: new THREE.Vector3(),
      radius: 1,
      rank: feature.status === 'proposed' ? 4.5 : (TYPE_RANK[feature.type] ?? 9),
    };
  });

  const world = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  let refresh = Infinity;
  let enabled = true;

  function overlaps(a, b) {
    return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
  }

  return {
    init(directionFromLatLon) {
      for (const item of items) directionFromLatLon(item.feature.lat, item.feature.lon, item.direction);
    },
    setEnabled(value) {
      enabled = Boolean(value);
      layer.hidden = !enabled;
    },
    get enabled() { return enabled; },
    update(camera, surfaceRadius, width, height, dt) {
      if (!enabled) return;
      refresh += dt;
      const refreshRadius = refresh > 0.8;
      if (refreshRadius) refresh = 0;

      const altitudeKm = Math.max(0, camera.position.length() - 1) * MOON_RADIUS_KM;
      const candidates = [];
      for (const item of items) {
        const opacity = fadeAt(altitudeKm, item.window.minKm, item.window.maxKm);
        if (opacity <= 0.05) continue;
        if (refreshRadius) item.radius = surfaceRadius(item.direction);
        world.copy(item.direction).multiplyScalar(item.radius);
        toCamera.copy(camera.position).sub(world);
        if (toCamera.dot(item.direction) <= 0) continue;
        world.project(camera);
        if (world.z <= -1 || world.z >= 1 || Math.abs(world.x) > 1.05 || Math.abs(world.y) > 1.05) continue;
        const x = (world.x + 1) / 2 * width;
        const y = (1 - world.y) / 2 * height;
        candidates.push({
          item,
          opacity,
          x,
          y,
          w: item.box.w,
          h: item.box.h,
          depth: world.z,
        });
      }

      candidates.sort((a, b) => a.item.rank - b.item.rank || b.item.feature.diameter_km - a.item.feature.diameter_km);
      const chosen = [];
      const add = (list, limit = MAX_LABELS) => {
        for (const candidate of list) {
          if (chosen.length >= limit) break;
          if (chosen.some((other) => overlaps(candidate, other))) continue;
          chosen.push(candidate);
        }
      };
      const proposed = candidates.filter((candidate) => candidate.item.feature.status === 'proposed');
      const craters = candidates.filter((candidate) => candidate.item.group === 'crater' && candidate.item.feature.status !== 'proposed');
      const others = candidates.filter((candidate) => candidate.item.group !== 'crater');
      const cx = width / 2;
      const cy = height / 2;
      craters.sort((a, b) => ((a.x - cx) ** 2 + (a.y - cy) ** 2) - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
      add(proposed);
      add(others, MAX_LABELS - 8);
      add(craters);

      for (let i = 0; i < pool.length; i++) {
        const button = pool[i];
        const pick = chosen[i];
        if (!pick) {
          if (!button.hidden) button.hidden = true;
          button._feature = null;
          continue;
        }
        const feature = pick.item.feature;
        if (button._feature !== feature) {
          button._feature = feature;
          button.textContent = feature.name;
          button.className = `feature-label feature-label--${pick.item.group}${feature.status === 'proposed' ? ' feature-label--proposed' : ''}`;
          button.style.fontSize = `${pick.item.size}px`;
          const status = feature.status === 'proposed' ? 'proposed, not yet IAU-approved' : feature.type.toLowerCase();
          button.setAttribute('aria-label', `${feature.name}, ${status}`);
        }
        button.hidden = false;
        button.style.opacity = pick.opacity.toFixed(2);
        button.style.transform = `translate3d(${pick.x.toFixed(1)}px, ${pick.y.toFixed(1)}px, 0)`;
      }
    },
  };
}
