// ─────────────────────────────────────────────────────────────────────────
// Kiez lookup — official Berlin LOR 2021 Planungsräume (542 Kieze).
// Each feature carries the whole hierarchy: plr_name (Kiez), bzr_name
// (Bezirksregion), pgr_name (Prognoseraum), bez (Bezirk).
//
// One point, many polygons → a hand-rolled ray-cast (zero deps), bbox-prefiltered.
// ─────────────────────────────────────────────────────────────────────────
import { setDataDir, dpath } from './datapath.js'

let _kieze = null // FeatureCollection
let _bbox = null  // per-feature [minX,minY,maxX,maxY]
let _outline = null
let _levelMaps = null // { bez: Map<id,feature>, pgr: …, bzr: … }
let _levelFC = null   // { bez: FC, pgr: FC, bzr: FC } — raw collections (for map overlays)
let _levelsPromise = null

async function loadJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json()
}

// ── City data config ──────────────────────────────────────────────────────
// Berlin is the DEFAULT, so leaving this unset keeps 100% backward-compatible
// Berlin behaviour (dataDir '/data', the Berlin outline, the Berlin centre).
// setCityData() (called once at boot from src/city.js) repoints every loader +
// the overview centre at another city's data folder.
const EMPTY_FC = { type: 'FeatureCollection', features: [] }
let _outlineFile = 'berlin-outline.geojson'
let _center = [13.404, 52.52]
export function setCityData(cfg = {}) {
  setDataDir(cfg.dataDir) // repoints EVERY data loader (kiez, stats, heat, hunt)
  _outlineFile = cfg.outlineFile || 'berlin-outline.geojson'
  if (cfg.center) _center = cfg.center
}
/** Die aktive Stadt-Mitte (für die Kamera-Übersicht). */
export function cityCenter() { return _center }

let _kiezAreaByGid = null // gid → merged colloquial-Kiez polygon (union of its Planungsräume)
let _kiezAreas = null     // the raw kiez-areas FeatureCollection (for search)
let _osmKieze = null       // OSM place=quarter/neighbourhood polygons (precise named Kieze)
let _osmBbox = null

export async function loadKieze() {
  if (_kieze) return _kieze
  const [kieze, areas, osm] = await Promise.all([
    loadJSON(dpath('kieze.geojson')),
    loadJSON(dpath('kiez-areas.geojson')).catch(() => null),
    loadJSON(dpath('osm-kieze.geojson')).catch(() => null),
  ])
  _kieze = kieze
  _bbox = _kieze.features.map(featureBBox)
  if (areas) {
    _kiezAreas = areas
    _kiezAreaByGid = new Map()
    for (const f of areas.features) _kiezAreaByGid.set(f.properties.gid, f)
  }
  if (osm) { _osmKieze = osm; _osmBbox = osm.features.map(featureBBox) }
  return _kieze
}

/** Loaded data accessors (for the search index). */
export function kiezeFC() { return _kieze }
export function kiezAreasFC() { return _kiezAreas }
export function osmKiezeFC() { return _osmKieze }

/**
 * Finest OSM-defined Kiez polygon containing the point (smallest bbox wins, so a
 * nested Kiez like Scheunenviertel beats its surrounding Spandauer Vorstadt).
 * These are precise named-Kiez boundaries OSM has but LOR can't express (finer
 * than a Planungsraum). null if the point isn't inside any.
 */
export function findOsmKiez(lon, lat) {
  if (!_osmKieze) return null
  let best = null, bestArea = Infinity
  const fs = _osmKieze.features
  for (let i = 0; i < fs.length; i++) {
    const b = _osmBbox[i]
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue
    if (!inGeometry([lon, lat], fs[i].geometry)) continue
    const area = (b[2] - b[0]) * (b[3] - b[1])
    if (area < bestArea) { bestArea = area; best = fs[i] }
  }
  return best
}

/**
 * The merged colloquial-Kiez area for a Planungsraum — the union of all
 * Planungsräume that share its colloquial Kiez (e.g. Schillerkiez = Hasenheide +
 * Schillerpromenade Nord/Süd + Wartheplatz), as ONE polygon. Falls back to the
 * single Planungsraum if no group data is available.
 */
export function kiezAreaFor(plrFeature) {
  if (!plrFeature) return null
  const gid = plrFeature.properties && plrFeature.properties.gid
  if (_kiezAreaByGid && gid != null && _kiezAreaByGid.has(gid)) return _kiezAreaByGid.get(gid)
  return plrFeature
}

// ── aggregate LOR levels (dissolved from the Kieze) — lazy, non-blocking ──────
// The hierarchy nests by plr_id prefix:
//   Bezirk (2) ⊃ Prognoseraum (4) ⊃ Bezirksregion (6) ⊃ Planungsraum/Kiez (8)
export const LEVELS = [
  { key: 'plr', label: 'Kiez' },
  { key: 'bez', label: 'Bezirk' },
  { key: 'bzr', label: 'Bezirksregion' },
  { key: 'pgr', label: 'Prognoseraum' },
]

