import * as THREE from 'three';
import { el, icons } from './ui.js';
import { pinStatus, pinDescription } from './pin-status.js';

export const GROUPS = [
  { id: 'apollo', label: 'Apollo landers', chip: 'Apollo' },
  { id: 'lander', label: 'Robotic landers', chip: 'Robotic landers' },
  { id: 'failed', label: 'Failed landing attempts', chip: 'Failed' },
  { id: 'artemis', label: 'Artemis region', chip: 'Artemis region' },
  { id: 'feature', label: 'Notable features', chip: 'Notable features' },
];

export function formatCoords(lat, lon) {
  return `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}° ${lon < 0 ? 'W' : 'E'}`;
}

function metaLine(place) {
  if (place.group === 'artemis') return 'Candidate region · terrain proxy';
  if (place.group === 'feature') return 'South pole terrain';
  if (place.group === 'failed') return ['Failed landing', place.year, place.country].filter(Boolean).join(' · ');
  return [place.approximate ? 'Approximate coordinates' : null, place.year, place.country].filter(Boolean).join(' · ');
}

const searchKey = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
const MAX_SEARCH_RESULTS = 40;

export function createSiteList(container, places, { onSelect, features = [], onFeatureSelect }) {
  const search = el('input', { type: 'search', placeholder: 'Search sites and features', 'aria-label': 'Search sites and features', 'aria-keyshortcuts': '/', autocomplete: 'off', spellcheck: 'false' });
  const destinations = places.filter((place) => !place.disabled);
  let selectedId = null;
  const randomButton = el('button', { type: 'button', class: 'btn', text: 'Random site' });
  randomButton.disabled = destinations.length === 0;
  randomButton.addEventListener('click', () => {
    const otherSites = destinations.filter((place) => place.id !== selectedId);
    const choices = otherSites.length ? otherSites : destinations;
    if (choices.length) onSelect(choices[Math.floor(Math.random() * choices.length)]);
  });
  const groupsWithSites = GROUPS.filter((group) => places.some((place) => place.group === group.id));
  let filter = 'all';
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter sites' }, [
    { id: 'all', chip: 'All' }, ...groupsWithSites,
  ].map((group) => el('button', { type: 'button', class: 'chip', 'data-filter': group.id, 'aria-pressed': String(group.id === filter), text: group.chip })));
  const body = el('div', { class: 'site-list__body' });
  const empty = el('p', { class: 'text-xs site-list__empty', text: 'No sites match.', hidden: true });
  const railButton = el('button', { type: 'button', class: 'btn btn--icon site-list__rail-btn', 'aria-label': 'Show site list', title: 'Search sites (/)', html: icons.search });
  const panel = el('aside', { class: 'site-list glass', id: 'site-list', 'aria-label': 'Sites' }, [
    railButton,
    el('div', { class: 'site-list__head' }, [
      el('div', { class: 'search' }, [el('span', { html: icons.search }), search, el('kbd', { 'aria-hidden': 'true', text: '/' })]),
      randomButton,
      chips,
    ]),
    body,
  ]);

  const rows = new Map();
  const groupNodes = [];
  for (const group of groupsWithSites) {
    const members = places.filter((place) => place.group === group.id)
      .sort((a, b) => Number(Boolean(a.disabled)) - Number(Boolean(b.disabled)));
    const count = el('span', { class: 'group__count' });
    const listId = `site-group-${group.id}`;
    const header = el('button', { type: 'button', class: 'group__header', 'aria-expanded': 'true', 'aria-controls': listId }, [
      el('span', { html: icons.chevron }), el('span', { text: group.label }), count,
    ]);
    const list = el('ul', { class: 'group__rows', id: listId });
    for (const place of members) {
      const row = el('button', {
        type: 'button',
        class: 'row',
        'data-id': place.id,
        'aria-disabled': place.disabled ? 'true' : null,
        title: place.disabled ? 'No published coordinates' : null,
      }, [
        el('span', { class: 'row__name', text: place.name }),
        el('span', { class: 'row__meta', text: metaLine(place) }),
      ]);
      row.addEventListener('click', () => onSelect(place));
      const item = el('li', {}, [row]);
      rows.set(place.id, { place, row, item });
      list.append(item);
    }
    header.addEventListener('click', () => {
      const open = header.getAttribute('aria-expanded') !== 'true';
      header.setAttribute('aria-expanded', String(open));
      list.hidden = !open;
    });
    const node = el('div', { class: 'group' }, [header, list]);
    groupNodes.push({ group, node, count, members });
    body.append(node);
  }
  const results = el('ul', { class: 'group__rows', 'aria-label': 'Search results', hidden: true });
  const resultCount = el('p', { class: 'text-xs site-list__empty', role: 'status', hidden: true });
  body.append(results, resultCount, empty);

  const siteNames = new Set(places.filter((place) => place.group === 'feature').map((place) => searchKey(place.name)));
  const searchEntries = [
    ...places.map((place) => ({
      name: place.name, group: place.group, disabled: place.disabled, meta: metaLine(place),
      extra: [place.mission, place.country], select: () => onSelect(place),
    })),
    ...features.filter((feature) => !siteNames.has(searchKey(feature.name))).map((feature) => ({
      name: feature.name, group: 'feature',
      meta: [feature.type, feature.diameter_km > 0 ? `${feature.diameter_km} km` : ''].filter(Boolean).join(' · '),
      extra: [feature.type], select: () => onFeatureSelect(feature),
    })),
  ].map((entry) => ({
    ...entry, key: searchKey(entry.name),
    haystack: searchKey([entry.name, ...entry.extra].filter(Boolean).join(' ')),
  }));

  function showSearchResults(query) {
    const matches = searchEntries
      .filter((entry) => (filter === 'all' || filter === entry.group) && entry.haystack.includes(query))
      .map((entry) => ({ ...entry, rank: entry.key === query ? 0 : entry.key.startsWith(query) ? 1 : entry.key.includes(query) ? 2 : 3 }))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    results.replaceChildren(...matches.slice(0, MAX_SEARCH_RESULTS).map((entry) => {
      const row = el('button', { type: 'button', class: 'row', 'aria-disabled': entry.disabled ? 'true' : null }, [
        el('span', { class: 'row__name', text: entry.name }),
        el('span', { class: 'row__meta', text: entry.meta }),
      ]);
      row.addEventListener('click', entry.select);
      return el('li', {}, [row]);
    }));
    results.hidden = matches.length === 0;
    resultCount.hidden = matches.length <= MAX_SEARCH_RESULTS;
    resultCount.textContent = `Showing ${MAX_SEARCH_RESULTS} of ${matches.length}. Refine your search for more specific results.`;
    empty.hidden = matches.length > 0;
  }

  function applyFilter() {
    const query = searchKey(search.value);
    if (query) {
      for (const { node } of groupNodes) node.hidden = true;
      showSearchResults(query);
      return;
    }
    results.hidden = true;
    resultCount.hidden = true;
    let total = 0;
    for (const { group, node, count, members } of groupNodes) {
      let shown = 0;
      for (const place of members) {
        const visible = filter === 'all' || filter === group.id;
        rows.get(place.id).item.hidden = !visible;
        if (visible) shown++;
      }
      node.hidden = shown === 0;
      count.textContent = String(shown);
      total += shown;
    }
    empty.hidden = total > 0;
  }

  search.addEventListener('input', applyFilter);
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || results.hidden) return;
    event.preventDefault();
    results.querySelector('button')?.click();
  });
  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    for (const other of chips.children) other.setAttribute('aria-pressed', String(other === chip));
    applyFilter();
  });
  applyFilter();
  container.append(panel);

  return {
    panel,
    railButton,
    search,
    setSelected(id) {
      selectedId = id;
      for (const { row } of rows.values()) {
        if (row.dataset.id === id) row.setAttribute('aria-current', 'true');
        else row.removeAttribute('aria-current');
      }
    },
    setRail(on) { panel.classList.toggle('site-list--rail', on); },
    get isRail() { return panel.classList.contains('site-list--rail'); },
    setOpen(on) { panel.classList.toggle('site-list--open', on); },
    get isOpen() { return panel.classList.contains('site-list--open'); },
  };
}

