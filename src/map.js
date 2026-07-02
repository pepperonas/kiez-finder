// ─────────────────────────────────────────────────────────────────────────
// Map — MapLibre GL with keyless Carto vector tiles (dark-matter / positron).
// Owns the signature transition: fly to the user, then the Kiez boundary
// *draws itself* in.
// ─────────────────────────────────────────────────────────────────────────
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { spring, SPRINGS, reduceMotion } from './motion.js'
import { BERLIN_CENTER, bboxOf, bezirkName } from './kiez.js'

const STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
}

// brand accent per theme (the Kiez fill / outline colour)
const ACCENT = { dark: '#7da2ff', light: '#3b5bdb' }
// strong selection outline: a bright crisp line over a dark/light casing halo so
// the active boundary stands out on any background (incl. the dense colour overlay)
const SELECTION = {
  dark: { line: '#ffffff', casing: 'rgba(5,9,17,0.85)' },
  light: { line: '#0b1c52', casing: 'rgba(255,255,255,0.9)' },
}

// fonts that ship with the Carto glyph endpoint (bold + regular stacks)
const FONT_BOLD = ['Montserrat Medium', 'Open Sans Bold']
const FONT_REG = ['Montserrat Regular', 'Open Sans Regular']

// ── theme-coherent categorical colours ───────────────────────────────────────
// A cohesive cool palette (teal → cyan → blue → indigo → violet → magenta).
// Bezirke get 12 distinct hues; Bezirksregionen inherit their Bezirk's hue and
// vary by lightness → grouped by Bezirk, yet locally distinguishable.
const bezHue = (idx) => 162 + (idx % 12) * 14 // 162…316°

