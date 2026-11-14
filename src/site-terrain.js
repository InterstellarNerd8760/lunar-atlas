import * as THREE from 'three';

const dataDirectory = new URL('../public/data/', import.meta.url);

async function fetchAsset(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load ${url.pathname.split('/').pop()} (HTTP ${response.status}).`);
  return response;
}

export async function loadSiteIndex(directory, signal) {
  const response = await fetchAsset(new URL(`${directory}/index.json`, dataDirectory), signal);
  return (await response.json()).sites;
}

async function loadRaster(directory, path, signal) {
  const heightUrl = new URL(`${directory}/${path}`, dataDirectory);
  const metadataUrl = new URL(heightUrl.href.replace(/\.f32$/, '.json'));
  const [response, metadataResponse] = await Promise.all([
    fetchAsset(heightUrl, signal),
    fetchAsset(metadataUrl, signal),
  ]);
  const [buffer, metadata] = await Promise.all([response.arrayBuffer(), metadataResponse.json()]);
  const { width, height, encoding, affine } = metadata;
  if (encoding !== 'float32-le' || buffer.byteLength !== width * height * 4) {
    throw new Error('The site elevation file does not match its metadata.');
  }

  const [pixelWidth, , west, , pixelHeight, north] = affine;
  const heights = new Float32Array(buffer);
  const clamp = THREE.MathUtils.clamp;
  const lerp = THREE.MathUtils.lerp;
  function sample(x, y) {
    const column = clamp((x - west) / pixelWidth - 0.5, 0, width - 1);
    const row = clamp((y - north) / pixelHeight - 0.5, 0, height - 1);
    const i = Math.floor(column);
    const j = Math.floor(row);
    const right = Math.min(i + 1, width - 1);
    const bottom = Math.min(j + 1, height - 1);
    return lerp(
      lerp(heights[j * width + i], heights[j * width + right], column - i),
      lerp(heights[bottom * width + i], heights[bottom * width + right], column - i),
      row - j,
    );
  }

  return { extent: metadata.extentM, sample };
}

function axisCoordinates(axis, layers) {
  const boundaries = [...new Set(layers.flatMap(({ extent }) => [extent[axis], extent[axis + 2]]))].sort((a, b) => a - b);
  const coordinates = [boundaries[0]];
  for (let i = 1; i < boundaries.length; i++) {
    const from = boundaries[i - 1];
    const to = boundaries[i];
    const { spacing } = layers.findLast(({ extent }) => extent[axis] <= from && extent[axis + 2] >= to);
    const steps = Math.ceil((to - from) / spacing);
    for (let step = 1; step <= steps; step++) {
      coordinates.push(THREE.MathUtils.lerp(from, to, step / steps));
    }
  }
  return coordinates;
}

function projectionFor(site, radius) {
  if (!site.layers) {
    // Inverse south polar stereographic projection at true scale at the pole.
    return {
      project(x, y, target) {
        const t = (x * x + y * y) / (4 * radius * radius);
        return target.set(y / radius, t - 1, -x / radius).divideScalar(1 + t);
      },
      center: new THREE.Vector3(0, -1, 0),
      east: new THREE.Vector3(0, 0, -1),
      north: new THREE.Vector3(1, 0, 0),
      polar: true,
    };
  }
  // Inverse azimuthal equidistant projection on the same lunar reference sphere.
  const lat = THREE.MathUtils.degToRad(site.lat);
  const lon = THREE.MathUtils.degToRad(site.lon);
  const center = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
  const east = new THREE.Vector3(-Math.sin(lon), 0, -Math.cos(lon));
  const north = new THREE.Vector3().crossVectors(center, east);
  return {
    project(x, y, target) {
      const distance = Math.hypot(x, y);
      const angle = distance / radius;
      const scale = distance > 0 ? Math.sin(angle) / distance : 0;
      return target.copy(center).multiplyScalar(Math.cos(angle))
        .addScaledVector(east, x * scale).addScaledVector(north, y * scale);
    },
    center,
    east,
    north,
    polar: false,
  };
}

export async function loadSiteTerrain(site, radius, relief, material, sampleGlobe, signal) {
  const { layers: mission } = site;
  const directory = mission ? 'landing-sites' : 'lola-sites';
  const files = mission ? [
    { path: mission.horizon.file, spacing: 1100, blend: 6500 },
    { path: mission.ground.file, spacing: 85, blend: 500 },
  ] : [
    { path: site.context, spacing: 1050, blend: 6500 },
    { path: site.height, spacing: 100, blend: 600 },
  ];
  if (mission?.nac) files.push({ path: mission.nac.file, spacing: 16, blend: 100 });
  const layers = await Promise.all(files.map(async ({ path, spacing, blend }) => ({
    ...await loadRaster(directory, path, signal), spacing, blend,
  })));
  const projection = projectionFor(site, radius);
  const extent = layers[0].extent;
  const [west, south, east, north] = layers[1].extent;
  const xs = axisCoordinates(0, layers);
  const ys = axisCoordinates(1, layers);
  const positions = new Float32Array(xs.length * ys.length * 3);
  const uv = new Float32Array(xs.length * ys.length * 2);
  const indices = [];
  const direction = new THREE.Vector3();
  const lerp = THREE.MathUtils.lerp;

  function surfaceRadius(x, y, direction) {
    let elevation;
    for (const layer of layers) {
      const [left, bottom, right, top] = layer.extent;
      const edge = Math.min(x - left, right - x, y - bottom, top - y);
      if (edge <= 0) continue;
      const value = layer.sample(x, y);
      if (!Number.isFinite(value)) continue;
      if (edge >= layer.blend) {
        elevation = value;
      } else {
        const background = elevation ?? sampleGlobe(direction);
        elevation = lerp(background, value, THREE.MathUtils.smoothstep(edge, 0, layer.blend));
      }
    }
    return 1 + (elevation ?? sampleGlobe(direction)) * relief / radius;
  }

  for (let row = 0; row < ys.length; row++) {
    for (let column = 0; column < xs.length; column++) {
      const x = xs[column];
      const y = ys[row];
      const index = row * xs.length + column;
      projection.project(x, y, direction);
      const longitude = Math.atan2(x, y);
      const latitude = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
      uv[index * 2] = 0.5 + longitude / (2 * Math.PI);
      uv[index * 2 + 1] = 0.5 + latitude / Math.PI;
      direction.multiplyScalar(surfaceRadius(x, y, direction)).toArray(positions, index * 3);

      if (row === 0 || column === 0) continue;
      const previous = index - xs.length;
      indices.push(previous - 1, previous, index - 1, previous, index, index - 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const x = (west + east) / 2;
  const y = (south + north) / 2;
  const center = projection.project(x, y, new THREE.Vector3());
  center.multiplyScalar(surfaceRadius(x, y, center));
  return { mesh: new THREE.Mesh(geometry, material), center, extent, projection };
}
