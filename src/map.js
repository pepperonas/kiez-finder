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
  dark: { line: '#ffffff', casing: 'rgba(5,9,17,0.7)', glow: '#dfe8ff', glowOp: 0.5 },
  light: { line: '#0b1c52', casing: 'rgba(255,255,255,0.8)', glow: '#3050b4', glowOp: 0.3 },
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
// interior point for a single feature (bbox centre if inside, else the interior
// grid point nearest it) — anchors the selection label
function interiorPoint(feature) {
  const bb = bboxOf(feature)
  const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2
  if (pipEvenOdd([cx, cy], feature.geometry)) return [cx, cy]
  const N = 5
  let best = null, bd = Infinity
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = bb[0] + (bb[2] - bb[0]) * (i + 0.5) / N
    const y = bb[1] + (bb[3] - bb[1]) * (j + 0.5) / N
    if (!pipEvenOdd([x, y], feature.geometry)) continue
    const d = (x - cx) ** 2 + (y - cy) ** 2
    if (d < bd) { bd = d; best = [x, y] }
  }
  return best || [cx, cy]
}

// planar shoelace area (relative units are enough — only used for RANKING)
function approxArea(geom) {
  let tot = 0
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []
  for (const poly of polys) {
    poly.forEach((ring, ri) => {
      let s = 0
      for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
      tot += (ri === 0 ? 1 : -1) * Math.abs(s) / 2
    })
  }
  return tot
}

