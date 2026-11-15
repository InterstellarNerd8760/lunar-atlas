# Lunar Atlas UI kit (basic)

Docs only. Devin implements this in the app. Nothing here changes app code.

Feel: a dark, full-bleed globe with a few quiet glass panels on top. Plain labels, restrained type, no hype copy.

## Style rules

- Sentence case for every label and heading. No all-caps or wide-tracked section labels.
- Depth comes from layered, slightly lighter translucent surfaces and 1px hairline borders, not drop shadows.
- No `transition-all`. Transition only the properties that change (`background-color`, `border-color`, `color`, `opacity`, `transform`), 120–180 ms, ease-out.
- `prefers-reduced-motion: reduce` turns off transitions, autoplay, and fly-to easing (cut straight to the target).
- No gradients on UI chrome, and no pulse animations.
- AA contrast, a visible `:focus-visible` ring on every control, and hit targets of at least 40 px (44 px on touch).

## Tokens (placeholder, owned by Polaris and pending review)

Keep every token in this one `:root` block so Polaris's final values can replace it in one swap.

```css
:root {
  /* surfaces */
  --background: 222 30% 4%;          /* page behind the canvas, #07090d */
  --foreground: 220 20% 94%;         /* primary text */
  --card: 222 24% 10% / 0.72;        /* glass panel, level 1 */
  --card-raised: 222 22% 14% / 0.78; /* nested surface or hover, level 2 */
  --popover: 222 22% 12% / 0.92;     /* menus, date picker, tooltips */
  --muted: 222 16% 18%;
  --muted-foreground: 220 12% 68%;   /* secondary text, AA on --card */
  --accent: 214 30% 24%;             /* hover fill */
  --accent-foreground: 220 20% 96%;
  --primary: 212 90% 72%;            /* selected, active, links */
  --primary-foreground: 222 30% 8%;
  --border: 220 20% 80% / 0.12;      /* hairline */
  --border-strong: 220 20% 80% / 0.22;
  --ring: 212 90% 72%;
  --destructive: 0 75% 66%;
  --radius: 10px;                    /* panels; controls use calc(var(--radius) - 4px) */
  --blur: 14px;

  /* visibility semantics (keep the hues already used in src/visibility.js) */
  --sun: 42 82% 68%;      /* #f0c76b */
  --earth: 213 70% 68%;   /* #73a9e7 */
  --both: 165 36% 61%;    /* #79bfad */
  --neither: 216 23% 26%; /* #344052 */

  /* type */
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace; /* time, coordinates */
}
```

Glass panel recipe: `background: hsl(var(--card)); backdrop-filter: blur(var(--blur)); border: 1px solid hsl(var(--border)); border-radius: var(--radius);` with no `box-shadow`. A nested surface uses `--card-raised` and the same hairline.

### Type scale

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `text-xs` | 12 / 16 | 400 | Captions, legend, source line |
| `text-sm` | 13 / 18 | 400–500 | Body, list rows, controls |
| `text-base` | 15 / 22 | 500 | Panel titles |
| `text-lg` | 18 / 24 | 600 | Drawer title |
| `text-mono` | 13 / 18, tabular numbers | 500 | UTC readout, coordinates, percentages |

### Spacing and radius

4 px base: 4, 8, 12, 16, 24. Panels have 12 px padding and sit 12 px from the viewport edges (16 px at 1440 wide and above). The gap inside a panel is 8 px. Radius is 10 px for panels, 6 px for controls, and fully round for pins and chips.

## Layout

```
+---------------------------------------------------------------------+
| Lunar Atlas            [Globe] [N pole] [S pole] [Free flight] [Layers]|  top bar (glass, 48px)
|+-----------+                                          +------------+|
|| Search /  |                                          | Site drawer||
|| Site list |              full-bleed globe            | title      ||
|| groups    |              (canvas, 100vw x 100dvh)    | image slot ||
||           |                                          | About...   ||
|| 280px     |                                          | Visibility ||
||           |                                          | Weston's   ||
|+-----------+                                          | take 340px ||
|                                                       +------------+|
| [<<][>||][1x v][Now]  ====o======================  Nov 15 2026 18:00 UTC [cal] |
+---------------------------------------------------------------------+  timeline (glass, 64px)
```

- Desktop, 1440×900 and up: site list on the left at 280 px, drawer on the right at 340 px, both open together.
- Old MacBook Air, 1280×800: the same layout. The site list collapses to a 48 px rail (search icon) once a site is selected, so the globe keeps its center. The drawer is capped at `calc(100dvh - 48px - 64px - 24px)` and scrolls inside.
- Tablet, 768–1023: the site list becomes a slide-over from the left (`/` or the search button). The drawer stays on the right at 320 px.
- Phone, below 768: the top bar keeps only the logo, search, and Layers. The drawer becomes a bottom sheet with peek (title and Sun/Earth status), half, and full heights. The timeline shrinks to a single row (play, scrubber, readout), and speed, reverse, and the date picker go into a "More" popover.
- The globe canvas is always full-bleed. `#moon-view` drops its current border, radius, and `h1` frame.

