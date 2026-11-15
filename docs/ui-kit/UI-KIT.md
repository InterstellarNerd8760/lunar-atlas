# Lunar Atlas UI kit (basic)

Docs only. Devin implements this in the app. Nothing here changes app code.

Feel: a dark, full-bleed globe with a few quiet glass panels on top, in the spirit of [Space Atlas](https://www.spaceatlas.tech). The palette formalizes the colors already hard-coded in `src/style.css` rather than re-skinning the app. Plain labels, restrained type, no hype copy.

## Style rules

- Sentence case for every label and heading. No all-caps or wide-tracked section labels.
- Depth comes from layered translucent surfaces (`--surface-1/2/3`) and 1px hairline borders, not drop shadows.
- No `transition-all`. Transition only the properties that change (`background-color`, `border-color`, `color`, `opacity`, `transform`), 120–180 ms, ease-out.
- `prefers-reduced-motion: reduce` turns off transitions, autoplay, and fly-to easing (cut straight to the target).
- No gradients on UI chrome, and no pulse animations.
- AA contrast. Hit targets are 40 px minimum (44 px on touch). The one exception is globe pins, below.
- Focus ring on every control and list row: `outline: 2px solid var(--ring); outline-offset: 2px;` on `:focus-visible`.

## Tokens (owned by Polaris, pending review)

These formalize the existing app palette. Keep them in this one `:root` block so the final values can be swapped in at once.

```css
:root {
  --background: #080b12;          /* style.css #moon-view background */
  --foreground: #f5f6fa;          /* style.css body color */
  --muted-foreground: #c5cad5;    /* style.css .moon-status; 11.2:1 on surface-1. Captions, source line, caveats */
  --subtle-foreground: rgb(255 255 255 / 0.45); /* disabled or decorative text only */

  /* glass, based on #10141d; each level is slightly more opaque */
  --surface-1: rgb(16 20 29 / 0.92); /* panels (style.css #10141de8 is about 91%) */
  --surface-2: rgb(16 20 29 / 0.94); /* nested blocks, hover rows, drawer sections */
  --surface-3: rgb(16 20 29 / 0.97); /* popovers, menus, date picker, pin label chips */
  --glass-blur: blur(8px);           /* style.css .camera-toolbar */
  --border: rgb(255 255 255 / 0.10); /* hairline */
  --border-strong: rgb(255 255 255 / 0.18);
  --muted: rgb(255 255 255 / 0.08); /* tracks, placeholders, empty strip lanes */
  --accent: rgb(158 201 255 / 0.14); /* hover and selected fill */

  --primary: #9ec9ff;              /* style.css link color; 10.8:1 on surface-1 */
  --primary-foreground: #080b12;
  --ring: #9ec9ff;
  --radius: 8px;                   /* panels; controls 6px */

  /* visibility hues, from src/visibility.js */
  --sun: #f0c76b;
  --earth: #73a9e7;
  --both: #79bfad;
  --neither: #344052;

  --font-sans: system-ui, sans-serif;                        /* style.css body */
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace; /* time, coordinates, % */
}
```

Glass panel recipe: `background: var(--surface-1); backdrop-filter: var(--glass-blur); border: 1px solid var(--border); border-radius: var(--radius);` with no `box-shadow`.

**The visibility hues can't be told apart by color alone.** Sun, Earth, and both are only about 1.15–1.53:1 from each other (Earth vs both is 1.15, Sun vs both 1.33, Sun vs Earth 1.53). Wherever they appear, a text legend and the two-lane strip below are required.

### Type scale

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `text-micro` | 10 / 14 | 500 | Pin labels (on a chip), strip legend |
| `text-xs` | 12 / 16 | 400 | Captions, source line, caveats (`--muted-foreground`) |
| `text-sm` | 14 / 20 | 400–500 | Body, list rows, controls |
| `text-base` | 16 / 24 | 500 | Panel titles |
| `text-lg` | 18 / 24 | 600 | Drawer title |
| `text-mono` | 13 / 18, tabular numbers | 500 | UTC readout, coordinates, percentages |

### Spacing and radius

Spacing uses a 4 px base: 4, 8, 12, 16, 24. Panels have 12 px padding and sit 12 px from the viewport edges (16 px at 1440 wide and above). The gap inside a panel is 8 px. Radius is 8 px for panels, 6 px for controls, and fully round for pins and chips.

## Layout

```
+---------------------------------------------------------------------+
| Lunar Atlas         [Globe] [N pole] [S pole] [Free flight] [Layers]|  top bar (glass, 48px)
|+-----------+                                          +------------+|
|| Search /  |                                          | Site drawer||
|| Site list |              full-bleed globe            | title      ||
|| groups    |              (canvas, 100vw x 100dvh)    | image slot ||
||           |                                          | About...   ||
|| 280px     |                                          | Visibility ||
||           |                                          | Weston's   ||
|+-----------+                                          | take 340px ||
|                                                       +------------+|
| [<<][>||][1x v][Now]  ====o==================  Nov 15 2026 18:00 UTC [cal] |
+---------------------------------------------------------------------+  timeline (glass, 64px)
```

- Desktop, 1440×900 and up: site list on the left at 280 px, drawer on the right at 340 px, both open together.
- Old MacBook Air, 1280×800: the same layout, but the site list collapses to a 48 px rail (search icon) once a site is selected. The drawer height is capped at `calc(100dvh - 48px - 64px - 24px)` and scrolls inside.
- Tablet, 768–1023: the site list becomes a slide-over from the left. The drawer stays on the right at 320 px.
- Phone, below 768: the top bar shows only the name, search, and Layers. The drawer becomes a bottom sheet with three heights: peek (title and Sun/Earth status), half, and full. The timeline is one row (play, scrubber, readout), and speed, reverse, and the date picker move into a "More" popover.
- The canvas is always full-bleed: `#moon-view` drops its border, radius, and the `main`/`h1` frame.

## Components

### Time slider (bottom timeline)
- Autoplays on load at 1 h/s, or starts paused under reduced motion. Play/pause is a single toggle button whose label switches between "Pause" and "Play", with `aria-pressed`.
- Speed: `1x`, `1 h/s`, `1 d/s`, `1 mo/s`, as a segmented control or a menu. Reverse is a toggle, and while it's on the speed chip shows a leading "−".
- Scrubber: a full-width range input over the ephemeris window. The track is `--muted`, the filled part is `--primary`, and the 16 px thumb has a 44 px hit area. It sets `aria-valuetext` to the UTC string (for example "Nov 15, 2026 18:00 UTC"). Dragging pauses playback, and releasing resumes it if it was playing.
- Readout: the UTC time in mono. Clicking it opens a UTC date and time picker on `--surface-3`, limited to the ephemeris window. Put the readout in a region with `aria-live="polite"` that is updated only on pause, scrub end, or a date pick, never on every tick while playing.
- Now: jumps to the current UTC time. When that time is outside the loaded window, the button is disabled and its tooltip reads "Now is outside the loaded data".

### Sun and Earth visibility panel
- Sits in the site drawer as "Sunlight and Earth visibility", replacing the floating `.visibility-panel`.
- Status rows for the current time: "Sun up" or "Sun down", and "Earth in view" or "Earth below horizon". Each row has a colored dot, but the text carries the meaning.
- Metrics in mono: % sunlight, % Earth in view, and the longest darkness in hours over the loaded window.
- Strip: two stacked 8 px lanes inside a 1px `--border` hairline. The top lane is Sun (filled `--sun` when the Sun is up) and the bottom lane is Earth (filled `--earth` when Earth is in view). "Both" means both lanes are filled. "Neither" means both are empty (`--muted`). A playhead line follows the time slider, a text legend sits below (required), and each segment has a tooltip with its UTC time and state.
- Optional: the existing horizon/sky-path plot, redrawn with the token colors.
- Keep the existing caveats (spherical horizon, no terrain occlusion) and the "Source: JPL Horizons" link in `text-xs` `--muted-foreground`.

### Site list and search
- Search field at the top, with the placeholder "Search sites" and the `/` shortcut. It filters by name, mission, and country.
- Filter chips: All, Apollo, Robotic landers, Artemis region. A selected chip uses the `--accent` fill with a `--primary` hairline.
- Groups in sentence case with collapsible headers and counts: "Apollo landers", "Robotic landers", "Artemis region".
- Hide the "Notable features" chip and group until there are sites for it.
- Each row has the name, then a muted line with the year and country (or "Terrain proxy" for Artemis region rows).
- Row states:
  - Hover: `--surface-2`.
  - Selected: `--accent` with a 2 px `--primary` left bar.
  - Focus: the focus ring.
  - Disabled: Artemis region rows without coordinates. They use `--subtle-foreground`, carry the tooltip "No published coordinates", and sort to the bottom of their group.
- Selecting a row flies to the site (about 1.2 s eased, or an instant cut under reduced motion) and opens the drawer.
- Globe pins: a 10 px dot with a 1px dark outline. Hovering grows it to 12 px and shows its label. Selected is 14 px in `--primary` with a ring. Artemis region pins are hollow rings because they're proxies.
- Pin labels are `text-micro` on a small `--surface-3` chip with a hairline border and no text-shadow.
- The 32 px pin hit area is an accepted exception to the 40 px minimum, because the site list mirrors every pin as a full-size, keyboard-reachable row.

### Site drawer
- Header:
  - Title (`text-lg`).
  - Status chip: "Landed 1969", "Candidate region", or "Feature".
  - Coordinates in mono (`20.191° N, 30.772° E`) with a copy button.
  - Close button, also on Esc.
- Image slot: 16:9 with a `--muted` placeholder, plus a caption and credit line.
- "About this site": text from `site-notes.json` and a source link. Artemis region entries keep the proxy disclaimer already in `moon.js`.
- Sunlight and Earth visibility: the panel above.
- "Weston's take": a quote block on `--surface-2` with a hairline left border. It's hidden when empty.
- Actions: "Fly to", plus the existing "Stand on surface" and "Look at Earth" buttons.

### Layers menu
- One "Layers" button in the top bar opens a popover on `--surface-3` (shortcut `L`). It holds the existing controls with their behavior unchanged:
  - Terrain relief: Auto relief, ×1 (true scale), ×2, ×3, ×4 (`reliefControl`).
  - WAC imagery toggle (`imageryButton`, `aria-pressed`).
  - Stars, moved here from the timeline.
- The status text (LOLA terrain, texture, relief) becomes a muted footer line in this menu instead of the floating `.moon-status`.

## Keyboard map

| Key | Action |
|---|---|
| Space | Play or pause |
| `[` / `]` | Slower or faster speed step |
| R | Reverse |
| N | Now |
| ← / → | Scrub 1 step (Shift for 10) |
| `/` | Focus search |
| L | Open or close layers |
| Esc | Close the open popover or drawer, or exit free flight |

When the shortcuts are skipped:
- All of them are skipped in free flight, which keeps W A S D, Space and C, and Shift as they are in `moon.js`.
- Space, R, N, and the arrows are also skipped when focus is in a text field, on a button, or on the scrubber, so native keys still work there.

Arrow keys and OrbitControls: `src/moon.js` creates `OrbitControls` without calling `listenToKeyEvents`, so the globe doesn't respond to arrow keys today and there's no conflict. If keyboard orbit is ever added, attach it to the canvas only and have the global scrub shortcut ignore events whose target is the canvas.

## Implementation notes for Devin

- `index.html` and `src/style.css`: drop the `main`/`h1` frame, make `#moon-view` fixed and full-bleed, add the token block, and replace the hard-coded hex values with the tokens.
- `src/moon.js`:
  - `.camera-toolbar` becomes the top bar.
  - `siteSelect` becomes the site list. Reuse the `collectPlaces` groups (`apollo`, `lander`, `pole`) and show `pole`/proxy as "Artemis region".
  - `reliefControl` and `imageryButton` move into the layers popover.
  - `.site-info` and `.site-status` become the drawer.
- `src/sky.js`: `.sky-timeline` becomes the time slider. Add playback state (speed and direction) around the existing `slider` and `update()`, and move the Stars checkbox to the layers menu.
- `src/visibility.js`: render into the drawer section. Replace the single-lane `.visibility-strip` with the two-lane strip, use the token colors, and add the playhead.
