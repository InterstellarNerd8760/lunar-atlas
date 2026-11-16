import { el, bindPopover, isTextField } from './ui.js';

export function installHelp(container) {
  const button = el('button', { type: 'button', class: 'btn', text: 'Help', 'aria-haspopup': 'dialog' });
  container.querySelector('.topbar__nav').append(button);
  const panel = el('section', { class: 'popover help-panel', role: 'dialog', 'aria-label': 'Using Lunar Atlas' });
  const close = el('button', { type: 'button', class: 'btn', text: 'Start exploring' });
  panel.append(el('h2', { text: 'Explore Lunar Atlas' }), close);
  const sections = [
    ['Find a place', 'Search for a mission or crater, or choose Random site. Select a site to read its sources and open its surface view. Drag the Moon to orbit and scroll or pinch to zoom. Double-click terrain to focus there.'],
    ['Free flight', 'WASD moves you relative to your view. Q and E turn. Space rises and C descends. Hold Shift to boost. Drag to look if pointer lock is unavailable. Esc exits. On touch screens, use the thumbstick and Rise / Descend.'],
    ['Walk', 'Choose Stand on surface, then Walk. WASD or arrow keys move, Shift runs, and Space jumps. Drag to look. On touch screens, use the thumbstick, Run and Jump. Esc or Exit walk returns to orbit controls.'],
    ['Time and visibility', 'Use the timeline to change the date, play time, or change its speed. Site visibility shows estimated sunlight and Earth visibility for the displayed period. Compare opens a comparison of up to three locations.'],
    ['Layers and settings', 'Layers (L) controls terrain relief, WAC imagery and feature labels. Relief ×1 uses true scale. Auto increases relief from orbit and returns toward ×1 near the surface. WAC imagery mode displays the image without simulated lighting.'],
    ['Move panels', 'Drag a panel by its Move panel handle. With the handle focused, arrow keys move it and Home resets its position. Reopen this guide with Help or ?.'],
  ];
  for (const [title, text] of sections) panel.append(el('h3', { text: title }), el('p', { text }));
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

