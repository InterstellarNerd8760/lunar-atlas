import * as THREE from 'three';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

import { addSky } from './sky.js';
import { createTerrain } from './terrain.js';

const MOON_RADIUS_METERS = 1_737_400;
const EYE_METERS = 2.2;

function surfaceNorth(up, fallback) {
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
  if (north.length() < 1e-6) {
    const hint = fallback && fallback.length() > 1e-6 ? fallback : new THREE.Vector3(1, 0, 0);
    north.copy(hint).addScaledVector(up, -hint.dot(up));
  }
  if (north.length() < 1e-6) north.set(0, 0, 1).addScaledVector(up, -up.z);
  if (north.length() < 1e-6) north.set(1, 0, 0);
  return north.normalize();
}

function northAt(latDeg, lonDeg) {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const north = new THREE.Vector3(
    -Math.sin(lat) * Math.cos(lon),
    Math.cos(lat),
    Math.sin(lat) * Math.sin(lon),
  );
  if (north.lengthSq() < 1e-8) north.set(Math.cos(lon), 0, -Math.sin(lon));
  return north.normalize();
}

function orbitUp(up, north) {
  const axis = up.clone();
  // OrbitControls turns camera.up onto +Y. That rotation is unstable when up
  // is parallel to the spin axis, which rolls polar sites onto their edge.
  if (1 - Math.abs(axis.y) < 1e-4) axis.addScaledVector(north, 0.04);
  if (axis.length() < 1e-6) axis.set(0, 0, 1);
  return axis.normalize();
}

function normId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function collectPlaces(demSites, previewSites) {
  const places = [];
  const seen = [];
  function duplicate(place) {
    const id = normId(place.id);
    return seen.some((other) => {
      const otherId = normId(other.id);
      if (otherId === id) return true;
      const cos = Math.cos(place.lat * Math.PI / 180);
      const dLat = other.lat - place.lat;
      const dLon = (other.lon - place.lon) * cos;
      const close = dLat * dLat + dLon * dLon < 0.03 * 0.03;
      return close && (otherId.includes(id) || id.includes(otherId));
    });
  }
  function add(place) {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return;
    if (duplicate(place)) return;
    seen.push(place);
    places.push(place);
  }
  for (const site of demSites || []) {
    const [lat, lon] = site.centerLatLon || [];
    add({
      id: site.id,
      name: site.name,
      lat,
      lon,
      group: site.group === 'lroc-nac-dtm' ? 'apollo' : 'pole',
      year: site.year,
      country: site.country_or_company,
      proxy: Boolean(site.artemisRegion),
    });
  }
  for (const site of previewSites || []) {
    const lat = site.lat ?? site.centerLatLon?.[0];
    const lon = site.lon ?? site.centerLatLon?.[1];
    const id = site.id || String(site.siteId || '').toLowerCase();
    const name = site.name || site.siteName || id;
    const proxy = Boolean(site.artemisRegion) || /artemis|candidate/i.test(`${id} ${name}`);
    let group = 'lander';
    if (/^apollo/i.test(id) || /Apollo 1[1-7]/.test(name)) group = 'apollo';
    else if (proxy || site.siteId) group = 'pole';
    add({
      id,
      name,
      lat,
      lon,
      group,
      year: site.year,
      country: site.country_or_company,
      proxy,
    });
  }
  const rank = { apollo: 0, lander: 1, pole: 2 };
  places.sort((a, b) => rank[a.group] - rank[b.group] || (a.year || 9999) - (b.year || 9999) || a.name.localeCompare(b.name));
  return places;
}

export function mountMoonView(container) {
  container.replaceChildren();

  const status = document.createElement('p');
  status.className = 'moon-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading LOLA elevation…';
  container.append(status);

  loadMoon(container, status).catch((error) => {
    console.error(error);
    status.textContent = 'Could not load the Moon data: ' + error.message;
  });
}

