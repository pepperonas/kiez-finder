// ─────────────────────────────────────────────────────────────────────────
// Kiez lookup — official Berlin LOR 2021 Planungsräume (542 Kieze).
// Each feature carries the whole hierarchy: plr_name (Kiez), bzr_name
// (Bezirksregion), pgr_name (Prognoseraum), bez (Bezirk).
//
// One point, many polygons → a hand-rolled ray-cast (zero deps), bbox-prefiltered.
// ─────────────────────────────────────────────────────────────────────────

let _kieze = null // FeatureCollection
let _bbox = null  // per-feature [minX,minY,maxX,maxY]
let _outline = null

async function loadJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json()
}

export async function loadKieze() {
  if (_kieze) return _kieze
  _kieze = await loadJSON('/data/kieze.geojson')
  _bbox = _kieze.features.map(featureBBox)
  return _kieze
}

export async function loadOutline() {
  if (_outline) return _outline
  _outline = await loadJSON('/data/berlin-outline.geojson')
  return _outline
}

function eachRing(geom, fn) {
  if (geom.type === 'Polygon') geom.coordinates.forEach((r, i) => fn(r, i === 0))
  else if (geom.type === 'MultiPolygon')
    geom.coordinates.forEach((poly) => poly.forEach((r, i) => fn(r, i === 0)))
}

function featureBBox(f) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  eachRing(f.geometry, (ring) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  })
  return [minX, minY, maxX, maxY]
}

// ray-casting on one ring; pt = [lon, lat]
function inRing(pt, ring) {
  let inside = false
  const [px, py] = pt
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

// inside an outer ring and not inside any hole
function inGeometry(pt, geom) {
  if (geom.type === 'Polygon') return inPolygonRings(pt, geom.coordinates)
  if (geom.type === 'MultiPolygon')
    return geom.coordinates.some((poly) => inPolygonRings(pt, poly))
  return false
}

function inPolygonRings(pt, rings) {
  if (!inRing(pt, rings[0])) return false
  for (let i = 1; i < rings.length; i++) if (inRing(pt, rings[i])) return false
  return true
}

/** Find the Kiez feature containing [lon, lat], or null if outside Berlin. */
export function findKiez(lon, lat) {
  if (!_kieze) return null
  const features = _kieze.features
  for (let i = 0; i < features.length; i++) {
    const b = _bbox[i]
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue
    if (inGeometry([lon, lat], features[i].geometry)) return features[i]
  }
  return null
}

/** Centre of a Berlin-wide overview (Alexanderplatz-ish). */
export const BERLIN_CENTER = [13.404, 52.52]

/** Squared-ish great-circle-lite distance in km from a point to Berlin centre. */
export function kmFromBerlin(lon, lat) {
  const [clon, clat] = BERLIN_CENTER
  const dy = (lat - clat) * 111.32
  const dx = (lon - clon) * 111.32 * Math.cos((clat * Math.PI) / 180)
  return Math.sqrt(dx * dx + dy * dy)
}

/** "01 - Mitte" → "Mitte" */
export function bezirkName(bez) {
  return (bez || '').replace(/^\d+\s*-\s*/, '').trim()
}