export function loadLevels() {
  if (_levelsPromise) return _levelsPromise
  _levelsPromise = Promise.all([
    loadJSON(dpath('bezirke.geojson')),
    loadJSON(dpath('prognoseraeume.geojson')).catch(() => EMPTY_FC),
    loadJSON(dpath('bezirksregionen.geojson')).catch(() => EMPTY_FC),
    loadJSON(dpath('bezirke-pts.geojson')).catch(() => EMPTY_FC),
    loadJSON(dpath('bezirksregionen-pts.geojson')).catch(() => EMPTY_FC),
  ]).then(([bez, pgr, bzr, bezPts, bzrPts]) => {
    const toMap = (fc) => {
      const m = new Map()
      for (const f of fc.features) m.set(f.properties.id, f)
      return m
    }
    // label points avoid the multi-tile duplicate-label bug for big polygons
    _levelFC = { bez, pgr, bzr, bezPts, bzrPts }
    _levelMaps = { bez: toMap(bez), pgr: toMap(pgr), bzr: toMap(bzr) }
    return _levelMaps
  })
  return _levelsPromise
}

/** Raw FeatureCollections per level (available after loadLevels resolves). */
export function levelFC() {
  return _levelFC
}

// id prefix length per level
const PREFIX = { bez: 2, pgr: 4, bzr: 6 }

/** The polygon Feature for a given level, derived from a Kiez (plr) feature. */
export function featureForLevel(level, plrFeature) {
  if (!plrFeature) return null
  if (level === 'kiez') return kiezAreaFor(plrFeature) // merged colloquial Kiez
  if (level === 'plr') return plrFeature
  if (!_levelMaps) return null
  const id = plrFeature.properties.plr_id.substring(0, PREFIX[level])
  return _levelMaps[level] ? _levelMaps[level].get(id) || null : null
}

/** Display name for a level, given a Kiez feature. */
export function levelName(level, plrFeature) {
  if (!plrFeature) return '—'
  const p = plrFeature.properties
  if (level === 'kiez') return p.kiez || p.plr_name
  if (level === 'plr') return p.plr_name
  if (level === 'bez') return bezirkName(p.bez)
  if (level === 'bzr') return p.bzr_name
  if (level === 'pgr') return p.pgr_name
  return '—'
}

/** [minLon, minLat, maxLon, maxLat] for a feature (for fitBounds). */
export function bboxOf(feature) {
  return feature ? featureBBox(feature) : null
}

export async function loadOutline() {
  if (_outline) return _outline
  _outline = await loadJSON(dpath(_outlineFile))
  return _outline
}

// Berlin Wall 1989 (Geoportal "Verlauf der Berliner Mauer"): Grenzmauer/
// Hinterlandmauer lines + Grenzstreifen polygons in one FC (each with {typ}),
// plus the stitched West-Berlin polygon (for the Ost/West side readout).
// Lazy — only fetched the first time the Mauer mode is switched on.
let _wallPromise = null
export function loadWall() {
  if (!_wallPromise) {
    _wallPromise = Promise.all([
      loadJSON(dpath('mauer.geojson')),
      loadJSON(dpath('west-berlin.geojson')).catch(() => null),
      loadJSON(dpath('ost-berlin.geojson')).catch(() => null),
    ]).then(([wall, west, ost]) => ({
      wall,
      west: west ? west.features[0] : null,
      ost: ost ? ost.features[0] : null,
    }))
      .catch((e) => { _wallPromise = null; throw e }) // allow retry after a failure
  }
  return _wallPromise
}

// Named Berlin streets (compact Overpass-derived records built by
// tools/build-streets.js) — search-only data: name, Bezirk, an on-street
// representative point and the street's bbox. ~11,400 entries, ~830 KB.
let _streetsPromise = null
export function loadStreets() {
  if (!_streetsPromise) {
    _streetsPromise = loadJSON(dpath('strassen.json'))
      .then((d) => d.streets.map(([name, bi, cx, cy, x1, y1, x2, y2]) => ({
        name, bez: d.bez[bi] || '', pt: [cx, cy], bbox: [x1, y1, x2, y2],
      })))
      .catch((e) => { _streetsPromise = null; throw e }) // allow retry after a failure
  }
  return _streetsPromise
}

// colloquial Kiez names from OSM (place=quarter/neighbourhood) — point labels
let _kiezNames = null
export async function loadKiezNames() {
  if (_kiezNames) return _kiezNames
  _kiezNames = await loadJSON(dpath('kiez-names.geojson'))
  return _kiezNames
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

/** Point-in-polygon for a GeoJSON geometry (outer ring minus holes; handles
 *  MultiPolygon). Exposed for unit tests of the classification core. */
export function pointInGeometry(geometry, lon, lat) {
  return geometry ? inGeometry([lon, lat], geometry) : false
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
  const [clon, clat] = _center
  const dy = (lat - clat) * 111.32
  const dx = (lon - clon) * 111.32 * Math.cos((clat * Math.PI) / 180)
  return Math.sqrt(dx * dx + dy * dy)
}

/** "01 - Mitte" → "Mitte" */
export function bezirkName(bez) {
  return (bez || '').replace(/^\d+\s*-\s*/, '').trim()
}
