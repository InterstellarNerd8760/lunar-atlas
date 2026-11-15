import * as THREE from 'three';
import { createVisibilityPanel, utcLabel } from './visibility.js';
import { bindPopover, el, icons, reducedMotion } from './ui.js';

const AU_KM = 149597870.7;
const MOON_RADIUS_KM = 1737.4;
const degrees = Math.PI / 180;
const sunDisplayDistance = 72;
const textureDirectory = new URL('../public/data/sky/', import.meta.url);

async function loadColorTexture(loader, filename) {
  const texture = await loader.loadAsync(new URL(filename, textureDirectory).href);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// At the reference site (0° longitude, 0° latitude), up is +X,
// north is +Y and east is −Z in the existing globe's UV convention.
function positionFromSample([azimuth, elevation, range]) {
  const az = azimuth * degrees;
  const el = elevation * degrees;
  const horizontal = Math.cos(el);
  return new THREE.Vector3(
    Math.sin(el),
    horizontal * Math.cos(az),
    -horizontal * Math.sin(az),
  ).multiplyScalar(range * AU_KM / MOON_RADIUS_KM).add(new THREE.Vector3(1, 0, 0));
}

export async function addSky(scene, camera, sunlight, container, { visibilitySection, onVisibilityStatus, horizon } = {}) {
  const response = await fetch(new URL('../public/data/lunar-ephemeris.json', import.meta.url));
  if (!response.ok) throw new Error('Sun and Earth data could not be loaded.');
  const { samples } = await response.json();
  const positions = samples.map(([utc, ...values]) => ({
    utc: Date.parse(utc),
    sun: positionFromSample(values.slice(0, 3)),
    earth: positionFromSample(values.slice(3, 6)),
  }));

  const sunlightDisk = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe1a2, toneMapped: false }),
  );
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(6371 / MOON_RADIUS_KM, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x6089c5, roughness: 0.9, toneMapped: false }),
  );
  scene.add(sunlightDisk, earth);

  const points = [];
  let seed = 301;
  function random() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 1200; i++) {
    const y = 2 * random() - 1;
    const angle = 2 * Math.PI * random();
    const radius = Math.sqrt(1 - y * y);
    points.push(450 * radius * Math.cos(angle), 450 * y, 450 * radius * Math.sin(angle));
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)),
    new THREE.PointsMaterial({ color: 0x8794ae, size: 1.1, sizeAttenuation: false }),
  );
  scene.add(stars);

  const backgroundColor = scene.background;
  let starMap = null;
  let starsOn = true;
  function updateStars() {
    stars.visible = starsOn && !starMap;
    scene.background = starsOn && starMap ? starMap : backgroundColor;
  }

  const loader = new THREE.TextureLoader();
  loadColorTexture(loader, 'earth-2048.jpg').then((texture) => {
    earth.material.map = texture;
    earth.material.color.set(0xffffff);
    earth.material.needsUpdate = true;
  }).catch((error) => console.warn('Earth texture unavailable.', error));

  loadColorTexture(loader, 'stars-4096.jpg').then((texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    starMap = texture;
    updateStars();
  }).catch((error) => console.warn('Star map unavailable.', error));

  const visibility = createVisibilityPanel(visibilitySection || document.createElement('section'), positions, { onStatus: onVisibilityStatus, horizon });
  const timeline = createTimeline(container, positions);

  const sunPosition = new THREE.Vector3();
  const earthshine = new THREE.DirectionalLight(0xaacbff, 0.01);
  scene.add(earthshine);
  function update(index) {
    const first = positions[Math.floor(index)];
    const next = positions[Math.ceil(index)];
    const fraction = index % 1;
    sunPosition.copy(first.sun).lerp(next.sun, fraction);
    sunlight.position.copy(sunPosition).normalize().multiplyScalar(4);
    sunlightDisk.position.copy(sunPosition).setLength(sunDisplayDistance);
    const sunDisplayRadius = sunDisplayDistance * 695700 / (sunPosition.length() * MOON_RADIUS_KM);
    sunlightDisk.scale.setScalar(sunDisplayRadius);
    earth.position.copy(first.earth).lerp(next.earth, fraction);
    earthshine.position.copy(earth.position).normalize().multiplyScalar(4);
    const phase = (1 + earth.position.clone().negate().normalize().dot(sunPosition.clone().sub(earth.position).normalize())) / 2;
    earthshine.intensity = 0.014 * phase;
    visibility.setTime(index);
  }
  timeline.onChange = update;
  update(timeline.index);

  // Start with sunlight crossing the visible face so craters show their relief.
  camera.position.copy(sunlight.position).normalize().add(new THREE.Vector3(1.15, 0.25, 0)).setLength(3.1);
  return {
    earth,
    analyze: visibility.analyze,
    positions,
    timeline,
    get starsOn() { return starsOn; },
    setStars(on) { starsOn = on; updateStars(); },
  };
}

