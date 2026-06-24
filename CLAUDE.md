# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kiez-Finder — a Berlin-specific PWA that uses browser geolocation to determine which official Berlin
**Kiez** (LOR 2021 Planungsraum) the user is standing in, highlights its boundary on a map, and shows
the full hierarchy (Kiez → Bezirksregion → Prognoseraum → Bezirk) plus address and coordinates.

Live: **https://kiezfinder.celox.io** · deployed as a static build on the celox.io VPS (69.62.121.168),
webroot `/var/www/kiezfinder.celox.io/`, nginx block `kiezfinder.celox.io`.

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
  **Interactive levels:** the Kiez title + the Bezirksregion/Bezirk rows are `<button>`s with
  `data-level` (`kiez`/`bzr`/`bez`); a delegated click calls `selectLevel()` → `map.highlight(…,{fit})`.
  **Default highlight = the merged colloquial Kiez** (`level: 'kiez'` → `kiezAreaFor`), so the whole
  Kiez is one area, not the single Planungsraum. Title = precomputed colloquial `kiez` (instant),
  subline = the exact `plr_name`. A **map click** → `pickAt()` → `locateAt()` (shared with geolocation
  `checkIn()`, `_seq`-guarded), which highlights `kiezAreaFor(kiez)`. Address row patched async.
  **Mobile bottom sheet** (`sheet`/`initSheetDrag` + `beginDrag`/`moveDrag`/`endDrag`): on `≤839px`
  the card is a fixed bottom sheet, `--sheet-y` transform, `open`↔`peek` snap via the M3 spring.
  **Touch gestures** (touch events, `{passive:false}`): a drag starts from the 44px handle (any dir),
  the peeked sheet (any vertical), or the content **only when scrolled to top & pulling down** — else
  native scroll wins (`touch-action: pan-y` on `.pass-scroll`). Velocity+position snap (light flick).
  Tap a peeked sheet → open (first tap opens, then controls work); synthetic clicks suppressed after a
  drag (`justDragged`). Mouse/keyboard: handle click toggles, `aria-expanded`. Non-modal (map usable).
- `src/map.js` — `KiezMap` class wrapping MapLibre GL. Keyless CARTO tiles (dark-matter/positron).
  `lockOn()` is the signature moment: `flyTo` the user, drop the beacon, then animate the Kiez
  fill/outline in with a spring. `highlight(feature,{fit})` highlights any LOR level (+`fitBounds`);
  `goTo()` handles a map-click pick; `onPick(cb)` fires on map clicks → main re-locates.
  **Sector overlay + labels:** `setOverlayData({bez,bzr,areas,…})` adds choropleth fill/line layers
  (below the blue selection) + always-on label symbol layers. **4 modes**
  `setOverlayMode('off'|'bezirke'|'bzr'|'kiez')` — the `kiez` mode colours the merged colloquial
  Kiez-areas (so Flughafenkiez ≠ Körnerkiez, which the Bezirksregion mode can't show as they share a
  Bezirksregion). **Every level is neighbour-aware coloured**: `adjacency(fc,idKey)` detects shared
  borders (the dissolve keeps them topologically identical), `computeSlots()` graph-colours over a
  14-hue cool ramp (greedy by degree + local passes, deterministic) so adjacent areas get far-apart
  hues; `colorAt(slot)` maps slot→colour. Bezirke keep `computeBezSlots()` (12 unique slots).
  `_tuneBasemapLabels()` hides the basemap's own suburb/hamlet/village place labels to avoid
  duplication. `setTheme()` re-adds custom layers AND recolours overlays after `setStyle()`.
  **Colloquial Kiez labels:** `lbl-kiez` renders OSM `place=quarter/neighbourhood` names
  (`public/data/kiez-names.geojson`, 537 pts from Overpass) accent-tinted at z≥12.5 — the vernacular
  Kieze (Flughafenkiez, Reuterkiez …), distinct from the official labels.
  **Label points:** Bezirk/Bezirksregion labels (`lbl-bez`/`lbl-bzr`) are driven by POINT sources
  (`bezirke-pts`/`bezirksregionen-pts.geojson`, mapshaper `-points inner`), NOT the polygons —
  otherwise a big polygon gets a duplicate label per vector tile it spans.
