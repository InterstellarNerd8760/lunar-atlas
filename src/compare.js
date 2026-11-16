import { analyzeTrack } from './horizon.js';
import { buildStrip, formatHours, formatPct } from './visibility.js';
import { el, icons } from './ui.js';

const SLOTS = 3;
const GROUP_LABELS = { apollo: 'Apollo', lander: 'Robotic landers', artemis: 'Artemis regions', feature: 'South pole terrain' };
const DEFAULT_IDS = [/malapert/i, /haworth/i, /apollo-11/i];

function upFromLatLon(lat, lon) {
  const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
  return [Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)];
}

// Side-by-side Sun/Earth visibility for up to three sites over the same window.
export function createComparePanel(container, { places, positions, horizon, getPoint }) {
  const usable = places.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon) && !place.disabled);
  const byId = new Map(usable.map((place) => [place.id, place]));
  const closeButton = el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Close compare', title: 'Close', html: icons.close });
  const selects = [];
  const table = el('table', { class: 'compare__table' });
  const strips = el('div', { class: 'compare__strips' });
  const t0 = positions[0].utc;
  const t1 = positions.at(-1).utc;
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const panel = el('div', { class: 'popover compare', role: 'dialog', 'aria-label': 'Compare sites', hidden: true }, [
    el('div', { class: 'compare__head' }, [el('h2', { text: 'Compare sites' }), closeButton]),
    el('div', { class: 'compare__pickers' }, Array.from({ length: SLOTS }, (_, i) => {
      const select = el('select', { 'aria-label': `Site ${i + 1}`, onchange: render });
      selects.push(select);
      return select;
    })),
    table,
    strips,
    el('p', { class: 'text-xs', text: `Same window for every site: ${day(t0)} to ${day(t1)} UTC (JPL Horizons, 6 h samples). Sun and Earth centers against the LOLA terrain horizon; “sphere” is the smooth-Moon value. Top lane Sun, bottom lane Earth.` }),
  ]);
  container.append(panel);

  function fillOptions() {
    const point = getPoint?.();
    for (const [i, select] of selects.entries()) {
      const value = select.value;
      select.replaceChildren(el('option', { value: '', text: i < 2 ? 'Choose a site' : 'None' }));
      if (point) select.append(el('option', { value: 'point', text: `Clicked point (${point.lat.toFixed(2)}°, ${point.lon.toFixed(2)}°)` }));
      for (const [group, label] of Object.entries(GROUP_LABELS)) {
        const members = usable.filter((place) => place.group === group);
        if (!members.length) continue;
        select.append(el('optgroup', { label }, members.map((place) => el('option', { value: place.id, text: place.name.replace(/^Artemis region:\s*/i, '') }))));
      }
      select.value = [...select.options].some((option) => option.value === value) ? value : '';
    }
  }

  function placeFor(value) {
    if (value === 'point') return getPoint?.();
    return byId.get(value);
  }

  function render() {
    const chosen = selects.map((select) => placeFor(select.value)).filter(Boolean);
    const results = chosen.map((place) => {
      const up = upFromLatLon(place.lat, place.lon);
      const { profile } = horizon.get(up);
      return { place, ...analyzeTrack(positions, up, profile) };
    });
    const rows = [
      ['Sunlight', (r) => formatPct(r.terrain.sunPct), (r) => formatPct(r.sphere.sunPct), 'max'],
      ['Earth in view', (r) => formatPct(r.terrain.earthPct), (r) => formatPct(r.sphere.earthPct), 'max'],
      ['Sun + Earth', (r) => formatPct(r.terrain.bothPct), (r) => formatPct(r.sphere.bothPct), 'max'],
      ['Longest dark', (r) => formatHours(r.terrain.longestDarkH), (r) => formatHours(r.sphere.longestDarkH), 'min'],
      ['Longest no Earth', (r) => formatHours(r.terrain.longestNoEarthH), (r) => formatHours(r.sphere.longestNoEarthH), 'min'],
    ];
    const raw = [(r) => r.terrain.sunPct, (r) => r.terrain.earthPct, (r) => r.terrain.bothPct, (r) => r.terrain.longestDarkH, (r) => r.terrain.longestNoEarthH];
    const head = el('tr', {}, [el('th', { scope: 'col', html: '<span class="sr-only">Metric</span>' }), ...results.map((r) => el('th', { scope: 'col', text: r.place.name.replace(/^Artemis region:\s*/i, '') }))]);
    const body = rows.map(([label, value, sphere, better], k) => {
      const values = results.map(raw[k]);
      const best = better === 'max' ? Math.max(...values) : Math.min(...values);
      return el('tr', {}, [
        el('th', { scope: 'row', text: label }),
        ...results.map((r, i) => el('td', { class: results.length > 1 && values[i] === best && values.some((v) => v !== best) ? 'compare__best' : '' }, [
          el('span', { class: 'mono', text: value(r) }),
          el('span', { class: 'text-xs mono compare__sphere', text: `sphere ${sphere(r)}` }),
        ])),
      ]);
    });
    table.replaceChildren(el('thead', {}, head), el('tbody', {}, body));
    table.hidden = !results.length;
    strips.replaceChildren(...results.map((r) => {
      const strip = el('div', { class: 'strip', role: 'img', 'aria-label': `${r.place.name}: Sun and Earth visibility` });
      buildStrip(strip, r.track);
      return el('div', { class: 'compare__row' }, [el('span', { class: 'text-xs compare__label', text: r.place.name.replace(/^Artemis region:\s*/i, '') }), strip]);
    }));
    if (results.length) {
      strips.append(el('div', { class: 'strip__axis text-xs mono compare__axis' }, [el('span', { text: day(t0).slice(5).replace('-', '/') }), el('span', { text: day(t1).slice(5).replace('-', '/') })]));
    }
  }

  let seeded = false;
  function open(place) {
    fillOptions();
    if (!seeded) {
      seeded = true;
      DEFAULT_IDS.forEach((pattern, i) => {
        const match = usable.find((p) => pattern.test(p.id));
        if (match && !selects[i].value) selects[i].value = match.id;
      });
    }
    if (place) {
      const value = place.group === 'point' ? 'point' : place.id;
      if (!selects.some((select) => select.value === value)) {
        const free = selects.find((select) => !select.value) || selects[0];
        free.value = value;
      }
    }
    panel.hidden = false;
    render();
  }

  closeButton.addEventListener('click', () => { panel.hidden = true; });
  return {
    open,
    close() { panel.hidden = true; },
    toggle(place) { if (panel.hidden) open(place); else panel.hidden = true; },
    get isOpen() { return !panel.hidden; },
    set(values) { fillOptions(); values.forEach((v, i) => { selects[i].value = v || ''; }); panel.hidden = false; render(); },
  };
}
