import { el, bindPopover, isTextField, reducedMotion } from './ui.js';

export function installHelp(container) {
  const button = el('button', { type: 'button', class: 'btn', text: 'Help', 'aria-haspopup': 'dialog' });
  container.querySelector('.topbar__nav').append(button);
  const panel = el('section', { class: 'popover help-panel', role: 'dialog', 'aria-label': 'Using Lunar Atlas' });
  const close = el('button', { type: 'button', class: 'btn', text: 'Close help' });
  panel.append(el('h2', { text: 'Explore Lunar Atlas' }), close);
  const sections = [
    ['Find a place', 'Search for a mission or crater, or choose Random site. Select a site to read its sources and open its surface view. Drag the Moon to orbit and scroll or pinch to zoom. Double-click terrain to focus there.'],
    ['Free flight', 'WASD moves you relative to your view. Q and E turn. Space rises and C descends. Hold Shift to boost. Drag to look; the pointer stays available to hover site pins. Esc exits. On touch screens, use the thumbstick and Rise / Descend.'],
    ['Walk', 'Choose Stand on surface, then Walk. WASD or arrow keys move, Shift runs, and Space jumps. Drag to look. On touch screens, use the thumbstick, Run and Jump. Esc or Exit walk returns to orbit controls.'],
    ['Time and visibility', 'Use the timeline to change the date, play time, or change its speed. Site visibility shows estimated sunlight and Earth visibility for the displayed period. Compare opens a comparison of up to three locations.'],
    ['Layers and settings', 'Layers (L) controls terrain relief, WAC imagery and feature labels. Relief ×1 uses true scale. Auto increases relief from orbit and returns toward ×1 near the surface. WAC imagery mode displays the image without simulated lighting.'],
    ['Move panels', 'Drag any information panel by its Move panel handle. With the handle focused, arrow keys move it and Home resets its position. Temporary pin labels appear on hover; they do not drag.'],
    ['Pin legend', 'Solid white: landed spacecraft · red: failed landing attempt · dashed gold: approximate landing coordinates · hollow white: potential landing region · small blue diamond: selected terrain feature. Thousands of named craters and other features are searched or shown as zoom-dependent labels, not spacecraft markers. Click Help or press I to reopen this guide.'],
  ];
  for (const [title, text] of sections) panel.append(el('h3', { text: title }), el('p', { text }));
  const swatches = [
    ['landed', 'Solid white', 'Confirmed landing site'],
    ['failed', 'Red', 'Failed landing or likely impact'],
    ['approx', 'Dashed gold', 'Approximate coordinates'],
    ['future', 'Hollow white', 'Potential landing region or planned CLPS mission'],
    ['terrain', 'Blue diamond', 'Selected terrain feature'],
  ];
  panel.append(el('h3', { text: 'Map key' }), el('div', { class: 'pin-key', role: 'list' },
    swatches.map(([kind, name, detail]) => el('div', { class: 'pin-key__row', role: 'listitem' }, [
      el('span', { class: `pin-key__symbol pin-key__symbol--${kind}`, 'aria-hidden': 'true' }),
      el('strong', { text: name }),
      el('span', { text: detail }),
    ]))));

  container.append(panel);
  const popup = bindPopover(button, panel, { onOpen: () => close.focus() });
  close.addEventListener('click', () => popup.close(true));

  // Full-screen first-visit onboarding, separate from the normal draggable Help dialog.
  // Mark it complete only when the visitor explicitly starts exploring.
  let welcomeVisible = false;
  let hasSeenWelcome = false;
  try { hasSeenWelcome = localStorage.getItem('lunar-atlas-welcome-v2') === 'complete'; }
  catch { /* Private browsing / blocked storage: show the guide for this visit. */ }
  const directView = new URLSearchParams(window.location.search).has('shot');
  if (!hasSeenWelcome && !directView) {
    const begin = el('button', { type: 'button', class: 'btn welcome-screen__start', text: 'Start exploring  →' });
    const intro = el('section', { class: 'welcome-screen__intro' }, [
      el('p', { class: 'welcome-screen__eyebrow', text: 'CENTAURI LUNAR ATLAS  /  USER GUIDE' }),
      el('h1', { id: 'welcome-title', text: 'Explore the Moon' }),
      el('p', { class: 'welcome-screen__lead', text: 'NASA terrain and imagery. Historic landing sites, future mission regions, and local sunlight and Earth visibility.' }),
      el('p', { class: 'welcome-screen__subtitle', text: 'Start on the Earth-facing near side, then orbit, fly, compare sites or walk the surface. This guide opens again with I, F1, or Help.' }),
      el('div', { class: 'welcome-screen__credits' }, [
        el('span', { text: 'NASA LOLA + LROC' }),
        el('span', { text: 'JPL Horizons' }),
        el('span', { text: 'Built by Weston Rosch' }),
      ]),
    ]);
    const controls = sections.map(([title, description], index) => el('div', { class: 'welcome-screen__guide-item' }, [
      el('span', { class: 'welcome-screen__guide-number', text: String(index + 1).padStart(2, '0') }),
      el('div', {}, [el('h3', { text: title }), el('p', { text: description })]),
    ]));
    const guide = el('section', { class: 'welcome-screen__guide', 'aria-label': 'Controls and map key' }, [
      el('p', { class: 'welcome-screen__eyebrow', text: 'CONTROLS & NAVIGATION' }),
      ...controls,
      el('div', { class: 'welcome-screen__legend' }, [
        el('p', { class: 'welcome-screen__eyebrow', text: 'SITE MARKERS' }),
        el('div', { class: 'pin-key' }, swatches.map(([kind, name, detail]) => el('div', { class: 'pin-key__row' }, [
          el('span', { class: `pin-key__symbol pin-key__symbol--${kind}`, 'aria-hidden': 'true' }),
          el('strong', { text: name }), el('span', { text: detail }),
        ]))),
      ]),
    ]);
    const welcome = el('div', { class: 'welcome-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcome-title' }, [
      el('div', { class: 'welcome-screen__body' }, [intro, guide]),
      el('footer', { class: 'welcome-screen__footer' }, [
        el('p', { text: 'LOLA TERRAIN  ·  LROC IMAGERY  ·  JPL HORIZONS' }),
        begin,
      ]),
    ]);
    container.append(welcome);
    welcomeVisible = true;
    // Set focus after the DOM is attached; the CTA is always available above the guide scroll.
    begin.focus({ preventScroll: true });
    let dismissed = false;
    const finish = () => {
      if (dismissed) return;
      dismissed = true;
      welcomeVisible = false;
      begin.disabled = true;
      try { localStorage.setItem('lunar-atlas-welcome-v2', 'complete'); } catch {}
      const remove = () => {
        welcome.remove();
        container.querySelector('canvas')?.focus({ preventScroll: true });
      };
      if (reducedMotion.matches) { remove(); return; }
      welcome.classList.add('welcome-screen--leaving');
      welcome.addEventListener('transitionend', (event) => {
        if (event.target === welcome) remove();
      }, { once: true });
      window.setTimeout(() => { if (welcome.isConnected) remove(); }, 800);
    };
    begin.addEventListener('click', finish);
    welcome.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(); }
      if (event.key === 'Tab') {
        // Keep keyboard focus within this first-visit modal.
        const focusables = [begin, ...welcome.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')].filter((node, i, list) => list.indexOf(node) === i);
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  }
  document.addEventListener('keydown', event => {
    // I is a single-key fallback: ? normally requires Shift+Slash on US keyboards.
    const helpKey = event.code === 'KeyI' || event.code === 'F1'
      || event.key === '?' || (event.code === 'Slash' && event.shiftKey);
    if (welcomeVisible || !helpKey || isTextField(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    popup.toggle();
  });
  // Returning visitors open the standard draggable Help panel from the toolbar or I / ? / F1.
}

