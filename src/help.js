import { el, bindPopover, isTextField } from './ui.js';

export function installHelp(container) {
  const button = el('button', { type: 'button', class: 'btn', text: 'Help', 'aria-haspopup': 'dialog' });
  container.querySelector('.topbar__nav').append(button);
  const panel = el('section', { class: 'popover help-panel', role: 'dialog', 'aria-label': 'Using Lunar Atlas' });
  const close = el('button', { type: 'button', class: 'btn', text: 'Start exploring' });
  panel.append(el('h2', { text: 'Explore Lunar Atlas' }));
  const sections = [
    ['Find a place', 'Search for a mission or crater, or choose Random site. Select a site to read its sources and open its surface view. Drag the Moon to orbit and scroll or pinch to zoom. Double-click terrain to focus there.'],
    ['Free flight', 'WASD moves you relative to your view. Q and E turn. Space rises and C descends. Hold Shift to boost. Drag to look if pointer lock is unavailable. Esc exits. On touch screens, use the thumbstick and Rise / Descend.'],
    ['Walk', 'Choose Stand on surface, then Walk. WASD or arrow keys move, Shift runs, and Space jumps. Drag to look. On touch screens, use the thumbstick, Run and Jump. Esc or Exit walk returns to orbit controls.'],
    ['Time and visibility', 'Use the timeline to change the date, play time, or change its speed. Site visibility shows estimated sunlight and Earth visibility for the displayed period. Compare opens a comparison of up to three locations.'],
    ['Layers and settings', 'Layers (L) controls terrain relief, WAC imagery and feature labels. Relief ×1 uses true scale. Auto increases relief from orbit and returns toward ×1 near the surface. WAC imagery mode displays the image without simulated lighting.'],
    ['Move panels', 'Drag a panel by its Move panel handle. With the handle focused, arrow keys move it and Home resets its position. Reopen this guide with Help or ?.'],
  ];
  for (const [title, text] of sections) panel.append(el('h3', { text: title }), el('p', { text }));
  panel.append(close);
  container.append(panel);
  const popup = bindPopover(button, panel, { onOpen: () => close.focus() });
  close.addEventListener('click', () => popup.close(true));
  document.addEventListener('keydown', event => {
    if (event.key !== '?' || isTextField(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    popup.toggle();
  });
  try {
    if (!localStorage.getItem('lunar-atlas-help-v1')) {
      popup.open();
      localStorage.setItem('lunar-atlas-help-v1', 'shown');
    }
  } catch { /* Help remains available when storage is blocked. */ }
}

export function makePanelDraggable(panel) {
  if (panel.querySelector(':scope > .panel-drag-handle')) return;
  const handle = el('button', { type: 'button', class: 'panel-drag-handle', text: 'Move panel', 'aria-label': 'Move panel. Arrow keys move, Home resets.' });
  panel.prepend(handle);
  let drag = null;
  let moved = false;
  const reset = () => {
    for (const property of ['left', 'top', 'right', 'bottom', 'transform', 'width']) panel.style.removeProperty(property);
    moved = false;
  };
  function move(left, top) {
    const bounds = panel.getBoundingClientRect();
    const parent = panel.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
    const x = Math.max(0, Math.min(left, window.innerWidth - bounds.width));
    const y = Math.max(0, Math.min(top, window.innerHeight - Math.min(bounds.height, window.innerHeight)));
    Object.assign(panel.style, { left: (x - parent.left) + 'px', top: (y - parent.top) + 'px', right: 'auto', bottom: 'auto', transform: 'none', width: bounds.width + 'px' });
    moved = true;
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const bounds = panel.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) move(event.clientX - drag.x, event.clientY - drag.y);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, () => { drag = null; });
  handle.addEventListener('keydown', event => {
    if (event.key === 'Home') { event.preventDefault(); reset(); return; }
    const steps = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
    if (!steps[event.key]) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = panel.getBoundingClientRect();
    move(bounds.left + steps[event.key][0], bounds.top + steps[event.key][1]);
  });
  window.addEventListener('resize', () => { if (moved) reset(); });
}