async function loadMoon(container, status) {
  const dataDirectory = new URL('../public/data/', import.meta.url);
  const params = new URLSearchParams(window.location.search);
  const [demResponse, previewResponse] = await Promise.all([
    fetch(new URL('site-dems/index.json', dataDirectory)),
    fetch(new URL('site-previews/index.json', dataDirectory)),
  ]);
  const demIndex = demResponse.ok ? await demResponse.json() : { sites: [] };
  const previewIndex = previewResponse.ok ? await previewResponse.json() : { sites: [] };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#030509');

  const camera = new THREE.PerspectiveCamera(42, 1, 0.4 / MOON_RADIUS_METERS, 900);
  camera.position.set(0, 0.1, 3.25);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D Moon. Drag to orbit; double-click terrain to focus.');
  container.append(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xc2ccdf, 0.17));
  const sunlight = new THREE.DirectionalLight(0xfff4df, 2.8);
  sunlight.position.set(-3, 1.5, 4);
  scene.add(sunlight);

  const useLegacyTexture = params.get('moonTexture') === 'legacy';
  const texturePromise = new THREE.TextureLoader().loadAsync(
    new URL(useLegacyTexture ? 'wac-texture-legacy.jpg' : 'wac-texture.jpg', dataDirectory).href,
  ).catch((error) => {
    console.warn('WAC texture unavailable.', error);
    return null;
  });

  const terrain = await createTerrain({
    scene,
    renderer,
    dataDirectory,
    demCatalog: demIndex.sites || [],
  });
  const texture = await texturePromise;
  if (texture) terrain.setAlbedo(texture);
  if (params.get('wire') === '1') terrain.setWireframe(true);

  let sky;
  let skyStatus = 'JPL Horizons';
  try {
    sky = await addSky(scene, camera, sunlight, container);
  } catch (error) {
    console.warn(error);
    skyStatus = 'Preview lighting';
  }

  const canvas = renderer.domElement;
  let controls;
  function createOrbitControls(up) {
    controls?.dispose();
    camera.up.copy(up);
    controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.012;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI;
  }
  createOrbitControls(new THREE.Vector3(0, 1, 0));

  const initialCameraPosition = camera.position.clone();
  const cameraToolbar = document.createElement('nav');
  cameraToolbar.className = 'camera-toolbar';
  cameraToolbar.setAttribute('aria-label', 'Camera controls');
  cameraToolbar.innerHTML =
    '<span class="camera-toolbar__label">Camera</span>' +
    '<button type="button" data-view="globe" aria-pressed="true">Globe</button>' +
    '<button type="button" data-view="north" aria-pressed="false">North pole</button>' +
    '<button type="button" data-view="south" aria-pressed="false">South pole</button>' +
    '<button type="button" data-action="flight" aria-pressed="false">Free flight</button>';
  const siteSelect = document.createElement('select');
  siteSelect.setAttribute('aria-label', 'Terrain site');
  siteSelect.add(new Option('Explore a site', ''));
  cameraToolbar.insertBefore(siteSelect, cameraToolbar.lastElementChild);
  const reliefControl = document.createElement('select');
  reliefControl.setAttribute('aria-label', 'Terrain relief');
  reliefControl.add(new Option('Auto relief', 'auto'));
  reliefControl.add(new Option('True scale ×1', 'true'));
  let reliefMode = 'auto';
  reliefControl.addEventListener('change', () => { reliefMode = reliefControl.value; });
  cameraToolbar.append(reliefControl);
  container.append(cameraToolbar);

  const siteStatus = document.createElement('p');
  siteStatus.className = 'site-status';
  siteStatus.setAttribute('role', 'status');
  siteStatus.hidden = true;
  container.append(siteStatus);

  const flightHint = document.createElement('p');
  flightHint.className = 'flight-hint';
  flightHint.hidden = true;
  flightHint.textContent = 'Free flight: mouse to look · W A S D to move · Space / C up or down · Shift to boost · Esc exits';
  container.append(flightHint);

  const flightButton = cameraToolbar.querySelector('[data-action="flight"]');
  const viewButtons = [...cameraToolbar.querySelectorAll('[data-view]')];
  const keys = new Set();
  let freeFlight = false;
  let yaw = 0;
  let pitch = 0;
  let dragPointerId = null;
  let previousFrame = performance.now();
  let fpsFrames = 0;
  let fpsStamp = previousFrame;
  let fps = 0;
  let currentPlace = null;
  let relief = 1;

  const origin = new THREE.Vector3(0, 0, 0);
  const viewDirection = new THREE.Vector3();
  const rightDirection = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const radialDirection = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  function desiredRelief() {
    if (reliefMode === 'true') return 1;
    const altitude = Math.max(0, camera.position.length() - 1);
    return Math.round((1 + 2 * THREE.MathUtils.smoothstep(altitude, 0.08, 2)) * 10) / 10;
  }

  function applyRelief() {
    const next = desiredRelief();
    if (next === relief) return;
    relief = next;
    terrain.setRelief(relief);
  }

  function describeRelief() {
    return `Relief ×${relief.toFixed(1)}${relief > 1 ? ' (exaggerated)' : ' (true scale)'}`;
  }

  function setView(view) {
    if (freeFlight) leaveFlight();
    currentPlace = null;
    siteSelect.value = '';
    siteStatus.hidden = true;
    camera.fov = 42;
    camera.updateProjectionMatrix();
    const isPolarView = view === 'north' || view === 'south';
    createOrbitControls(new THREE.Vector3(0, isPolarView ? 0 : 1, isPolarView ? 1 : 0));
    if (view === 'north') camera.position.set(0, 3.25, 0.001);
    else if (view === 'south') camera.position.set(0, -3.25, 0.001);
    else camera.position.copy(initialCameraPosition);
    controls.target.set(0, 0, 0);
    camera.lookAt(controls.target);
    controls.update();
    for (const button of viewButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    }
  }

  function placeEye(lat, lon) {
    terrain.directionFromLatLon(lat, lon, scratch);
    const height = terrain.sampleMeters(scratch);
    const up = scratch.clone();
    const radius = 1 + (Number.isFinite(height) ? height : 0) / MOON_RADIUS_METERS;
    const north = northAt(lat, lon);
    const sunHoriz = sunlight.position.clone().addScaledVector(up, -sunlight.position.dot(up));
    const ahead = sunHoriz.lengthSq() > 1e-8 ? sunHoriz.normalize() : north;
    createOrbitControls(orbitUp(up, ahead));
    camera.fov = 58;
    camera.updateProjectionMatrix();
    const eye = up.clone().multiplyScalar(radius + EYE_METERS / MOON_RADIUS_METERS);
    const look = eye.clone().addScaledVector(ahead, 600 / MOON_RADIUS_METERS);
    camera.position.copy(eye);
    controls.target.copy(look);
    controls.minDistance = 1.2 / MOON_RADIUS_METERS;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI / 2;
    camera.lookAt(controls.target);
    controls.update();
    for (const button of viewButtons) button.setAttribute('aria-pressed', 'false');
  }

  const notesResponse = await fetch(new URL('site-notes.json', dataDirectory));
  const siteNotes = notesResponse.ok ? await notesResponse.json() : [];
  const siteInfo = document.createElement('details');
  siteInfo.className = 'site-info';
  siteInfo.innerHTML = '<summary>About this site</summary><div></div>';
  siteInfo.hidden = true;
  container.append(siteInfo);

  function showSiteNotes(place) {
    const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = normalize(place.name);
    const note = siteNotes.find((entry) => key.includes(normalize(entry.name)) || normalize(entry.name).includes(key));
    const body = siteInfo.lastElementChild;
    body.replaceChildren();
    const description = document.createElement('p');
    description.textContent = note?.notes ?? `${place.name}. Terrain coordinates come from the bundled landing catalog. Consult the dataset sources for mission context.`;
    body.append(description);
    if (place.proxy) {
      const proxy = document.createElement('p');
      proxy.textContent = 'Terrain proxy for a candidate region. This is not an official landing coordinate or a selected base.';
      body.append(proxy);
    }
    const link = document.createElement('a');
    link.href = note?.source ?? 'https://data.lroc.im-ldi.com/';
    link.textContent = 'Source';
    link.target = '_blank';
    link.rel = 'noopener';
    body.append(link);
    siteInfo.hidden = false;
  }

  const places = collectPlaces(demIndex.sites, previewIndex.sites);
  const placesById = new Map(places.map((place) => [place.id, place]));
  const groupLabels = [
    ['apollo', 'Apollo landing sites'],
    ['lander', 'Landing sites'],
    ['pole', 'South pole terrain'],
  ];
  for (const [groupId, label] of groupLabels) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const place of places.filter((entry) => entry.group === groupId)) {
      group.append(new Option(place.name, place.id));
    }
    if (group.childElementCount) siteSelect.append(group);
  }

  function focusPlace(place, announce = true) {
    if (!place) {
      setView('globe');
      return;
    }
    if (freeFlight) leaveFlight();
    currentPlace = place;
    siteSelect.value = place.id;
    relief = 1;
    terrain.setRelief(1);
    placeEye(place.lat, place.lon);
    if (!announce) return;
    sky?.analyze(scratch.clone().multiplyScalar(1 + (terrain.sampleMeters(scratch) || 0) / MOON_RADIUS_METERS), place.name);
    showSiteNotes(place);
    const coordinateText = `${Math.abs(place.lat).toFixed(4)}° ${place.lat < 0 ? 'S' : 'N'} · ${Math.abs(place.lon).toFixed(4)}° ${place.lon < 0 ? 'W' : 'E'}`;
    const details = [place.name, place.proxy ? 'Terrain proxy' : place.year, place.country, coordinateText].filter(Boolean);
    siteStatus.hidden = false;
    siteStatus.textContent = details.join(' · ');
    terrain.preloadSite(place.id).then((loaded) => {
      if (currentPlace !== place || !loaded) return;
      placeEye(place.lat, place.lon);
    });
  }

  siteSelect.addEventListener('change', () => {
    focusPlace(placesById.get(siteSelect.value));
  });

  function updateFlightLook(deltaX, deltaY) {
    const sensitivity = 0.002;
    yaw -= deltaX * sensitivity;
    pitch = THREE.MathUtils.clamp(pitch - deltaY * sensitivity, -1.52, 1.52);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
  }

  function leaveFlight(releasePointer = true) {
    if (!freeFlight) return;
    freeFlight = false;
    keys.clear();
    dragPointerId = null;
    const up = camera.position.clone().normalize();
    const nearGround = camera.position.length() < 1.25;
    const [lat, lon] = terrain.latLonFromDirection(up.x, up.y, up.z);
    const north = northAt(lat, lon);
    createOrbitControls(nearGround ? orbitUp(up, north) : new THREE.Vector3(0, 1, 0));
    controls.target.copy(nearGround ? up.clone().multiplyScalar(up.dot(camera.position) * 0.999) : origin);
    if (!nearGround && controls.target.lengthSq() < 0.01) controls.target.set(0, 0, 0);
    controls.minDistance = nearGround ? 1.2 / MOON_RADIUS_METERS : 1.012;
    if (nearGround) controls.maxPolarAngle = Math.PI / 2;
    camera.lookAt(controls.target);
    controls.update();
    flightButton.textContent = 'Free flight';
    flightButton.setAttribute('aria-pressed', 'false');
    flightHint.hidden = true;
    if (releasePointer && document.pointerLockElement === canvas) document.exitPointerLock();
  }

  function enterFlight() {
    freeFlight = true;
    keys.clear();
    controls.enabled = false;
    camera.up.set(0, 1, 0);
    camera.getWorldDirection(viewDirection);
    yaw = Math.atan2(-viewDirection.x, -viewDirection.z);
    pitch = Math.asin(THREE.MathUtils.clamp(viewDirection.y, -1, 1));
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
    flightButton.textContent = 'Exit flight';
    flightButton.setAttribute('aria-pressed', 'true');
    flightHint.hidden = false;
    for (const button of viewButtons) button.setAttribute('aria-pressed', 'false');
    canvas.focus({ preventScroll: true });
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  }

  for (const button of viewButtons) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }
  const earthButton = document.createElement('button');
  earthButton.textContent = 'Look at Earth';
  earthButton.addEventListener('click', () => {
    if (!sky) return;
    if (freeFlight) leaveFlight();
    controls.target.copy(camera.position).add(sky.earth.position.clone().sub(camera.position).normalize().multiplyScalar(0.001));
    camera.lookAt(controls.target);
    controls.update();
  });
  cameraToolbar.append(earthButton);
  const groundButton = document.createElement('button');
  groundButton.textContent = 'Stand on surface';
  groundButton.addEventListener('click', () => {
    if (freeFlight) leaveFlight();
    const dir = camera.position.clone().normalize();
    const [lat, lon] = terrain.latLonFromDirection(dir.x, dir.y, dir.z);
    const place = currentPlace || { id: '', name: 'Surface', lat, lon };
    focusPlace({ ...place, lat, lon });
  });
  cameraToolbar.append(groundButton);
  flightButton.addEventListener('click', () => {
    if (freeFlight) leaveFlight();
    else enterFlight();
  });

  canvas.addEventListener('dblclick', (event) => {
    if (freeFlight) return;
    const bounds = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const picker = new THREE.Raycaster();
    picker.setFromCamera(pointer, camera);
    const hit = terrain.raycast(picker.ray.origin, picker.ray.direction);
    if (!hit) return;
    sky?.analyze(hit, 'Selected terrain point');
    const up = hit.clone().normalize();
    const [lat, lon] = terrain.latLonFromDirection(up.x, up.y, up.z);
    createOrbitControls(orbitUp(up, northAt(lat, lon)));
    controls.target.copy(hit);
    controls.minDistance = 1.2 / MOON_RADIUS_METERS;
    controls.maxPolarAngle = Math.PI / 2;
    controls.update();
    for (const button of viewButtons) button.setAttribute('aria-pressed', 'false');
  });

  canvas.addEventListener('mousemove', (event) => {
    if (freeFlight && document.pointerLockElement === canvas) updateFlightLook(event.movementX, event.movementY);
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (!freeFlight || document.pointerLockElement === canvas) return;
    dragPointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!freeFlight || document.pointerLockElement === canvas || event.pointerId !== dragPointerId) return;
    updateFlightLook(event.movementX, event.movementY);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === dragPointerId) dragPointerId = null;
  });
  canvas.addEventListener('pointercancel', () => { dragPointerId = null; });
  document.addEventListener('pointerlockchange', () => {
    if (freeFlight && document.pointerLockElement !== canvas) leaveFlight(false);
  });

  const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight']);
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && freeFlight) leaveFlight();
    if (!freeFlight || !movementKeys.has(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
  });
  document.addEventListener('keyup', (event) => { keys.delete(event.code); });
  window.addEventListener('blur', () => keys.clear());

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const textureLabel = texture
    ? (useLegacyTexture ? 'WAC morphology texture' : 'WAC reflectance texture')
    : 'grayscale relief';
  status.textContent = `LOLA terrain + ${textureLabel} · ${describeRelief()} · ${skyStatus}`;
  status.classList.add('moon-status--loaded');

  setView('globe');
  const shot = params.get('shot');
  if (shot) {
    const panel = container.querySelector('.visibility-panel');
    if (panel) panel.open = false;
    const key = shot.toLowerCase();
    const aliases = { shackleton: 'site04', apollo11: 'apollo-11', apollo: 'apollo-11' };
    if (key === 'south') setView('south');
    else if (key === 'north') setView('north');
    else if (key === 'globe') setView('globe');
    else {
      const id = aliases[key] || key;
      const place = placesById.get(id)
        || places.find((entry) => normId(entry.id) === normId(id));
      if (place) focusPlace(place);
    }
  }

  const lighting = {
    sun: new THREE.Vector3(1, 0.2, 0.4),
    earth: new THREE.Vector3(-1, 0.1, 0.2),
    earthshine: 0.2,
  };

  renderer.setAnimationLoop((now) => {
    const deltaSeconds = Math.min((now - previousFrame) / 1000, 0.05);
    previousFrame = now;
    fpsFrames++;
    if (now - fpsStamp > 500) {
      fps = fpsFrames * 1000 / (now - fpsStamp);
      fpsFrames = 0;
      fpsStamp = now;
    }

    if (freeFlight) {
      camera.updateMatrixWorld();
      camera.getWorldDirection(viewDirection);
      rightDirection.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      movement.set(0, 0, 0);
      if (keys.has('KeyW')) movement.add(viewDirection);
      if (keys.has('KeyS')) movement.sub(viewDirection);
      if (keys.has('KeyD')) movement.add(rightDirection);
      if (keys.has('KeyA')) movement.sub(rightDirection);
      radialDirection.copy(camera.position).normalize();
      if (keys.has('Space')) movement.add(radialDirection);
      if (keys.has('KeyC')) movement.sub(radialDirection);
      if (movement.lengthSq() > 0) {
        movement.normalize();
        const groundR = terrain.surfaceRadius(camera.position);
        const altitude = camera.position.length() - groundR;
        const near = altitude < 0.02;
        let speed = THREE.MathUtils.clamp(altitude * 0.28, near ? 2 / MOON_RADIUS_METERS : 0.01, 0.5);
        if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed *= 4;
        camera.position.addScaledVector(movement, speed * deltaSeconds);
        if (camera.position.length() > 18) camera.position.setLength(18);
      }
    } else {
      controls.update();
      if (controls.target.lengthSq() < 0.04) {
        controls.minDistance = relief > 2 ? 1.1 : 1.012;
        controls.maxPolarAngle = Math.PI;
      }
    }

    radialDirection.copy(camera.position);
    const radiusNow = radialDirection.length();
    if (radiusNow > 1e-4) {
      const ground = terrain.surfaceRadius(radialDirection) + 1.15 / MOON_RADIUS_METERS;
      if (radiusNow < ground) radialDirection.multiplyScalar(ground / radiusNow);
      camera.position.copy(radialDirection);
    }

    applyRelief();
    if (sky?.earth) {
      lighting.sun.copy(sunlight.position);
      lighting.earth.copy(sky.earth.position);
      const sunHat = lighting.sun;
      const earthHat = scratch.copy(lighting.earth).normalize();
      const sunLen = sunHat.length() || 1;
      lighting.earthshine = (1 - earthHat.dot(sunHat) / sunLen) / 2;
    }
    terrain.update(camera, lighting);
    const stats = terrain.stats();
    window.__lunarStats = {
      ...stats,
      fps: Math.round(fps),
      cam: Number(camera.position.length().toFixed(5)),
    };
    if (!currentPlace) {
      status.textContent = `LOLA terrain + ${textureLabel} · ${describeRelief()} · ${skyStatus}`;
    }
    renderer.render(scene, camera);
  });
}