const SPEEDS = [
  { label: '1x', rate: 1, name: 'real time' },
  { label: '1 h/s', rate: 3600, name: '1 hour per second' },
  { label: '1 d/s', rate: 86400, name: '1 day per second' },
  { label: '1 mo/s', rate: 30 * 86400, name: '1 month per second' },
];

function toInputValue(ms) {
  return new Date(ms).toISOString().slice(0, 16);
}

function createTimeline(container, positions) {
  const t0 = positions[0].utc;
  const t1 = positions.at(-1).utc;
  const stepMs = (t1 - t0) / (positions.length - 1);
  const nowInWindow = () => Date.now() >= t0 && Date.now() <= t1;
  let utc = nowInWindow() ? Date.now() : t0 + 3 * stepMs;
  let playing = !reducedMotion.matches;
  let speedIndex = 1;
  let reverse = false;
  let dragging = false;
  let resumeAfterDrag = false;
  let lastReadout = '';

  const playButton = el('button', { type: 'button', class: 'btn btn--icon', title: 'Play or pause (Space)' });
  const reverseButton = el('button', { type: 'button', class: 'btn btn--icon tl-wide', 'aria-label': 'Reverse', title: 'Reverse (R)', 'aria-pressed': 'false', 'data-reverse': '', html: icons.reverse });
  const speedButton = el('button', { type: 'button', class: 'btn speed-btn tl-wide', 'aria-haspopup': 'menu', title: 'Speed ([ and ])' });
  const nowButton = el('button', { type: 'button', class: 'btn tl-wide', 'data-now': '', text: 'Now' });
  const slider = el('input', { type: 'range', min: '0', max: String(t1 - t0), step: 'any', 'aria-label': 'Time' });
  const fill = el('span', { class: 'scrubber__fill' });
  const scrubber = el('div', { class: 'scrubber' }, [el('span', { class: 'scrubber__track' }), fill, slider]);
  const readoutText = el('span');
  const readoutButton = el('button', { type: 'button', class: 'btn readout tl-wide', 'aria-haspopup': 'dialog', title: 'Choose a UTC date and time' }, [readoutText, el('span', { html: icons.calendar })]);
  const phoneReadout = el('span', { class: 'readout more-btn', 'aria-hidden': 'true' });
  const moreButton = el('button', { type: 'button', class: 'btn btn--icon more-btn', 'aria-label': 'More time controls', html: icons.more });
  const live = el('div', { class: 'sr-only', 'aria-live': 'polite' });

  const timeline = el('div', { class: 'timeline glass', role: 'group', 'aria-label': 'Time' }, [
    reverseButton, playButton, speedButton, nowButton, scrubber, readoutButton, phoneReadout, moreButton, live,
  ]);

  const windowText = `${utcLabel(t0)} to ${utcLabel(t1)}`;
  const makeDateInput = () => el('input', { type: 'datetime-local', min: toInputValue(t0), max: toInputValue(t1), step: '60' });
  const dateInput = makeDateInput();
  const datePopover = el('div', { class: 'popover time-popover date-popover', role: 'dialog', 'aria-label': 'Choose date and time' }, [
    el('label', {}, ['Date and time (UTC)', dateInput]),
    el('p', { class: 'text-xs', style: 'margin:0', text: `Loaded data: ${windowText}` }),
  ]);

  const speedMenu = (extraClass = '') => el('ul', { class: `menu ${extraClass}`, role: 'menu', 'aria-label': 'Playback speed' }, SPEEDS.map((speed, index) => el('li', { role: 'none' }, [
    el('button', { type: 'button', class: 'btn', role: 'menuitemradio', 'data-speed': String(index), 'aria-label': speed.name, text: speed.label }),
  ])));
  const speedPopover = el('div', { class: 'popover time-popover speed-popover' }, [speedMenu()]);

  const moreDate = makeDateInput();
  const morePopover = el('div', { class: 'popover time-popover more-popover', role: 'dialog', 'aria-label': 'More time controls' }, [
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'Playback speed' }, SPEEDS.map((speed, index) => el('button', { type: 'button', class: 'btn', 'data-speed': String(index), 'aria-label': speed.name, text: speed.label }))),
    el('div', { class: 'switch-row' }, [
      el('button', { type: 'button', class: 'btn btn--outline', 'data-reverse': '', 'aria-pressed': 'false', html: `${icons.reverse}Reverse` }),
      el('button', { type: 'button', class: 'btn btn--outline', 'data-now': '', text: 'Now' }),
    ]),
    el('label', {}, ['Date and time (UTC)', moreDate]),
  ]);

  container.append(timeline, datePopover, speedPopover, morePopover);
  const datePop = bindPopover(readoutButton, datePopover, { onOpen: () => { dateInput.value = toInputValue(utc); dateInput.focus(); } });
  const speedPop = bindPopover(speedButton, speedPopover, { onOpen: () => speedPopover.querySelector(`[data-speed="${speedIndex}"]`).focus() });
  bindPopover(moreButton, morePopover, { onOpen: () => { moreDate.value = toInputValue(utc); } });

  const api = {
    onChange: null,
    get index() { return Math.min(positions.length - 1, Math.max(0, (utc - t0) / stepMs)); },
    get playing() { return playing; },
    tick,
    togglePlay() { setPlaying(!playing, true); },
    stepSpeed(direction) { setSpeed(speedIndex + direction); },
    toggleReverse,
    now: goNow,
    step(count) { setTime(utc + count * stepMs); announce(); },
  };

  function announce() {
    live.textContent = `${utcLabel(utc)}${playing ? '' : ', paused'}`;
  }

  function syncControls() {
    playButton.innerHTML = playing ? icons.pause : icons.play;
    playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    playButton.setAttribute('aria-pressed', String(playing));
    const sign = reverse ? '−' : '';
    speedButton.innerHTML = '';
    speedButton.append(`${sign}${SPEEDS[speedIndex].label}`, el('span', { html: icons.chevron }));
    speedButton.setAttribute('aria-label', `Speed: ${reverse ? 'reverse, ' : ''}${SPEEDS[speedIndex].name}`);
    for (const node of [timeline, speedPopover, morePopover]) {
      node.querySelectorAll('[data-speed]').forEach((button) => {
        const on = Number(button.dataset.speed) === speedIndex;
        if (button.getAttribute('role') === 'menuitemradio') button.setAttribute('aria-checked', String(on));
        else button.setAttribute('aria-pressed', String(on));
        button.textContent = `${on ? sign : ''}${SPEEDS[button.dataset.speed].label}`;
      });
      node.querySelectorAll('[data-reverse]').forEach((button) => button.setAttribute('aria-pressed', String(reverse)));
    }
    syncNow();
  }

  function syncNow() {
    const ok = nowInWindow();
    for (const button of [nowButton, morePopover.querySelector('[data-now]')]) {
      button.setAttribute('aria-disabled', String(!ok));
      button.title = ok ? 'Jump to the current time (N)' : 'Now is outside the loaded data';
    }
  }

  function render() {
    const value = utc - t0;
    slider.value = String(value);
    fill.style.width = `${(value / (t1 - t0)) * 100}%`;
    const label = utcLabel(utc);
    if (label !== lastReadout) {
      lastReadout = label;
      readoutText.textContent = label;
      phoneReadout.textContent = label.replace(/, \d{4}/, '');
      slider.setAttribute('aria-valuetext', label);
    }
    api.onChange?.(api.index);
  }

  function setTime(ms) {
    utc = Math.min(t1, Math.max(t0, ms));
    render();
  }

  function setPlaying(next, speak = false) {
    playing = next;
    syncControls();
    if (speak && !playing) announce();
  }

  function setSpeed(index) {
    speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index));
    syncControls();
  }

  function toggleReverse() {
    reverse = !reverse;
    syncControls();
  }

  function goNow() {
    if (!nowInWindow()) return;
    setTime(Date.now());
    announce();
  }

  let nowCheck = 0;
  function tick(dt) {
    nowCheck += dt;
    if (nowCheck > 5) { nowCheck = 0; syncNow(); }
    if (!playing || dragging) return;
    let next = utc + (reverse ? -1 : 1) * SPEEDS[speedIndex].rate * dt * 1000;
    if (next > t1) next = t0 + (next - t1);
    if (next < t0) next = t1 - (t0 - next);
    setTime(next);
  }

  playButton.addEventListener('click', () => setPlaying(!playing, true));
  timeline.addEventListener('click', (event) => {
    if (event.target.closest('[data-reverse]')) toggleReverse();
  });
  for (const node of [timeline, morePopover]) {
    node.addEventListener('click', (event) => {
      if (event.target.closest('[data-now]')) goNow();
    });
  }
  morePopover.addEventListener('click', (event) => {
    if (event.target.closest('[data-reverse]')) toggleReverse();
    const speed = event.target.closest('[data-speed]');
    if (speed) setSpeed(Number(speed.dataset.speed));
  });
  speedPopover.addEventListener('click', (event) => {
    const speed = event.target.closest('[data-speed]');
    if (!speed) return;
    setSpeed(Number(speed.dataset.speed));
    speedPop.close(true);
  });
  speedPopover.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...speedPopover.querySelectorAll('[data-speed]')];
    const index = items.indexOf(document.activeElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });

  for (const input of [dateInput, moreDate]) {
    input.addEventListener('change', () => {
      const ms = Date.parse(`${input.value}:00Z`);
      if (!Number.isFinite(ms)) return;
      setTime(ms);
      announce();
      if (input === dateInput) datePop.close(true);
    });
  }

  slider.addEventListener('pointerdown', () => {
    dragging = true;
    resumeAfterDrag = playing;
    if (playing) setPlaying(false);
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (resumeAfterDrag) setPlaying(true);
    announce();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  slider.addEventListener('input', () => {
    utc = t0 + Number(slider.value);
    render();
  });
  slider.addEventListener('change', () => {
    if (!dragging) announce();
  });

  syncControls();
  render();
  return api;
}
