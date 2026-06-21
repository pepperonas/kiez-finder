// ─────────────────────────────────────────────────────────────────────────
// Map — MapLibre GL with keyless Carto vector tiles (dark-matter / positron).
// Owns the signature transition: fly to the user, then the Kiez boundary
// *draws itself* in.
// ─────────────────────────────────────────────────────────────────────────
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { spring, SPRINGS, reduceMotion } from './motion.js'
import { BERLIN_CENTER, bboxOf } from './kiez.js'

const STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
}

// brand accent per theme (the Kiez fill / outline colour)
const ACCENT = { dark: '#7da2ff', light: '#3b5bdb' }

export class KiezMap {
  constructor(container, theme, outline) {
    this.theme = theme
    this._outline = outline
    this._beacon = null
    this._cancelFill = null
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

  _onLoad() {
    const accent = ACCENT[this.theme]
    // Berlin outline — the "stage" in the locating state
    if (this._outline) {
      this.map.addSource('berlin', { type: 'geojson', data: this._outline })
      this.map.addLayer({
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
    // Active Kiez — starts empty, filled in on lock
    this.map.addSource('kiez', { type: 'geojson', data: emptyFC() })
    this.map.addLayer({
      id: 'kiez-fill',
      type: 'fill',
      source: 'kiez',
      paint: { 'fill-color': accent, 'fill-opacity': 0 },
    })
    this.map.addLayer({
      id: 'kiez-line',
      type: 'line',
      source: 'kiez',
      paint: {
        'line-color': accent,
        'line-width': 2.4,
        'line-opacity': 0,
        'line-blur': 0.3,
      },
    })
  }

  async setTheme(theme) {
    this.theme = theme
    await this._ready
    // setStyle wipes custom layers → re-add them once the new style loads
    this.map.setStyle(STYLES[theme])
    await new Promise((res) => this.map.once('styledata', res))
    this._onLoad()
    if (this._activeFeature) this._paint(this._activeFeature, true)
    if (this._lastPos) this._placeBeacon(this._lastPos)
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
      const delay = reduceMotion() ? 0 : 1500
      setTimeout(() => this._paint(feature), delay)
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

  _paint(feature, instant = false) {
    this.map.getSource('kiez').setData(fc(feature))
    if (this._cancelFill) this._cancelFill()
    const targetFill = this.theme === 'dark' ? 0.16 : 0.12
    if (instant || reduceMotion()) {
      this.map.setPaintProperty('kiez-fill', 'fill-opacity', targetFill)
      this.map.setPaintProperty('kiez-line', 'line-opacity', 0.9)
      this.map.setPaintProperty('kiez-line', 'line-width', 2.4)
      return
    }
    // animate fill + outline with the slow spatial spring (a confident reveal)
    this._cancelFill = spring(0, 1, SPRINGS.spatialSlow, (p) => {
      this.map.setPaintProperty('kiez-fill', 'fill-opacity', targetFill * p)
      this.map.setPaintProperty('kiez-line', 'line-opacity', Math.min(1, p) * 0.9)
      this.map.setPaintProperty('kiez-line', 'line-width', 1 + 1.8 * p)
    })
  }

  clearHighlight() {
    this._activeFeature = null
    this.map.getSource('kiez').setData(emptyFC())
    this.map.setPaintProperty('kiez-fill', 'fill-opacity', 0)
    this.map.setPaintProperty('kiez-line', 'line-opacity', 0)
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
