// ─────────────────────────────────────────────────────────────────────────
// City config — the app is city-parameterized. Berlin is the default (and the
// full-featured original); Frankfurt reuses the exact same engine against its
// own data. A city is resolved once at boot (URL ?city= > localStorage > sub-
// domain > Berlin) and points kiez.js at that city's data folder + centre.
//
// Colloquial unit ("Kiez") ≙ Berlin Planungsraum-group / Frankfurt Stadtteil.
// "Bezirk" ≙ Berlin Bezirk (12) / Frankfurt Ortsbezirk (16).
// Frankfurt's 3-tier admin (Stadtbezirk→Stadtteil→Ortsbezirk) uses two app
// levels; Berlin's finer LOR tiers (Bezirksregion/Prognoseraum) simply don't
// exist there and are omitted from `levels`.
// ─────────────────────────────────────────────────────────────────────────
import { setCityData } from './kiez.js'

export const CITIES = {
  berlin: {
    id: 'berlin',
    name: 'Berlin',
    term: 'Kiez', // colloquial unit the user "steht in"
    article: 'im',
    center: [13.404, 52.52],
    bbox: [13.088, 52.338, 13.761, 52.675], // WGS84 [minLon,minLat,maxLon,maxLat]
    fallback: [13.4353, 52.4814], // Rathaus Neukölln → Donaukiez (bei fehlendem Standort)
    fallbackArea: 'Neukölln',
    fallbackHint: 'den Donaukiez',
    dataDir: '/data',
    outlineFile: 'berlin-outline.geojson',
    // level rows shown under the title (finest→coarsest, minus the Kiez itself)
    levels: [
      { key: 'bzr', label: 'Bezirksregion' },
      { key: 'pgr', label: 'Prognoseraum' },
      { key: 'bez', label: 'Bezirk' },
    ],
    features: { wall: true },
  },
  frankfurt: {
    id: 'frankfurt',
    name: 'Frankfurt',
    term: 'Stadtteil',
    article: 'im',
    center: [8.682, 50.111],
    bbox: [8.472, 50.016, 8.800, 50.227],
    fallback: [8.682, 50.111], // Römer → Altstadt
    fallbackArea: 'der Altstadt',
    fallbackHint: 'die Altstadt',
    dataDir: '/data/frankfurt',
    outlineFile: 'outline.geojson',
    levels: [{ key: 'bez', label: 'Ortsbezirk' }],
    features: { wall: false },
  },
}

let _active = CITIES.berlin
export function activeCity() { return _active }

/** Which configured city's bbox contains the point (null = none). */
export function cityIdForPoint(lon, lat) {
  for (const c of Object.values(CITIES)) {
    const [x1, y1, x2, y2] = c.bbox
    if (lon >= x1 && lon <= x2 && lat >= y1 && lat <= y2) return c.id
  }
  return null
}

/** Resolve + activate the city at boot: URL ?city= > localStorage > subdomain
 *  > Berlin. Points kiez.js at the city's data (setCityData). Idempotent. */
export function resolveCity() {
  let id = 'berlin'
  try {
    const q = new URL(location.href).searchParams.get('city')
    if (q && CITIES[q]) id = q
    else {
      const stored = localStorage.getItem('kf-city')
      if (stored && CITIES[stored]) id = stored
      else if (/(^|\.)frankfurt/i.test(location.hostname)) id = 'frankfurt'
    }
  } catch (e) { /* SSR/no-DOM safety */ }
  _active = CITIES[id] || CITIES.berlin
  setCityData(_active)
  return _active
}

/** Persist + switch the active city — reloads so every loader repoints cleanly. */
export function switchCity(id) {
  if (!CITIES[id] || id === _active.id) return
  try { localStorage.setItem('kf-city', id) } catch (e) {}
  try {
    const url = new URL(location.href)
    url.searchParams.delete('city') // localStorage is now the source of truth
    location.assign(url.pathname + url.search + url.hash)
  } catch (e) { location.reload() }
}
