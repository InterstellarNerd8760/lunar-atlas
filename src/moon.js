import * as THREE from 'three';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

import { addSky } from './sky.js';

const MOON_RADIUS_METERS = 1_737_400;
const DISPLAY_RELIEF = 6;
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
  const metadataUrl = new URL('../public/data/global-height.json', import.meta.url);
  const heightUrl = new URL('../public/data/global-height.f32', import.meta.url);

  const [metadataResponse, heightResponse] = await Promise.all([
    fetch(metadataUrl),
    fetch(heightUrl),
  ]);
  if (!metadataResponse.ok || !heightResponse.ok) {
    throw new Error('Put global-height.json and global-height.f32 in public/data/.');
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

  const camera = new THREE.PerspectiveCamera(42, 1, 0.002, 600);
  camera.position.set(0, 0.1, 3.25);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
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
  scene.add(moon);

  let skyStatus = 'JPL Horizons';
  try {
    await addSky(scene, camera, sunlight, container);
  } catch (error) {
    console.warn(error);
    skyStatus = 'Preview lighting';
  }

  const canvas = renderer.domElement;
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.06;
  controls.maxDistance = 8;

  const initialCameraPosition = camera.position.clone();
  const cameraToolbar = document.createElement('nav');
  cameraToolbar.className = 'camera-toolbar';
  cameraToolbar.setAttribute('aria-label', 'Camera controls');
  cameraToolbar.innerHTML =
    '<span class="camera-toolbar__label">Camera</span>' +
    '<button type="button" data-view="globe" aria-pressed="true">Globe</button>' +
    '<button type="button" data-view="north">North pole</button>' +
    '<button type="button" data-view="south">South pole</button>' +
    '<button type="button" data-action="flight" aria-pressed="false">Free flight</button>';
  container.append(cameraToolbar);

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

  const origin = new THREE.Vector3(0, 0, 0);
  const flightRaycaster = new THREE.Raycaster();
  const viewDirection = new THREE.Vector3();
  const rightDirection = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const radialDirection = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();

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
    const hit = flightRaycaster.intersectObject(moon, false)[0];
    return hit ? hit.point : origin;
  }

  function leaveFlight(releasePointer = true) {
    if (!freeFlight) return;
    freeFlight = false;
    keys.clear();
    dragPointerId = null;
    controls.enabled = true;
    controls.target.copy(focusInFrontOfCamera());
    controls.minDistance = controls.target.lengthSq() > 0.1 ? 0.035 : 1.06;
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
    camera.getWorldDirection(viewDirection);
    yaw = Math.atan2(-viewDirection.x, -viewDirection.z);
    pitch = Math.asin(THREE.MathUtils.clamp(viewDirection.y, -1, 1));
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
    flightButton.textContent = 'Exit flight';
    flightButton.setAttribute('aria-pressed', 'true');
    flightHint.hidden = false;
    canvas.focus({ preventScroll: true });
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  }

  function setView(view) {
    if (freeFlight) leaveFlight();
    controls.enabled = true;
    controls.target.set(0, 0, 0);
    controls.minDistance = 1.06;

    if (view === 'north') camera.position.set(0, 3.25, 0.001);
    else if (view === 'south') camera.position.set(0, -3.25, 0.001);
    else camera.position.copy(initialCameraPosition);

    camera.lookAt(controls.target);
    controls.update();
    for (const button of viewButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    }
  }

  for (const button of viewButtons) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }
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
    const hit = picker.intersectObject(moon, false)[0];
    if (!hit) return;
    controls.target.copy(hit.point);
    controls.minDistance = 0.035;
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
      if (keys.has('Space')) movement.y += 1;
      if (keys.has('KeyC')) movement.y -= 1;

      if (movement.lengthSq() > 0) {
        movement.normalize();
        let speed = THREE.MathUtils.clamp((camera.position.length() - 1) * 0.16, 0.008, 0.45);
        if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed *= 3;
        camera.position.addScaledVector(movement, speed * deltaSeconds);
        if (camera.position.length() > MAX_FLIGHT_RADIUS) {
          camera.position.setLength(MAX_FLIGHT_RADIUS);
        }
      }

      radialDirection.copy(camera.position).normalize();
      rayOrigin.copy(radialDirection).multiplyScalar(2);
      rayDirection.copy(radialDirection).negate();
      flightRaycaster.set(rayOrigin, rayDirection);
      const surfaceHit = flightRaycaster.intersectObject(moon, false)[0];
      if (surfaceHit) {
        const minimumRadius = surfaceHit.point.length() + FLIGHT_CLEARANCE;
        if (camera.position.length() < minimumRadius) {
          camera.position.copy(radialDirection).multiplyScalar(minimumRadius);
        }
      }
    } else {
      controls.update();
    }

    renderer.render(scene, camera);
  });
}
