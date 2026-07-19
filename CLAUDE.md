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
npm test         # unit tests (Node's built-in runner, no deps) — tests/*.test.js
```
No linter configured. Geolocation needs a secure context (localhost or HTTPS).

**Tests** (`tests/`, `node --test`, zero dependencies — 56 tests, 100% line coverage on
the three unit-testable modules) cover the dependency-light pure logic: `search.js`
(norm folding + the multi-tier scorer / type-priority / dedup), `kiez.js` (point-in-polygon
classification incl. holes + MultiPolygon, `bezirkName`, `kmFromBerlin`, `bboxOf`,
`levelName` — plus, via a **fetch mock**, the loaders and the loaded-state functions:
`tests/loaders.test.js` = happy paths (memoisation, `findKiez`/`findOsmKiez` nesting,
`kiezAreaFor` merge, `featureForLevel` prefix derivation) and `tests/loaders-fallback.test.js`
= failure paths (core-dataset failure surfaces as an error, optional datasets missing,
`loadWall`/`loadStreets` fail→reset→retry). The two files share fixtures via
`tests/loaders-fixtures.mjs` and MUST stay separate files: the runner isolates each test
file in its own process, giving the fallback file a fresh module instance — query-string
imports would instead split `src/kiez.js` into one coverage row per instance), and
`prefs.js` (the DOM-free persistence helpers backing the Auto-Zoom toggle).
`main.js`/`map.js` aren't covered — they pull in MapLibre + CSS, so pure logic worth
testing (persistence, graph-colouring, label candidates) is **extracted into a
maplibre-free module first** (that's what `prefs.js` is). Add tests alongside as
`tests/<name>.test.js`. Coverage: `node --test --experimental-test-coverage tests/`.
**CI:** `.github/workflows/ci.yml` runs tests+coverage+build on Node 20/22 per push/PR;
the README's CI badge points at it.

**README screenshots** (`docs/screenshot-*.png`) are regenerated with
`tools/screenshots.cjs` against a `npm run preview -- --port 4190` server (needs a
resolvable `playwright` package + real Chrome; captures via CDP because Playwright's
`page.screenshot` hangs on the continuously repainting software-WebGL MapLibre canvas;
geolocation mocked to the Reuterkiez; 4 shots dark = app default, the Mauer shot
deliberately light for the paper-archival look). Compress afterwards with
`pngquant --quality=70-90` (script header documents the exact call).

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
  **Sheet stays put on a map-pick:** `locateAt({fly})` passes `openSheet: fly` → `renderFound`/
  `renderOutside` → `setCard(node, animate, forceOpen)` → `sheetOnRender(forceOpen)`. Only the geolocation
  lock-on (`fly:true`) re-opens the bottom sheet; a casual map-pick keeps the current state (a peeked
  sheet stays peeked) so the map + overlay you're exploring stay visible — otherwise every pick slammed
  the sheet open over the map and overlay-mode switches looked like they did nothing.
  **Auto-Zoom toggle (⛶ topbar toggle):** `state.autoZoom` (persisted `kf-autozoom`, default on)
  governs ONLY the map-tap camera fit — `locateAt` passes `fit: state.autoZoom` into
  `map.goTo(lon,lat,feature,{fit})`, which paints the boundary + moves the beacon but skips `fitTo`
  when off (the tapped point is already on screen, so the camera stays put). Explicit "take-me-there"
  actions are unaffected and always frame: the geolocation lock-on (`fly:true`), the level rows,
  search selection, and the "Auf Karte zentrieren" buttons. `applyAutoZoom` flips
  `aria-pressed`/`is-active` (accent-tinted when on, like the wall button) + persists.
  **Mobile bottom sheet** (`sheet`/`initSheetDrag` + `beginDrag`/`moveDrag`/`endDrag`): on `≤839px`
  the card is a fixed bottom sheet, `--sheet-y` transform, `open`↔`peek` snap via the M3 spring.
  **Compact peek (~113px):** in peek the decorative/secondary elements collapse via CSS
  (`.pass[data-sheet='peek'] :is(.stamp,.radar,.eyebrow,.kiez-official)` → max-height 0) so the
  strip is just grabber + Kiez title. `measureSheet` measures the title's real bottom and
  subtracts the outer heights of exactly what collapses ABOVE it (stamp/radar + eyebrow) — this
  works measured in either state (collapsed elements contribute 0), so resize-while-peeked stays
  correct. Don't hard-code the peek height; paddings/margins between handle and title vary.
  **Touch gestures** (touch events, `{passive:false}`): a drag starts from the 44px handle (any dir),
  the peeked sheet (any vertical), or the content **only when scrolled to top & pulling down** — else
  native scroll wins (`touch-action: pan-y` on `.pass-scroll`). Velocity+position snap (light flick).
  Tap a peeked sheet → open (first tap opens, then controls work); synthetic clicks suppressed after a
  drag (`justDragged`). Mouse/keyboard: handle click toggles, `aria-expanded`. Non-modal (map usable).
  **Desktop collapse:** on `≥840px` the card is a side panel with a `.pass-collapse` (◀) button;
  `setPanelCollapsed` toggles `#app.panel-collapsed`, sliding the panel off-screen via **`margin-left`**
  (not `transform` — the card's pointer-tilt owns `transform`, and the `pass-in` entrance animation's
  `fill: both` would otherwise override an opacity/transform collapse). A fixed `.pass-reopen` tab brings
  it back; state persists in `localStorage 'kf-panel'`. Both buttons are mobile-hidden; the collapse CSS
  is scoped to the desktop media query so a persisted collapsed state is inert on phones.
