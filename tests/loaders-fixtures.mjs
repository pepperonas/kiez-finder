// Shared synthetic fixtures + fetch mock for the src/kiez.js loader tests
// (tests/loaders.test.js = happy paths, tests/loaders-fallback.test.js =
// failure/fallback paths in a fresh process). Not a test file itself.

export const square = (minX, minY, maxX, maxY) => ({
  type: 'Polygon',
  coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]],
})
export const fc = (features) => ({ type: 'FeatureCollection', features })
export const feat = (properties, geometry) => ({ type: 'Feature', properties, geometry })

// two Planungsräume sharing colloquial Kiez gid 1, one triangle without gid
export const PLR_A = feat(
  { plr_id: '08010101', plr_name: 'Testfeld West', kiez: 'Testkiez', gid: 1,
    bzr_name: 'Test-Region', pgr_name: 'Test-Raum', bez: '08 - Neukölln' },
  square(13.0, 52.0, 13.2, 52.2)
)
export const PLR_B = feat(
  { plr_id: '08010102', plr_name: 'Testfeld Ost', kiez: 'Testkiez', gid: 1,
    bzr_name: 'Test-Region', pgr_name: 'Test-Raum', bez: '08 - Neukölln' },
  square(13.2, 52.0, 13.4, 52.2)
)
// triangle: its bbox corner (13.79, 52.79) is inside the bbox but OUTSIDE the
// geometry → covers the bbox-hit/geometry-miss branch of findKiez
export const PLR_TRI = feat(
  { plr_id: '01011101', plr_name: 'Dreieck', bez: '01 - Mitte',
    bzr_name: 'Mitte-Region', pgr_name: 'Mitte-Raum' },
  { type: 'Polygon', coordinates: [[[13.6, 52.6], [13.8, 52.6], [13.6, 52.8], [13.6, 52.6]]] }
)
export const KIEZE = fc([PLR_A, PLR_B, PLR_TRI])
// merged colloquial-Kiez area for gid 1 (union of A+B)
export const AREAS = fc([feat({ gid: 1, kiez: 'Testkiez' }, square(13.0, 52.0, 13.4, 52.2))])
// OSM Kieze: a big quarter with a smaller one nested inside (smallest bbox wins)
export const OSM = fc([
  feat({ name: 'Viertel Groß' }, square(13.0, 52.0, 13.2, 52.2)),
  feat({ name: 'Viertel Klein' }, square(13.05, 52.05, 13.1, 52.1)),
])
export const LEVELS_FIX = {
  '/data/bezirke.geojson': fc([feat({ id: '08', bez: '08 - Neukölln' }, square(13.0, 52.0, 13.4, 52.2))]),
  '/data/prognoseraeume.geojson': fc([feat({ id: '0801', pgr_name: 'Test-Raum' }, square(13.0, 52.0, 13.4, 52.2))]),
  '/data/bezirksregionen.geojson': fc([feat({ id: '080101', bzr_name: 'Test-Region' }, square(13.0, 52.0, 13.4, 52.2))]),
  '/data/bezirke-pts.geojson': fc([]),
  '/data/bezirksregionen-pts.geojson': fc([]),
}
export const STREETS = {
  bez: ['Neukölln'],
  streets: [
    ['Teststraße', 0, 13.1, 52.1, 13.0, 52.0, 13.2, 52.2],
    ['Grenzweg', 7, 13.3, 52.1, 13.2, 52.0, 13.4, 52.2], // bezIdx out of range → ''
  ],
}
export const WALL = fc([feat({ typ: 'mauer' }, square(13.0, 52.0, 13.1, 52.1))])
export const WEST = fc([feat({ side: 'west' }, square(13.0, 52.0, 13.2, 52.2))])
export const OST = fc([feat({ side: 'ost' }, square(13.2, 52.0, 13.4, 52.2))])

/** Install a fetch mock with a mutable route table.
 *  Returns { serve, failUrl, drop, countFor, restore }. */
export function mockFetch() {
  const routes = new Map()
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    calls.push(url)
    const r = routes.get(url)
    if (!r) return { ok: false, status: 404, json: async () => { throw new Error('404') } }
    if (r.fail) return { ok: false, status: 500, json: async () => { throw new Error('500') } }
    return { ok: true, status: 200, json: async () => structuredClone(r.data) }
  }
  return {
    serve: (url, data) => routes.set(url, { data }),
    failUrl: (url) => routes.set(url, { fail: true, data: null }),
    drop: (url) => routes.delete(url),
    countFor: (url) => calls.filter((u) => u === url).length,
    restore: () => { globalThis.fetch = realFetch },
  }
}

/** Serve the complete happy-path dataset. */
export function serveAll(m) {
  m.serve('/data/kieze.geojson', KIEZE)
  m.serve('/data/kiez-areas.geojson', AREAS)
  m.serve('/data/osm-kieze.geojson', OSM)
  m.serve('/data/berlin-outline.geojson', fc([feat({}, square(13.0, 52.0, 13.4, 52.2))]))
  m.serve('/data/kiez-names.geojson', fc([feat({ name: 'Testkiez' }, { type: 'Point', coordinates: [13.1, 52.1] })]))
  m.serve('/data/strassen.json', STREETS)
  for (const [url, data] of Object.entries(LEVELS_FIX)) m.serve(url, data)
  m.serve('/data/mauer.geojson', WALL)
  m.serve('/data/west-berlin.geojson', WEST)
  m.serve('/data/ost-berlin.geojson', OST)
}
