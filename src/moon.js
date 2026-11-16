import { installHelp } from './help.js';
import * as THREE from 'three';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

import { addSky } from './sky.js';
import { aimAt, levelFlight, transportFlight, turnFlight } from './flight.js';
import { createFeatureLabels } from './features.js';
import { createDrawer, createPins, createSiteList } from './sites.js';
import { bindPopover, closeOpenPopover, makePanelDraggable, el, icons, isTextField, reducedMotion } from './ui.js';
import { createTerrain } from './terrain.js';
import { createHorizonSource } from './horizon.js';
import { createComparePanel } from './compare.js';

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

function isApproximateSource(source) {
  return /not LROC-confirmed/i.test(source || '');
}

function parseCsvRow(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

function landingCatalog(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const header = parseCsvRow(lines.shift());
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const catalog = new Map();
  for (const line of lines) {
    const cells = parseCsvRow(line);
    const id = cells[index.id];
    if (!id) continue;
    catalog.set(id, { approximate: isApproximateSource(cells[index.coord_source] || '') });
  }
  return catalog;
}

function collectPlaces(demSites, previewSites, catalog = new Map()) {
  const places = [];
  function decorate(place) {
    const row = catalog.get(place.id);
    if (row) place.approximate = row.approximate;
    return place;
  }
  function duplicateOf(place) {
    const id = normId(place.id);
    return places.find((other) => {
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
    const existing = duplicateOf(place);
    if (existing) {
      for (const key of ['year', 'country', 'mission', 'approximate']) existing[key] ??= place[key];
      decorate(existing);
      return;
    }
    places.push(decorate(place));
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
      mission: site.mission,
      proxy,
    });
  }
  for (const place of places) {
    if (place.group === 'pole') place.group = place.proxy ? 'artemis' : 'feature';
  }
  const rank = { apollo: 0, lander: 1, artemis: 2, feature: 3 };
  places.sort((a, b) => rank[a.group] - rank[b.group] || (a.year || 9999) - (b.year || 9999) || a.name.localeCompare(b.name));
  return places;
}

const isArtemisNote = (note) => /artemis/i.test(note.status || '');

function noteFinder(notes) {
  return function findNote(place) {
    const key = normId(place.name.replace(/^artemis region:\s*/i, ''));
    const pool = notes.filter((note) => isArtemisNote(note) === (place.group === 'artemis'));
    return pool.find((note) => normId(note.name) === key)
      || pool.find((note) => key.includes(normId(note.name)) || normId(note.name).includes(key));
  };
}

function photoKey(value) {
  return normId(String(value || '').replace(/^artemis region:\s*/i, '').replace(/^(note|artemis3)-/, ''));
}

function findPhoto(place, photosById) {
  if (photosById.has(place.id)) return photosById.get(place.id);
  const keys = new Set([photoKey(place.id), photoKey(place.name)].filter(Boolean));
  for (const photo of photosById.values()) {
    if (keys.has(photoKey(photo.id)) || keys.has(photoKey(photo.title))) return photo;
  }
  return null;
}

function findWriteup(place, writeupsById) {
  if (writeupsById.has(place.id)) return writeupsById.get(place.id);
  const keys = new Set([photoKey(place.id), photoKey(place.name)].filter(Boolean));
  for (const writeup of writeupsById.values()) {
    if (keys.has(photoKey(writeup.id)) || keys.has(photoKey(writeup.name))) return writeup;
  }
  return null;
}

function attachWriteup(note, place, writeupsById) {
  const writeup = findWriteup(place, writeupsById);
  if (!writeup) return note;
  return {
    ...(note || {}),
    about: writeup.about,
    facts: writeup.facts,
    sources: writeup.sources,
    take: String(writeup.westonsTake || '').trim(),
  };
}

function attachPhoto(note, place, photosById, dataDirectory) {
  const photo = findPhoto(place, photosById);
  if (!photo) return note;
  return {
    ...(note || {}),
    image: new URL(photo.file.includes('/') ? photo.file : `site-photos/${photo.file}`, dataDirectory).href,
    imageAlt: photo.title || place.name,
    imageCaption: photo.caption,
    imageCredit: photo.credit,
  };
}

export function mountMoonView(container) {
  container.replaceChildren();

  const status = document.createElement('p');
  status.className = 'loading-status glass';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading LOLA elevation…';
  container.append(status);

  loadMoon(container, status).catch((error) => {
    console.error(error);
    status.hidden = false;
    status.textContent = 'Could not load the Moon data: ' + error.message;
  });
}

async function loadMoon(container, loadingStatus) {
  const dataDirectory = new URL('../public/data/', import.meta.url);
  const params = new URLSearchParams(window.location.search);
  const [demResponse, previewResponse, notesResponse, photosResponse, catalogResponse, writeupsResponse, featuresResponse, horizonsResponse] = await Promise.all([
    fetch(new URL('site-dems/index.json', dataDirectory)),
    fetch(new URL('site-previews/index.json', dataDirectory)),
    fetch(new URL('site-notes.json', dataDirectory)),
    fetch(new URL('site-photos/index.json', dataDirectory)),
    fetch(new URL('landing-sites.csv', dataDirectory)),
    fetch(new URL('site-writeups.json', dataDirectory)),
    fetch(new URL('features.json', dataDirectory)),
    fetch(new URL('horizons.json', dataDirectory)),
  ]);
  const demIndex = demResponse.ok ? await demResponse.json() : { sites: [] };
  const previewIndex = previewResponse.ok ? await previewResponse.json() : { sites: [] };
  const siteNotes = notesResponse.ok ? await notesResponse.json() : [];
  const photoIndex = photosResponse.ok ? await photosResponse.json() : { photos: [] };
  const photosById = new Map((photoIndex.photos || []).map((photo) => [photo.id, photo]));
  const catalog = catalogResponse.ok ? landingCatalog(await catalogResponse.text()) : new Map();
  const writeupsById = new Map();
  if (writeupsResponse.ok) {
    const writeups = await writeupsResponse.json();
    for (const [id, writeup] of Object.entries(writeups)) writeupsById.set(id, writeup);
  }
  const namedFeatures = featuresResponse.ok ? ((await featuresResponse.json()).features || []) : [];
  const searchableFeatures = await fetch(new URL('lunar-names.json', dataDirectory))
    .then((response) => {
      if (!response.ok) throw new Error(`Lunar name catalog request failed (${response.status})`);
      return response.json();
    })
    .then(({ types, features }) => features.map(([name, lat, lon, diameter_km, type, id]) => ({
      name, lat, lon, diameter_km, type: types[type] === 'Satellite Feature' ? 'Satellite crater' : types[type],
      source: `https://planetarynames.wr.usgs.gov/Feature/${id}`,
    })))
    .catch((error) => {
      console.warn(error);
      return [];
    });
  const catalogNames = new Set(searchableFeatures.map((feature) => feature.name.toLowerCase()));
  const featureSearch = [...searchableFeatures, ...namedFeatures.filter((feature) => !catalogNames.has(feature.name.toLowerCase()))];

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

  const textureLoader = new THREE.TextureLoader();
  async function loadWacTexture() {
    if (params.get('moonTexture') === 'legacy') {
      try {
        const texture = await textureLoader.loadAsync(new URL('wac-texture-legacy.jpg', dataDirectory).href);
        return { texture, label: 'WAC morphology texture' };
      } catch (error) {
        console.warn('Legacy WAC texture unavailable. Loading bundled WAC instead.', error);
      }
    }
    try {
      const texture = await textureLoader.loadAsync(new URL('wac-texture.jpg', dataDirectory).href);
      return { texture, label: 'WAC reflectance texture' };
    } catch (error) {
      console.warn('Bundled WAC texture unavailable: public/data/wac-texture.jpg', error);
      return { texture: null, label: 'WAC image unavailable' };
    }
  }
  const texturePromise = loadWacTexture();

  const terrain = await createTerrain({
    scene,
    renderer,
    dataDirectory,
    demCatalog: demIndex.sites || [],
  });
  const { texture, label: textureLabel } = await texturePromise;
  if (texture) terrain.setAlbedo(texture);
  if (params.get('wire') === '1') terrain.setWireframe(true);

  const places = collectPlaces(demIndex.sites, previewIndex.sites, catalog);
  const findNote = noteFinder(siteNotes);
  const placesById = new Map(places.map((place) => [place.id, place]));

  const drawer = createDrawer(container, {
    onClose: () => clearSelection(),
    onFlyTo: () => { if (currentPlace) focusPlace(currentPlace, { surface: false }); },
    onStand: () => { if (currentPlace) focusPlace(currentPlace); },
    onEarth: lookAtEarth,
    onCompare: () => compare?.open(currentPlace),
  });

  const horizon = createHorizonSource({
    sample: terrain.sampleBaseMeters,
    precomputed: horizonsResponse.ok ? await horizonsResponse.json().catch(() => null) : null,
    label: () => terrain.heightsLabel,
    epoch: () => terrain.heightsEpoch,
  });

  let sky;
  let skyStatus = 'JPL Horizons';
  try {
    sky = await addSky(scene, camera, sunlight, container, {
      visibilitySection: drawer.visSection,
      onVisibilityStatus: (text) => drawer.setPeek(text),
      horizon,
    });
  } catch (error) {
    console.warn(error);
    skyStatus = 'Preview lighting';
  }

  const compare = sky ? createComparePanel(container, {
    places,
    positions: sky.positions,
    horizon,
    getPoint: () => (currentPlace?.group === 'point' ? currentPlace : null),
  }) : null;
  // Horizons computed on the startup grid are refreshed once the 16 px/deg grid lands.
  terrain.heightsReady.then(() => {
    if (currentPlace && Number.isFinite(currentPlace.lat)) analyzePlace(currentPlace);
  });

  const canvas = renderer.domElement;
  let controls;
  function createOrbitControls(up) {
    controls?.dispose();
    camera.up.copy(up);
    // OrbitControls updates immediately in its constructor; keep the observer fixed.
    const position = camera.position.clone();
    const orientation = camera.quaternion.clone();
    controls = new OrbitControls(camera, canvas);
    camera.position.copy(position);
    camera.quaternion.copy(orientation);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.012;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI;
  }
  createOrbitControls(new THREE.Vector3(0, 1, 0));

  const initialCameraPosition = camera.position.clone();

  // Top bar
  const sitesButton = el('button', { type: 'button', class: 'btn btn--icon topbar__sites', 'aria-label': 'Sites', title: 'Search sites (/)', 'aria-controls': 'site-list', 'aria-expanded': 'false', html: icons.search });
  const viewButtons = [
    ['globe', 'Globe'], ['north', 'N pole'], ['south', 'S pole'],
  ].map(([view, label]) => el('button', { type: 'button', class: 'btn', 'data-view': view, 'aria-pressed': String(view === 'globe'), text: label }));
  const flightButton = el('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', text: 'Free flight' });
  const walkButton = el('button', { type: 'button', class: 'btn', text: 'Walk', title: 'Walk on the surface below you', 'aria-pressed': 'false' });
  let walking = false;
  let jumpHeight = 0;
  let jumpVelocity = 0;
  let walkSwayPhase = 0;
  let walkSway = 0;
  const walkUp = new THREE.Vector3();
  const walkRotation = new THREE.Quaternion();
  const walkOrientation = new THREE.Quaternion();
  walkButton.addEventListener('click', () => {
    if (walking) leaveFlight();
    else {
      if (freeFlight) leaveFlight(false);
      if (flight) finishFlight();
      // Drop onto the ground directly below the camera, anywhere on the Moon, facing the horizon.
      walkUp.copy(camera.position).normalize();
      const heading = camera.getWorldDirection(new THREE.Vector3()).projectOnPlane(walkUp);
      if (heading.lengthSq() < 1e-8) heading.copy(camera.up).projectOnPlane(walkUp);
      if (heading.lengthSq() < 1e-8) heading.set(0, 1, 0).projectOnPlane(walkUp);
      if (heading.lengthSq() < 1e-8) heading.set(1, 0, 0).projectOnPlane(walkUp);
      heading.normalize();
      camera.position.copy(walkUp).multiplyScalar(terrain.surfaceRadius(walkUp) + 1.7 / MOON_RADIUS_METERS);
      camera.up.copy(walkUp);
      camera.lookAt(camera.position.clone().add(heading));
      enterFlight(false);
      flightButton.textContent = 'Free flight';
      flightButton.setAttribute('aria-pressed', 'false');
      walking = true;
      jumpHeight = jumpVelocity = 0;
      walkSwayPhase = walkSway = 0;
      walkButton.textContent = 'Exit walk';
      walkButton.setAttribute('aria-pressed', 'true');
      showFlightControls();
    }
  });
  const compareButton = el('button', { type: 'button', class: 'btn', 'aria-haspopup': 'dialog', title: 'Compare sites side by side', text: 'Compare', hidden: !compare, onclick: () => compare?.toggle(currentPlace) });
  const layersButton = el('button', { type: 'button', class: 'btn topbar__layers', 'aria-label': 'Layers', 'aria-haspopup': 'dialog', 'aria-keyshortcuts': 'L', title: 'Layers (L)', html: `${icons.layers}<span>Layers</span>` });
  const topbar = el('header', { class: 'topbar glass' }, [
    el('h1', { class: 'brand', html: '<span class="brand__accent">Centauri</span> Lunar Atlas <a class="brand__by" href="https://westonrosch.com" target="_blank" rel="noopener">by Weston Rosch</a>' }),
    el('nav', { class: 'topbar__nav', 'aria-label': 'Camera' }, [
      sitesButton,
      el('div', { class: 'topbar__nav topbar__views' }, viewButtons),
      flightButton,
      walkButton,
      compareButton,
      layersButton,
    ]),
  ]);
  container.append(topbar);

  // Layers menu
  let reliefMode = 'auto';
  const reliefOptions = [['auto', 'Auto'], ['1', '×1'], ['2', '×2'], ['3', '×3'], ['4', '×4']];
  const reliefControl = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Terrain relief' }, reliefOptions.map(([value, label]) => el('button', {
    type: 'button',
    class: 'btn',
    'data-relief': value,
    'aria-pressed': String(value === reliefMode),
    title: value === 'auto' ? 'Auto relief: up to ×4 from orbit, ×1 near the surface' : value === '1' ? '×1 (true scale)' : `×${value} exaggerated`,
    'aria-label': value === 'auto' ? 'Auto relief' : value === '1' ? '×1 (true scale)' : `×${value}`,
    text: label,
  })));
  reliefControl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-relief]');
    if (!button) return;
    reliefMode = button.dataset.relief;
    for (const other of reliefControl.children) other.setAttribute('aria-pressed', String(other === button));
  });
  const layersStatus = el('p', { class: 'terrain-summary__status', role: 'status' });
  const layerRows = [];
  if (texture) {
    const imageryButton = el('input', { type: 'checkbox', id: 'layer-wac', 'aria-describedby': 'layer-wac-desc' });
    imageryButton.addEventListener('change', () => terrain.setImageryOnly(imageryButton.checked));
    layerRows.push(el('div', { class: 'switch-row' }, [
      el('label', { for: 'layer-wac' }, ['WAC imagery', el('span', { class: 'sr-only', id: 'layer-wac-desc', text: 'Show the WAC image without Sun and Earth lighting' })]),
      imageryButton,
    ]));
  }
  if (sky) {
    const starsToggle = el('input', { type: 'checkbox', id: 'layer-stars', checked: true });
    starsToggle.addEventListener('change', () => sky.setStars(starsToggle.checked));
    layerRows.push(el('div', { class: 'switch-row' }, [el('label', { for: 'layer-stars', text: 'Stars' }), starsToggle]));
  }
  const namesToggle = el('input', { type: 'checkbox', id: 'layer-feature-names', checked: true });
  namesToggle.addEventListener('change', () => featureLabels?.setEnabled(namesToggle.checked));
  layerRows.push(el('div', { class: 'switch-row' }, [el('label', { for: 'layer-feature-names', text: 'Feature names' }), namesToggle]));
  const hideUiButton = el('button', {
    type: 'button', class: 'btn', text: 'Hide UI', title: 'Hide UI (H)', 'aria-keyshortcuts': 'H',
    onclick: () => setMoonOnly(true),
  });
  const restoreUiButton = el('button', {
    type: 'button', class: 'btn glass moon-only__restore', text: 'Show UI', hidden: true,
    title: 'Show UI (H or Esc)', onclick: () => setMoonOnly(false),
  });
  function setMoonOnly(enabled) {
    closeOpenPopover();
    container.classList.toggle('moon-only', enabled);
    pins.setMarkersVisible(!enabled);
    restoreUiButton.hidden = !enabled;
    if (enabled) renderer.domElement.focus({ preventScroll: true });
    else layersButton.focus({ preventScroll: true });
  }
  const layersMenu = el('div', { class: 'popover layers-menu', role: 'dialog', 'aria-label': 'Layers' }, [
    el('div', { class: 'field' }, [el('h2', { text: 'Terrain relief' }), reliefControl]),
    ...layerRows,
    hideUiButton,
  ]);
  container.append(layersMenu, restoreUiButton);
  const terrainSummary = el('aside', { class: 'terrain-summary', 'aria-label': 'Terrain relief and sources' }, [
    layersStatus,
    el('a', {
      href: 'https://github.com/InterstellarNerd8760/lunar-atlas/blob/main/docs/data-sources.md',
      target: '_blank', rel: 'noopener', text: 'Data sources',
    }),
  ]);
  container.append(terrainSummary);
  const layersPopover = bindPopover(layersButton, layersMenu, {
    onOpen: () => reliefControl.querySelector('[aria-pressed="true"]').focus(),
  });

  const featureNote = el('p', { class: 'feature-note glass text-xs', hidden: true, role: 'status' });
  container.append(featureNote);
  function hideFeatureNote() {
    featureNote.hidden = true;
    featureNote.textContent = '';
    featureLabels?.setSelected(null);
  }
  function showFeatureNote(feature) {
    const details = [feature.name, feature.type, feature.diameter_km > 0 ? `${feature.diameter_km} km` : ''].filter(Boolean).join(' · ');
    featureNote.textContent = feature.note || details;
    if (feature.source) {
      featureNote.append(' · ', el('a', { href: feature.source, target: '_blank', rel: 'noopener', text: 'Gazetteer' }));
    }
    featureNote.hidden = false;
  }

  let featureLabels = null;
  if (namedFeatures.length) {
    featureLabels = createFeatureLabels(container, namedFeatures, { onSelect: (feature) => focusFeature(feature) });
    featureLabels.init((lat, lon, target) => terrain.directionFromLatLon(lat, lon, target));
    featureLabels.setEnabled(namesToggle.checked);
  } else {
    namesToggle.closest('.switch-row').hidden = true;
  }

  const pins = createPins(container, places, { onSelect: (place) => focusPlace(place), scene });
  pins.init((lat, lon, target) => terrain.directionFromLatLon(lat, lon, target));
  const siteList = createSiteList(container, places, {
    features: featureSearch,
    onFeatureSelect: (feature) => {
      focusFeature(feature);
      if (narrowQuery.matches) setListOpen(false);
    },
    onSelect: (place) => {
      focusPlace(place);
      if (narrowQuery.matches) setListOpen(false);
    },
  });

  const flightHint = el('p', { class: 'flight-hint glass', hidden: true, text: 'Free flight: mouse / drag to look · W A S D move · Q / E turn · Space / C rise / descend · Shift boost · Esc exits' });
  const touchInput = window.matchMedia('(any-pointer: coarse), (hover: none)');
  const heldPointers = new Map();
  function flightPad(label, directions) {
    return el('div', { class: 'flight-pad glass', role: 'group', 'aria-label': label }, directions.map(([key, name, symbol]) => {
      const button = el('button', { type: 'button', class: 'btn', 'aria-label': name, 'data-flight-key': key, text: symbol });
      button.addEventListener('pointerdown', (event) => {
        if (!freeFlight || event.button !== 0) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        heldPointers.set(event.pointerId, key);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, (event) => heldPointers.delete(event.pointerId));
      }
      return button;
    }));
  }
  const joystickKnob = el('span', { class: 'flight-stick__knob' });
  const joystick = el('div', { class: 'flight-stick', role: 'group', 'aria-label': 'Movement joystick. Drag to move.' }, [joystickKnob]);
  let stickPointer = null;
  const stick = { x: 0, y: 0 };
  function resetStick() {
    stickPointer = null;
    stick.x = stick.y = 0;
    joystickKnob.style.transform = '';
  }
  function moveStick(event) {
    const bounds = joystick.getBoundingClientRect();
    const radius = bounds.width / 2 - 24;
    let x = (event.clientX - bounds.left - bounds.width / 2) / radius;
    let y = (event.clientY - bounds.top - bounds.height / 2) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    joystickKnob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
    const strength = Math.max(0, Math.min(length, 1) - 0.12) / 0.88;
    stick.x = length > 0 ? x / Math.min(length, 1) * strength : 0;
    stick.y = length > 0 ? y / Math.min(length, 1) * strength : 0;
  }
  joystick.addEventListener('pointerdown', (event) => {
    if (!freeFlight || stickPointer !== null || event.button !== 0) return;
    event.preventDefault();
    stickPointer = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    moveStick(event);
  });
  joystick.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickPointer) moveStick(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    joystick.addEventListener(type, (event) => {
      if (event.pointerId === stickPointer) resetStick();
    });
  }
  const altitudePad = flightPad('Altitude', [['Space', 'Rise', 'Rise'], ['KeyC', 'Descend', 'Descend']]);
  let touchRunning = false;
  function walkAction(label, action) {
    return el('button', {
      type: 'button', class: 'btn', text: label, 'aria-label': label,
      ontouchstart(event) {
        // Handle the second finger directly, even when the browser suppresses its click.
        event.preventDefault();
        action();
      },
      onclick(event) {
        if (event.pointerType !== 'touch') action();
      },
    });
  }
  const runButton = walkAction('Run', () => setTouchRun(!touchRunning));
  runButton.setAttribute('aria-pressed', 'false');
  function setTouchRun(active) {
    touchRunning = active;
    runButton.textContent = active ? 'Running' : 'Run';
    runButton.setAttribute('aria-pressed', String(active));
  }
  function jump() {
    if (walking && jumpHeight === 0 && jumpVelocity === 0) jumpVelocity = 2.6;
  }
  const walkPad = el('div', { class: 'flight-pad glass', role: 'group', 'aria-label': 'Walk actions', hidden: true }, [
    runButton,
    walkAction('Jump', jump),
  ]);
  const touchControls = el('div', { class: 'flight-touch', hidden: true }, [joystick, altitudePad, walkPad]);
  container.append(flightHint, touchControls);

  const narrowQuery = window.matchMedia('(max-width: 1023px)');
  const railQuery = window.matchMedia('(min-width: 1024px) and (max-width: 1439px)');
  let railDismissed = false;
  function updateRail() {
    siteList.setRail(railQuery.matches && drawer.isOpen && !railDismissed);
  }
  railQuery.addEventListener('change', updateRail);
  siteList.railButton.addEventListener('click', () => {
    railDismissed = true;
    updateRail();
    siteList.search.focus();
  });
  function setListOpen(open) {
    siteList.setOpen(open);
    sitesButton.setAttribute('aria-expanded', String(open));
    if (open) siteList.search.focus();
  }
  sitesButton.addEventListener('click', () => setListOpen(!siteList.isOpen));
  function focusSearch() {
    if (narrowQuery.matches) setListOpen(true);
    else if (siteList.isRail) { railDismissed = true; updateRail(); }
    siteList.search.focus();
    siteList.search.select();
  }

  const keys = new Set();
  let freeFlight = false;
  let lookPointer = null;
  let previousFrame = performance.now();
  let fpsFrames = 0;
  let fpsStamp = previousFrame;
  let fps = 0;
  let currentPlace = null;
  let relief = 1;
  let flight = null;

  const origin = new THREE.Vector3(0, 0, 0);
  const viewDirection = new THREE.Vector3();
  const rightDirection = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const radialDirection = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  function desiredRelief() {
    if (reliefMode !== 'auto') return Number(reliefMode);
    const altitude = Math.max(0, camera.position.length() - 1);
    return Math.round((1 + 3 * THREE.MathUtils.smoothstep(altitude, 0.08, 2)) * 10) / 10;
  }

  function applyRelief() {
    const next = desiredRelief();
    if (next === relief) return;
    const oldSurface = terrain.surfaceRadius(camera.position);
    relief = next;
    terrain.setRelief(relief);
    if (camera.position.length() - oldSurface < 0.08) {
      const delta = terrain.surfaceRadius(camera.position) - oldSurface;
      radialDirection.copy(camera.position).normalize().multiplyScalar(delta);
      camera.position.add(radialDirection);
      if (flight) {
        flight.toPos.add(radialDirection);
        flight.toTarget.add(radialDirection);
      } else if (!freeFlight && controls.target.lengthSq() >= 0.04) controls.target.add(radialDirection);
    }
  }

  function describeRelief() {
    return `Relief ×${relief.toFixed(1)}${relief > 1 ? ' (exaggerated)' : ' (true scale)'}`;
  }

  // Camera flights: slerp the direction, interpolate altitude in log space.
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const fromDir = new THREE.Vector3();
  const toDir = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const noSpin = new THREE.Quaternion();
  function flyTo({ pos, target, up, fov, minDistance = 1.012, maxPolarAngle = Math.PI }, instant = false) {
    if (freeFlight) leaveFlight();
    flight = {
      fromPos: camera.position.clone(), fromTarget: controls.target.clone(), fromUp: camera.up.clone(), fromFov: camera.fov,
      toPos: pos.clone(), toTarget: target.clone(), toUp: up.clone(), toFov: fov, minDistance, maxPolarAngle,
      t: 0, duration: instant || reducedMotion.matches ? 0 : 1.2,
    };
    controls.enabled = false;
    if (!flight.duration) finishFlight();
  }
  function finishFlight() {
    const done = flight;
    flight = null;
    camera.position.copy(done.toPos);
    camera.fov = done.toFov;
    camera.updateProjectionMatrix();
    createOrbitControls(done.toUp);
    controls.target.copy(done.toTarget);
    controls.minDistance = done.minDistance;
    controls.maxPolarAngle = done.maxPolarAngle;
    camera.lookAt(controls.target);
    controls.update();
  }
  function stepFlight(dt) {
    flight.t = Math.min(1, flight.t + dt / flight.duration);
    if (flight.t >= 1) { finishFlight(); return; }
    const e = ease(flight.t);
    const r0 = flight.fromPos.length();
    const r1 = flight.toPos.length();
    const base = Math.min(r0, r1) - 1e-6;
    const altitude = Math.exp(THREE.MathUtils.lerp(Math.log(r0 - base), Math.log(r1 - base), e));
    fromDir.copy(flight.fromPos).normalize();
    toDir.copy(flight.toPos).normalize();
    spin.setFromUnitVectors(fromDir, toDir);
    noSpin.identity().slerp(spin, e);
    camera.position.copy(fromDir).applyQuaternion(noSpin).multiplyScalar(base + altitude);
    camera.up.copy(flight.fromUp).lerp(flight.toUp, e).normalize();
    camera.fov = THREE.MathUtils.lerp(flight.fromFov, flight.toFov, e);
    camera.updateProjectionMatrix();
    scratch.copy(flight.fromTarget).lerp(flight.toTarget, e);
    controls.target.copy(scratch);
    camera.lookAt(scratch);
  }

  function setViewPressed(view) {
    for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }

  function setView(view) {
    if (freeFlight) leaveFlight();
    clearSelection();
    const isPolarView = view === 'north' || view === 'south';
    const pos = view === 'north' ? new THREE.Vector3(0, 3.25, 0.001)
      : view === 'south' ? new THREE.Vector3(0, -3.25, 0.001)
        : initialCameraPosition.clone();
    flyTo({ pos, target: origin, up: new THREE.Vector3(0, isPolarView ? 0 : 1, isPolarView ? 1 : 0), fov: 42 });
    setViewPressed(view);
  }

  function surfaceEye(lat, lon, place) {
    terrain.directionFromLatLon(lat, lon, scratch);
    const up = scratch.clone();
    const radius = terrain.surfaceRadius(up);
    const north = northAt(lat, lon);
    const sunHoriz = sunlight.position.clone().addScaledVector(up, -sunlight.position.dot(up));
    const ahead = sunHoriz.lengthSq() > 1e-8 ? sunHoriz.normalize() : north;
    const pos = up.clone().multiplyScalar(radius + EYE_METERS / MOON_RADIUS_METERS);
    let target = pos.clone().addScaledVector(ahead, 600 / MOON_RADIUS_METERS);
    // Stand a short way back from landed spacecraft so the exact point stays in frame,
    // and look at the marker. Seat the camera on the terrain under that offset so a
    // crater floor or coarse DEM wave cannot drop the point out of view.
    if (place && (place.group === 'apollo' || place.group === 'lander')) {
      pos.addScaledVector(ahead, -20 / MOON_RADIUS_METERS);
      const camUp = pos.clone().normalize();
      pos.copy(camUp).multiplyScalar(terrain.surfaceRadius(camUp) + EYE_METERS / MOON_RADIUS_METERS);
      target = up.clone().multiplyScalar(radius + 1.6 / MOON_RADIUS_METERS);
    }
    return {
      pos,
      target,
      up: orbitUp(up, ahead),
      fov: 58,
      minDistance: 1.2 / MOON_RADIUS_METERS,
      // Allow a slight downward look so a crater-floor site stays in frame.
      maxPolarAngle: (place && (place.group === 'apollo' || place.group === 'lander')) ? Math.PI * 0.65 : Math.PI / 2,
    };
  }

  function overviewEye(lat, lon) {
    terrain.directionFromLatLon(lat, lon, scratch);
    const up = scratch.clone();
    const target = up.clone().multiplyScalar(terrain.surfaceRadius(up));
    const north = northAt(lat, lon);
    const height = 30_000 / MOON_RADIUS_METERS;
    const pos = target.clone().addScaledVector(up, height).addScaledVector(north, -height * 1.2);
    return { pos, target, up: orbitUp(up, north), fov: 42, minDistance: 1.2 / MOON_RADIUS_METERS, maxPolarAngle: Math.PI / 2 };
  }

  function featureEye(feature) {
    terrain.directionFromLatLon(feature.lat, feature.lon, scratch);
    const up = scratch.clone();
    const target = up.clone().multiplyScalar(terrain.surfaceRadius(up));
    const north = northAt(feature.lat, feature.lon);
    const frameKm = feature.status === 'proposed'
      ? Math.max(feature.diameter_km || 0, 120)
      : feature.diameter_km > 0 ? Math.max(feature.diameter_km, 0.1) : 20;
    const verticalHalfFov = 21 * Math.PI / 180;
    const halfFov = Math.min(verticalHalfFov, Math.atan(Math.tan(verticalHalfFov) * camera.aspect));
    const alt = (frameKm * 500) / Math.tan(halfFov * 0.65);
    const pos = target.clone().addScaledVector(up, alt / MOON_RADIUS_METERS).addScaledVector(north, -alt * 0.15 / MOON_RADIUS_METERS);
    return { pos, target, up: orbitUp(up, north), fov: 42, minDistance: 1.2 / MOON_RADIUS_METERS, maxPolarAngle: Math.PI };
  }

  function findNamedFeature(key) {
    const needle = normId(key);
    return namedFeatures.find((feature) => normId(feature.name) === needle)
      || namedFeatures.find((feature) => normId(feature.name).includes(needle));
  }

  function focusFeature(feature, { instant = false } = {}) {
    if (!feature || !Number.isFinite(feature.lat) || !Number.isFinite(feature.lon)) return;
    if (freeFlight) leaveFlight();
    clearSelection();
    showFeatureNote(feature);
    featureLabels?.setSelected(feature);
    setViewPressed(null);
    flyTo(featureEye(feature), instant);
  }

  function clearSelection() {
    currentPlace = null;
    drawer.hide();
    hideFeatureNote();
    siteList.setSelected(null);
    pins.setSelected(null);
    railDismissed = false;
    updateRail();
  }

  function analyzePlace(place) {
    terrain.directionFromLatLon(place.lat, place.lon, scratch);
    sky?.analyze(scratch.clone().multiplyScalar(1 + (terrain.sampleMeters(scratch) || 0) / MOON_RADIUS_METERS), place.name);
  }

  let navigationRevision = 0;
  function focusPlace(place, { surface = true, instant = false } = {}) {
    const revision = ++navigationRevision;
    if (!place) {
      setView('globe');
      return;
    }
    if (freeFlight) leaveFlight();
    const changed = currentPlace?.id !== place.id || currentPlace?.lat !== place.lat || currentPlace?.lon !== place.lon;
    currentPlace = place;
    hideFeatureNote();
    siteList.setSelected(place.id);
    pins.setSelected(place.id);
    if (changed) {
      railDismissed = false;
      const note = place.group === 'point' ? null : attachPhoto(attachWriteup(findNote(place), place, writeupsById), place, photosById, dataDirectory);
      drawer.show(place, note);
      if (Number.isFinite(place.lat) && Number.isFinite(place.lon)) analyzePlace(place);
    }
    updateRail();
    setViewPressed(null);
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return;
    if (reliefMode === 'auto' && relief !== 1) {
      relief = 1;
      terrain.setRelief(relief);
    }
    flyTo(surface ? surfaceEye(place.lat, place.lon, place) : overviewEye(place.lat, place.lon), instant);
    if (!place.id) return;
    terrain.preloadSite(place.id).then((loaded) => {
      if (currentPlace !== place || !loaded || !surface || freeFlight || navigationRevision !== revision) return;
      const eye = surfaceEye(place.lat, place.lon, place);
      if (flight) Object.assign(flight, { toPos: eye.pos, toTarget: eye.target });
      else flyTo(eye, true);
    });
  }

  function lookAtEarth() {
    if (!sky) return;
    // Orbit constraints are inappropriate for looking out from a fixed observer.
    // Do not request pointer lock: the drawer and timeline remain usable.
    if (!freeFlight) enterFlight(false);
    aimAt(camera, sky.earth.position);
  }

  function updateFlightLook(deltaX, deltaY) {
    turnFlight(camera, -deltaX * 0.002, -deltaY * 0.002);
  }

  function clearFlightInput() {
    keys.clear();
    heldPointers.clear();
    resetStick();
    setTouchRun(false);
    lookPointer = null;
  }

  function showFlightControls() {
    const showTouch = freeFlight && touchInput.matches;
    touchControls.hidden = !showTouch;
    altitudePad.hidden = walking;
    walkPad.hidden = !walking;
    container.classList.toggle('touch-flight-active', showTouch);
    container.classList.toggle('touch-walk-active', showTouch && walking);
    flightHint.hidden = !freeFlight;
    if (showTouch) {
      flightHint.textContent = walking ? 'Thumbstick to move · Drag to look · Run toggles speed' : 'Thumbstick to move · Drag to look · Rise / Descend';
    } else {
      flightHint.textContent = walking
        ? 'Walk: W A S D / arrows move · Drag to look · Shift run · Space jump · Esc exits'
        : 'Free flight: mouse / drag to look · W A S D move · Q / E turn · Space / C rise / descend · Shift boost · Esc exits';
    }
  }

  touchInput.addEventListener('change', () => {
    clearFlightInput();
    showFlightControls();
  });

  function leaveFlight(releasePointer = true) {
    if (!freeFlight) return;
    freeFlight = false;
    walking = false;
    walkButton.textContent = 'Walk';
    walkButton.setAttribute('aria-pressed', 'false');
    clearFlightInput();
    // Preserve the view when leaving flight instead of snapping toward the ground.
    const position = camera.position.clone();
    camera.getWorldDirection(viewDirection);
    const up = position.clone().normalize();
    createOrbitControls(up);
    controls.target.copy(position).addScaledVector(viewDirection, 600 / MOON_RADIUS_METERS);
    controls.minDistance = 1.2 / MOON_RADIUS_METERS;
    controls.maxPolarAngle = Math.PI;
    controls.update();
    flightButton.textContent = 'Free flight';
    flightButton.setAttribute('aria-pressed', 'false');
    showFlightControls();
    if (releasePointer && document.pointerLockElement === canvas) document.exitPointerLock();
  }

  function enterFlight(lockPointer = true) {
    navigationRevision++;
    if (flight) finishFlight();
    freeFlight = true;
    clearFlightInput();
    controls.enabled = false;
    levelFlight(camera);
    flightButton.textContent = 'Exit flight';
    flightButton.setAttribute('aria-pressed', 'true');
    showFlightControls();
    setViewPressed(null);
    canvas.focus({ preventScroll: true });
    if (lockPointer && !touchInput.matches && canvas.requestPointerLock) {
      // Drag-to-look remains available if the browser denies pointer lock.
      try { canvas.requestPointerLock()?.catch(() => {}); } catch { /* drag fallback */ }
    }
  }

  for (const button of viewButtons) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }
  flightButton.addEventListener('click', () => {
    if (freeFlight && !walking) leaveFlight();
    else {
      if (walking) leaveFlight(false);
      enterFlight();
    }
  });

  canvas.addEventListener('dblclick', (event) => {
    if (freeFlight) return;
    if (flight) finishFlight();
    const bounds = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const picker = new THREE.Raycaster();
    picker.setFromCamera(pointer, camera);
    const hit = terrain.raycast(picker.ray.origin, picker.ray.direction);
    if (!hit) return;
    const up = hit.clone().normalize();
    const [lat, lon] = terrain.latLonFromDirection(up.x, up.y, up.z);
    currentPlace = { id: '', name: 'Selected terrain point', lat, lon, group: 'point' };
    siteList.setSelected(null);
    pins.setSelected(null);
    railDismissed = false;
    drawer.show(currentPlace, null);
    updateRail();
    sky?.analyze(hit, currentPlace.name);
    createOrbitControls(orbitUp(up, northAt(lat, lon)));
    controls.target.copy(hit);
    controls.minDistance = 1.2 / MOON_RADIUS_METERS;
    controls.maxPolarAngle = Math.PI / 2;
    controls.update();
    setViewPressed(null);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (freeFlight && document.pointerLockElement === canvas) updateFlightLook(event.movementX, event.movementY);
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (flight) finishFlight();
    if (!freeFlight || lookPointer || event.button !== 0 || document.pointerLockElement === canvas) return;
    if (event.pointerType === 'touch') event.preventDefault();
    lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!freeFlight || event.pointerId !== lookPointer?.id || document.pointerLockElement === canvas) return;
    updateFlightLook(event.clientX - lookPointer.x, event.clientY - lookPointer.y);
    lookPointer.x = event.clientX;
    lookPointer.y = event.clientY;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (event) => {
      if (event.pointerId === lookPointer?.id) lookPointer = null;
    });
  }
  document.addEventListener('pointerlockchange', () => {
    if (freeFlight && document.pointerLockElement !== canvas) leaveFlight(false);
  });

  const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  document.addEventListener('keydown', (event) => {
    const moonOnly = container.classList.contains('moon-only');
    if (!event.metaKey && !event.ctrlKey && !event.altKey && !isTextField(event.target)
      && (event.key.toLowerCase() === 'h' || (moonOnly && event.key === 'Escape'))) {
      event.preventDefault();
      if (!event.repeat) setMoonOnly(!moonOnly);
      return;
    }
    if (event.code === 'Escape' && closeOpenPopover()) { event.preventDefault(); return; }
    if (freeFlight) {
      if (event.code === 'Escape') leaveFlight();
      else if (!isTextField(event.target) && !event.metaKey && !event.ctrlKey && !event.altKey && movementKeys.has(event.code)) {
        event.preventDefault();
        if (event.code === 'Space' && !event.repeat) jump();
        keys.add(event.code);
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const typing = isTextField(target);
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'Escape') {
      if (closeOpenPopover()) return;
      if (narrowQuery.matches && siteList.isOpen) { setListOpen(false); sitesButton.focus(); return; }
      if (drawer.isOpen && !(typing && target.value)) { clearSelection(); return; }
      return;
    }
    if (typing || moonOnly) return;
    if (key === '/') { event.preventDefault(); focusSearch(); return; }
    if (key === 'l') { event.preventDefault(); layersPopover.toggle(); return; }
    if (!sky) return;
    const timeline = sky.timeline;
    if (key === '[' || key === ']') { timeline.stepSpeed(key === ']' ? 1 : -1); return; }
    const onControl = target instanceof HTMLElement && target.matches('button, input, [role="menuitemradio"]');
    if (onControl) return;
    if (event.code === 'Space') { event.preventDefault(); timeline.togglePlay(); }
    else if (key === 'r') timeline.toggleReverse();
    else if (key === 'n') timeline.now();
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      timeline.step((key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1));
    }
  });
  document.addEventListener('keyup', (event) => { keys.delete(event.code); });
  window.addEventListener('blur', clearFlightInput);
  document.addEventListener('visibilitychange', clearFlightInput);
  document.addEventListener('focusin', (event) => { if (isTextField(event.target)) keys.clear(); });

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

  loadingStatus.hidden = true;
  for (const panel of container.querySelectorAll('.popover, .drawer, .site-list')) makePanelDraggable(panel);
  installHelp(container);
  let statusText = '';
  function updateStatus() {
    const next = `LOLA terrain + ${textureLabel} · ${describeRelief()} · ${skyStatus}`;
    if (next !== statusText) layersStatus.textContent = statusText = next;
  }
  updateStatus();

  setView('globe');
  if (flight) finishFlight();
  const shot = params.get('shot');
  if (shot) {
    const key = shot.toLowerCase();
    const aliases = { shackleton: 'site04', apollo11: 'apollo-11', apollo: 'apollo-11' };
    if (key === 'south' || key === 'north' || key === 'globe') {
      setView(key);
      finishFlight();
    } else {
      const id = aliases[key] || key;
      const place = placesById.get(id)
        || places.find((entry) => normId(entry.id) === normId(id));
      const feature = findNamedFeature(id);
      if (place) focusPlace(place, { surface: true, instant: true });
      else if (feature) focusFeature(feature, { instant: true });
    }
  }

  const lighting = {
    sun: new THREE.Vector3(1, 0.2, 0.4),
    earth: new THREE.Vector3(-1, 0.1, 0.2),
    earthshine: 0.2,
  };

  renderer.setAnimationLoop((now) => {
    const deltaSeconds = Math.min((now - previousFrame) / 1000, 0.05);
    const realDelta = Math.min((now - previousFrame) / 1000, 1);
    previousFrame = now;
    fpsFrames++;
    if (now - fpsStamp > 500) {
      fps = fpsFrames * 1000 / (now - fpsStamp);
      fpsFrames = 0;
      fpsStamp = now;
    }

    sky?.timeline.tick(realDelta);

    if (flight) {
      stepFlight(realDelta);
    } else if (walking) {
      // Reuse scratch vectors; walking never requests DEM loads.
      radialDirection.copy(camera.position).normalize();
      camera.getWorldDirection(viewDirection).projectOnPlane(radialDirection).normalize();
      rightDirection.crossVectors(viewDirection, radialDirection).normalize();
      movement.copy(viewDirection).multiplyScalar(-stick.y).addScaledVector(rightDirection, stick.x);
      if (keys.has('KeyW') || keys.has('ArrowUp')) movement.add(viewDirection);
      if (keys.has('KeyS') || keys.has('ArrowDown')) movement.sub(viewDirection);
      if (keys.has('KeyD') || keys.has('ArrowRight')) movement.add(rightDirection);
      if (keys.has('KeyA') || keys.has('ArrowLeft')) movement.sub(rightDirection);
      let swayTarget = 0;
      if (movement.lengthSq() > 0) {
        if (movement.lengthSq() > 1) movement.normalize();
        const running = touchRunning || keys.has('ShiftLeft') || keys.has('ShiftRight');
        const speed = running ? 4 : 1.5;
        camera.position.addScaledVector(movement, speed * deltaSeconds / MOON_RADIUS_METERS);
        if (jumpHeight === 0 && jumpVelocity === 0 && !reducedMotion.matches) {
          const stride = movement.length();
          walkSwayPhase += deltaSeconds * stride * (running ? 8.5 : 5.5);
          swayTarget = Math.sin(walkSwayPhase) * stride * (running ? 0.026 : 0.016);
        }
        walkUp.copy(camera.position).normalize();
        walkRotation.setFromUnitVectors(radialDirection, walkUp);
        camera.quaternion.premultiply(walkRotation);
        camera.up.copy(walkUp);
      }
      walkSway = reducedMotion.matches ? 0 : THREE.MathUtils.damp(walkSway, swayTarget, 12, deltaSeconds);
      if (jumpHeight > 0 || jumpVelocity > 0) {
        jumpHeight += jumpVelocity * deltaSeconds - 0.5 * 1.62 * deltaSeconds * deltaSeconds;
        jumpVelocity -= 1.62 * deltaSeconds;
        if (jumpHeight <= 0) jumpHeight = jumpVelocity = 0;
      }
    } else if (freeFlight) {
      const activeKeys = heldPointers.size ? new Set([...keys, ...heldPointers.values()]) : keys;
      const yawInput = Number(activeKeys.has('KeyQ')) - Number(activeKeys.has('KeyE'));
      if (yawInput) turnFlight(camera, yawInput * 1.2 * deltaSeconds, 0);
      camera.updateMatrixWorld();
      camera.getWorldDirection(viewDirection);
      rightDirection.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      movement.copy(viewDirection).multiplyScalar(-stick.y).addScaledVector(rightDirection, stick.x);
      if (activeKeys.has('KeyW')) movement.add(viewDirection);
      if (activeKeys.has('KeyS')) movement.sub(viewDirection);
      if (activeKeys.has('KeyD')) movement.add(rightDirection);
      if (activeKeys.has('KeyA')) movement.sub(rightDirection);
      radialDirection.copy(camera.position).normalize();
      if (activeKeys.has('Space')) movement.add(radialDirection);
      if (activeKeys.has('KeyC')) movement.sub(radialDirection);
      if (movement.lengthSq() > 0) {
        if (movement.lengthSq() > 1) movement.normalize();
        const groundR = terrain.surfaceRadius(camera.position);
        const altitude = camera.position.length() - groundR;
        let speed = THREE.MathUtils.clamp(altitude * 0.28, 2 / MOON_RADIUS_METERS, 0.5);
        if (activeKeys.has('ShiftLeft') || activeKeys.has('ShiftRight')) speed *= 4;
        camera.position.addScaledVector(movement, speed * deltaSeconds);
        if (camera.position.length() > 18) camera.position.setLength(18);
        transportFlight(camera, radialDirection);
      }
    } else {
      controls.update();
      if (controls.target.lengthSq() < 0.04) {
        controls.minDistance = relief > 2 ? 1.1 : 1.012;
        controls.maxPolarAngle = Math.PI;
      }
    }

    applyRelief();
    if (walking) camera.position.setLength(terrain.surfaceRadius(camera.position) + (1.7 + jumpHeight) / MOON_RADIUS_METERS);
    radialDirection.copy(camera.position);
    const radiusNow = radialDirection.length();
    if (radiusNow > 1e-4) {
      const ground = terrain.surfaceRadius(radialDirection) + 1.15 / MOON_RADIUS_METERS;
      if (radiusNow < ground) radialDirection.multiplyScalar(ground / radiusNow);
      camera.position.copy(radialDirection);
    }

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
    updateStatus();
    // Apply sway only to the rendered view so movement and look input use a level camera.
    const swayView = walking && Math.abs(walkSway) > 1e-5;
    if (swayView) {
      walkOrientation.copy(camera.quaternion);
      camera.rotateZ(walkSway);
    }
    camera.updateMatrixWorld();
    pins.update(camera, (direction) => terrain.surfaceRadius(direction), container.clientWidth, container.clientHeight, realDelta);
    featureLabels?.update(camera, (direction) => terrain.surfaceRadius(direction), container.clientWidth, container.clientHeight, realDelta);
    renderer.render(scene, camera);
    if (swayView) {
      camera.quaternion.copy(walkOrientation);
      camera.updateMatrixWorld();
    }
  });
}