- `src/map.js` — `KiezMap` class wrapping MapLibre GL. Keyless CARTO tiles (dark-matter/positron).
  `lockOn()` is the signature moment: `flyTo` the user, drop the beacon, then animate the Kiez
  fill/outline in with a spring. `highlight(feature,{fit})` highlights any LOR level (+`fitBounds`);
  `goTo(lon,lat,feature,{fit})` handles a map-click pick (`fit:false` from the Auto-Zoom-off
  toggle marks the area but leaves the camera put); `onPick(cb)` fires on map clicks → main re-locates.
  **"Current area" chip:** in `main.js`, a floating pill names the coloured region under the map
  **centre** (via `map.areaAtCenter(mode)` → `queryRenderedFeatures` on the active `ov-*-fill`, giving
  name+colour). Driven by `map.onMove` (rAF-throttled `move` + `idle`); `refreshAreaChip` retries on rAF
  up to 1.5s (a new viewport / freshly-shown layer needs a few frames to paint) and keeps the last label
  during tile loads instead of flickering. Fixes labels vanishing when zoomed into a region whose centroid
  label point is off-screen.
  **Sector overlay + labels:** `setOverlayData({bez,bzr,areas,…})` adds choropleth fill/line layers
  (below the blue selection) + always-on label symbol layers. **4 modes**
  `setOverlayMode('off'|'bezirke'|'bzr'|'kiez')` — the `kiez` mode colours the merged colloquial
  Kiez-areas (so Flughafenkiez ≠ Körnerkiez, which the Bezirksregion mode can't show as they share a
  Bezirksregion). **Every level is neighbour-aware coloured**: `adjacency(fc,idKey)` detects shared
  borders (the dissolve keeps them topologically identical), `computeSlots()` graph-colours over a
  14-hue cool ramp (greedy by degree + local passes, deterministic) so adjacent areas get far-apart
  hues; `colorAt(slot)` maps slot→colour. Bezirke keep `computeBezSlots()` (12 unique slots).
  `_tuneBasemapLabels()` hides the basemap's own suburb/hamlet/village place labels to avoid
  duplication. `_tuneBasemapDetails()` surfaces streets + parks gently: dark-matter paints green
  spaces `#0e0e0e` (invisible) and shows minor street names only at z16 — we retint
  `landcover`/`park_*` fills (quiet theme-matched green, opacity grows with zoom), pull street
  names one zoom step earlier (`setLayerZoomRange`: minor 16→15, sec 15→14, pri 14→13.5) in muted
  tones that sit under the accent Kiez labels, and bring `poi_park` names to z14 (green-tinted).
  The selection also filters its own name out of the ambient `lbl-kiez` layer (setFilter in
  `_paint`/`clearHighlight`) so it isn't written twice. `setTheme()` re-adds custom layers AND
  recolours overlays after `setStyle()` (tunings re-run in `_onLoad`).
  **Colloquial Kiez labels:** `lbl-kiez` renders OSM `place=quarter/neighbourhood` names
  (`public/data/kiez-names.geojson`, 537 pts from Overpass) accent-tinted at z≥12.5 — the vernacular
  Kieze (Flughafenkiez, Reuterkiez …), distinct from the official labels.
  **Dynamic area labels:** every *visible* area of the active overlay is labelled, not just the one
  whose centroid is on screen. At `setOverlayData` we precompute `_labelCands` (a 4×4 grid of interior
  points per feature via even-odd point-in-polygon); on `moveend`/`zoomend` + mode change,
  `_updateOverlayLabels()` picks, per feature whose bbox is in view, the interior point on screen nearest
  its centre → one point per visible area into `pt-bez`/`pt-bzr`/`pt-kiez`, rendered by `lbl-bez`/`lbl-bzr`/
  `lbl-kiezarea`. Inactive levels' sources are emptied; `lbl-kiez` (ambient OSM names) is hidden in Kieze
  mode so it doesn't double the merged-area labels. This replaced the single static centroid point per
  area (which vanished when you zoomed past it). `main.js` also keeps a floating **"current area" chip**
  (`map.areaAtCenter` via `queryRenderedFeatures` on `ov-*-fill`) as a live centre readout while panning.
  **Label UX rules (cartographic hierarchy):** each candidate carries `sort` (area rank →
  `symbol-sort-key`: big areas beat slivers in collisions) and `szf` (data-driven text-size factor:
  top-20% areas ×1.14, bottom-40% ×0.88 → visual size hierarchy). All area/ambient labels use
  `text-variable-anchor` (center/top/bottom/left/right + radial offset) so crowded labels slide aside
  instead of vanishing. **Anti-jitter hysteresis:** `_lblKeep` keeps a feature's chosen interior point
  while it stays on screen (verified: 11/11 points stable across a pan; cache dropped when
  `_labelCands` rebuild or level changes). **Selection label `lbl-sel`:** `_paint` writes the
  highlighted area's name to `sel-pt` (interior point via `interiorPoint()`, name from
  kiez/name/plr_name/bzr_name/pgr_name/bez), accent-tinted, `symbol-sort-key: -1` (always wins);
  the same-named overlay label is suppressed in `_updateOverlayLabels` (`_selName`) so it isn't
  written twice; cleared in `clearHighlight`. `lbl-bez` sizes are capped ~21px and fade to 0.75
  past z15 so the Bezirk name stops shouting once you're deep in a Kiez; ambient `lbl-kiez` has
  `symbol-sort-key: 10000` (must yield — the overlay `sort` ranks can reach ~400).
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
- `src/search.js` — dependency-free fuzzy place search. `buildSearchIndex({kieze,areas,bez,bzr,pgr,streets})`
  builds ~12,500 entries (Bezirk/Kiez/Bezirksregion/Planungsraum/Prognoseraum deduped by norm|type,
  redundant pgr/plr skipped, plus ~11,400 street entries — NOT deduped, so same-named streets in
  different corners of the city stay separate hits distinguished by their Bezirk sub-line).
  `norm()` folds diacritics + ß→ss + „straße"→„str". `search(q,limit)` scores per multi-tier
  (exact→prefix→word-prefix→substring→subsequence→bounded Levenshtein typo) + type priority
  (streets = lowest prio → a Kiez outranks a same-named street); ~2 ms/query, input debounced 120 ms.
  `main.js` wires the topbar search box → `selectPlace()` → `map.highlight(feature,{fit})` + a
  `renderPlace()` card ("Ausgewählt", "Mein Standort" back to geo).
  **Street search:** street entries carry `pt` (on-street point) + `bbox` and `feature: null` —
  anything consuming `e.feature` must handle that. `selectPlace` branches to `selectStreet()`:
  resolves the street's Kiez from `pt` (same `findKiez` → `findOsmKiez`/`kiezAreaFor` preference as
  `locateAt`), sub-line "in <Kiez> · <Bezirk>", and calls `map.frameStreet(lon,lat,area,bbox)` —
  beacon ON the street, Kiez painted, camera fits the street's OWN bbox with `maxZoom: 15.5`
  (closer than the area fit's 13.7 — a street must be readable; the 5-km Sonnenallee still fits
  fully). Data: `public/data/strassen.json` (~833 KB, compact `[name, bezIdx, cx, cy, bbox×4]` +
  12-entry Bezirk table), loaded via `loadStreets()` in kiez.js inside boot's non-blocking
  Promise.all (`.catch(()=>null)` — search still works without streets if the file fails).
  Built one-time by `tools/build-streets.js` from an Overpass dump (all named highway ways incl.
  service, with per-way bounds via "out tags bb;" — query in the script header): 93,831 ways →
  10,119 names → union-find clustering of same-named segments within ~300 m → 11,446 clusters
  (the 10 Hauptstraßen stay separate). Representative point = member-way centre nearest the
  cluster centre (guaranteed on-street — a raw bbox centre of an L-shaped street is off-road);
  Bezirk via own point-in-polygon (46 boundary streets → bezIdx −1 → sub "Berlin").