function sourceLabel(url, index, total) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const leaf = (parsed.pathname.split('/').filter(Boolean).pop() || '')
      .replace(/\.(html?|php)$/i, '');
    if (leaf && leaf.length <= 24) return `${host} · ${leaf}`;
    return host;
  } catch {
    return total > 1 ? `Source ${index + 1}` : 'Source';
  }
}

export function createDrawer(container, { onClose, onFlyTo, onStand, onEarth, onCompare }) {
  const title = el('h2', { class: 'drawer__title', id: 'drawer-title' });
  const statusChip = el('span', { class: 'status-chip' });
  const coordsText = el('span', { class: 'mono' });
  const copyButton = el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Copy coordinates', title: 'Copy coordinates', html: icons.copy });
  const closeButton = el('button', { type: 'button', class: 'btn btn--icon drawer__close', 'aria-label': 'Close', title: 'Close (Esc)', html: icons.close });
  const peek = el('p', { class: 'text-xs drawer__peek' });
  const handle = el('button', { type: 'button', class: 'drawer__handle', 'aria-label': 'Expand panel' });

  const imageFrame = el('div', { class: 'image-slot__frame' });
  const imageCaption = el('figcaption', { class: 'text-xs' });
  const imageSlot = el('figure', { class: 'image-slot' }, [imageFrame, imageCaption]);

  const aboutText = el('p');
  const factsList = el('ul', { class: 'facts' });
  const proxyText = el('p', { class: 'text-xs', text: 'Terrain proxy for a candidate region. This is not an official landing coordinate or a selected base.' });
  const sourcesList = el('ul', { class: 'sources text-xs' });
  const about = el('section', { 'aria-labelledby': 'about-title' }, [
    el('h3', { id: 'about-title', text: 'About this site' }), aboutText, factsList, proxyText, sourcesList,
  ]);
  const dataNotesText = el('p', { class: 'text-xs' });
  const dataNotesSource = el('p', { class: 'text-xs' });
  const dataNotes = el('section', { class: 'data-notes', 'aria-labelledby': 'data-notes-title' }, [
    el('h3', { id: 'data-notes-title', class: 'text-xs', text: 'Data notes' }), dataNotesText, dataNotesSource,
  ]);
  const visSection = el('section');
  const takeQuote = el('blockquote', { class: 'take' });
  const take = el('section', {}, [el('h3', { text: 'Weston’s take' }), takeQuote]);
  const actions = el('div', { class: 'actions' }, [
    el('button', { type: 'button', class: 'btn btn--outline', text: 'View from above', onclick: () => onFlyTo() }),
    el('button', { type: 'button', class: 'btn btn--outline', text: 'Stand on surface', onclick: () => onStand() }),
    el('button', { type: 'button', class: 'btn btn--outline', text: 'Look at Earth', onclick: () => onEarth() }),
    el('button', { type: 'button', class: 'btn btn--outline', text: 'Compare', title: 'Add this site to the side-by-side comparison', onclick: () => onCompare?.() }),
  ]);

  const drawer = el('aside', { class: 'drawer glass', 'aria-labelledby': 'drawer-title', hidden: true }, [
    handle,
    el('div', { class: 'drawer__scroll' }, [
      el('header', { class: 'drawer__header' }, [
        title, closeButton,
        el('div', { class: 'drawer__meta' }, [statusChip, el('span', { class: 'coords' }, [coordsText, copyButton])]),
        peek,
      ]),
      imageSlot, about, dataNotes, visSection, take, actions,
    ]),
  ]);
  container.append(drawer);

  const sheets = ['peek', 'half', 'full'];
  handle.addEventListener('click', () => {
    const next = sheets[(sheets.indexOf(drawer.dataset.sheet || 'peek') + 1) % sheets.length];
    drawer.dataset.sheet = next;
    handle.setAttribute('aria-label', next === 'full' ? 'Collapse panel' : 'Expand panel');
  });
  closeButton.addEventListener('click', () => onClose());
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(coordsText.textContent);
      copyButton.innerHTML = icons.check;
      copyButton.setAttribute('aria-label', 'Copied');
      setTimeout(() => { copyButton.innerHTML = icons.copy; copyButton.setAttribute('aria-label', 'Copy coordinates'); }, 1500);
    } catch (error) {
      console.warn('Clipboard unavailable.', error);
    }
  });

  function chipText(place) {
    if (place.group === 'failed') return place.year ? `Failed attempt ${place.year}` : 'Failed landing';
    if (place.group === 'artemis') return 'Candidate region';
    if (place.group === 'feature') return 'Feature';
    if (place.group === 'point') return 'Terrain point';
    if (place.approximate) return 'Approximate landing site';
    return place.year ? `Landed ${place.year}` : 'Landed';
  }

  return {
    visSection,
    get isOpen() { return !drawer.hidden; },
    setPeek(text) { peek.textContent = text; },
    show(place, note) {
      const isPoint = place.group === 'point';
      title.textContent = place.name;
      statusChip.textContent = chipText(place);
      const hasCoords = Number.isFinite(place.lat) && Number.isFinite(place.lon);
      coordsText.textContent = hasCoords ? formatCoords(place.lat, place.lon) : 'No published coordinates';
      copyButton.hidden = !hasCoords;
      imageSlot.hidden = isPoint;
      imageFrame.replaceChildren();
      if (note?.image) {
        imageFrame.append(el('img', {
          src: note.image,
          alt: note.imageAlt || place.name,
          loading: 'lazy',
          decoding: 'async',
        }));
        imageCaption.textContent = [note.imageCaption, note.imageCredit && `Credit: ${note.imageCredit}`].filter(Boolean).join(' · ');
      } else {
        imageFrame.textContent = 'No image yet';
        imageCaption.textContent = '';
      }
      imageCaption.hidden = !imageCaption.textContent;
      about.hidden = isPoint;
      const hasWriteup = Boolean(note?.about);
      aboutText.textContent = note?.about || note?.notes || `${place.name}. Coordinates come from the bundled landing catalog. Consult the dataset sources for mission context.`;
      const facts = Array.isArray(note?.facts) ? note.facts.filter(Boolean) : [];
      factsList.replaceChildren(...facts.map((fact) => el('li', { text: fact })));
      factsList.hidden = facts.length === 0;
      proxyText.hidden = !place.proxy;
      const sources = Array.isArray(note?.sources) && note.sources.length
        ? note.sources
        : (!hasWriteup && note?.source ? [note.source] : []);
      sourcesList.replaceChildren(...sources.map((href, index) => el('li', {}, [
        el('a', { href, target: '_blank', rel: 'noopener', text: sourceLabel(href, index, sources.length) }),
      ])));
      sourcesList.hidden = sources.length === 0;
      const dataText = hasWriteup ? note?.notes : '';
      dataNotesText.textContent = [note?.status && hasWriteup ? note.status : '', dataText].filter(Boolean).join(' — ');
      dataNotesSource.replaceChildren();
      if (hasWriteup && note?.source) {
        dataNotesSource.append(el('a', { href: note.source, target: '_blank', rel: 'noopener', text: 'Source' }));
      }
      dataNotes.hidden = isPoint || !(dataNotesText.textContent || dataNotesSource.childNodes.length);
      takeQuote.textContent = note?.take ?? '';
      take.hidden = !note?.take;
      if (drawer.hidden) drawer.dataset.sheet = 'peek';
      drawer.hidden = false;
    },
    hide() { drawer.hidden = true; },
  };
}

