// ─────────────────────────────────────────────────────────────────────────
// Map — MapLibre GL with keyless Carto vector tiles (dark-matter / positron).
// Owns the signature transition: fly to the user, then the Kiez boundary
// *draws itself* in.
// ─────────────────────────────────────────────────────────────────────────
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { spring, SPRINGS, reduceMotion } from './motion.js'
import { BERLIN_CENTER } from './kiez.js'

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
    this._ready = new Promise((res) => this.map.on('load', res)).then(() => this._onLoad())
  }

  whenReady() {
    return this._ready
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
    if (this._activeFeature) this._paintKiez(this._activeFeature, true)
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
      setTimeout(() => this._paintKiez(feature), delay)
    } else {
      this._clearKiez()
    }
  }

  _paintKiez(feature, instant = false) {
    this.map.getSource('kiez').setData(fc(feature))
    if (this._cancelFill) this._cancelFill()
    const targetFill = this.theme === 'dark' ? 0.16 : 0.12
    if (instant || reduceMotion()) {
      this.map.setPaintProperty('kiez-fill', 'fill-opacity', targetFill)
      this.map.setPaintProperty('kiez-line', 'line-opacity', 0.9)
      return
    }
    // animate fill + outline with the slow spatial spring (a confident reveal)
    this._cancelFill = spring(0, 1, SPRINGS.spatialSlow, (p) => {
      this.map.setPaintProperty('kiez-fill', 'fill-opacity', targetFill * p)
      this.map.setPaintProperty('kiez-line', 'line-opacity', Math.min(1, p) * 0.9)
      this.map.setPaintProperty('kiez-line', 'line-width', 1 + 1.8 * p)
    })
  }

  _clearKiez() {
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
