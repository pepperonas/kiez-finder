# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kiez-Finder — a Berlin-specific PWA that uses browser geolocation to determine which official Berlin
**Kiez** (LOR 2021 Planungsraum) the user is standing in, highlights its boundary on a map, and shows
the full hierarchy (Kiez → Bezirksregion → Prognoseraum → Bezirk) plus address and coordinates.

Live: **https://kiez-finder.celox.io** · deployed as a static build on the celox.io VPS (69.62.121.168),
webroot `/var/www/kiez-finder.celox.io/`, nginx block `kiez-finder.celox.io`.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # → dist/
npm run preview  # serve dist/ locally
```
No test suite, no linter configured. Geolocation needs a secure context (localhost or HTTPS).

## Architecture

Vanilla JS + Vite, deliberately dependency-light. **One JS island**, one motion system.

- `src/main.js` — orchestrator + state machine (locating → found / outside-Berlin / error), builds the
  DOM with a safe `h()` helper (Kiez names via `textContent`, only static strings via innerHTML),
  owns the lock-on flow, theme toggle (View Transitions circular reveal), install prompt, card tilt.
  **Interactive levels:** the Kiez title + the Bezirk/Bezirksregion/Prognoseraum rows are `<button>`s
  with `data-level`; a delegated click on the card calls `selectLevel()` → `map.highlight(…,{fit})`.
  A **map click** → `pickAt()` → `locateAt()` (shared with geolocation `checkIn()`, `_seq`-guarded
  against out-of-order results), which always resets to the Kiez level. The address row renders
  instantly and is patched async (`patchAddress`).
- `src/map.js` — `KiezMap` class wrapping MapLibre GL. Keyless CARTO tiles (dark-matter/positron).
  `lockOn()` is the signature moment: `flyTo` the user, drop the beacon, then animate the Kiez
  fill/outline in with a spring. `highlight(feature,{fit})` highlights any LOR level (+`fitBounds`);
  `goTo()` handles a map-click pick; `onPick(cb)` fires on map clicks → main re-locates.
  **Sector overlay + labels:** `setOverlayData(bezFC,bzrFC)` adds choropleth fill/line layers (below
  the blue selection) + always-on label symbol layers (Bezirk = big/bold/uppercase, Bezirksregion =
  smaller). `setOverlayMode('off'|'bezirke'|'bzr')` toggles fill/line visibility. Per-feature colours
  are precomputed in `augment()` from a cohesive cool HSL palette (`bezHue`/`bezColors`/`bzrColors`):
  Bezirke get 12 distinct hues; Bezirksregionen inherit their Bezirk's hue and vary by lightness.
  `_tuneBasemapLabels()` hides the basemap's own suburb/hamlet/village place labels to avoid
  duplication. `setTheme()` re-adds custom layers AND recolours overlays after `setStyle()`.
- `src/kiez.js` — loads `public/data/kieze.geojson`, hand-rolled ray-cast point-in-polygon
  (bbox-prefiltered, handles MultiPolygon + holes). `findKiez(lon,lat)` → feature or null.
  Also loads the 3 **aggregate LOR levels** (`bezirke`/`prognoseraeume`/`bezirksregionen.geojson`,
  lazy via `loadLevels()`) and exposes `featureForLevel(level, plrFeature)` — derives the level's id
  from the Kiez's `plr_id` prefix (Bezirk=2, Prognoseraum=4, Bezirksregion=6, Kiez=8) and looks it up.
  `bboxOf()` feeds `fitBounds`.
- `src/geo.js` — `getPosition()` (geolocation, mapped errors) + `reverseGeocode()` (Nominatim,
  best-effort, cached in sessionStorage). Returns `{ line, kiez, raw }`: `line` = address,
  `kiez` = OSM `quarter`/`neighbourhood` (the colloquial Kiez name, e.g. "Flughafenkiez").
  When present and ≠ the LOR name, `main.js` `patchKiezName()` promotes it to the title and demotes
  the official Planungsraum name (e.g. "Flughafenstraße") to a `.kiez-official` subline. OSM `quarter`
  isn't flächendeckend, so it only augments — the LOR name is the instant default + fallback.
- `src/motion.js` — **the spring system.** CSS has no springs, so spatial motion uses a tiny Euler
  spring integrator with the verbatim **M3 Expressive** tokens (spatial-fast 800/0.6,
  spatial-default 380/0.8, spatial-slow 200/0.8). Opacity/colour stay on CSS easing. Honors
  `prefers-reduced-motion` everywhere. Also: `revealStagger`, `tweenNumber`, `damdamper` (pointer tilt).
- `src/style.css` — MD3 Expressive tokens (motion/shape/state), tonal dark+light palettes,
  all component styles, beacon/radar/stamp animations, reduced-motion guard.

## Key facts & gotchas

- **No API keys / secrets.** Tiles are keyless CARTO; geocoding is Nominatim (1 req/s policy → results
  are cached). The classification is our own point-in-polygon against official boundaries, NOT Nominatim.
- **Kiez data** (`public/data/`) is pre-processed with mapshaper from the Geoportal Berlin WFS
  (LOR 2021 Planungsräume, EPSG:4326). Regeneration steps are in the README. `kieze.geojson` ≈ 628 KB
  (542 features, simplified 12%); `berlin-outline.geojson` is the dissolved city boundary.
- **nginx Permissions-Policy gotcha:** geolocation must be allowed on the *HTML document*. Because
  `try_files … /index.html` internally redirects to `location = /index.html`, and that block defines
  its own `add_header`, nginx drops the server-level headers there — so the security headers
  (incl. `Permissions-Policy: geolocation=(self)`) are repeated inside the `location = /index.html`
  block. Without it the browser blocks `getCurrentPosition`.
- **Theme:** pre-paint inline script in `index.html` sets `data-theme` (no FOUC) and flags `html.js`.
- The original app (React + Google Maps, at mrx3k1.de/kiez-finder) was rebuilt from scratch here —
  keyless, Berlin-specialized, MD3 Expressive, with a proper motion/craft pass.

## Deploy

```bash
npm run build
rsync -avz --delete dist/ root@69.62.121.168:/var/www/kiez-finder.celox.io/
```
TLS via certbot (Let's Encrypt), auto-renewing. DNS A-record kiez-finder.celox.io → 69.62.121.168.