## Components

### Time slider (bottom timeline)
- Autoplays on load at 1 h/s (or paused under reduced motion). Play/pause is one toggle button with `aria-pressed`, labeled "Pause" or "Play".
- Speed is a segmented control or menu: `1x`, `1 h/s`, `1 d/s`, `1 mo/s`. Reverse is a toggle; when it's on, the speed chip shows a leading "−".
- Scrubber: full-width range input over the ephemeris window. The track is `--muted`, the filled part `--primary`, and the thumb is 16 px with a 44 px hit area. Dragging pauses playback, and releasing resumes it if it was playing.
- Readout: `Nov 15, 2026 18:00 UTC` in mono. Clicking it opens a date and time picker (UTC, a popover surface) limited to the ephemeris window.
- Now: jumps to the current UTC time. It's disabled, with a tooltip saying "Now is outside the loaded data", when the current time falls outside the window.
- Optional: a 4 px Sun/Earth strip for the selected site above the track, using the visibility colors.

### Sun and Earth visibility panel
- Lives in the site drawer, under "Sunlight and Earth visibility" (replaces the floating `.visibility-panel`).
- Two status rows at the current time: "Sun up" or "Sun down", and "Earth in view" or "Earth below horizon", each with a colored dot (`--sun` or `--earth`). A dot alone never carries the meaning; the text does.
- Metrics, in mono: % sunlight, % Earth in view, and longest darkness in hours, all over the loaded window.
- Strip timeline: 16 px tall, colored by `--sun`, `--earth`, `--both`, and `--neither`, with a playhead line that follows the time slider and a legend below it. Each segment has a tooltip with its UTC time and state.
- Optional: the existing horizon/sky-path plot (azimuth vs elevation), redrawn with token colors.
- Keep the existing caveats in `text-xs` muted text: spherical horizon, no terrain occlusion, and a "Source: JPL Horizons" link.

### Site list and search
- A search field at the top (placeholder "Search sites", focused with `/`) that filters by name, mission, and country.
- Filter chips: All, Apollo, Robotic landers, Artemis region, Notable features. A chip is either off or selected (`--accent` fill with a `--primary` hairline).
- Groups, in this order, with collapsible headers in sentence case and a count: "Apollo landers", "Robotic landers", "Artemis region", "Notable features".
- Row: name, then a muted second line with year and country, or "Terrain proxy" for Artemis region entries. States: default; hover (`--card-raised`); selected (`--accent` with a 2 px `--primary` left bar); focus-visible (ring); disabled for entries without coordinates (muted, with the tooltip "No published coordinates").
- Selecting a row flies to the site (about 1.2 s eased, or an instant cut under reduced motion) and opens the drawer.
- Globe pins: 10 px dot with a 1px dark outline and a 32 px invisible hit area. Hover grows it to 12 px and shows a name label. Selected is 14 px in `--primary` with a ring. Artemis region pins are hollow rings to show they are proxies.

### Site drawer
- Header: title (`text-lg`), a status chip ("Landed 1969", "Candidate region", or "Feature"), coordinates in mono (`20.191° N, 30.772° E`) with a copy button, and a close button (Esc).
- Image slot: 16:9, `--muted` placeholder, with a caption and credit line.
- "About this site": short text from `site-notes.json`, plus a source link. Artemis region entries keep the proxy disclaimer that's already in `moon.js`.
- Sunlight and Earth visibility (the panel above).
- "Weston's take": a quoted block on `--card-raised` with a hairline left border. It's hidden when empty.
- Actions: "Fly to", "Stand on surface", and "Look at Earth" (existing buttons).

### Layers menu
- One "Layers" button in the top bar (shortcut `L`) opens a popover. It holds the existing controls, unchanged in behavior:
  - Terrain relief: Auto relief, ×1 (true scale), ×2, ×3, ×4 (`reliefControl`).
  - WAC imagery toggle (`imageryButton`, `aria-pressed`).
  - Stars toggle (moved here from the timeline).
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

These shortcuts only apply when focus is not in a text field and free flight is off. Free flight keeps W A S D, Space and C, and Shift as they are.

## Implementation notes for Devin

- `index.html` and `src/style.css`: drop the `main`/`h1` frame, make `#moon-view` fixed full-bleed, and add the token block.
- `src/moon.js`: the `.camera-toolbar` becomes the top bar. `siteSelect` becomes the site list (reuse `collectPlaces` groups: `apollo`, `lander`, `pole`, with `pole`/proxy shown as "Artemis region"). `reliefControl` and `imageryButton` go into the layers popover. `.site-info` and `.site-status` become the drawer.
- `src/sky.js`: `.sky-timeline` becomes the time slider. Add playback state (speed, direction) around the existing `slider` and `update()`. Move the Stars checkbox to the layers menu.
- `src/visibility.js`: render into the drawer section. Swap the hard-coded hex values for the `--sun`, `--earth`, `--both`, and `--neither` tokens. Add the playhead.
