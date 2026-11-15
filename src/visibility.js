import * as THREE from 'three';

const COLORS = { sun: '#f0c76b', earth: '#73a9e7', axis: 'rgba(255,255,255,0.18)', text: '#c5cad5', background: '#10141d' };

const formatUtc = new Intl.DateTimeFormat('en', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function utcLabel(ms) {
  return `${formatUtc.format(ms)} UTC`;
}

// Body-center visibility above a spherical horizon. Terrain is not included.
export function createVisibilityPanel(section, positions, { onStatus } = {}) {
  section.classList.add('vis');
  section.innerHTML = `
    <h3>Sunlight and Earth visibility</h3>
    <ul class="vis__status" aria-label="Status at the selected time">
      <li><span class="dot" data-dot="sun"></span><span data-status="sun"></span></li>
      <li><span class="dot" data-dot="earth"></span><span data-status="earth"></span></li>
    </ul>
    <dl class="vis__metrics"></dl>
    <div class="strip" role="img"></div>
    <div class="strip__axis text-xs mono"><span></span><span></span></div>
    <ul class="legend">
      <li><span class="legend__swatch" aria-hidden="true"><i class="sun"></i><i></i></span>Top lane: Sun up</li>
      <li><span class="legend__swatch" aria-hidden="true"><i></i><i class="earth"></i></span>Bottom lane: Earth in view</li>
      <li><span class="legend__swatch" aria-hidden="true"><i class="sun"></i><i class="earth"></i></span>Both</li>
      <li><span class="legend__swatch" aria-hidden="true"><i></i><i></i></span>Neither</li>
    </ul>
    <details>
      <summary class="text-xs">Sky path (azimuth vs elevation)</summary>
    </details>
    <p class="text-xs vis__note"></p>
    <p class="text-xs"><a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noopener">Source: JPL Horizons</a></p>
  `;
  const statusText = {
    sun: section.querySelector('[data-status="sun"]'),
    earth: section.querySelector('[data-status="earth"]'),
  };
  const dots = {
    sun: section.querySelector('[data-dot="sun"]'),
    earth: section.querySelector('[data-dot="earth"]'),
  };
  const metrics = section.querySelector('.vis__metrics');
  const strip = section.querySelector('.strip');
  const axis = section.querySelectorAll('.strip__axis span');
  const plotHolder = section.querySelector('details');
  const note = section.querySelector('.vis__note');
  const playhead = document.createElement('span');
  playhead.className = 'strip__playhead';

  const t0 = positions[0].utc;
  const t1 = positions.at(-1).utc;
  let track = null;
  let lastIndex = 0;
  let lastState = '';

  function elevationAt(body, index) {
    const a = track[Math.floor(index)][body].elevation;
    const b = track[Math.ceil(index)][body].elevation;
    return a + (b - a) * (index % 1);
  }

  function setTime(index) {
    lastIndex = index;
    if (!track) return;
    const i0 = Math.floor(index);
    const utc = track[i0].utc + (index % 1) * ((track[Math.ceil(index)].utc) - track[i0].utc);
    playhead.style.left = `${((utc - t0) / (t1 - t0)) * 100}%`;
    const sun = elevationAt('sun', index) > 0;
    const earth = elevationAt('earth', index) > 0;
    const state = `${sun}${earth}`;
    if (state === lastState) return;
    lastState = state;
    statusText.sun.textContent = sun ? 'Sun up' : 'Sun down';
    statusText.earth.textContent = earth ? 'Earth in view' : 'Earth below horizon';
    dots.sun.classList.toggle('dot--sun', sun);
    dots.earth.classList.toggle('dot--earth', earth);
    onStatus?.(`${sun ? 'Sun up' : 'Sun down'} · ${earth ? 'Earth in view' : 'Earth below horizon'}`);
  }

  function analyze(point) {
    const up = point.clone().normalize();
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
    if (north.lengthSq() < 1e-12) north.set(1, 0, 0);
    north.normalize();
    const east = north.clone().cross(up).normalize();
    const observer = up.clone();
    track = positions.map((sample) => {
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
    const hours = (t1 - t0) / 3600000;
    const segments = [];
    for (let i = 0; i < track.length - 1; i++) {
      const sample = track[i];
      const dt = (track[i + 1].utc - sample.utc) / 3600000;
      const sun = sample.sun.elevation > 0;
      const earth = sample.earth.elevation > 0;
      sunHours += sun ? dt : 0;
      earthHours += earth ? dt : 0;
      darkness = sun ? 0 : darkness + dt;
      longest = Math.max(longest, darkness);
      const segment = document.createElement('span');
      segment.className = 'strip__seg';
      segment.style.flexGrow = dt;
      segment.dataset.sun = sun ? '1' : '0';
      segment.dataset.earth = earth ? '1' : '0';
      const state = sun && earth ? 'Sun up, Earth in view' : sun ? 'Sun up, Earth below horizon' : earth ? 'Sun down, Earth in view' : 'Sun down, Earth below horizon';
      segment.title = `${utcLabel(sample.utc)} · ${state}`;
      segment.innerHTML = '<span class="strip__lane strip__lane--sun"></span><span class="strip__lane strip__lane--earth"></span>';
      segments.push(segment);
    }
    strip.replaceChildren(...segments, playhead);
    strip.setAttribute('aria-label', `Sun and Earth visibility from ${utcLabel(t0)} to ${utcLabel(t1)}. Top lane Sun, bottom lane Earth.`);
    axis[0].textContent = new Date(t0).toISOString().slice(5, 10).replace('-', '/');
    axis[1].textContent = new Date(t1).toISOString().slice(5, 10).replace('-', '/');

    const metric = (label, value, title) => {
      const item = document.createElement('div');
      item.title = title;
      item.innerHTML = `<dt></dt><dd class="mono"></dd>`;
      item.firstChild.textContent = label;
      item.lastChild.textContent = value;
      return item;
    };
    metrics.replaceChildren(
      metric('Sunlight', `${(sunHours / hours * 100).toFixed(1)}%`, 'Share of this window with the Sun’s center above the spherical horizon. Solar power also depends on terrain and hardware.'),
      metric('Earth in view', `${(earthHours / hours * 100).toFixed(1)}%`, 'Share with Earth’s center above the spherical horizon, a first estimate for direct radio visibility.'),
      metric('Longest dark', `${longest.toFixed(0)} h`, 'Longest sampled dark interval within this window. A night crossing the window boundary may be longer.'),
    );

    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 220;
    canvas.setAttribute('aria-label', 'Sun and Earth elevation paths versus azimuth, with spherical horizon at zero degrees');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = COLORS.background; ctx.fillRect(0, 0, 600, 220);
    ctx.strokeStyle = COLORS.axis; ctx.beginPath(); ctx.moveTo(25, 100); ctx.lineTo(575, 100); ctx.stroke();
    ctx.fillStyle = COLORS.text; ctx.font = '13px system-ui, sans-serif';
    ['N', 'E', 'S', 'W', 'N'].forEach((label, i) => ctx.fillText(label, 21 + i * 137.5, 120));
    ctx.fillText('0° horizon', 25, 92);
    for (const body of ['sun', 'earth']) {
      ctx.fillStyle = COLORS[body];
      for (const sample of track) {
        ctx.beginPath(); ctx.arc(25 + sample[body].azimuth / 360 * 550, 100 - sample[body].elevation, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    plotHolder.querySelector('canvas')?.remove();
    plotHolder.append(canvas);

    const step = (track[1].utc - track[0].utc) / 3600000;
    note.textContent = `${new Date(t0).toISOString().slice(0, 10)} to ${new Date(t1).toISOString().slice(0, 10)} UTC, ${step} h samples; transitions within an interval are unresolved. Uses a spherical horizon: terrain occlusion and disk edges are excluded. Polar results are seasonal.`;
    lastState = '';
    setTime(lastIndex);
  }

  return { analyze, setTime };
}
