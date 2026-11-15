import * as THREE from 'three';

const dataDirectory = new URL('../public/data/', import.meta.url);
const previewBuffers = new Map();

async function fetchAsset(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load ${url.pathname.split('/').pop()} (HTTP ${response.status}).`);
  return response;
}

export async function loadSiteIndex(directory, signal) {
  const response = await fetchAsset(new URL(`${directory}/index.json`, dataDirectory), signal);
  return (await response.json()).sites;
}

function loadPreviewBuffer(archive) {
  if (!previewBuffers.has(archive)) {
    const url = new URL(`site-previews/${archive}.f32.gz`, dataDirectory);
    const load = fetchAsset(url).then(response =>
      new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    ).catch(error => {
      previewBuffers.delete(archive);
      throw error;
    });
    previewBuffers.set(archive, load);
  }
  return previewBuffers.get(archive);
}

async function readRaster(directory, path, preview, signal) {
  if (preview) {
    const metadata = preview.rasters[path];
    const packed = await loadPreviewBuffer(preview.archive);
    signal?.throwIfAborted();
    const end = metadata.offset + metadata.width * metadata.height * Float32Array.BYTES_PER_ELEMENT;
    return [packed.slice(metadata.offset, end), metadata];
  }
  const heightUrl = new URL(`${directory}/${path}`, dataDirectory);
  const metadataUrl = new URL(heightUrl.href.replace(/\.f32$/, '.json'));
  const [response, metadataResponse] = await Promise.all([
    fetchAsset(heightUrl, signal),
    fetchAsset(metadataUrl, signal),
  ]);
  return Promise.all([response.arrayBuffer(), metadataResponse.json()]);
}

async function loadRaster(directory, path, preview, signal) {
  const [buffer, metadata] = await readRaster(directory, path, preview, signal);
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

// Average valid samples into a mesh-sized grid, then replace nodata with the
// nearest valid cell. Heights are never substituted with 0.
function coarseHeights(heights, width, height, columns, rows) {
  const grid = new Float32Array(columns * rows);
  grid.fill(Number.NaN);
  const origin = new Int32Array(grid.length).fill(-1);
  const queue = [];
  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor(row * height / rows);
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * height / rows));
    const yStep = Math.max(1, Math.floor((y1 - y0) / 4));
    for (let column = 0; column < columns; column++) {
      const x0 = Math.floor(column * width / columns);
      const x1 = Math.max(x0 + 1, Math.floor((column + 1) * width / columns));
      const xStep = Math.max(1, Math.floor((x1 - x0) / 4));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += yStep) {
        for (let x = x0; x < x1; x += xStep) {
          const value = heights[y * width + x];
          if (Number.isFinite(value)) {
            sum += value;
            count++;
          }
        }
      }
      const index = row * columns + column;
      if (!count) continue;
      grid[index] = sum / count;
      origin[index] = index;
      queue.push(index);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++];
    const x = index % columns;
    const y = (index / columns) | 0;
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
      const next = ny * columns + nx;
      if (origin[next] !== -1) continue;
      origin[next] = origin[index];
      grid[next] = grid[origin[index]];
      queue.push(next);
    }
  }
  return grid;
}

const PATCH_SEGMENTS = 320;

async function loadDemPatch(site, radius, relief, material, sampleGlobe, signal) {
  const heightUrl = new URL(`site-dems/${site.file}`, dataDirectory);
  const metadataUrl = new URL(heightUrl.href.replace(/\.f32$/, '.json'));
  const [response, metadataResponse] = await Promise.all([
    fetchAsset(heightUrl, signal),
    fetchAsset(metadataUrl, signal),
  ]);
  const [buffer, metadata] = await Promise.all([response.arrayBuffer(), metadataResponse.json()]);
  const { width, height, encoding, extentM } = metadata;
  if (encoding !== 'float32-le' || buffer.byteLength !== width * height * 4) {
    throw new Error('The site elevation file does not match its metadata.');
  }
  const [west, south, east, north] = extentM;
  const span = Math.max(east - west, north - south);
  const columns = PATCH_SEGMENTS + 1;
  const rows = PATCH_SEGMENTS + 1;
  const grid = coarseHeights(new Float32Array(buffer), width, height, columns, rows);
  const projection = projectionFor(site, radius);
  const margin = Math.min(span * 0.16, 2000);
  const positions = new Float32Array(columns * rows * 3);
  const uv = new Float32Array(columns * rows * 2);
  const fade = new Float32Array(columns * rows);
  const indices = [];
  const direction = new THREE.Vector3();
  const smoothstep = THREE.MathUtils.smoothstep;
  const centerX = (west + east) / 2;
  const centerY = (south + north) / 2;
  projection.project(centerX, centerY, direction);
  const referenceLongitude = Math.atan2(-direction.z, direction.x);

  for (let row = 0; row < rows; row++) {
    const y = north + (south - north) * (row / (rows - 1));
    for (let column = 0; column < columns; column++) {
      const x = west + (east - west) * (column / (columns - 1));
      const index = row * columns + column;
      projection.project(x, y, direction);
      let longitude = Math.atan2(-direction.z, direction.x);
      longitude += Math.round((referenceLongitude - longitude) / (2 * Math.PI)) * 2 * Math.PI;
      const latitude = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
      uv[index * 2] = 0.5 + longitude / (2 * Math.PI);
      uv[index * 2 + 1] = 0.5 + latitude / Math.PI;

      const edge = Math.min(x - west, east - x, y - south, north - y);
      const blend = smoothstep(edge, 0, margin);
      const dem = grid[index];
      const globe = sampleGlobe(direction);
      const elevation = Number.isFinite(dem) ? THREE.MathUtils.lerp(globe, dem, blend) : globe;
      // A few meters of lift only while the edge fades, so the patch sits on
      // the globe instead of z-fighting it. The interior stays at true scale.
      const lift = (1 - blend) * 6;
      direction.multiplyScalar(1 + (elevation * relief + lift) / radius).toArray(positions, index * 3);
      fade[index] = blend;
    }
  }

  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const index = row * columns + column;
      const previous = index - columns;
      const corners = [previous - 1, previous, index - 1, index];
      if (corners.some((corner) => !Number.isFinite(positions[corner * 3]))) continue;
      // Row 0 is north. Wind east × north so the front face points outward.
      indices.push(previous - 1, index - 1, previous, index - 1, index, previous);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const center = new THREE.Vector3();
  projection.project(centerX, centerY, center);
  const centerEdge = Math.min(centerX - west, east - centerX, centerY - south, north - centerY);
  const centerBlend = smoothstep(centerEdge, 0, margin);
  const centerDem = grid[(rows >> 1) * columns + (columns >> 1)];
  const centerGlobe = sampleGlobe(center);
  const centerElevation = Number.isFinite(centerDem)
    ? THREE.MathUtils.lerp(centerGlobe, centerDem, centerBlend)
    : centerGlobe;
  center.multiplyScalar(1 + centerElevation * relief / radius);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  mesh.renderOrder = 2;
  const inset = Math.min(margin * 0.82, span * 0.28);
  const cutout = [west + inset, south + inset, east - inset, north - inset];
  return { mesh, center, extent: cutout, projection, span };
}

function projectionFor(site, radius) {
  if (!site.layers && site.group !== 'lroc-nac-dtm') {
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
  const [latitude, longitude] = site.layers ? [site.lat, site.lon] : site.centerLatLon;
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
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
  if (site.file && (site.group === 'lroc-nac-dtm' || site.group === 'pgda-lola-5m')) {
    return loadDemPatch(site, radius, relief, material, sampleGlobe, signal);
  }
  const { layers: mission } = site;
  const bundled = site.file && (site.group === 'lroc-nac-dtm' || site.group === 'pgda-lola-5m');
  const directory = bundled ? 'site-dems' : mission ? 'landing-sites' : 'lola-sites';
  const files = bundled ? [{
    path: site.file,
    // Bound the preview mesh size while sampling the original elevation grid.
    spacing: Math.max(site.width, site.height) * site.resolutionM / 320,
    blend: 250,
  }] : mission ? [
    { path: mission.horizon.file, spacing: 1100, blend: 6500 },
    { path: mission.ground.file, spacing: 85, blend: 500 },
  ] : [
    { path: site.context, spacing: 1050, blend: 6500 },
    { path: site.height, spacing: 100, blend: 600 },
  ];
  if (mission?.nac) files.push({ path: mission.nac.file, spacing: 16, blend: 100 });
  const layers = await Promise.all(files.map(async ({ path, spacing, blend }) => ({
    ...await loadRaster(directory, path, site.preview, signal), spacing, blend,
  })));
  const projection = projectionFor(site, radius);
  const extent = layers[0].extent;
  const [west, south, east, north] = (layers[1] ?? layers[0]).extent;
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

  const textureCenter = projection.project((west + east) / 2, (south + north) / 2, new THREE.Vector3());
  const referenceLongitude = Math.atan2(-textureCenter.z, textureCenter.x);
  for (let row = 0; row < ys.length; row++) {
    for (let column = 0; column < xs.length; column++) {
      const x = xs[column];
      const y = ys[row];
      const index = row * xs.length + column;
      projection.project(x, y, direction);
      let longitude = Math.atan2(-direction.z, direction.x);
      // Keep nearby vertices together across the global texture's date-line seam.
      longitude += Math.round((referenceLongitude - longitude) / (2 * Math.PI)) * 2 * Math.PI;
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
  geometry.setAttribute('fade', new THREE.BufferAttribute(new Float32Array(xs.length * ys.length).fill(1), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const x = (west + east) / 2;
  const y = (south + north) / 2;
  const center = projection.project(x, y, new THREE.Vector3());
  center.multiplyScalar(surfaceRadius(x, y, center));
  // Keep vertex coordinates relative to the patch center for close-range precision.
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  const span = Math.max(east - west, north - south);
  return { mesh, center, extent, projection, span };
}