export function isLanderPlace(place) {
  return place.group === 'apollo' || place.group === 'lander' || place.group === 'failed';
}

const MOON_RADIUS_METERS = 1_737_400;
const NEAR_ALTITUDE = 0.004; // about 7 km; below this the old globe pins hid

function closeLabel(place) {
  // A hover hint must show the actual site, not a generic label.
  return place.name;
}

function createGroundMarker(place) {
  const units = (meters) => meters / MOON_RADIUS_METERS;
  const color = pinStatus(place) === 'failed' ? 0xe66c73 : place.approximate ? 0xe2b657 : 0xf5f6fa;
  const material = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const root = new THREE.Group();
  root.name = `lander-marker-${place.id}`;
  root.renderOrder = 2;
  const radius = units(place.approximate ? 1.1 : 0.85);
  const ground = new THREE.Mesh(
    place.approximate
      ? new THREE.RingGeometry(radius * 0.55, radius, 28)
      : new THREE.CircleGeometry(radius, 28),
    material,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = units(0.12);
  const height = units(1.8);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(units(0.05), units(0.05), height, 8), material);
  stalk.position.y = height / 2;
  root.add(ground, stalk);
  if (!place.approximate) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(units(0.12), 12, 8), material);
    cap.position.y = height;
    root.add(cap);
  }
  return root;
}