- `src/kiez.js` — loads `public/data/kieze.geojson`, hand-rolled ray-cast point-in-polygon
  (bbox-prefiltered, handles MultiPolygon + holes). `findKiez(lon,lat)` → feature or null.
  Each Planungsraum carries `gid` + `kiez` (precomputed colloquial Kiez, see pipeline below).
  **`kiezAreaFor(plr)`** → the merged colloquial-Kiez polygon (union of all Planungsräume sharing
  its `gid`) from `kiez-areas.geojson` (loaded alongside in `loadKieze`); falls back to the single plr.
  **`findOsmKiez(lon,lat)`** → finest OSM `place=quarter/neighbourhood` polygon containing the point
  (`osm-kieze.geojson`, 71 precise named Kieze that are *finer than a Planungsraum*, e.g. Scheunenviertel).
  `locateAt` prefers it over the Planungsraum-group when standing inside one; also fed into search.
  Also loads the 3 **aggregate LOR levels** (`bezirke`/`prognoseraeume`/`bezirksregionen.geojson`,
  lazy via `loadLevels()`) and exposes `featureForLevel(level, plrFeature)` — `kiez` → `kiezAreaFor`,
  else derives the level's id from the `plr_id` prefix (Bezirk=2, Prognoseraum=4, Bezirksregion=6) and
  looks it up. `bboxOf()` feeds `fitBounds`.
- `src/search.js` — dependency-free fuzzy place search. `buildSearchIndex({kieze,areas,bez,bzr,pgr})`
  builds ~950 entries (Bezirk/Kiez/Bezirksregion/Planungsraum/Prognoseraum, deduped by norm|type,
  redundant pgr/plr skipped). `norm()` folds diacritics + ß→ss + „straße"→„str". `search(q,limit)`
  scores per multi-tier (exact→prefix→word-prefix→substring→subsequence→bounded Levenshtein typo) +
  type priority; ~0.2 ms/query. `main.js` wires the topbar search box → `selectPlace()` →
  `map.highlight(feature,{fit})` + a `renderPlace()` card ("Ausgewählt", "Mein Standort" back to geo).
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
  (LOR 2021 Planungsräume, EPSG:4326). Regeneration steps are in the README. `kieze.geojson` ≈ 647 KB
  (542 features, simplified 12%, carries `gid`+`kiez`); `berlin-outline.geojson` = dissolved city boundary;
  `bezirke`/`prognoseraeume`/`bezirksregionen.geojson` = aggregate LOR levels; `kiez-names.geojson` =
  537 OSM colloquial-Kiez label points.
- **Merged Kiez-areas** (`kiez-areas.geojson`, 355 features): each colloquial Kiez (Schillerkiez =
  4 Planungsräume) is ONE dissolved polygon. Built by reverse-geocoding every Planungsraum's inner
  point via Nominatim → its `quarter`/`neighbourhood`, grouping by name **within connected components**
  (shared-vertex adjacency, so distant same-named Kieze don't merge), then `mapshaper -dissolve gid`.
  This is more precise than the Bezirksregion (which would over-include, e.g. Silbersteinstraße =
  Körnerkiez, not Schillerkiez). Coverage ≈78 % (OSM `quarter` isn't flächendeckend); the rest stays
  its own Planungsraum. One-time build (slow: 542 rate-limited Nominatim calls).
- **nginx Permissions-Policy gotcha:** geolocation must be allowed on the *HTML document*. Because
  `try_files … /index.html` internally redirects to `location = /index.html`, and that block defines
  its own `add_header`, nginx drops the server-level headers there — so the security headers
  (incl. `Permissions-Policy: geolocation=(self)`) are repeated inside the `location = /index.html`
  block. Without it the browser blocks `getCurrentPosition`.
- **Theme:** pre-paint inline script in `index.html` sets `data-theme` (no FOUC) and flags `html.js`.
- **OG/preview image** `public/og.png` (1200×630) is generated from the real Bezirksregionen geometry:
  a Node script projects them to an SVG (cool-palette fills) + brand wordmark/tagline and renders to PNG
  via `@resvg/resvg-js` using the self-hosted woff2 fonts. (Playwright screenshots are unreliable in
  this env — use resvg, not a browser screenshot.) Meta tags + JSON-LD (WebApplication) in `index.html`.
- The original app (React + Google Maps, at mrx3k1.de/kiez-finder) was rebuilt from scratch here —
  keyless, Berlin-specialized, MD3 Expressive, with a proper motion/craft pass.

## Deploy

```bash
npm run build
rsync -avz --delete dist/ root@69.62.121.168:/var/www/kiezfinder.celox.io/
```
TLS via certbot (Let's Encrypt), auto-renewing. DNS A-record kiezfinder.celox.io → 69.62.121.168.
