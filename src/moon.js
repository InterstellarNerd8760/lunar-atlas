import * as THREE from 'three';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

const MOON_RADIUS_METERS = 1_737_400;
const DISPLAY_RELIEF = 6;
const MESH_WIDTH_SEGMENTS = 512;
const MESH_HEIGHT_SEGMENTS = 256;

export function mountMoonView(container) {
  container.replaceChildren();

  const status = document.createElement('p');
  status.className = 'moon-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading LOLA elevation…';
  container.append(status);

  loadMoon(container, status).catch((error) => {
    console.error(error);
    status.textContent = `Could not load the Moon data: ${error.message}`;
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
  scene.background = new THREE.Color('#080b12');

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(0, 0.1, 3.25);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x77809a, 1.3));
  const sunlight = new THREE.DirectionalLight(0xfff1d0, 3.2);
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

  const moon = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: '#aaa9a5',
      roughness: 1,
      metalness: 0,
    }),
  );
  scene.add(moon);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.15;
  controls.maxDistance = 8;

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

  status.textContent = `LOLA global terrain loaded · relief ×${DISPLAY_RELIEF}`;
  status.classList.add('moon-status--loaded');

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}