// For each feature: a name + bbox + a small grid of interior points. At render
// time we pick, per visible feature, the interior point on screen nearest its
// centre → one label per visible area, at any zoom (centroid points fall off the
// screen when you zoom in; these don't).
// Cartographic hierarchy: every candidate carries a collision priority (`sort`,
// area rank — big areas beat slivers when space is tight) and a size tier
// (`szf`, data-driven text-size factor) so important areas read bigger.
function labelCandidates(featureColl, nameOf) {
  const N = 4
  const cands = featureColl.features.map((f, i) => {
    const bb = bboxOf(f) // [minLon, minLat, maxLon, maxLat]
    const pts = []
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = bb[0] + (bb[2] - bb[0]) * (i + 0.5) / N
      const y = bb[1] + (bb[3] - bb[1]) * (j + 0.5) / N
      if (pipEvenOdd([x, y], f.geometry)) pts.push([x, y])
    }
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2
    if (!pts.length) pts.push([cx, cy])
    return { id: i, name: nameOf(f), c: [cx, cy], bb, pts, area: approxArea(f.geometry) }
  })
  // area rank → collision priority (0 = biggest wins first) + size tier
  const byArea = cands.slice().sort((a, b) => b.area - a.area)
  byArea.forEach((c, rank) => {
    c.sort = rank
    const q = rank / Math.max(1, byArea.length - 1) // 0 = biggest … 1 = smallest
    c.szf = q < 0.2 ? 1.14 : q < 0.6 ? 1 : 0.88
  })
  return cands
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

  // Heat mode: the PLR under the screen centre → its name + raw properties
  // (the caller formats the active metric's value for the chip).
  heatAtCenter() {
    if (!this.map.getLayer('heat-fill')) return null
    const pt = this.map.project(this.map.getCenter())
    const f = this.map.queryRenderedFeatures(pt, { layers: ['heat-fill'] })[0]
    return f ? { name: f.properties.name, props: f.properties } : null
  }

  // ── Heatmap (Choroplethen je Planungsraum) ──────────────────────────────────
  /** Geometry + metric properties, set once; layers re-added after restyles. */
  async setHeatData(fc) {
    await this._ready
    this._heatRaw = fc
    this._addHeatLayers()
  }

  _addHeatLayers() {
    if (!this._heatRaw) return
    const src = this.map.getSource('heat')
    if (src) src.setData(this._heatRaw)
    else this.map.addSource('heat', { type: 'geojson', data: this._heatRaw })
    // below the blue selection, like the categorical overlays
    const before = this.map.getLayer('kiez-fill') ? 'kiez-fill' : undefined
    if (!this.map.getLayer('heat-fill')) {
      this.map.addLayer({
        id: 'heat-fill', type: 'fill', source: 'heat',
        layout: { visibility: 'none' },
        paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': this.theme === 'dark' ? 0.55 : 0.5 },
      }, before)
    }
    if (!this.map.getLayer('heat-line')) {
      this.map.addLayer({
        id: 'heat-line', type: 'line', source: 'heat',
        layout: { visibility: 'none', 'line-join': 'round' },
        paint: {
          'line-color': this.theme === 'dark' ? 'rgba(6,9,16,0.5)' : 'rgba(255,255,255,0.6)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 13, 1, 15, 1.8],
        },
      }, before)
    }
    // theme-dependent paints refresh on every (re)load
    if (this.map.getLayer('heat-fill')) this.map.setPaintProperty('heat-fill', 'fill-opacity', this.theme === 'dark' ? 0.55 : 0.5)
    if (this.map.getLayer('heat-line')) this.map.setPaintProperty('heat-line', 'line-color', this.theme === 'dark' ? 'rgba(6,9,16,0.5)' : 'rgba(255,255,255,0.6)')
    // restyle while a metric is active → re-apply its paint + visibility
    if (this._heatPaint) this.setHeatMode(true, this._heatPaint)
  }

  /** on/off + the active metric's fill-color expression (from heat.js). */
  setHeatMode(on, paint) {
    this._heatPaint = on ? paint : null
    for (const id of ['heat-fill', 'heat-line']) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    if (on && paint && this.map.getLayer('heat-fill')) {
      this.map.setPaintProperty('heat-fill', 'fill-color', paint)
    }
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
    // Feathered light straddling the boundary — a heavily blurred wide line
    // reads as outer glow AND inner vignette at once (winding-independent,
    // unlike line-offset tricks). Replaces the old hard white slab look.
    addLyr({
      id: 'kiez-glow',
      type: 'line',
      source: 'kiez',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': sel.glow, 'line-width': 0, 'line-opacity': 0, 'line-blur': 14 },
    })
    addLyr({
      id: 'kiez-casing',
      type: 'line',
      source: 'kiez',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': sel.casing, 'line-width': 0, 'line-opacity': 0, 'line-blur': 1.4 },
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
    if (this.map.getLayer('kiez-glow')) this.map.setPaintProperty('kiez-glow', 'line-color', sel.glow)
    if (this.map.getLayer('kiez-fill')) this.map.setPaintProperty('kiez-fill', 'fill-color', accent)

    this._tuneBasemapLabels()
    this._tuneBasemapDetails()
    if (this._overlayRaw) this._addOverlayLayers()
    if (this._heatRaw) this._addHeatLayers()
    if (this._wallRaw) this._addWallLayers()
  }

  // Streets + parks, gently. The basemap ships them but hides/dims them too
  // hard for a neighbourhood app: dark-matter paints green spaces #0e0e0e
  // (invisible) and minor street names only appear at z16. Surface both a step
  // earlier, in muted theme-matched tones that sit UNDER the Kiez hierarchy.
  _tuneBasemapDetails() {
    const dark = this.theme === 'dark'
    const set = (id, prop, v) => { try { if (this.map.getLayer(id)) this.map.setPaintProperty(id, prop, v) } catch (e) {} }
    const zoom = (id, z) => { try { if (this.map.getLayer(id)) this.map.setLayerZoomRange(id, z, 24) } catch (e) {} }
    // green spaces: a quiet wash that grows slightly as you approach
    const parkFill = dark ? '#6fae7f' : '#aecfa6'
    const parkOp = dark
      ? ['interpolate', ['linear'], ['zoom'], 10, 0.05, 13, 0.09, 15, 0.12]
      : ['interpolate', ['linear'], ['zoom'], 10, 0.18, 13, 0.28, 15, 0.34]
    for (const id of ['landcover', 'park_national_park', 'park_nature_reserve']) {
      set(id, 'fill-color', parkFill)
      set(id, 'fill-opacity', parkOp)
    }
    // park names: one step earlier + green-tinted, quiet
    zoom('poi_park', 14)
    set('poi_park', 'text-color', dark ? '#93b89c' : '#4f7a55')
    set('poi_park', 'text-halo-color', dark ? 'rgba(6,9,16,0.85)' : 'rgba(255,255,255,0.9)')
    // street names: one zoom step earlier, muted so they never compete with
    // the accent-tinted Kiez labels
    zoom('roadname_minor', 15)
    zoom('roadname_sec', 14)
    zoom('roadname_pri', 13.5)
    const road = dark ? '#8d95ab' : '#8a8f9e'
    for (const id of ['roadname_minor', 'roadname_sec', 'roadname_pri', 'roadname_major']) {
      set(id, 'text-color', road)
      set(id, 'text-halo-color', dark ? 'rgba(6,9,16,0.8)' : 'rgba(255,255,255,0.85)')
    }
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

  /** Theme-Restyle hinter einem eingefrorenen "Veil": der aktuell komponierte
      Frame wird in ein 2D-Canvas kopiert und ÜBER das GL-Canvas gelegt (unter
      den DOM-Markern), das echte Restyle läuft unsichtbar darunter; erst wenn
      die neuen Tiles wirklich gerendert sind ('idle', hart begrenzt) blendet
      das Veil aus. Ohne Veil endete der Theme-Reveal in einem harten Blitz:
      der Faux-invert-Filter lag noch auf dem Canvas, während der NEUE Style
      schon renderte (doppelt invertiert = wieder der alte Look), dann fiel der
      Filter schlagartig — plus Background-Flash, weil setTheme bei
      isStyleLoaded auflöst, bevor Tiles gezeichnet sind. `onVeiled` feuert,
      sobald das Veil das Canvas deckt — exakt dann darf der Aufrufer seinen
      Live-Canvas-Filter entfernen. */
  /** Drop any active veil immediately (e.g. the next toggle starts while the
      previous unveil is still pending — a stale veil would cover the new
      reveal with the OLD look and then get ripped away hard). Removes ALL
      `.map-veil` nodes: a superseded restyle may have left its own behind. */
  dropVeil() {
    this._veil = null
    for (const v of this.map.getCanvas().parentNode.querySelectorAll('.map-veil')) v.remove()
  }

  async setThemeVeiled(theme, onVeiled) {
    await this._ready
    // supersede any restyle still in flight — its late veil-placement/unveil
    // must NOT run (would orphan a veil over this newer restyle)
    const rtok = (this._restyleTok = (this._restyleTok || 0) + 1)
    // map already committed to this theme (e.g. a fast toggle-back netted out)
    // → no restyle will happen, so a veil would lay a WRONG look over an
    // already-correct canvas. Nothing to hide — bail.
    if (theme === this.theme && this._themedOnce) { if (onVeiled) onVeiled(); return }
    this.dropVeil() // rapid re-toggle: never stack veils
    const gl = this.map.getCanvas()
    // copy must happen inside a 'render' tick — the WebGL buffer is cleared
    // after compositing (preserveDrawingBuffer is off); bounded so a stuck
    // render can never hang the toggle. Timeout GENEROUS (3s): after repeated
    // toggles the GPU is busy with tile churn and the render tick arrives
    // late — timing out means NO veil = a visible hard restyle. Waiting is
    // safe: the caller's faux filter stays on until onVeiled fires.
    const veil = await new Promise((res) => {
      const tmr = setTimeout(() => res(null), 3000)
      this.map.once('render', () => {
        clearTimeout(tmr)
        try {
          const c = document.createElement('canvas')
          c.width = gl.width; c.height = gl.height
          c.getContext('2d').drawImage(gl, 0, 0)
          res(c)
        } catch (e) { res(null) } // e.g. tainted canvas → restyle without veil
      })
      this.map.triggerRepaint()
    })
    // a newer restyle superseded us during the async snapshot → abort quietly:
    // don't place a veil (it would orphan over the newer cycle), don't restyle
    if (rtok !== this._restyleTok) { if (veil) veil.remove?.(); if (onVeiled) onVeiled(); return }
    if (veil) {
      veil.className = 'map-veil'
      gl.parentNode.insertBefore(veil, gl.nextSibling) // above canvas, below markers (beacon stays live)
      this._veil = veil
    }
    if (onVeiled) onVeiled()
    await this.setTheme(theme)
    if (!veil || rtok !== this._restyleTok) return // superseded → leave veil for the newer cycle's dropVeil
    // unveil once the new style has actually drawn ('idle'), bounded; a camera
    // move unveils immediately — panning under a frozen image reads as broken
    await new Promise((res) => {
      const fin = () => {
        clearTimeout(tmr)
        this.map.off('idle', fin); this.map.off('movestart', fin)
        res()
      }
      const tmr = setTimeout(fin, 4000)
      this.map.once('idle', fin)
      this.map.once('movestart', fin)
    })
    if (this._veil === veil) this._veil = null
    if (reduceMotion()) { veil.remove(); return }
    veil.style.opacity = '0' // .map-veil carries the opacity transition
    setTimeout(() => veil.remove(), 500)
  }

  async setTheme(theme) {
    if (theme === this.theme && this._themedOnce) return
    this.theme = theme
    this._themedOnce = true
    const tok = (this._themeTok = (this._themeTok || 0) + 1) // guard overlapping rapid toggles
    await this._ready
    // setStyle wipes custom layers → re-add them once the NEW style is loaded.
    // Sequencing matters (measured, MapLibre v4): 'style.load' never fires on
    // setStyle; polling isStyleLoaded() immediately can report a stale `true`
    // for the DYING style (then _onLoad paints into it and the swap silently
    // wipes every custom layer). Reliable order: wait for a 'styledata' (the
    // swap has begun, loaded=false) and only then accept isStyleLoaded()=true
    // (checked on 'styledata'/'idle'). Hard timeout so the toggle never hangs.
    this.map.setStyle(STYLES[theme])
    await new Promise((res) => {
      let swapped = false
      const fin = () => {
        clearTimeout(tmr)
        this.map.off('styledata', onData); this.map.off('idle', check)
        res()
      }
      const tmr = setTimeout(fin, 4000)
      const check = () => { if (swapped && this.map.isStyleLoaded()) fin() }
      const onData = () => { swapped = true; check() }
      this.map.on('styledata', onData)
      this.map.on('idle', check)
    })
    if (tok !== this._themeTok) return // a newer setTheme superseded this one
    this._onLoad() // re-adds selection layers, basemap tuning + overlays + wall
    if (this._activeFeature) this._paint(this._activeFeature, true)
    if (this._lastPos) this._placeBeacon(this._lastPos)
    // belt & braces: if the timing still landed wrong, the custom layers are
    // gone once the map settles — detect and rebuild (idempotent)
    this.map.once('idle', () => {
      if (tok !== this._themeTok || this.map.getSource('kiez')) return
      this._onLoad()
      if (this._activeFeature) this._paint(this._activeFeature, true)
    })
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
    this._lblKeepLvl = undefined // candidate ids changed → drop the hysteresis cache
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
            'symbol-sort-key': 10000, // ambient names always yield to the active hierarchy
            // shift instead of vanish when colliding
            'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
            'text-radial-offset': 0.3,
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

    // Overlay area labels. Shared cartographic rules:
    //  · collision priority = area rank (['get','sort'] — big areas beat slivers)
    //  · size hierarchy = per-feature factor (['get','szf'] — big areas read bigger)
    //  · variable anchors — a crowded label slides aside before it disappears
    const szf = (base) => ['*', base, ['coalesce', ['get', 'szf'], 1]]
    if (this.map.getSource('pt-bzr') && !this.map.getLayer('lbl-bzr')) {
      this.map.addLayer({
        id: 'lbl-bzr', type: 'symbol', source: 'pt-bzr', minzoom: 10.5,
        layout: {
          'text-field': ['get', 'name'], 'text-font': FONT_REG,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, szf(9.5), 13, szf(11.5), 15, szf(13.5), 17, szf(15.5)],
          'text-max-width': 7, 'text-padding': 4, 'text-letter-spacing': 0.01,
          'symbol-sort-key': ['coalesce', ['get', 'sort'], 0],
          'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.3,
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
          // capped at ~21px and eased back at deep zoom — the Bezirk name must
          // not shout over the fine-grained context you zoomed in for
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 10, 14.5, 12, 18, 14, 20, 16, 21],
          'text-transform': 'uppercase', 'text-letter-spacing': 0.09,
          'text-max-width': 8, 'text-padding': 8,
          'symbol-sort-key': ['coalesce', ['get', 'sort'], 0],
          'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.3,
        },
        paint: {
          'text-color': dark ? '#eef2ff' : '#10131c',
          'text-halo-color': dark ? haloDark : haloLight,
          'text-halo-width': 1.7, 'text-halo-blur': 0.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.92, 11, 1, 14, 1, 15.5, 0.75],
        },
      })
    }
    // merged colloquial Kiez labels for the Kieze overlay (accent-tinted)
    if (this.map.getSource('pt-kiez') && !this.map.getLayer('lbl-kiezarea')) {
      this.map.addLayer({
        id: 'lbl-kiezarea', type: 'symbol', source: 'pt-kiez',
        layout: {
          'text-field': ['get', 'name'], 'text-font': FONT_REG,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, szf(10.5), 13, szf(12.5), 15, szf(14.5), 17, szf(16)],
          'text-max-width': 8, 'text-padding': 4, 'text-letter-spacing': 0.01,
          'symbol-sort-key': ['coalesce', ['get', 'sort'], 0],
          'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.3,
        },
        paint: {
          'text-color': ACCENT[this.theme],
          'text-halo-color': dark ? haloDark : haloLight,
          'text-halo-width': 1.5, 'text-halo-blur': 0.3,
        },
      })
    }
    // the SELECTED area's own label — top collision priority, never lost in the
    // crowd (the highlight is the map's most important object; on mobile the
    // card is often peeked, so the map itself must name it)
    if (!this.map.getSource('sel-pt')) this.map.addSource('sel-pt', { type: 'geojson', data: emptyFC() })
    if (!this.map.getLayer('lbl-sel')) {
      this.map.addLayer({
        id: 'lbl-sel', type: 'symbol', source: 'sel-pt',
        layout: {
          'text-field': ['get', 'name'], 'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 12, 12, 15, 15, 18],
          'text-max-width': 8, 'text-padding': 6, 'text-letter-spacing': 0.06,
          'symbol-sort-key': -1,
          'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.4,
        },
        paint: {
          'text-color': ACCENT[this.theme],
          'text-halo-color': dark ? haloDark : haloLight,
          'text-halo-width': 2.4, 'text-halo-blur': 0.8,
        },
      })
    }
    if (this.map.getLayer('lbl-sel')) this.map.setPaintProperty('lbl-sel', 'text-color', ACCENT[this.theme])
    this._applyMode()
  }

  setOverlayMode(mode) {
    this._mode = mode
    this._applyMode()
  }

  // ── Berliner Mauer 1989 (retro B&W mode) ────────────────────────────────────
  // wall = FC of grenzmauer/hinterland lines + grenzstreifen polygons ({typ}),
  // west = the stitched West-Berlin polygon feature (side tint + side readout).
  async setWallData({ wall, west, ost } = {}) {
    await this._ready
    this._wallRaw = { wall, west, ost }
    this._addWallLayers()
  }

  // All colours are grayscale by design: the whole map runs through the retro
  // B&W CSS filter in wall mode, so the wall must pop via lightness contrast
  // (white casing + near-black core), not hue.
  _addWallLayers() {
    if (!this._wallRaw) return
    const { wall, west, ost } = this._wallRaw
    const vis = this._wallOn ? 'visible' : 'none'
    const addSrc = (id, data) => {
      const s = this.map.getSource(id)
      if (s) s.setData(data)
      else this.map.addSource(id, { type: 'geojson', data })
    }
    addSrc('wall', wall)
    if (west) addSrc('wall-west', { type: 'FeatureCollection', features: [west] })
    if (ost) addSrc('wall-ost', { type: 'FeatureCollection', features: [ost] })
    // sector name labels — two fixed interior points, styled like an archival map
    addSrc('wall-lbl', { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'WEST-BERLIN' },
        geometry: { type: 'Point', coordinates: [13.22, 52.5] } },
      { type: 'Feature', properties: { name: 'OST-BERLIN' },
        geometry: { type: 'Point', coordinates: [13.55, 52.53] } },
    ] })
    const before = this.map.getLayer('kiez-fill') ? 'kiez-fill' : undefined
    const addLyr = (def, top) => { if (!this.map.getLayer(def.id)) this.map.addLayer(def, top ? undefined : before) }
    // Both halves must read as clearly highlighted against Brandenburg, yet
    // stay distinguishable from EACH OTHER with lightness/texture only (the
    // whole map is grayscaled): West = solid bright lift, Ost = comparable
    // lift + a diagonal HATCH — the classic archival "other sector" signature.
    const paints = this.theme === 'dark'
      ? { west: { color: '#ffffff', op: 0.12 }, ost: { color: '#ffffff', op: 0.08 }, hatchInk: 'rgba(236,231,216,0.78)', hatchOp: 0.6 }
      : { west: { color: '#8a7c5e', op: 0.09 }, ost: { color: '#8a7c5e', op: 0.06 }, hatchInk: 'rgba(58,52,36,0.62)', hatchOp: 0.6 }
    // seamless 45° hatch tile, ink colour follows the theme; setStyle wipes
    // style images → re-created on every (re)load
    const N = 20
    const pc = document.createElement('canvas')
    pc.width = pc.height = N
    const px = pc.getContext('2d')
    px.strokeStyle = paints.hatchInk
    // Fine engraving-like strokes — the old 2.4px ink read as coarse zebra
    // stripes; thinner lines at slightly lower opacity read as archival
    // texture while the sector stays clearly marked.
    px.lineWidth = 1.5
    px.beginPath()
    px.moveTo(0, N); px.lineTo(N, 0)       // main diagonal
    px.moveTo(-4, 4); px.lineTo(4, -4)     // corner wrap (top-left)
    px.moveTo(N - 4, N + 4); px.lineTo(N + 4, N - 4) // corner wrap (bottom-right)
    px.stroke()
    if (this.map.hasImage('wall-hatch')) this.map.removeImage('wall-hatch')
    this.map.addImage('wall-hatch', px.getImageData(0, 0, N, N), { pixelRatio: 2 })
    if (west) addLyr({
      id: 'wall-west-fill', type: 'fill', source: 'wall-west',
      layout: { visibility: vis },
      paint: { 'fill-color': paints.west.color, 'fill-opacity': paints.west.op },
    })
    if (ost) {
      addLyr({
        id: 'wall-ost-fill', type: 'fill', source: 'wall-ost',
        layout: { visibility: vis },
        paint: { 'fill-color': paints.ost.color, 'fill-opacity': paints.ost.op },
      })
      addLyr({
        id: 'wall-ost-hatch', type: 'fill', source: 'wall-ost',
        layout: { visibility: vis },
        paint: { 'fill-pattern': 'wall-hatch', 'fill-opacity': paints.hatchOp },
      })
    }
    // theme-dependent → refresh on every (re)load, like the selection colours
    for (const [id, p] of [['wall-west-fill', paints.west], ['wall-ost-fill', paints.ost]]) {
      if (this.map.getLayer(id)) {
        this.map.setPaintProperty(id, 'fill-color', p.color)
        this.map.setPaintProperty(id, 'fill-opacity', p.op)
      }
    }
    if (this.map.getLayer('wall-ost-hatch')) this.map.setPaintProperty('wall-ost-hatch', 'fill-opacity', paints.hatchOp)
    // Grenzstreifen (death strip) — the pale cleared band along the wall
    addLyr({
      id: 'wall-strip', type: 'fill', source: 'wall',
      filter: ['==', ['get', 'typ'], 'streifen'],
      layout: { visibility: vis },
      paint: { 'fill-color': '#f2efe4', 'fill-opacity': 0.55 },
    })
    // Hinterlandsicherungsmauer/-zaun — thin dashed inner line
    addLyr({
      id: 'wall-hinterland', type: 'line', source: 'wall',
      filter: ['==', ['get', 'typ'], 'hinterland'],
      layout: { visibility: vis, 'line-join': 'round' },
      paint: {
        'line-color': '#141414',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 1.8],
        'line-dasharray': [2, 2],
        'line-opacity': 0.75,
      },
    })
    // A soft light along the wall course — heavy blur under the casing gives
    // the border a gentle presence-glow instead of a hard cut-out edge.
    addLyr({
      id: 'wall-glow', type: 'line', source: 'wall',
      filter: ['==', ['get', 'typ'], 'mauer'],
      layout: { visibility: vis, 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': this.theme === 'dark' ? '#f5f1e2' : '#5a503a',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 9, 12, 18, 15, 30],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 8, 9, 12, 18, 15, 30],
        'line-opacity': this.theme === 'dark' ? 0.3 : 0.18,
      },
    })
    // the Grenzmauer itself: wide white casing + near-black core
    addLyr({
      id: 'wall-casing', type: 'line', source: 'wall',
      filter: ['==', ['get', 'typ'], 'mauer'],
      layout: { visibility: vis, 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 12, 7, 15, 12],
        'line-opacity': 0.9,
      },
    })
    addLyr({
      id: 'wall-line', type: 'line', source: 'wall',
      filter: ['==', ['get', 'typ'], 'mauer'],
      layout: { visibility: vis, 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#0d0d0d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 12, 3.2, 15, 5.5],
        'line-opacity': 0.95,
      },
    })
    // WEST-BERLIN / OST-BERLIN wordmarks on top of everything (archival plate style)
    const lblPaint = this.theme === 'dark'
      ? { color: '#f0ede4', halo: 'rgba(6,9,16,0.9)' }
      : { color: '#241f14', halo: 'rgba(255,253,246,0.92)' }
    addLyr({
      id: 'lbl-wall', type: 'symbol', source: 'wall-lbl', maxzoom: 13,
      layout: {
        visibility: vis,
        'text-field': ['get', 'name'], 'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 14, 10, 20, 12, 26],
        'text-letter-spacing': 0.28, 'text-padding': 10,
        'symbol-sort-key': 0, 'text-allow-overlap': false,
      },
      paint: {
        'text-color': lblPaint.color,
        'text-halo-color': lblPaint.halo,
        'text-halo-width': 1.8, 'text-halo-blur': 0.4,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.95, 13, 0],
      },
    }, true)
    if (this.map.getLayer('lbl-wall')) {
      this.map.setPaintProperty('lbl-wall', 'text-color', lblPaint.color)
      this.map.setPaintProperty('lbl-wall', 'text-halo-color', lblPaint.halo)
    }
    // a restyle carries fresh original paints → drop the stale stash and
    // re-apply the spot colours if the mode is active
    this._spotOrig = {}
    if (this._wallOn) this._applyWallSpotColors(true)
  }

  setWallMode(on) {
    this._wallOn = !!on
    for (const id of ['wall-west-fill', 'wall-ost-fill', 'wall-ost-hatch', 'wall-strip', 'wall-hinterland', 'wall-glow', 'wall-casing', 'wall-line', 'lbl-wall']) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    this._applyWallSpotColors(on)
  }

  // Archival spot colours for wall mode: water in ink blue, parks in green —
  // painted OVERSATURATED because the retro CSS filter still removes ~65% of
  // the chroma; what survives is the muted, aged tint of an old printed map.
  // Originals are stashed and restored on exit; after a restyle the stash is
  // reset (the fresh style carries originals again).
  _applyWallSpotColors(on) {
    const dark = this.theme === 'dark'
    if (!this._spotOrig) this._spotOrig = {}
    const spot = (id, prop, v) => {
      if (!this.map.getLayer(id)) return
      const key = id + '|' + prop
      try {
        if (on) {
          if (!(key in this._spotOrig)) this._spotOrig[key] = this.map.getPaintProperty(id, prop)
          this.map.setPaintProperty(id, prop, v)
        } else if (key in this._spotOrig) {
          this.map.setPaintProperty(id, prop, this._spotOrig[key])
          delete this._spotOrig[key]
        }
      } catch (e) {}
    }
    // water: rivers/lakes (fills) + canals (waterway lines) in deep ink blue —
    // saturated hard so it clearly survives the (halved) desaturation
    spot('water', 'fill-color', dark ? '#2563b8' : '#5b8ecf')
    spot('water_shadow', 'fill-color', dark ? '#1c4a8f' : '#4d80c4')
    spot('waterway', 'line-color', dark ? '#2e6cc4' : '#4d80c4')
    for (const id of ['watername_lake', 'watername_lake_line', 'waterway_label', 'watername_sea', 'watername_ocean']) {
      spot(id, 'text-color', dark ? '#7ea8e6' : '#2f5695')
    }
    // parks: firm, clearly-green wash
    const green = dark ? '#3aa75c' : '#43a352'
    const greenOp = dark
      ? ['interpolate', ['linear'], ['zoom'], 10, 0.2, 13, 0.28, 15, 0.36]
      : ['interpolate', ['linear'], ['zoom'], 10, 0.36, 13, 0.46, 15, 0.55]
    for (const id of ['landcover', 'park_national_park', 'park_nature_reserve']) {
      spot(id, 'fill-color', green)
      spot(id, 'fill-opacity', greenOp)
    }
    spot('poi_park', 'text-color', dark ? '#63a877' : '#3c7a48')
    // our own accent layers would leak blue through the weakened filter → ink
    spot('lbl-kiez', 'text-color', dark ? '#c9c2ac' : '#4a4536')
    spot('lbl-sel', 'text-color', dark ? '#efe9d5' : '#241f14')
    spot('kiez-fill', 'fill-color', dark ? '#cfc7ae' : '#57503b')
  }

  /** Current camera centre as [lon, lat] — feeds the Ost/West side readout. */
  centerLngLat() {
    const c = this.map.getCenter()
    return [c.lng, c.lat]
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
    const inView = (p) => p[0] >= W && p[0] <= E && p[1] >= S && p[1] <= No
    // anti-jitter hysteresis: keep a feature's previously chosen point while it
    // is still on screen — labels must not hop around during a pan
    if (this._lblKeepLvl !== lvl) { this._lblKeepLvl = lvl; this._lblKeep = new Map() }
    const keep = this._lblKeep
    const selName = this._selName || null
    const feats = []
    for (const c of cands) {
      if (c.bb[2] < W || c.bb[0] > E || c.bb[3] < S || c.bb[1] > No) { keep.delete(c.id); continue } // off-screen
      if (selName && c.name === selName) { keep.delete(c.id); continue } // the selection carries its own label
      let best = keep.get(c.id)
      if (!best || !inView(best)) {
        best = null
        let bd = Infinity
        for (const p of c.pts) {
          if (!inView(p)) continue
          const dx = p[0] - c.c[0], dy = p[1] - c.c[1], d = dx * dx + dy * dy
          if (d < bd) { bd = d; best = p }
        }
        if (best) keep.set(c.id, best)
        else keep.delete(c.id)
      }
      if (best) feats.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: best },
        properties: { name: c.name, sort: c.sort, szf: c.szf },
      })
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

  /** Map-click pick: move the beacon to the point and (optionally) frame its Kiez.
   *  `fit:false` (auto-zoom toggle off) marks the area but leaves the camera put —
   *  the tapped point is already on screen, so no move is needed. */
  async goTo(lon, lat, feature, { fit = true } = {}) {
    await this._ready
    this._lastPos = [lon, lat]
    this._placeBeacon([lon, lat])
    if (feature) {
      this._paint(feature)
      if (fit) this.fitTo(feature)
    } else {
      this.clearHighlight()
      if (fit) this.map.easeTo({
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
      // keep surrounding context: small Kieze must not slam the camera in
      maxZoom: 13.7,
    })
  }

  /** Street pick from search: beacon on the street, paint its Kiez, frame the
   *  street's own bbox (closer than an area fit — a street must be readable). */
  async frameStreet(lon, lat, feature, bbox) {
    await this._ready
    this._lastPos = [lon, lat]
    this._placeBeacon([lon, lat])
    if (feature) this._paint(feature)
    else this.clearHighlight()
    if (bbox) this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: this._fitPadding(),
      duration: reduceMotion() ? 0 : 900,
      essential: true,
      maxZoom: 15.5, // short streets: close enough to read the name, still with context
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
    // the selection names itself on the map (top collision priority) — and the
    // overlay label of the same area is suppressed so it isn't written twice
    const p = feature.properties || {}
    const name = p.kiez || p.name || p.plr_name || p.bzr_name || p.pgr_name || (p.bez ? bezirkName(p.bez) : '')
    this._selName = name || null
    const selSrc = this.map.getSource('sel-pt')
    if (selSrc) selSrc.setData(name
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: interiorPoint(feature) }, properties: { name } }] }
      : emptyFC())
    // the ambient OSM name point of the same Kiez would double the selection label
    if (this.map.getLayer('lbl-kiez')) this.map.setFilter('lbl-kiez', name ? ['!=', ['get', 'name'], name] : null)
    this._updateOverlayLabels()
    const targetFill = this.theme === 'dark' ? 0.13 : 0.1
    // Slimmer, layered boundary: soft feathered glow (GW, heavy blur) under a
    // thin dark seat (CW) under a crisp hairline (LW) — depth instead of the
    // old 8.5px white slab.
    const LW = 2.2, CW = 4.6, GW = 17
    const glowOp = SELECTION[this.theme].glowOp
    const set = (p) => {
      // a theme restyle (setStyle) can wipe the layers mid-spring — skip those frames
      if (!this.map.getLayer('kiez-fill')) return
      this.map.setPaintProperty('kiez-fill', 'fill-opacity', targetFill * p)
      this.map.setPaintProperty('kiez-glow', 'line-opacity', glowOp * p)
      this.map.setPaintProperty('kiez-glow', 'line-width', GW * p)
      this.map.setPaintProperty('kiez-line', 'line-opacity', Math.min(1, p))
      this.map.setPaintProperty('kiez-line', 'line-width', LW * p)
      this.map.setPaintProperty('kiez-casing', 'line-opacity', Math.min(1, p) * 0.75)
      this.map.setPaintProperty('kiez-casing', 'line-width', CW * p)
    }
    if (instant || reduceMotion()) { set(1); return }
    // animate fill + outline with the slow spatial spring (a confident reveal)
    this._cancelFill = spring(0, 1, SPRINGS.spatialSlow, set)
  }

  clearHighlight() {
    this._activeFeature = null
    this._cancelPendingPaint()
    this._selName = null
    const selSrc = this.map.getSource('sel-pt')
    if (selSrc) selSrc.setData(emptyFC())
    if (this.map.getLayer('lbl-kiez')) this.map.setFilter('lbl-kiez', null)
    this._updateOverlayLabels() // un-suppress the area's regular overlay label
    const src = this.map.getSource('kiez')
    if (!src) return
    src.setData(emptyFC())
    if (!this.map.getLayer('kiez-fill')) return
    this.map.setPaintProperty('kiez-fill', 'fill-opacity', 0)
    this.map.setPaintProperty('kiez-glow', 'line-opacity', 0)
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