function hslHex(h, s, l) {
  h = ((h % 360) + 360) % 360
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0')
  return '#' + to(f(0)) + to(f(8)) + to(f(4))
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function bezColors(idx, theme) {
  const h = bezHue(idx)
  return theme === 'dark'
    ? { fill: hslHex(h, 52, 60), line: hslHex(h, 64, 74) }
    : { fill: hslHex(h, 60, 50), line: hslHex(h, 66, 38) }
}
// generic distinct colour for a graph-coloured slot (Bezirksregionen + Kieze) —
// each adjacent area gets a far-apart hue, so neighbours read clearly different.
const PAL_N = 14
function colorAt(slot, theme) {
  const h = 158 + ((slot % PAL_N) + PAL_N) % PAL_N * (172 / (PAL_N - 1)) // 158…330° (cool jewel ramp)
  return theme === 'dark'
    ? { fill: hslHex(h, 58, 62), line: hslHex(h, 70, 76) }
    : { fill: hslHex(h, 64, 47), line: hslHex(h, 68, 37) }
}

// ── neighbour-aware palette assignment ───────────────────────────────────────
// Adjacent Bezirke must look clearly different. We detect adjacency from shared
// boundary vertices (the dissolve keeps shared borders topologically identical),
// then spread the 12 palette slots so neighbours land far apart on the hue ramp.
function ringsOf(geom) {
  return geom.type === 'Polygon' ? geom.coordinates
    : geom.type === 'MultiPolygon' ? geom.coordinates.flat() : []
}

// adjacency from shared boundary vertices (the dissolve keeps shared borders
// topologically identical), keyed by an arbitrary id property.
function adjacency(fc, idKey) {
  const at = new Map(), adj = new Map()
  for (const f of fc.features) adj.set(f.properties[idKey], new Set())
  for (const f of fc.features) {
    const id = f.properties[idKey]
    for (const ring of ringsOf(f.geometry)) {
      for (const [x, y] of ring) {
        const k = x.toFixed(5) + ',' + y.toFixed(5)
        let s = at.get(k); if (!s) at.set(k, (s = new Set()))
        s.add(id)
      }
    }
  }
  for (const s of at.values()) {
    if (s.size < 2) continue
    const a = [...s]
    for (let i = 0; i < a.length; i++)
      for (let j = i + 1; j < a.length; j++) { adj.get(a[i]).add(a[j]); adj.get(a[j]).add(a[i]) }
  }
  return adj
}
const bezAdjacency = (fc) => adjacency(fc, 'id')

// Graph-colour many areas (Bezirksregionen, Kieze) over PAL_N hues so adjacent
// areas land far apart on the ramp. Greedy by descending degree + a few local
// passes — deterministic (no RNG), fast for hundreds of features.
function computeSlots(fc, idKey) {
  const ids = fc.features.map((f) => f.properties[idKey])
  const adj = adjacency(fc, idKey)
  // distance-2 neighbours (share a common neighbour) — so even areas that are
  // only *near* each other (e.g. Flughafenkiez & Körnerkiez, with Rollberg
  // between them) get pushed to different hues.
  const adj2 = new Map()
  for (const id of ids) {
    const s = new Set(), d1 = adj.get(id)
    for (const n of d1) for (const nn of adj.get(n)) if (nn !== id && !d1.has(nn)) s.add(nn)
    adj2.set(id, s)
  }
  const order = ids.slice().sort((a, b) => (adj.get(b).size - adj.get(a).size) || (a < b ? -1 : 1))
  const slot = new Map()
  // slot-usage histogram, maintained incrementally — rebuilding it per pick made
  // the assignment O(n²·passes) (~2M ops for the 427 Kiez areas)
  const used = new Array(PAL_N).fill(0)
  const assign = (id, s) => {
    const old = slot.get(id)
    if (old != null) used[old]--
    slot.set(id, s)
    used[s]++
  }
  const pick = (id) => {
    const nb1 = [...adj.get(id)].map((x) => slot.get(x)).filter((v) => v != null)
    const nb2 = [...adj2.get(id)].map((x) => slot.get(x)).filter((v) => v != null)
    let best = 0, bestScore = -Infinity
    for (let s = 0; s < PAL_N; s++) {
      let m1 = PAL_N; for (const v of nb1) { const d = Math.abs(s - v); if (d < m1) m1 = d }
      let m2 = PAL_N; for (const v of nb2) { const d = Math.abs(s - v); if (d < m2) m2 = d }
      const sc = m1 * 1000 + m2 * 8 - used[s] // adjacent gap dominates, then near gap, then balance
      if (sc > bestScore) { bestScore = sc; best = s }
    }
    return best
  }
  for (const id of order) assign(id, pick(id))
  for (let pass = 0; pass < 6; pass++) for (const id of order) assign(id, pick(id))
  return slot
}

// Assign each Bezirk a palette slot (0…n-1) maximising the minimum hue gap
// between adjacent Bezirke. Deterministic: greedy local search (pair swaps) over
// a few fixed start permutations, no RNG → stable colours across reloads.
function computeBezSlots(fc) {
  const codes = fc.features.map((f) => f.properties.id).sort()
  const n = codes.length
  const idx = new Map(codes.map((c, i) => [c, i]))
  const adj = bezAdjacency(fc)
  const nbr = codes.map((c) => [...adj.get(c)].map((x) => idx.get(x)).filter((v) => v != null))
  const score = (s) => {
    let min = Infinity, sum = 0
    for (let i = 0; i < n; i++) for (const j of nbr[i]) if (j > i) {
      const d = Math.abs(s[i] - s[j]); if (d < min) min = d; sum += d
    }
    return { min, sum }
  }
  const better = (a, b) => a.min > b.min || (a.min === b.min && a.sum > b.sum)
  const optimise = (start) => {
    const s = start.slice()
    let cur = score(s), improved = true, guard = 0
    while (improved && guard++ < 200) {
      improved = false
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        ;[s[a], s[b]] = [s[b], s[a]]
        const sc = score(s)
        if (better(sc, cur)) { cur = sc; improved = true } else { [s[a], s[b]] = [s[b], s[a]] }
      }
    }
    return { s, sc: cur }
  }
  // deterministic start permutations: identity, reversed, even-then-odd interleave
  const ident = codes.map((_, i) => i)
  const starts = [
    ident,
    ident.slice().reverse(),
    [...ident.filter((i) => i % 2 === 0), ...ident.filter((i) => i % 2 === 1)],
  ]
  let best = null
  for (const st of starts) { const r = optimise(st); if (!best || better(r.sc, best.sc)) best = r }
  return new Map(codes.map((c, i) => [c, best.s[i]]))
}