export function createPins(container, places, { onSelect, scene } = {}) {
  const layer = el('div', { class: 'pins' });
  const markers = scene ? new THREE.Group() : null;
  if (markers) {
    markers.name = 'lander-location-markers';
    scene.add(markers);
  }
  const pins = places.map((place) => {
    const lander = isLanderPlace(place);
    const classes = ['pin'];
    const status = pinStatus(place);
    if (status === 'future') classes.push('pin--proxy', 'pin--future');
    if (place.approximate) classes.push('pin--approx');
    if (status === 'failed') classes.push('pin--failed');
    const labelText = place.name;
    const button = el('button', {
      type: 'button',
      class: classes.join(' '),
      tabindex: '-1',
      'aria-label': `${place.name}, ${pinDescription(place)}`,
    }, [el('span', { class: 'pin__dot' }), el('span', { class: 'pin__label', text: labelText })]);
    button.addEventListener('click', () => onSelect(place));
    layer.append(button);
    const marker = (markers && lander && Number.isFinite(place.lat) && Number.isFinite(place.lon))
      ? createGroundMarker(place)
      : null;
    if (marker) markers.add(marker);
    return { place, button, label: button.querySelector('.pin__label'), direction: new THREE.Vector3(), radius: 1, shown: true, marker };
  });
  container.append(layer);

  const world = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let refresh = Infinity;

  function seatMarker(pin) {
    if (!pin.marker) return;
    pin.marker.position.copy(pin.direction).multiplyScalar(pin.radius);
    pin.marker.quaternion.setFromUnitVectors(up, pin.direction);
  }

  return {
    setMarkersVisible(visible) {
      if (markers) markers.visible = visible;
    },
    init(directionFromLatLon) {
      for (const pin of pins) {
        if (!Number.isFinite(pin.place.lat) || !Number.isFinite(pin.place.lon)) continue;
        directionFromLatLon(pin.place.lat, pin.place.lon, pin.direction);
        seatMarker(pin);
      }
    },
    setSelected(id) {
      for (const pin of pins) pin.button.classList.toggle('pin--selected', pin.place.id === id);
    },
    update(camera, surfaceRadius, width, height, dt) {
      const near = camera.position.length() - 1 < NEAR_ALTITUDE;
      refresh += dt;
      const refreshRadius = refresh > 0.5;
      if (refreshRadius) refresh = 0;
      // Keep the layer visible close up so landed spacecraft still have a marker.
      layer.hidden = false;
      for (const pin of pins) {
        const lander = isLanderPlace(pin.place);
        if (refreshRadius) {
          pin.radius = surfaceRadius(pin.direction);
          seatMarker(pin);
        }
        // When close, pin the HTML chip at the top of the short stalk so it stays readable.
        const tip = (lander && near) ? pin.radius + 1.9 / MOON_RADIUS_METERS : pin.radius;
        world.copy(pin.direction).multiplyScalar(tip);
        toCamera.copy(camera.position).sub(world);
        let visible = toCamera.dot(pin.direction) > 0;
        if (visible) {
          world.project(camera);
          visible = world.z > -1 && world.z < 1 && Math.abs(world.x) < 1.05 && Math.abs(world.y) < 1.05;
        }
        if (near && !lander) visible = false;
        if (visible !== pin.shown) {
          pin.shown = visible;
          pin.button.hidden = !visible;
        }
        if (visible) {
          const x = (world.x + 1) / 2 * width;
          const y = (1 - world.y) / 2 * height;
          pin.button.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        }
        if (lander && near) {
          pin.button.classList.add('pin--near');
          const text = closeLabel(pin.place);
          if (pin.label.textContent !== text) pin.label.textContent = text;
        } else if (pin.button.classList.contains('pin--near') || (pin.label && pin.label.textContent !== pin.place.name)) {
          pin.button.classList.remove('pin--near');
          pin.label.textContent = pin.place.name;
        }
      }
    },
  };
}
