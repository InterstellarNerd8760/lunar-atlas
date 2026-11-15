import * as THREE from 'three';

// Body-center visibility above a spherical horizon. Terrain is not included.
export function createVisibilityPanel(container, positions) {
  const panel = document.createElement('details');
  panel.className = 'visibility-panel';
  panel.open = true;
  panel.innerHTML = `<summary>Sunlight & Earth visibility</summary><div class="visibility-content"></div>`;
  const content = panel.lastElementChild;
  content.textContent = 'Select a site or double-click terrain to analyze this ephemeris window.';
  container.append(panel);
  return function analyze(point, name) {
    const up = point.clone().normalize();
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
    if (north.lengthSq() < 1e-12) north.set(1, 0, 0);
    north.normalize();
    const east = north.clone().cross(up).normalize();
    const observer = up.clone();
    const track = positions.map(sample => {
      const result = { utc: sample.utc };
      for (const body of ['sun', 'earth']) {
        const direction = sample[body].clone().sub(observer).normalize();
        result[body] = {
          elevation: Math.asin(THREE.MathUtils.clamp(direction.dot(up), -1, 1)) * 180 / Math.PI,
          azimuth: (Math.atan2(direction.dot(east), direction.dot(north)) * 180 / Math.PI + 360) % 360,
        };
      }
      return result;
    });
    let sunHours = 0, earthHours = 0, darkness = 0, longest = 0;
    const hours = (track.at(-1).utc - track[0].utc) / 3600000;
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 220;
    canvas.setAttribute('aria-label', 'Sun and Earth elevation paths versus azimuth, with spherical horizon at zero degrees');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101723'; ctx.fillRect(0, 0, 600, 220);
    ctx.strokeStyle = '#748297'; ctx.beginPath(); ctx.moveTo(25, 100); ctx.lineTo(575, 100); ctx.stroke();
    ctx.fillStyle = '#cbd5e1'; ctx.font = '12px sans-serif';
    ctx.fillText('0° horizon · N      E      S      W      N', 25, 18);
    const timeline = document.createElement('div'); timeline.className = 'visibility-strip';
    for (let i = 0; i < track.length - 1; i++) {
      const sample = track[i];
      const dt = (track[i + 1].utc - sample.utc) / 3600000;
      const sun = sample.sun.elevation > 0, earth = sample.earth.elevation > 0;
      sunHours += sun ? dt : 0; earthHours += earth ? dt : 0;
      darkness = sun ? 0 : darkness + dt; longest = Math.max(longest, darkness);
      const segment = document.createElement('span');
      segment.style.flexGrow = dt;
      segment.style.background = sun ? (earth ? '#79bfad' : '#f0c76b') : (earth ? '#73a9e7' : '#344052');
      segment.title = `${new Date(sample.utc).toISOString()} · Sun ${sun ? 'up' : 'down'} · Earth ${earth ? 'up' : 'down'}`;
      timeline.append(segment);
    }
    for (const [body, color] of [['sun', '#f0c76b'], ['earth', '#73a9e7']]) {
      ctx.fillStyle = color;
      for (const sample of track) {
        ctx.beginPath(); ctx.arc(25 + sample[body].azimuth / 360 * 550, 100 - sample[body].elevation, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    content.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = name;
    content.append(heading);
    const metrics = [
      [`${(sunHours / hours * 100).toFixed(1)}% sunlight`, 'Share of this window with the Sun’s center above the spherical horizon. Solar power also depends on terrain and hardware.'],
      [`${(earthHours / hours * 100).toFixed(1)}% Earth in view`, 'Share with Earth’s center above the spherical horizon, a first estimate for direct radio visibility.'],
      [`${longest.toFixed(0)} h longest darkness`, 'Longest sampled dark interval within this window. A night crossing the window boundary may be longer.'],
    ];
    for (const [value, explanation] of metrics) {
      const row = document.createElement('p'); const label = document.createElement('b'); label.textContent = value;
      row.append(label, document.createElement('br'), explanation); content.append(row);
    }
    content.append(canvas, timeline);
    const note = document.createElement('p');
    const step = (track[1].utc - track[0].utc) / 3600000;
    note.textContent = `${new Date(track[0].utc).toISOString().slice(0,10)} to ${new Date(track.at(-1).utc).toISOString().slice(0,10)} UTC. ${step} h samples, transitions unresolved within each interval. Yellow: Sun; blue: Earth; green: both; gray: neither. Terrain occlusion and disk edges are excluded. Polar results are seasonal.`;
    content.append(note);
    const source = document.createElement('a'); source.href = 'https://ssd.jpl.nasa.gov/horizons/'; source.textContent = 'Source: JPL Horizons'; source.target = '_blank'; source.rel = 'noopener'; content.append(source);
  };
}
