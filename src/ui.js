const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  play: svg('<path d="M7 5v14l11-7z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  reverse: svg('<path d="M11 18 4 12l7-6M20 18l-7-6 7-6"/>'),
  calendar: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'),
  layers: svg('<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>'),
};

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...[children].flat().filter((child) => child !== null && child !== undefined));
  return node;
}

const popovers = new Set();

export function bindPopover(trigger, panel, { onOpen, onClose } = {}) {
  makePanelDraggable(panel);
  panel.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  const api = {
    get isOpen() { return !panel.hidden; },
    open() {
      for (const other of popovers) if (other !== api) other.close();
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      onOpen?.();
    },
    close(returnFocus = false) {
      if (panel.hidden) return;
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      onClose?.();
      if (returnFocus) trigger.focus();
    },
    toggle() { if (api.isOpen) api.close(); else api.open(); },
    contains(node) { return panel.contains(node) || trigger.contains(node); },
  };
  trigger.addEventListener('click', () => api.toggle());
  popovers.add(api);
  return api;
}

export function closeOpenPopover() {
  for (const popover of popovers) {
    if (popover.isOpen) {
      popover.close(true);
      return true;
    }
  }
  return false;
}

document.addEventListener('pointerdown', (event) => {
  for (const popover of popovers) {
    if (popover.isOpen && !popover.contains(event.target)) popover.close();
  }
});

export function isTextField(target) {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, select'));
}

export function makePanelDraggable(panel) {
  if (panel.querySelector(':scope > .panel-drag-handle')) return;
  const handle = el('button', { type: 'button', class: 'panel-drag-handle', text: 'Move panel', 'aria-label': 'Move panel. Arrow keys move, Home resets.' });
  panel.prepend(handle);
  let drag = null;
  let moved = false;
  const reset = () => {
    for (const property of ['left', 'top', 'right', 'bottom', 'transform', 'width', 'height']) panel.style.removeProperty(property);
    moved = false;
  };
  function move(left, top) {
    const bounds = panel.getBoundingClientRect();
    if (panel.classList.contains('site-list')) panel.style.height = bounds.height + 'px';
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
  if (panel.classList.contains('site-list')) new MutationObserver(reset).observe(panel, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => { if (moved) reset(); });
}
