import * as THREE from 'three';
import { createVisibilityPanel } from './visibility.js';

const AU_KM = 149597870.7;
const MOON_RADIUS_KM = 1737.4;
const degrees = Math.PI / 180;
const sunDisplayDistance = 72;
const textureDirectory = new URL('../public/data/sky/', import.meta.url);

async function loadColorTexture(loader, filename) {
  const texture = await loader.loadAsync(new URL(filename, textureDirectory).href);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// At the reference site (0° longitude, 0° latitude), up is +X,
// north is +Y and east is −Z in the existing globe's UV convention.
function positionFromSample([azimuth, elevation, range]) {
  const az = azimuth * degrees;
  const el = elevation * degrees;
  const horizontal = Math.cos(el);
  return new THREE.Vector3(
    Math.sin(el),
    horizontal * Math.cos(az),
    -horizontal * Math.sin(az),
  ).multiplyScalar(range * AU_KM / MOON_RADIUS_KM).add(new THREE.Vector3(1, 0, 0));
}

export async function addSky(scene, camera, sunlight, container) {
  const response = await fetch(new URL('../public/data/lunar-ephemeris.json', import.meta.url));
  if (!response.ok) throw new Error('Sun and Earth data could not be loaded.');
  const { samples } = await response.json();
  const positions = samples.map(([utc, ...values]) => ({
    utc: Date.parse(utc),
    sun: positionFromSample(values.slice(0, 3)),
    earth: positionFromSample(values.slice(3, 6)),
  }));

  const sunlightDisk = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe1a2, toneMapped: false }),
  );
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(6371 / MOON_RADIUS_KM, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x6089c5, roughness: 0.9, toneMapped: false }),
  );
  scene.add(sunlightDisk, earth);

  const points = [];
  let seed = 301;
  function random() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 1200; i++) {
    const y = 2 * random() - 1;
    const angle = 2 * Math.PI * random();
    const radius = Math.sqrt(1 - y * y);
    points.push(450 * radius * Math.cos(angle), 450 * y, 450 * radius * Math.sin(angle));
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)),
    new THREE.PointsMaterial({ color: 0x8794ae, size: 1.1, sizeAttenuation: false }),
  );
  scene.add(stars);

  const timeline = document.createElement('div');
  timeline.className = 'sky-timeline';
  timeline.innerHTML = `
    <label>Time <output></output><input type="range" min="0" step="0.01"></label>
    <label><input type="checkbox" checked> Stars</label>
  `;
  const slider = timeline.querySelector('input[type=range]');
  const date = timeline.querySelector('output');
  slider.max = positions.length - 1;
  slider.value = 3;
  const starsToggle = timeline.querySelector('input[type=checkbox]');
  const backgroundColor = scene.background;
  let starMap = null;
  function updateStars() {
    stars.visible = starsToggle.checked && !starMap;
    scene.background = starsToggle.checked && starMap ? starMap : backgroundColor;
  }
  starsToggle.addEventListener('change', updateStars);

  const loader = new THREE.TextureLoader();
  loadColorTexture(loader, 'earth-2048.jpg').then((texture) => {
    earth.material.map = texture;
    earth.material.color.set(0xffffff);
    earth.material.needsUpdate = true;
  }).catch((error) => console.warn('Earth texture unavailable.', error));

  loadColorTexture(loader, 'stars-4096.jpg').then((texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    starMap = texture;
    updateStars();
  }).catch((error) => console.warn('Star map unavailable.', error));
  container.append(timeline);

  const formatTime = new Intl.DateTimeFormat('en', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const sunPosition = new THREE.Vector3();
  const earthshine = new THREE.DirectionalLight(0xaacbff, 0.01);
  scene.add(earthshine);
  function update() {
    const index = Number(slider.value);
    const first = positions[Math.floor(index)];
    const next = positions[Math.ceil(index)];
    const fraction = index % 1;
    sunPosition.copy(first.sun).lerp(next.sun, fraction);
    sunlight.position.copy(sunPosition).normalize().multiplyScalar(4);
    sunlightDisk.position.copy(sunPosition).setLength(sunDisplayDistance);
    const sunDisplayRadius = sunDisplayDistance * 695700 / (sunPosition.length() * MOON_RADIUS_KM);
    sunlightDisk.scale.setScalar(sunDisplayRadius);
    earth.position.copy(first.earth).lerp(next.earth, fraction);
    earthshine.position.copy(earth.position).normalize().multiplyScalar(4);
    const phase = (1 + earth.position.clone().negate().normalize().dot(sunPosition.clone().sub(earth.position).normalize())) / 2;
    earthshine.intensity = 0.014 * phase;
    date.value = formatTime.format(first.utc + fraction * (next.utc - first.utc)) + ' UTC';
  }
  slider.addEventListener('input', update);
  update();

  // Start with sunlight crossing the visible face so craters show their relief.
  camera.position.copy(sunlight.position).normalize().add(new THREE.Vector3(1.15, 0.25, 0)).setLength(3.1);
  return { earth, analyze: createVisibilityPanel(container, positions) };
}
