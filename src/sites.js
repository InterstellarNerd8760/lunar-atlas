import * as THREE from 'three';
import { el, icons } from './ui.js';

export const GROUPS = [
  { id: 'apollo', label: 'Apollo landers', chip: 'Apollo' },
  { id: 'lander', label: 'Robotic landers', chip: 'Robotic landers' },
  { id: 'artemis', label: 'Artemis region', chip: 'Artemis region' },
  { id: 'feature', label: 'Notable features', chip: 'Notable features' },
];

export function formatCoords(lat, lon) {
  return `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}° ${lon < 0 ? 'W' : 'E'}`;
}

function metaLine(place) {
  if (place.group === 'artemis') return 'Terrain proxy';
  if (place.group === 'feature') return 'South pole terrain';
  return [place.year, place.country].filter(Boolean).join(' · ');
}

export function createSiteList(container, places, { onSelect }) {
  const search = el('input', { type: 'search', placeholder: 'Search sites', 'aria-label': 'Search sites', 'aria-keyshortcuts': '/', autocomplete: 'off', spellcheck: 'false' });
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
  body.append(empty);

  function applyFilter() {
    const query = search.value.trim().toLowerCase();
    let total = 0;
    for (const { group, node, count, members } of groupNodes) {
      let shown = 0;
      for (const place of members) {
        const haystack = [place.name, place.mission, place.country].filter(Boolean).join(' ').toLowerCase();
        const visible = (filter === 'all' || filter === group.id) && (!query || haystack.includes(query));
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

export function createDrawer(container, { onClose, onFlyTo, onStand, onEarth }) {
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
  const proxyText = el('p', { class: 'text-xs', text: 'Terrain proxy for a candidate region. This is not an official landing coordinate or a selected base.' });
  const sourceLink = el('a', { target: '_blank', rel: 'noopener', text: 'Source' });
  const about = el('section', { 'aria-labelledby': 'about-title' }, [
    el('h3', { id: 'about-title', text: 'About this site' }), aboutText, proxyText, el('p', { class: 'text-xs' }, [sourceLink]),
  ]);
  const visSection = el('section');
  const takeQuote = el('blockquote', { class: 'take' });
  const take = el('section', {}, [el('h3', { text: 'Weston’s take' }), takeQuote]);
  const actions = el('div', { class: 'actions' }, [
    el('button', { type: 'button', class: 'btn btn--outline', text: 'View from above', onclick: () => onFlyTo() }),
    el('button', { type: 'button', class: 'btn btn--outline', text: 'Stand on surface', onclick: () => onStand() }),
    el('button', { type: 'button', class: 'btn btn--outline', text: 'Look at Earth', onclick: () => onEarth() }),
  ]);

  const drawer = el('aside', { class: 'drawer glass', 'aria-labelledby': 'drawer-title', hidden: true }, [
    handle,
    el('div', { class: 'drawer__scroll' }, [
      el('header', { class: 'drawer__header' }, [
        title, closeButton,
        el('div', { class: 'drawer__meta' }, [statusChip, el('span', { class: 'coords' }, [coordsText, copyButton])]),
        peek,
      ]),
      imageSlot, about, visSection, take, actions,
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
    if (place.group === 'artemis') return 'Candidate region';
    if (place.group === 'feature') return 'Feature';
    if (place.group === 'point') return 'Terrain point';
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
      aboutText.textContent = note?.notes ?? `${place.name}. Coordinates come from the bundled landing catalog. Consult the dataset sources for mission context.`;
      proxyText.hidden = !place.proxy;
      sourceLink.href = note?.source ?? 'https://data.lroc.im-ldi.com/';
      takeQuote.textContent = note?.take ?? '';
      take.hidden = !note?.take;
      if (drawer.hidden) drawer.dataset.sheet = 'peek';
      drawer.hidden = false;
    },
    hide() { drawer.hidden = true; },
  };
}

export function createPins(container, places, { onSelect }) {
  const layer = el('div', { class: 'pins' });
  const pins = places.map((place) => {
    const button = el('button', {
      type: 'button',
      class: `pin${place.group === 'artemis' ? ' pin--proxy' : ''}`,
      tabindex: '-1',
      'aria-label': place.name,
    }, [el('span', { class: 'pin__dot' }), el('span', { class: 'pin__label', text: place.name })]);
    button.addEventListener('click', () => onSelect(place));
    layer.append(button);
    return { place, button, direction: new THREE.Vector3(), radius: 1, shown: true };
  });
  container.append(layer);

  const world = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  let refresh = Infinity;

  return {
    init(directionFromLatLon) {
      for (const pin of pins) directionFromLatLon(pin.place.lat, pin.place.lon, pin.direction);
    },
    setSelected(id) {
      for (const pin of pins) pin.button.classList.toggle('pin--selected', pin.place.id === id);
    },
    update(camera, surfaceRadius, width, height, dt) {
      const hideAll = camera.position.length() - 1 < 0.004;
      layer.hidden = hideAll;
      if (hideAll) return;
      refresh += dt;
      const refreshRadius = refresh > 0.5;
      if (refreshRadius) refresh = 0;
      for (const pin of pins) {
        if (refreshRadius) pin.radius = surfaceRadius(pin.direction);
        world.copy(pin.direction).multiplyScalar(pin.radius);
        toCamera.copy(camera.position).sub(world);
        let visible = toCamera.dot(pin.direction) > 0;
        if (visible) {
          world.project(camera);
          visible = world.z > -1 && world.z < 1 && Math.abs(world.x) < 1.05 && Math.abs(world.y) < 1.05;
        }
        if (visible !== pin.shown) {
          pin.shown = visible;
          pin.button.hidden = !visible;
        }
        if (visible) {
          const x = (world.x + 1) / 2 * width;
          const y = (1 - world.y) / 2 * height;
          pin.button.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        }
      }
    },
  };
}