- `src/geo.js` — `getPosition()` (geolocation, mapped errors) + `reverseGeocode()` (Nominatim,
  best-effort, cached in sessionStorage). Returns `{ line, kiez, raw }`: `line` = address,
  `kiez` = OSM `quarter`/`neighbourhood` (the colloquial Kiez name, e.g. "Flughafenkiez").
  When present and ≠ the LOR name, `main.js` `patchKiezName()` promotes it to the title and demotes
  the official Planungsraum name (e.g. "Flughafenstraße") to a `.kiez-official` subline. OSM `quarter`
  isn't flächendeckend, so it only augments — the LOR name is the instant default + fallback.
- `src/prefs.js` — DOM-free `readBoolPref(storage,key,dflt)` / `writeBoolPref(storage,key,on)` for
  localStorage-backed boolean preferences (storage injected → unit-testable, throwing/absent storage
  falls back to the default). Backs the Auto-Zoom toggle (`kf-autozoom`); `main.js` passes the real
  `localStorage`. Covered by `tests/prefs.test.js`.
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
- **Berliner-Mauer-Modus (🧱 topbar toggle):** retro B&W view. Data: official WFS
  `gdi.berlin.de/services/wfs/berlinermauer` ("Verlauf der Berliner Mauer, 1989" — layers
  a_grenzmauer/b_hinterlandmauer/c_politischegrenze/d_grenzstreifen) → `public/data/mauer.geojson`
  (one FC, `{typ: mauer|hinterland|streifen}`, DP-simplified) + `west-berlin.geojson`
  (THE West-Berlin polygon, 480 km², polygonized from grenzmauer+politischegrenze via
  `mapshaper -polygons gap-tolerance=0.002`; rebuild script pattern in the repo history)
  + `ost-berlin.geojson` (berlin-outline `-erase` west ring, sliver parts <0.2 km² dropped →
  404.6 km² main + 5.4 km² West-Staaken, which really was DDR territory).
  `loadWall()` in kiez.js is lazy (first toggle). map.js `setWallData`/`setWallMode` add
  8 layers (west = solid bright lift; ost = lift + diagonal-HATCH `fill-pattern` — the
  archival "other sector" signature, since grayscale leaves only lightness/texture to
  distinguish the halves; strip fill, dashed hinterland, white casing + black core,
  `lbl-wall` WEST-/OST-BERLIN wordmarks at two fixed points, maxzoom 13) idempotently in
  `_addWallLayers`, re-added by `_onLoad` after restyles. The hatch tile is a canvas-drawn
  16px image (`wall-hatch`, ink follows the theme) — style images are WIPED by setStyle,
  so it's re-created on every (re)load (remove-then-add, never just hasImage-skip). The B&W look is a
  CSS filter on `#map` (`#app.wall-mode`) + grain/vignette pseudo-elements — wall layers are
  deliberately grayscale (lightness contrast, not hue). **Spot colours:** the filter is
  `grayscale(0.5)` (NOT 1) so `_applyWallSpotColors(on)` can paint water (fills + waterway
  lines + water names) in OVERSATURATED ink blue and parks in firm green — after the filter
  they read as the muted two-spot-colour tints of an old printed map. Originals are stashed
  per layer|prop and restored on exit; `_addWallLayers` resets the stash after restyles and
  re-applies when `_wallOn`. The weakened filter would leak our accent blue → `lbl-kiez`,
  `lbl-sel`, `kiez-fill` are re-inked in wall mode via the same stash mechanism.
  Wall mode and the colour overlay are
  mutually exclusive (`applyWall`/`applyOverlay` switch each other off; previous overlay is
  restored on exit). The area chip becomes an Ost/West readout (`applyWallChip`,
  pointInGeometry against the west polygon). Persisted as `localStorage 'kf-wall'`.
  **Full-page restyle:** `#app.wall-mode` overrides the design tokens (accent/surface/outline
  per theme → ink-on-charcoal / ink-on-paper) plus `--font-display`/`--font-body` → system
  Courier stack; `font-family: var(--font-body)` on `#app.wall-mode` re-roots inheritance
  (body sits OUTSIDE #app, so inherited Inter would leak through otherwise). Every component
  flips via tokens — no markup changes, instant on/off. **Sector stamp in the card:**
  `sectorFor(pos)` (west/ost polygons) → `fillSectorSlot` renders an archival rubber-stamp
  (`.sector-stamp`: SEKTOR · 1989 / OST-BERLIN / Sowjetischer Sektor) into a `.sector-slot`
  in `renderFound`; CSS-gated on `#app.wall-mode` (no re-render on toggle) and patched via
  `updateSectorStamp()` when the wall data first loads with a card already on screen.
  Tests: `tests/wall-data.test.js` (dataset shape, ~480 km² area, known-place side checks).
- **setTheme restyle wait (map.js):** after `setStyle`, do NOT trust an immediate
  `isStyleLoaded()` — it can report a stale `true` for the DYING style, `_onLoad` then paints
  into it and the swap silently wipes ALL custom layers (selection, overlays, wall). MapLibre
  v4 also never fires `style.load` on setStyle. The reliable sequence (measured): wait for a
  `styledata` (swap begun) and only then accept `isStyleLoaded()===true` (checked on
  styledata/idle), with a 4 s hard-timeout + an `once('idle')` rebuild fallback.
- **PWA/offline:** all `public/data/*` (13 geojson + `strassen.json`, ~2.3 MB) are **precached** by
  the SW (`geojson,json` in `workbox.globPatterns`) — revisioned by content hash, so data edits bust
  the cache on deploy; the app classifies fully offline after the first visit and the **street
  search works fully offline** too (verified: preview server killed → reload → search + Kiez
  resolution intact). Only the basemap tiles are runtime-cached (StaleWhileRevalidate, 400 entries) —
  offline the map shows just previously visited areas. Don't reintroduce a
  runtime-caching route for them (the old `CacheFirst` route capped at 4 entries and silently broke
  offline). If the core `kieze.geojson` fails on a *first* load (offline/404/SPA-fallback-HTML),
  `locateAt` renders a dedicated **"Daten nicht geladen"** card with a retry (`renderDataError`) —
  a data failure must never masquerade as the "nicht in Berlin" state.
- **Selection paint races (map.js):** `lockOn` delays `_paint` by 1.5 s (camera flight). That timer
  (`_paintTimer`) and the reveal spring (`_cancelFill`) are cancelled via `_cancelPendingPaint()` at
  the top of `_paint`/`clearHighlight` (+ before scheduling in `lockOn`) — otherwise a rapid re-lock
  painted the stale Kiez and a cleared boundary sprang back in.
- **Breakpoint:** mobile sheet is `max-width: 839.98px`, desktop panel `min-width: 840px` — the .98
  keeps the ranges contiguous at fractional widths (zoom/DPR); `sheetEnabled()` in main.js mirrors it.
- **nginx Permissions-Policy gotcha:** geolocation must be allowed on the *HTML document*. Because
  `try_files … /index.html` internally redirects to `location = /index.html`, and that block defines
  its own `add_header`, nginx drops the server-level headers there — so the security headers
  (incl. `Permissions-Policy: geolocation=(self)`) are repeated inside the `location = /index.html`
  block. Without it the browser blocks `getCurrentPosition`.
- **Theme:** pre-paint inline script in `index.html` sets `data-theme` (no FOUC) and flags `html.js`.
  The toggle (`applyTheme`) updates `state.theme` **synchronously** and swaps `data-theme` targeting the
  *current* `state.theme` (never the captured value) so overlapping/slow View Transitions can't lose or
  reorder a flip; a 600ms fallback + `t.finished.finally` guarantee the swap, and the heavy `map.setTheme`
  runs **outside** the VT callback (putting it inside → "DOM update timeout" → lost toggles). `map.setTheme`
  waits for `isStyleLoaded()`, is token-guarded against overlap, and `_onLoad` re-adds custom layers
  **idempotently** (add-if-absent, never remove-then-add) so a restyle can't throw "source already exists";
  `_paint`/`clearHighlight` no-op if the `kiez` source isn't back yet — and the reveal-spring `set()` +
  `clearHighlight` paint-resets are additionally `getLayer('kiez-fill')`-guarded (a restyle can wipe the
  layers MID-spring → console spam "Cannot style non-existing layer"). `updateThemeColor` keeps the
  `theme-color` meta matching the chosen theme.
  **Reveal-Look = 1:1 die celox.io-Website (2026-07-17):** circular reveal via View Transitions vom
  Klickpunkt, Desktop **900 ms** / Mobile+Touch (`max-width:768px` or `pointer:coarse`) **520 ms**,
  Easing `cubic-bezier(0.22, 0.08, 0, 1)`; während der Transition schaltet `html.theme-transition`
  ALLE `backdrop-filter` ab (Haupt-Ruckelquelle auf Mobile-GPUs, CSS in style.css).
  **Faux-Map-Theme + Veil:** die WebGL-Karte restylt erst NACH der Transition (setStyle+Tiles) —
  damit der Kreis auch über der KARTE das neue Theme aufdeckt, legt `swap()` sofort
  `#app.map-faux-theme` an (Canvas-Filter `invert(1) hue-rotate(180deg)` ≈ dark-matter↔positron,
  Hues bleiben erhalten). Der Rückweg läuft über `map.setThemeVeiled()` (map.js): der aktuelle
  Frame wird **im 'render'-Tick** (Buffer nur dort lesbar, preserveDrawingBuffer off) in ein
  2D-Canvas kopiert und als `.map-veil` ÜBER das GL-Canvas gelegt (unter den DOM-Markern — Beacon
  bleibt live), erst DANN fällt der Live-Filter (`onVeiled`-Callback), das echte Restyle läuft
  unsichtbar darunter, Unveil-Fade erst bei `'idle'` (Tiles gerendert; hart auf 4 s begrenzt,
  `movestart` unveilt sofort — Pannen unter eingefrorenem Bild wirkt kaputt). OHNE Veil blitzte
  die Karte nach dem Reveal hart auf: der Filter lag noch auf dem schon NEU rendernden Style
  (doppelt invertiert = alter Look) und schnappte dann ab; zudem löst setTheme bei isStyleLoaded
  auf, BEVOR Tiles gezeichnet sind (Background-Flash). Verifiziert per 50-ms-Timeline: 0 Lücken,
  in denen weder Filter noch Veil das Canvas deckt; Doppel-Toggle stackt nie >1 Veil
  (`this._veil`-Guard in map.js, `fauxThemeTok` modul-scoped in main.js).
  **Re-Toggle-Härtung (2026-07-17, „harte Wechsel nach ein paar Toggles"):** (1) `swap()` ruft
  `map.dropVeil()` — ein noch aktives Veil des VORHERIGEN Wechsels deckte sonst mit seinem festen
  alten Look den ganzen nächsten Reveal ab und wurde dann hart weggerissen (läuft im VT-Callback →
  alter Snapshot behält den Veil-Look). (2) Faux-Klasse CONDITIONAL: `toggle('map-faux-theme',
  map.theme !== state.theme)` — nach schnellem Hin-und-zurück rendert das Canvas schon das Ziel,
  blindes Invertieren zeigte das falsche Theme; dazu No-op-Skip in `setThemeVeiled` (Theme schon
  committed → gar kein Veil). (3) Der Palette-Fallback-Timer ist **2500 ms** (war 600) — der
  VT-Callback (WebGL-Snapshot) braucht auf beschäftigter GPU real >600 ms; feuerte der Timer
  vorher, passierte der ganze Swap OHNE Animation. (4) Snapshot-Timeout **3 s** (war 1 s) — bei
  Tile-Churn kommt der 'render'-Tick spät, Timeout = kein Veil = harter Restyle; Warten ist sicher,
  der Faux-Filter liegt bis `onVeiled` durchgehend. Hammer-Test (5 Toggles/1 s) + Netto-Null-
  Doppelklick + Re-Toggle-während-Veil sind Playwright-verifiziert.
  **Cooldown gegen Rapid-Toggle-Glitches (2026-07-17, VOLLER Zyklus):** schnelles Klicken erzeugte
  Darstellungsfehler mit mehreren Ursachen — (a) zwei überlappende View Transitions (VTs können nicht
  verschachteln, die laufende wird abgebrochen), UND (b) subtiler: ein Re-Toggle direkt nach dem
  sichtbaren Reveal startete, WÄHREND der vorherige `setTheme` noch Tiles lud → der Faux-Invert-Filter
  invertierte eine halb geladene Karte, sichtbar bis das nächste Veil deckte. Ein Cooldown, der nur
  den Reveal abdeckt (`t.finished`), fixt (a), aber NICHT (b). Fix: `themeBusy`-Guard im Click-Handler;
  `applyTheme` gibt ein Promise zurück, das erst auflöst, wenn der **GANZE Restyle** durch ist
  (`restyle().finally(resolve)` = setStyle + Tile-Load + Veil-Fade) — volle Serialisierung, kein
  setStyle-/Veil-Race. Klicks während des Cooldowns werden verworfen, `.busy` dimmt den Button. Dauer:
  auf echter Hardware ~2–4 s (im Software-WebGL-Headless bis ~13 s, weil dort schon der VT-Snapshot
  für `t.finished` ~4 s dauert — Artefakt, nicht real). **Restyle-Overlap-Härtung** bleibt als Defense:
  `KiezMap._restyleTok` — ein überholter `setThemeVeiled` platziert sein spätes Veil nicht mehr und
  restylet nicht; `dropVeil()` entfernt ALLE `.map-veil`. **Safety-Timeout 16 s** (NICHT weniger):
  liegt bewusst ÜBER der gebundenen Worst-Case-Summe (Reveal + 3 s Snapshot + 4 s setTheme + 4 s
  Unveil), damit er eine legitime Auflösung nie vorzeitig freigibt (das würde ein Race wieder
  ermöglichen); löst nur einen echten Hänger (Tab im Hintergrund → VT pausiert). Verifiziert:
  12 Klicks/80 ms → nur 1 akzeptiert, `vtMax`/`maxVeils`=1, Endzustand sauber; Re-Toggle 1,5 s nach
  Klick (Restyle läuft) → korrekt BLOCKIERT, Theme flippt nicht doppelt; 0 Konsolenfehler. Browser ohne
  `startViewTransition` bekommen den celox-`themeRipple`-Fallback: einfarbiger Kreis-Layer
  (Kiez-Surface-Farben `#0b0e14`/`#f3f4fb`) wächst per clip-path vom Button, Theme+Map wechseln
  unsichtbar darunter, dann fade-out; `themeRippleActive` guardet Doppelklicks. Bei Anpassungen
  die celox-Referenz beachten: `_customers/celox/website/v2/src/layouts/Layout.astro` (Theme-Teil).
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
