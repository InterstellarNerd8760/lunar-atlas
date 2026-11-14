import * as THREE from 'three';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

import { addSky } from './sky.js';
import { loadSiteIndex, loadSiteTerrain } from './site-terrain.js';

const MOON_RADIUS_METERS = 1_737_400;
const DISPLAY_RELIEF = 1;
const MESH_WIDTH_SEGMENTS = 512;
const MESH_HEIGHT_SEGMENTS = 256;
const FLIGHT_CLEARANCE = 0.008;
const MAX_FLIGHT_RADIUS = 18;

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
  function fetchGlobalHeight(prefix) {
    return Promise.all([
      fetch(new URL(prefix + 'global-height.json', dataDirectory)),
      fetch(new URL(prefix + 'global-height.f32', dataDirectory)),
    ]);
  }
  let [metadataResponse, heightResponse] = await fetchGlobalHeight('global-height/');
  if (!metadataResponse.ok || !heightResponse.ok) {
    [metadataResponse, heightResponse] = await fetchGlobalHeight('');
  }
  if (!metadataResponse.ok || !heightResponse.ok) {
    throw new Error('Global LOLA elevation files are missing from public/data/global-height/.');
  }

  const metadata = await metadataResponse.json();
  const heightBuffer = await heightResponse.arrayBuffer();
  const expectedSamples = metadata.width * metadata.height;
  if (heightBuffer.byteLength !== expectedSamples * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error('The elevation file size does not match its metadata.');
  }
  const heights = new Float32Array(heightBuffer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#030509');

  const camera = new THREE.PerspectiveCamera(42, 1, 2 / MOON_RADIUS_METERS, 600);
  camera.position.set(0, 0.1, 3.25);

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D Moon. Drag to orbit; double-click terrain to focus.');
  container.append(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xc2ccdf, 0.17));
  const sunlight = new THREE.DirectionalLight(0xfff4df, 2.8);
  sunlight.position.set(-3, 1.5, 4);
  scene.add(sunlight);

  const geometry = new THREE.SphereGeometry(
    1,
    MESH_WIDTH_SEGMENTS,
    MESH_HEIGHT_SEGMENTS,
  );
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  const direction = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    const column = Math.min(
      metadata.width - 1,
      Math.floor(uvs.getX(i) * metadata.width),
    );
    const row = Math.min(
      metadata.height - 1,
      Math.floor((1 - uvs.getY(i)) * metadata.height),
    );
    const elevationMeters = heights[row * metadata.width + column];
    direction.fromBufferAttribute(positions, i).normalize();

    const radius = 1 + (elevationMeters / MOON_RADIUS_METERS) * DISPLAY_RELIEF;
    positions.setXYZ(i, direction.x * radius, direction.y * radius, direction.z * radius);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const textureUrl = new URL('../public/data/wac-texture.jpg', import.meta.url);
  let texture = null;
  try {
    texture = await new THREE.TextureLoader().loadAsync(textureUrl.href);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  } catch {
    // The terrain still renders in gray while the WAC texture is being prepared.
  }

  const moon = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: texture ? '#ffffff' : '#aaa9a5',
      map: texture,
      roughness: 1,
      metalness: 0,
    }),
  );
  const cutout = { value: new THREE.Vector4() };
  const cutoutCenter = { value: new THREE.Vector3() };
  const cutoutEast = { value: new THREE.Vector3() };
  const cutoutNorth = { value: new THREE.Vector3() };
  const cutoutPolar = { value: false };
  const cutoutActive = { value: false };
  // Replace the globe inside the high-resolution terrain's projected footprint.
  moon.material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { siteCutout: cutout, cutoutCenter, cutoutEast, cutoutNorth, cutoutPolar, cutoutActive });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 lunarPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nlunarPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 lunarPosition;
        uniform vec4 siteCutout;
        uniform vec3 cutoutCenter, cutoutEast, cutoutNorth;
        uniform bool cutoutPolar, cutoutActive;
      `)
      .replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        if (cutoutActive) {
          vec3 lunarDirection = normalize(lunarPosition);
          float cosine = dot(lunarDirection, cutoutCenter);
          if (cosine > 0.0) {
            vec2 coordinates = vec2(dot(lunarDirection, cutoutEast), dot(lunarDirection, cutoutNorth));
            float sine = length(coordinates);
            float scale = cutoutPolar ? 2.0 / (1.0 + cosine) : (sine > 0.000001 ? atan(sine, cosine) / sine : 1.0);
            coordinates *= scale * ${MOON_RADIUS_METERS.toFixed(1)};
            if (all(greaterThan(coordinates, siteCutout.xy)) && all(lessThan(coordinates, siteCutout.zw))) discard;
          }
        }
      `);
  };

  function sampleGlobe(direction) {
    const u = 0.5 + Math.atan2(-direction.z, direction.x) / (2 * Math.PI);
    const v = 0.5 - Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) / Math.PI;
    const column = Math.min(metadata.width - 1, Math.floor(u * metadata.width));
    const row = Math.min(metadata.height - 1, Math.floor(v * metadata.height));
    return heights[row * metadata.width + column];
  }
  const siteMaterial = moon.material.clone();
  scene.add(moon);

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
    controls.minDistance = 1.06;
    controls.maxDistance = 8;
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
  siteSelect.hidden = true;
  cameraToolbar.insertBefore(siteSelect, cameraToolbar.lastElementChild);
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
  let lastCollisionCheck = previousFrame;
  let activeSite = null;
  let siteRequest = null;

  const origin = new THREE.Vector3(0, 0, 0);
  const flightRaycaster = new THREE.Raycaster();
  const viewDirection = new THREE.Vector3();
  const rightDirection = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const radialDirection = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();

  function surfaceHit(raycaster) {
    const siteHit = activeSite ? raycaster.intersectObject(activeSite.mesh, false)[0] : null;
    const globeHit = raycaster.intersectObject(moon, false).find(({ point }) => {
      if (!activeSite) return true;
      const { projection } = activeSite;
      const length = point.length();
      const cosine = point.dot(projection.center) / length;
      if (cosine <= 0) return true;
      const east = point.dot(projection.east) / length;
      const north = point.dot(projection.north) / length;
      const sine = Math.hypot(east, north);
      const scale = projection.polar ? 2 / (1 + cosine) : sine > 0 ? Math.atan2(sine, cosine) / sine : 1;
      const x = east * scale * MOON_RADIUS_METERS;
      const y = north * scale * MOON_RADIUS_METERS;
      const extent = cutout.value;
      return x <= extent.x || x >= extent.z || y <= extent.y || y >= extent.w;
    });
    return siteHit && (!globeHit || siteHit.distance < globeHit.distance) ? siteHit : globeHit;
  }

  function resetSite() {
    siteRequest?.abort();
    siteRequest = null;
    if (activeSite) {
      scene.remove(activeSite.mesh);
      activeSite.mesh.geometry.dispose();
      activeSite = null;
    }
    cutoutActive.value = false;
    siteSelect.value = '';
    siteStatus.hidden = true;
  }

  function updateFlightLook(deltaX, deltaY) {
    const sensitivity = 0.002;
    yaw -= deltaX * sensitivity;
    pitch = THREE.MathUtils.clamp(pitch - deltaY * sensitivity, -1.52, 1.52);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
  }

  function focusInFrontOfCamera() {
    camera.updateMatrixWorld();
    camera.getWorldDirection(viewDirection);
    flightRaycaster.set(camera.position, viewDirection);
    const hit = surfaceHit(flightRaycaster);
    return hit ? hit.point : origin;
  }

  function leaveFlight(releasePointer = true) {
    if (!freeFlight) return;
    freeFlight = false;
    keys.clear();
    dragPointerId = null;
    const focus = focusInFrontOfCamera().clone();
    const up = activeSite ? activeSite.center.clone().normalize() : new THREE.Vector3(0, 1, 0);
    createOrbitControls(up);
    controls.target.copy(focus);
    controls.minDistance = activeSite ? 5 / MOON_RADIUS_METERS : focus.lengthSq() > 0.1 ? 0.035 : 1.06;
    if (activeSite) controls.maxPolarAngle = Math.PI / 2;
    controls.update();
    flightButton.textContent = 'Free flight';
    flightButton.setAttribute('aria-pressed', 'false');
    flightHint.hidden = true;

    if (releasePointer && document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
    if (controls.target.lengthSq() > 0.1) {
      for (const button of viewButtons) button.setAttribute('aria-pressed', 'false');
    }
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

  function setView(view) {
    if (freeFlight) leaveFlight();
    resetSite();
    camera.fov = 42;
    camera.updateProjectionMatrix();
    const isPolarView = view === 'north' || view === 'south';
    createOrbitControls(new THREE.Vector3(0, isPolarView ? 0 : 1, isPolarView ? 1 : 0));

    if (view === 'north') camera.position.set(0, 3.25, 0.001);
    else if (view === 'south') camera.position.set(0, -3.25, 0.001);
    else camera.position.copy(initialCameraPosition);

    camera.lookAt(controls.target);
    controls.update();
    for (const button of viewButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    }
  }

  const siteGroups = [
    ['landing-sites', 'Historical landing sites', (site) => !site.id.startsWith('artemis3-')],
    ['landing-sites', 'Artemis III terrain proxies', (site) => site.id.startsWith('artemis3-')],
    ['lola-sites', 'South pole LOLA surveys', () => true],
  ];
  Promise.allSettled(['landing-sites', 'lola-sites'].map(async (directory) => [directory, await loadSiteIndex(directory)])).then((results) => {
    const indexes = new Map(results.filter(({ status }) => status === 'fulfilled').map(({ value }) => value));
    const sites = new Map();
    for (const [directory, label, include] of siteGroups) {
      const group = document.createElement('optgroup');
      group.label = label;
      for (const site of (indexes.get(directory) ?? []).filter(include)) {
        const id = site.id ?? site.siteId;
        sites.set(id, site);
        group.append(new Option(site.name ?? site.siteName, id));
      }
      if (group.childElementCount) siteSelect.append(group);
    }
    if (!sites.size) {
      siteStatus.hidden = false;
      siteStatus.textContent = 'Extract landing-sites.zip and lola-sites.zip into public/data to explore detailed sites.';
      return;
    }
    siteSelect.hidden = false;
    siteSelect.addEventListener('change', async () => {
      const id = siteSelect.value;
      const site = sites.get(id);
      if (freeFlight) leaveFlight();
      if (!site) {
        setView('south');
        return;
      }
      resetSite();
      siteSelect.value = id;
      const name = site.name ?? site.siteName;
      const request = new AbortController();
      siteRequest = request;
      siteStatus.hidden = false;
      siteStatus.textContent = `Loading ${name}…`;
      try {
        const terrain = await loadSiteTerrain(site, MOON_RADIUS_METERS, DISPLAY_RELIEF, siteMaterial, sampleGlobe, request.signal);
        if (request.signal.aborted) {
          terrain.mesh.geometry.dispose();
          return;
        }
        if (freeFlight) leaveFlight();
        activeSite = terrain;
        cutout.value.set(...terrain.extent);
        cutoutCenter.value.copy(terrain.projection.center);
        cutoutEast.value.copy(terrain.projection.east);
        cutoutNorth.value.copy(terrain.projection.north);
        cutoutPolar.value = terrain.projection.polar;
        cutoutActive.value = true;
        scene.add(terrain.mesh);
        const up = terrain.center.clone().normalize();
        const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
        createOrbitControls(up);
        const distance = 120 / MOON_RADIUS_METERS;
        camera.fov = 65;
        camera.updateProjectionMatrix();
        camera.position.copy(terrain.center).addScaledVector(up, distance).addScaledVector(north, -distance * 0.55);
        controls.target.copy(terrain.center).addScaledVector(north, 1500 / MOON_RADIUS_METERS);
        controls.minDistance = 5 / MOON_RADIUS_METERS;
        controls.maxPolarAngle = Math.PI / 2;
        camera.lookAt(controls.target);
        controls.update();
        for (const button of viewButtons) button.setAttribute('aria-pressed', 'false');
        sky?.analyze(terrain.center, name);
        const coordinates = site.layers ? [site.lat, site.lon] : site.centerLatLon;
        const [latitude, longitude] = coordinates;
        const coordinateText = `${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? 'S' : 'N'} · ${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? 'W' : 'E'}`;
        const details = [name, site.id?.startsWith('artemis3-') ? 'Terrain proxy' : site.year, site.country_or_company, coordinateText].filter(Boolean);
        siteStatus.textContent = details.join(' · ');
      } catch (error) {
        if (request.signal.aborted) return;
        console.warn(error);
        setView('south');
        siteStatus.textContent = `Could not load ${name}.`;
        siteStatus.hidden = false;
      }
    });
  });

  for (const button of viewButtons) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }
  const earthButton = document.createElement('button');
  earthButton.textContent = 'Look at Earth';
  earthButton.addEventListener('click', () => {
    if (!sky) return;
    if (freeFlight) leaveFlight();
    controls.target.copy(sky.earth.position);
    camera.lookAt(controls.target);
    controls.update();
  });
  cameraToolbar.append(earthButton);
  const groundButton = document.createElement('button');
  groundButton.textContent = 'Stand on surface';
  groundButton.addEventListener('click', () => {
    if (!activeSite) return;
    if (freeFlight) leaveFlight();
    const up = activeSite.center.clone().normalize();
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
    const ray = new THREE.Raycaster(up.clone().multiplyScalar(2), up.clone().negate());
    activeSite.mesh.updateMatrixWorld(true);
    const point = surfaceHit(ray)?.point ?? activeSite.center;
    camera.position.copy(point).addScaledVector(up, 8 / MOON_RADIUS_METERS);
    createOrbitControls(up);
    controls.minDistance = 5 / MOON_RADIUS_METERS;
    controls.target.copy(camera.position).addScaledVector(north, 500 / MOON_RADIUS_METERS);
    camera.fov = 65;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
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
    const hit = surfaceHit(picker);
    if (!hit) return;
    sky?.analyze(hit.point, "Selected terrain point");
    controls.target.copy(hit.point);
    controls.minDistance = activeSite ? 5 / MOON_RADIUS_METERS : 0.035;
    controls.update();
    for (const button of viewButtons) button.setAttribute('aria-pressed', 'false');
  });

  canvas.addEventListener('mousemove', (event) => {
    if (freeFlight && document.pointerLockElement === canvas) {
      updateFlightLook(event.movementX, event.movementY);
    }
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
  canvas.addEventListener('pointercancel', () => {
    dragPointerId = null;
  });

  document.addEventListener('pointerlockchange', () => {
    if (freeFlight && document.pointerLockElement !== canvas) leaveFlight(false);
  });

  const movementKeys = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight',
  ]);
  document.addEventListener('keydown', (event) => {
    if (!freeFlight || !movementKeys.has(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
  });
  document.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
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

  status.textContent = texture
    ? 'LOLA terrain + WAC texture · relief ×' + DISPLAY_RELIEF
    : 'LOLA terrain loaded · add WAC texture · relief ×' + DISPLAY_RELIEF;
  status.textContent += ' · ' + skyStatus;
  status.classList.add('moon-status--loaded');

  renderer.setAnimationLoop((now) => {
    const deltaSeconds = Math.min((now - previousFrame) / 1000, 0.05);
    previousFrame = now;

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
        const altitude = camera.position.length() - (activeSite?.center.length() ?? 1);
        let speed = THREE.MathUtils.clamp(altitude * 0.16, activeSite ? 1 / MOON_RADIUS_METERS : 0.008, 0.45);
        if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed *= 3;
        camera.position.addScaledVector(movement, speed * deltaSeconds);
        if (camera.position.length() > MAX_FLIGHT_RADIUS) {
          camera.position.setLength(MAX_FLIGHT_RADIUS);
        }
      }

      if (camera.position.length() < 1.15 && now - lastCollisionCheck >= 100) {
        lastCollisionCheck = now;
        radialDirection.copy(camera.position).normalize();
        rayOrigin.copy(radialDirection).multiplyScalar(2);
        rayDirection.copy(radialDirection).negate();
        flightRaycaster.set(rayOrigin, rayDirection);
        const hit = surfaceHit(flightRaycaster);
        if (hit) {
          const minimumRadius = hit.point.length() + (activeSite ? 5 / MOON_RADIUS_METERS : FLIGHT_CLEARANCE);
          if (camera.position.length() < minimumRadius) {
            camera.position.copy(radialDirection).multiplyScalar(minimumRadius);
          }
        }
      }
    } else {
      controls.update();
    }

    renderer.render(scene, camera);
  });
}
