import { analyzeTrack } from './horizon.js';

const COLORS = { sun: '#f0c76b', earth: '#73a9e7', axis: 'rgba(255,255,255,0.18)', text: '#c5cad5', background: '#10141d', terrain: 'rgba(150,158,176,0.32)', ridge: '#aab2c4' };

const formatUtc = new Intl.DateTimeFormat('en', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function utcLabel(ms) {
  return `${formatUtc.format(ms)} UTC`;
}

export const formatPct = (v) => `${v.toFixed(v > 0 && v < 1 ? 1 : 0)}%`;
export const formatHours = (h) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(0)} h`);

// Plain-language read of the terrain numbers for solar power over this window.
export function solarVerdict(t) {
  const sun = t.sunPct, dark = t.longestDarkH;
  if (sun < 5) return { level: 'no', label: 'won\u2019t work', detail: `The Sun clears the terrain only ${formatPct(sun)} of this window, so panels would sit in shadow.` };
  if (sun >= 65 && dark < 120) return { level: 'good', label: 'good', detail: `Sunlit ${formatPct(sun)} of the window and the longest dark stretch is ${formatHours(dark)}, so batteries only need to bridge short gaps.` };
  if (dark >= 240) return { level: 'day', label: 'daytime only', detail: `Plenty of Sun by day (${formatPct(sun)}), but nights last up to ${formatHours(dark)}, so you need big batteries or another power source to survive the night.` };
  return { level: 'partial', label: 'possible, with storage', detail: `Sunlit ${formatPct(sun)} of the window, with dark stretches up to ${formatHours(dark)} to cover with batteries.` };
}

function stateLabel(sun, earth) {
  return `${sun ? 'Sun up' : 'Sun down'}, ${earth ? 'Earth in view' : 'Earth hidden'}`;
}

// Two-lane strip (Sun on top, Earth below) for one analyzed track.
export function buildStrip(strip, track) {
  const segments = [];
  for (let i = 0; i < track.length - 1; i++) {
    const sample = track[i];
    const segment = document.createElement('span');
    segment.className = 'strip__seg';
    segment.style.flexGrow = (track[i + 1].utc - sample.utc) / 3600000;
    segment.dataset.sun = sample.sun.up ? '1' : '0';
    segment.dataset.earth = sample.earth.up ? '1' : '0';
    segment.title = `${utcLabel(sample.utc)} · ${stateLabel(sample.sun.up, sample.earth.up)}`;
    segment.innerHTML = '<span class="strip__lane strip__lane--sun"></span><span class="strip__lane strip__lane--earth"></span>';
    segments.push(segment);
  }
  strip.replaceChildren(...segments);
}

// Sun/Earth visibility against the LOLA terrain horizon (body centers).
export function createVisibilityPanel(section, positions, { onStatus, horizon } = {}) {
  section.classList.add('vis');
  section.innerHTML = `
    <h3>Sunlight and Earth visibility</h3>
    <ul class="vis__status" aria-label="Status at the selected time">
      <li><span class="dot" data-dot="sun"></span><span data-status="sun"></span></li>
      <li><span class="dot" data-dot="earth"></span><span data-status="earth"></span></li>
    </ul>
    <dl class="vis__metrics"></dl>
    <p class="vis__solar text-sm"></p>
    <div class="strip" role="img"></div>
    <div class="strip__axis text-xs mono"><span></span><span></span></div>
    <ul class="legend">
      <li><span class="legend__swatch" aria-hidden="true"><i class="sun"></i><i></i></span>Top lane: Sun up</li>
      <li><span class="legend__swatch" aria-hidden="true"><i></i><i class="earth"></i></span>Bottom lane: Earth in view</li>
      <li><span class="legend__swatch" aria-hidden="true"><i class="sun"></i><i class="earth"></i></span>Both</li>
      <li><span class="legend__swatch" aria-hidden="true"><i></i><i></i></span>Neither</li>
    </ul>
    <details>
      <summary class="text-xs">Sky path and terrain skyline</summary>
    </details>
    <p class="text-xs vis__note"></p>
    <p class="text-xs"><a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noopener">Sun and Earth: JPL Horizons</a> · <a href="https://pds-geosciences.wustl.edu/missions/lro/lola.htm" target="_blank" rel="noopener">Terrain: LRO LOLA</a></p>
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
  const solar = section.querySelector('.vis__solar');
  const strip = section.querySelector('.strip');
  const axis = section.querySelectorAll('.strip__axis span');
  const plotHolder = section.querySelector('details');
  const note = section.querySelector('.vis__note');
  const playhead = document.createElement('span');
  playhead.className = 'strip__playhead';

  const t0 = positions[0].utc;
  const t1 = positions.at(-1).utc;
  let result = null;
  let track = null;
  let lastIndex = 0;
  let lastState = '';

  function lerp(body, key, index) {
    const a = track[Math.floor(index)][body][key];
    const b = track[Math.ceil(index)][body][key];
    if (key === 'azimuth' && Math.abs(b - a) > 180) return a; // wrap; hold
    return a + (b - a) * (index % 1);
  }

  function bodyState(body, index) {
    const elevation = lerp(body, 'elevation', index);
    const horizonEl = lerp(body, 'horizon', index);
    return { up: elevation > horizonEl, blocked: elevation > 0 && elevation <= horizonEl };
  }

  function setTime(index) {
    lastIndex = index;
    if (!track) return;
    const i0 = Math.floor(index);
    const utc = track[i0].utc + (index % 1) * ((track[Math.ceil(index)].utc) - track[i0].utc);
    playhead.style.left = `${((utc - t0) / (t1 - t0)) * 100}%`;
    const sun = bodyState('sun', index);
    const earth = bodyState('earth', index);
    const state = `${sun.up}${sun.blocked}${earth.up}${earth.blocked}`;
    if (state === lastState) return;
    lastState = state;
    const sunText = sun.up ? 'Sun up' : sun.blocked ? 'Sun behind terrain' : 'Sun below horizon';
    const earthText = earth.up ? 'Earth in view' : earth.blocked ? 'Earth behind terrain' : 'Earth below horizon';
    statusText.sun.textContent = sunText;
    statusText.earth.textContent = earthText;
    dots.sun.classList.toggle('dot--sun', sun.up);
    dots.earth.classList.toggle('dot--earth', earth.up);
    onStatus?.(`${sunText} · ${earthText}`);
  }

  function drawSky(profile) {
    const W = 600, H = 240, left = 34, right = 590, top = 10, bottom = 214;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.setAttribute('aria-label', 'Sun and Earth paths by azimuth and elevation, over the LOLA terrain skyline');
    const ctx = canvas.getContext('2d');
    let hi = 4;
    let lo = -2;
    for (const v of profile.elevation) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
    for (const sample of track) {
      for (const body of ['sun', 'earth']) {
        const e = sample[body].elevation;
        if (e > lo - 2) hi = Math.max(hi, e);
      }
    }
    hi = Math.min(90, Math.ceil(hi * 1.1 + 1));
    lo = Math.max(-20, Math.floor(Math.min(lo, -hi * 0.15) - 1));
    const x = (az) => left + (az / 360) * (right - left);
    const y = (el) => top + ((hi - el) / (hi - lo)) * (bottom - top);
    ctx.fillStyle = COLORS.background; ctx.fillRect(0, 0, W, H);
    // terrain skyline
    ctx.beginPath();
    ctx.moveTo(x(0), y(lo));
    for (let i = 0; i <= profile.bins; i++) ctx.lineTo(x((i / profile.bins) * 360), y(profile.elevation[i % profile.bins]));
    ctx.lineTo(x(360), y(lo));
    ctx.closePath();
    ctx.fillStyle = COLORS.terrain; ctx.fill();
    ctx.strokeStyle = COLORS.ridge; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= profile.bins; i++) ctx[i ? 'lineTo' : 'moveTo'](x((i / profile.bins) * 360), y(profile.elevation[i % profile.bins]));
    ctx.stroke();
    // spherical horizon
    ctx.strokeStyle = COLORS.axis; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(left, y(0)); ctx.lineTo(right, y(0)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.text; ctx.font = '12px system-ui, sans-serif';
    ['N', 'E', 'S', 'W', 'N'].forEach((label, i) => ctx.fillText(label, x(i * 90) - 4, H - 8));
    ctx.textAlign = 'right';
    for (const v of [hi, 0, lo]) ctx.fillText(`${v}°`, left - 4, y(v) + 4);
    ctx.textAlign = 'left';
    ctx.fillText('dashed: 0° sphere', left + 4, top + 10);
    for (const body of ['sun', 'earth']) {
      for (const sample of track) {
        const b = sample[body];
        if (b.elevation < lo || b.elevation > hi) continue;
        ctx.beginPath(); ctx.arc(x(b.azimuth), y(b.elevation), 2.5, 0, Math.PI * 2);
        if (b.up) { ctx.fillStyle = COLORS[body]; ctx.fill(); } else { ctx.strokeStyle = COLORS[body]; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }
    plotHolder.querySelector('canvas')?.remove();
    plotHolder.append(canvas);
  }

  function analyze(point) {
    const len = Math.hypot(point.x, point.y, point.z) || 1;
    const up = [point.x / len, point.y / len, point.z / len];
    const started = performance.now();
    const { profile, source } = horizon ? horizon.get(up) : { profile: null, source: 'none' };
    result = analyzeTrack(positions, up, profile);
    const ms = performance.now() - started;
    track = result.track;
    buildStrip(strip, track);
    strip.append(playhead);
    strip.setAttribute('aria-label', `Sun and Earth visibility from ${utcLabel(t0)} to ${utcLabel(t1)} against the terrain horizon. Top lane Sun, bottom lane Earth.`);
    axis[0].textContent = new Date(t0).toISOString().slice(5, 10).replace('-', '/');
    axis[1].textContent = new Date(t1).toISOString().slice(5, 10).replace('-', '/');

    const { terrain: t, sphere: s } = result;
    const metric = (label, value, sphere, title) => {
      const item = document.createElement('div');
      item.title = title;
      item.innerHTML = '<dt></dt><dd class="mono"></dd><dd class="vis__sphere text-xs mono"></dd>';
      item.children[0].textContent = label;
      item.children[1].textContent = value;
      item.children[2].textContent = sphere;
      return item;
    };
    let maxEl = -90, maxAz = 0;
    if (profile) profile.elevation.forEach((v, i) => { if (v > maxEl) { maxEl = v; maxAz = (i / profile.bins) * 360; } });
    metrics.replaceChildren(
      metric('Sunlight', formatPct(t.sunPct), `sphere ${formatPct(s.sunPct)}`, 'Share of this window with the Sun’s center above the LOLA terrain horizon. “sphere” is the same with a smooth Moon.'),
      metric('Earth in view', formatPct(t.earthPct), `sphere ${formatPct(s.earthPct)}`, 'Share with Earth’s center above the terrain horizon: a first estimate for direct-to-Earth radio.'),
      metric('Sun + Earth', formatPct(t.bothPct), `sphere ${formatPct(s.bothPct)}`, 'Share with both: solar power and direct-to-Earth comms at the same time.'),
      metric('Longest dark', formatHours(t.longestDarkH), `sphere ${formatHours(s.longestDarkH)}`, 'Longest sampled stretch with the Sun hidden, within this window. A night crossing the window edge may be longer.'),
      metric('Longest no Earth', formatHours(t.longestNoEarthH), `sphere ${formatHours(s.longestNoEarthH)}`, 'Longest sampled stretch with Earth hidden, within this window.'),
      metric('Highest skyline', profile ? `${maxEl.toFixed(1)}°` : '—', profile ? `at ${Math.round(maxAz)}° az` : '', 'Highest terrain horizon elevation around this point and its azimuth (clockwise from north).'),
    );
    if (profile) drawSky(profile);
    const verdict = solarVerdict(t);
    solar.dataset.level = verdict.level;
    solar.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = `Solar here: ${verdict.label}. `;
    solar.append(strong, verdict.detail);

    const step = (track[1].utc - track[0].utc) / 3600000;
    note.textContent = `${new Date(t0).toISOString().slice(0, 10)} to ${new Date(t1).toISOString().slice(0, 10)} UTC, ${step} h samples; transitions inside a sample are unresolved. Terrain horizon: 360 azimuths, ${source}, with lunar curvature, 2 m above the ground. Uses Sun and Earth centers (disk edges not modeled); terrain smaller than the grid spacing is smoothed. Polar results are seasonal.`;
    note.title = `Horizon and track computed in ${ms.toFixed(0)} ms`;
    lastState = '';
    setTime(lastIndex);
    return result;
  }

  return { analyze, setTime, get result() { return result; } };
}