// build an overlay source FC: shares geometry, adds name + per-theme colours.
// slotMap is the level's own neighbour-spread assignment (id/gid → palette slot).
function augment(fc, level, theme, slotMap) {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const p = f.properties
      let name, c
      if (level === 'bez') {
        name = bezirkName(p.bez)
        c = bezColors(slotMap && slotMap.has(p.id) ? slotMap.get(p.id) : parseInt(p.id, 10) - 1, theme)
      } else if (level === 'kiez') {
        name = p.kiez
        c = colorAt(slotMap.get(p.gid) || 0, theme)
      } else { // bzr
        name = p.bzr_name
        c = colorAt(slotMap.get(p.id) || 0, theme)
      }
      return { type: 'Feature', geometry: f.geometry, properties: { name, col: c.fill, lin: c.line } }
    }),
  }
}

// point-in-polygon (even-odd across all rings → handles holes + MultiPolygon)
function ringHas([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function pipEvenOdd(pt, geom) {
  let inside = false
  for (const ring of ringsOf(geom)) if (ringHas(pt, ring)) inside = !inside
  return inside
}
// For each feature: a name + bbox + a small grid of interior points. At render
// time we pick, per visible feature, the interior point on screen nearest its
// centre → one label per visible area, at any zoom (centroid points fall off the
// screen when you zoom in; these don't).
function labelCandidates(featureColl, nameOf) {
  const N = 4
  return featureColl.features.map((f) => {
    const bb = bboxOf(f) // [minLon, minLat, maxLon, maxLat]
    const pts = []
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = bb[0] + (bb[2] - bb[0]) * (i + 0.5) / N
      const y = bb[1] + (bb[3] - bb[1]) * (j + 0.5) / N
      if (pipEvenOdd([x, y], f.geometry)) pts.push([x, y])
    }
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2
    if (!pts.length) pts.push([cx, cy])
    return { name: nameOf(f), c: [cx, cy], bb, pts }
  })
}

export class KiezMap {
  constructor(container, theme, outline) {
    this.theme = theme
    this._outline = outline
    this._beacon = null
    this._cancelFill = null
    this._overlayRaw = null     // { bez: FC, bzr: FC }
    this._mode = 'off'          // off | bezirke | bzr
    this.map = new maplibregl.Map({
      container,
      style: STYLES[theme],
      center: BERLIN_CENTER,
      zoom: 9.4,
      attributionControl: { compact: true },
      cooperativeGestures: false,
      pitchWithRotate: false,
      dragRotate: false,
      // keep the camera feeling like an object with inertia
      fadeDuration: 200,
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      'bottom-right'
    )
    this._pickCb = null
    this.map.getCanvas().style.cursor = 'crosshair'
    this.map.on('click', (e) => {
      if (this._pickCb) this._pickCb(e.lngLat.lng, e.lngLat.lat)
    })
    this._ready = new Promise((res) => this.map.on('load', res)).then(() => this._onLoad())
  }

  whenReady() {
    return this._ready
  }

  /** Register a callback for map clicks → (lon, lat). */
  onPick(cb) {
    this._pickCb = cb
  }

  // Notify on camera movement (rAF-throttled) and once the map settles — drives
  // the floating "current area" chip.
  onMove(cb) {
    let raf = 0
    const fire = () => { raf = 0; cb() }
    this.map.on('move', () => { if (!raf) raf = requestAnimationFrame(fire) })
    this.map.on('idle', cb)
  }

  // The overlay area under the screen centre for the active mode → { name, col }.
  // Uses the rendered fill so it always reflects what's actually on screen, at any
  // zoom (unlike the centroid label points, which leave the viewport when zoomed in).
  areaAtCenter(mode) {
    const layer = mode === 'bezirke' ? 'ov-bez-fill'
      : mode === 'bzr' ? 'ov-bzr-fill'
      : mode === 'kiez' ? 'ov-kiez-fill' : null
    if (!layer || !this.map.getLayer(layer)) return null
    const pt = this.map.project(this.map.getCenter())
    const f = this.map.queryRenderedFeatures(pt, { layers: [layer] })[0]
    return f ? { name: f.properties.name, col: f.properties.col } : null
  }

  _onLoad() {
    const accent = ACCENT[this.theme]
    // Idempotent add helpers — a rapid theme re-style can re-enter before the old
    // style is fully torn down; adding only what's absent avoids both "already
    // exists" throws and the "can't remove source in use" pitfall.
    const addSrc = (id, def) => { if (!this.map.getSource(id)) this.map.addSource(id, def) }
    const addLyr = (def) => { if (!this.map.getLayer(def.id)) this.map.addLayer(def) }
    // Berlin outline — the "stage" in the locating state
    if (this._outline) {
      addSrc('berlin', { type: 'geojson', data: this._outline })
      addLyr({
        id: 'berlin-line',
        type: 'line',
        source: 'berlin',
        paint: {
          'line-color': accent,
          'line-width': 1.4,
          'line-opacity': 0.35,
          'line-dasharray': [2, 2],
        },
      })
    }
    // Active selection — starts empty, filled in on lock. A dark casing under a
    // bright crisp line makes the boundary pop on ANY background (dark map or the
    // dense colour overlay).
    const sel = SELECTION[this.theme]
    addSrc('kiez', { type: 'geojson', data: emptyFC() })
    addLyr({
      id: 'kiez-fill',
      type: 'fill',
      source: 'kiez',
      paint: { 'fill-color': accent, 'fill-opacity': 0 },
    })
    addLyr({
      id: 'kiez-casing',
      type: 'line',
      source: 'kiez',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': sel.casing, 'line-width': 0, 'line-opacity': 0, 'line-blur': 0.8 },
    })
    addLyr({
      id: 'kiez-line',
      type: 'line',
      source: 'kiez',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': sel.line, 'line-width': 0, 'line-opacity': 0, 'line-blur': 0.2 },
    })
    // selection colours are theme-dependent → refresh on every (re)load
    if (this.map.getLayer('kiez-line')) this.map.setPaintProperty('kiez-line', 'line-color', sel.line)
    if (this.map.getLayer('kiez-casing')) this.map.setPaintProperty('kiez-casing', 'line-color', sel.casing)
    if (this.map.getLayer('kiez-fill')) this.map.setPaintProperty('kiez-fill', 'fill-color', accent)

    this._tuneBasemapLabels()
    if (this._overlayRaw) this._addOverlayLayers()
  }

  // Hide the basemap's own neighbourhood labels (suburbs/hamlets) so our
  // official Bezirk/Bezirksregion hierarchy reads cleanly without duplication.
  _tuneBasemapLabels() {
    for (const l of this.map.getStyle().layers) {
      if (l.type === 'symbol' && /place_(suburb|hamlet|village|neighbourhood|quarter)/.test(l.id)) {
        try { this.map.setLayoutProperty(l.id, 'visibility', 'none') } catch (e) {}
      }
    }
  }

  async setTheme(theme) {
    if (theme === this.theme && this._themedOnce) return
    this.theme = theme
    this._themedOnce = true
    const tok = (this._themeTok = (this._themeTok || 0) + 1) // guard overlapping rapid toggles
    await this._ready
    // setStyle wipes custom layers → re-add them once the new style is fully loaded
    this.map.setStyle(STYLES[theme])
    await new Promise((res) => {
      const check = () => { if (this.map.isStyleLoaded()) { this.map.off('styledata', check); res() } }
      this.map.on('styledata', check); check()
    })
    if (tok !== this._themeTok) return // a newer setTheme superseded this one
    this._onLoad() // re-adds selection layers, basemap tuning + overlays
    if (this._activeFeature) this._paint(this._activeFeature, true)
    if (this._lastPos) this._placeBeacon(this._lastPos)
  }

  // ── district / region overlay (choropleth + always-on labels) ──────────────
  async setOverlayData({ bez, bzr, areas, bezPts, bzrPts, kiezNames } = {}) {
    await this._ready
    this._overlayRaw = { bez, bzr, areas }
    this._labelPts = { bez: bezPts || null, bzr: bzrPts || null }
    this._kiezNames = kiezNames || this._kiezNames || null
    // neighbour-aware palette slots per level → adjacent areas clearly differ
    this._slots = {
      bez: computeBezSlots(bez),
      bzr: computeSlots(bzr, 'id'),
      kiez: areas ? computeSlots(areas, 'gid') : null,
    }
    // interior label points per area → dynamic, viewport-aware labels (so every
    // visible coloured area is labelled, not just the one whose centroid is on screen)
    this._labelCands = {
      bez: labelCandidates(bez, (f) => bezirkName(f.properties.bez)),
      bzr: labelCandidates(bzr, (f) => f.properties.bzr_name),
      kiez: areas ? labelCandidates(areas, (f) => f.properties.kiez) : null,
    }
    this._addOverlayLayers()
  }

  _addOverlayLayers() {
    if (!this._overlayRaw) return
    const dark = this.theme === 'dark'
    const defs = [
      { src: 'ov-bez', data: augment(this._overlayRaw.bez, 'bez', this.theme, this._slots.bez) },
      { src: 'ov-bzr', data: augment(this._overlayRaw.bzr, 'bzr', this.theme, this._slots.bzr) },
    ]
    if (this._overlayRaw.areas && this._slots.kiez)
      defs.push({ src: 'ov-kiez', data: augment(this._overlayRaw.areas, 'kiez', this.theme, this._slots.kiez) })
    for (const d of defs) {
      if (this.map.getSource(d.src)) this.map.getSource(d.src).setData(d.data)
      else this.map.addSource(d.src, { type: 'geojson', data: d.data })
    }
    // label POINT sources — filled dynamically per viewport (_updateOverlayLabels)
    for (const src of ['pt-bez', 'pt-bzr', 'pt-kiez']) {
      if (!this.map.getSource(src)) this.map.addSource(src, { type: 'geojson', data: emptyFC() })
    }
    // recompute which interior point labels each area whenever the camera settles;
    // a zoom fires moveend AND zoomend → coalesce to one scan per frame
    if (!this._lblHook) {
      this._lblHook = true
      let raf = 0
      const u = () => {
        if (raf) return
        raf = requestAnimationFrame(() => { raf = 0; this._updateOverlayLabels() })
      }
      this.map.on('moveend', u)
      this.map.on('zoomend', u)
    }

    // fills + lines sit BELOW the blue selection so it stays prominent
    const before = this.map.getLayer('kiez-fill') ? 'kiez-fill' : undefined
    const addFill = (id, src, vis) => {
      if (this.map.getLayer(id)) return
      this.map.addLayer({
        id, type: 'fill', source: src,
        layout: { visibility: vis },
        paint: { 'fill-color': ['get', 'col'], 'fill-opacity': dark ? 0.42 : 0.36 },
      }, before)
    }
    const addLine = (id, src, vis) => {
      if (this.map.getLayer(id)) return
      this.map.addLayer({
        id, type: 'line', source: src,
        layout: { visibility: vis, 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'lin'],
          'line-opacity': 0.85,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 12, 1.6, 15, 2.6],
        },
      }, before)
    }
    addFill('ov-bez-fill', 'ov-bez', this._mode === 'bezirke' ? 'visible' : 'none')
    addLine('ov-bez-line', 'ov-bez', this._mode === 'bezirke' ? 'visible' : 'none')
    addFill('ov-bzr-fill', 'ov-bzr', this._mode === 'bzr' ? 'visible' : 'none')
    addLine('ov-bzr-line', 'ov-bzr', this._mode === 'bzr' ? 'visible' : 'none')
    if (this.map.getSource('ov-kiez')) {
      addFill('ov-kiez-fill', 'ov-kiez', this._mode === 'kiez' ? 'visible' : 'none')
      addLine('ov-kiez-line', 'ov-kiez', this._mode === 'kiez' ? 'visible' : 'none')
    }

    // labels render ON TOP of everything; always visible (collision-managed)
    const haloDark = 'rgba(6,9,16,0.88)', haloLight = 'rgba(255,255,255,0.92)'

    // colloquial Kiez names (OSM quarter/neighbourhood) — the heart of the app,
    // so they're accent-tinted to read as a distinct layer. High zoom, lowest
    // collision priority (official Bezirk/Bezirksregion labels win).
    if (this._kiezNames) {
      if (this.map.getSource('kiez-names')) this.map.getSource('kiez-names').setData(this._kiezNames)
      else this.map.addSource('kiez-names', { type: 'geojson', data: this._kiezNames })
      if (!this.map.getLayer('lbl-kiez')) {
        this.map.addLayer({
          id: 'lbl-kiez', type: 'symbol', source: 'kiez-names', minzoom: 12.5,
          layout: {
            'text-field': ['get', 'name'], 'text-font': FONT_REG,
            'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 10, 14, 12.5, 16, 15],
            'text-max-width': 8, 'text-padding': 3, 'text-letter-spacing': 0.01,
            'symbol-sort-key': 3,
          },
          paint: {
            'text-color': ACCENT[this.theme],
            'text-halo-color': dark ? haloDark : haloLight,
            'text-halo-width': 1.5, 'text-halo-blur': 0.3,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 12.6, 1],
          },
        })
      }
    }

    if (this.map.getSource('pt-bzr') && !this.map.getLayer('lbl-bzr')) {
      this.map.addLayer({
        id: 'lbl-bzr', type: 'symbol', source: 'pt-bzr', minzoom: 10.5,
        layout: {
          'text-field': ['get', 'name'], 'text-font': FONT_REG,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.5, 13, 11.5, 15, 13.5, 17, 15.5],
          'text-max-width': 7, 'text-padding': 4, 'text-letter-spacing': 0.01,
          'symbol-sort-key': 2,
        },
        paint: {
          'text-color': dark ? '#c3cce2' : '#3a4159',
          'text-halo-color': dark ? haloDark : haloLight,
          'text-halo-width': 1.3, 'text-halo-blur': 0.3,
        },
      })
    }
    if (this.map.getSource('pt-bez') && !this.map.getLayer('lbl-bez')) {
      this.map.addLayer({
        id: 'lbl-bez', type: 'symbol', source: 'pt-bez',
        layout: {
          'text-field': ['get', 'name'], 'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 10, 14.5, 12, 19, 14, 23, 16, 27],
          'text-transform': 'uppercase', 'text-letter-spacing': 0.09,
          'text-max-width': 8, 'text-padding': 8, 'symbol-sort-key': 0,
        },
        paint: {
          'text-color': dark ? '#eef2ff' : '#10131c',
          'text-halo-color': dark ? haloDark : haloLight,
          'text-halo-width': 1.7, 'text-halo-blur': 0.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.92, 11, 1],
        },
      })
    }
    // merged colloquial Kiez labels for the Kieze overlay (accent-tinted)
    if (this.map.getSource('pt-kiez') && !this.map.getLayer('lbl-kiezarea')) {
      this.map.addLayer({
        id: 'lbl-kiezarea', type: 'symbol', source: 'pt-kiez',
        layout: {
          'text-field': ['get', 'name'], 'text-font': FONT_REG,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 13, 12.5, 15, 14.5, 17, 16],
          'text-max-width': 8, 'text-padding': 4, 'text-letter-spacing': 0.01, 'symbol-sort-key': 1,
        },
        paint: {
          'text-color': ACCENT[this.theme],
          'text-halo-color': dark ? haloDark : haloLight,
          'text-halo-width': 1.5, 'text-halo-blur': 0.3,
        },
      })
    }
    this._applyMode()
  }

  setOverlayMode(mode) {
    this._mode = mode
    this._applyMode()
  }

  // Per visible area, choose the interior grid point nearest its centre that's on
  // screen → one label inside each visible area, at any zoom/pan. Inactive levels
  // get an empty source so only the active overlay is labelled.
  _updateOverlayLabels() {
    if (!this._labelCands) return
    const lvl = this._mode === 'bezirke' ? 'bez' : this._mode === 'bzr' ? 'bzr' : this._mode === 'kiez' ? 'kiez' : null
    // empty the now-inactive sources only when the level actually changes —
    // re-feeding empty FCs on every camera settle is pointless worker churn
    if (lvl !== this._lblLevel) {
      this._lblLevel = lvl
      const empty = emptyFC()
      for (const k of ['bez', 'bzr', 'kiez']) {
        const s = this.map.getSource('pt-' + k)
        if (s && k !== lvl) s.setData(empty)
      }
    }
    const cands = lvl && this._labelCands[lvl]
    if (!cands) return
    const b = this.map.getBounds()
    const W = b.getWest(), E = b.getEast(), S = b.getSouth(), No = b.getNorth()
    const feats = []
    for (const c of cands) {
      if (c.bb[2] < W || c.bb[0] > E || c.bb[3] < S || c.bb[1] > No) continue // off-screen
      let best = null, bd = Infinity
      for (const p of c.pts) {
        if (p[0] < W || p[0] > E || p[1] < S || p[1] > No) continue
        const dx = p[0] - c.c[0], dy = p[1] - c.c[1], d = dx * dx + dy * dy
        if (d < bd) { bd = d; best = p }
      }
      if (best) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: best }, properties: { name: c.name } })
    }
    const src = this.map.getSource('pt-' + lvl)
    if (src) src.setData({ type: 'FeatureCollection', features: feats })
  }

  _applyMode() {
    const set = (id, on) => {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    set('ov-bez-fill', this._mode === 'bezirke')
    set('ov-bez-line', this._mode === 'bezirke')
    set('ov-bzr-fill', this._mode === 'bzr')
    set('ov-bzr-line', this._mode === 'bzr')
    set('ov-kiez-fill', this._mode === 'kiez')
    set('ov-kiez-line', this._mode === 'kiez')
    // in Kieze mode the merged-area labels replace the ambient OSM Kiez labels
    set('lbl-kiez', this._mode !== 'kiez')
    set('lbl-kiezarea', this._mode === 'kiez')
    // the dashed city outline is redundant once sectors are coloured
    set('berlin-line', this._mode === 'off')
    this._updateOverlayLabels()
  }

  /** Signature moment: fly to the user, drop the beacon, draw the Kiez. */
  async lockOn(lon, lat, feature) {
    await this._ready
    this._lastPos = [lon, lat]
    this._activeFeature = feature || null

    this._placeBeacon([lon, lat])

    const flyOpts = {
      center: [lon, lat],
      zoom: feature ? 14.2 : 11,
      duration: reduceMotion() ? 0 : 2200,
      essential: true,
      // emphasized-decelerate feel for the camera
      easing: (t) => 1 - Math.pow(1 - t, 4),
      curve: 1.42,
    }
    this.map.flyTo(flyOpts)

    if (feature) {
      // wait until the camera has mostly arrived, then draw the boundary in
      this._cancelPendingPaint()
      const delay = reduceMotion() ? 0 : 1500
      this._paintTimer = setTimeout(() => this._paint(feature), delay)
    } else {
      this.clearHighlight()
    }
  }

  /** Map-click pick: move the beacon to the point and frame its Kiez. */
  async goTo(lon, lat, feature) {
    await this._ready
    this._lastPos = [lon, lat]
    this._placeBeacon([lon, lat])
    if (feature) {
      this._paint(feature)
      this.fitTo(feature)
    } else {
      this.clearHighlight()
      this.map.easeTo({
        center: [lon, lat],
        zoom: Math.max(this.map.getZoom(), 11),
        duration: reduceMotion() ? 0 : 600,
        essential: true,
      })
    }
  }

  /**
   * Highlight an arbitrary LOR feature (any level). `fit` frames the camera to
   * the feature's bounds — used when the user switches level via the card.
   */
  async highlight(feature, { fit = false } = {}) {
    await this._ready
    if (!feature) { this.clearHighlight(); return }
    this._activeFeature = feature
    this._paint(feature)
    if (fit) this.fitTo(feature)
  }

  fitTo(feature) {
    const b = bboxOf(feature)
    if (!b) return
    this.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
      padding: this._fitPadding(),
      duration: reduceMotion() ? 0 : 900,
      essential: true,
      maxZoom: 15,
    })
  }

  // leave room for the pass card (bottom sheet on mobile, side panel on desktop)
  _fitPadding() {
    const wide = window.matchMedia('(min-width: 840px)').matches
    return wide
      ? { top: 90, right: 60, bottom: 60, left: 480 }
      : { top: 90, right: 40, bottom: Math.round(window.innerHeight * 0.5), left: 40 }
  }

  // a newer paint/clear supersedes any boundary still waiting on the lock-on delay
  _cancelPendingPaint() {
    if (this._paintTimer) { clearTimeout(this._paintTimer); this._paintTimer = null }
    if (this._cancelFill) { this._cancelFill(); this._cancelFill = null }
  }

  _paint(feature, instant = false) {
    this._cancelPendingPaint()
    const src = this.map.getSource('kiez')
    if (!src) return // mid-restyle: layers not re-added yet — skip (will repaint after)
    src.setData(fc(feature))
    const targetFill = this.theme === 'dark' ? 0.16 : 0.12
    const LW = 3.8, CW = 8.5 // line + casing widths (strong, pops over the overlay)
    const set = (p) => {
      this.map.setPaintProperty('kiez-fill', 'fill-opacity', targetFill * p)
      this.map.setPaintProperty('kiez-line', 'line-opacity', Math.min(1, p))
      this.map.setPaintProperty('kiez-line', 'line-width', LW * p)
      this.map.setPaintProperty('kiez-casing', 'line-opacity', Math.min(1, p) * 0.9)
      this.map.setPaintProperty('kiez-casing', 'line-width', CW * p)
    }
    if (instant || reduceMotion()) { set(1); return }
    // animate fill + outline with the slow spatial spring (a confident reveal)
    this._cancelFill = spring(0, 1, SPRINGS.spatialSlow, set)
  }

  clearHighlight() {
    this._activeFeature = null
    this._cancelPendingPaint()
    const src = this.map.getSource('kiez')
    if (!src) return
    src.setData(emptyFC())
    this.map.setPaintProperty('kiez-fill', 'fill-opacity', 0)
    this.map.setPaintProperty('kiez-line', 'line-opacity', 0)
    this.map.setPaintProperty('kiez-casing', 'line-opacity', 0)
  }

  _placeBeacon([lon, lat]) {
    if (!this._beacon) {
      const el = document.createElement('div')
      el.className = 'beacon'
      el.innerHTML = '<span class="beacon-ring"></span><span class="beacon-ring beacon-ring--2"></span><span class="beacon-dot"></span>'
      this._beacon = new maplibregl.Marker({ element: el, anchor: 'center' })
    }
    this._beacon.setLngLat([lon, lat]).addTo(this.map)
  }

  /** Recentre on the active Kiez (used by the "show on map" affordance). */
  recenter() {
    if (this._lastPos)
      this.map.flyTo({ center: this._lastPos, zoom: 14.2, duration: 900, essential: true })
  }

  resize() {
    this.map && this.map.resize()
  }
}

function fc(feature) {
  return { type: 'FeatureCollection', features: [feature] }
}
function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}
