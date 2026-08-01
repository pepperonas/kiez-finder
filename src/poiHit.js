// ─────────────────────────────────────────────────────────────────────────
// POI hit targeting — pure, maplibre-free. Used by map.js `_poiAtPoint`.
// ─────────────────────────────────────────────────────────────────────────

/** Full CSS-pixel pad for poi-dot once you're into a neighbourhood. */
export const POI_DOT_TOL_MAX = 10

/**
 * Hit-pad (CSS px) for the poi-dot query box.
 *
 * At city-wide zooms many km² fit on screen and POIs sit dense — a fixed 10 px
 * halo steals Kiez taps between dots. Pad stays 0 until mid-zoom, then ramps
 * to {@link POI_DOT_TOL_MAX} by neighbourhood scale. Labels stay direct-hit
 * only (handled separately in map.js) and only appear from z14 anyway.
 *
 * @param {number} z map zoom
 * @returns {number} integer ≥ 0
 */
export function poiDotTol(z) {
  const z0 = 12 // city / multi-Bezirk: must land on the rendered circle
  const z1 = 14 // Kiez / street: full finger-friendly pad
  if (!(z > z0)) return 0
  if (z >= z1) return POI_DOT_TOL_MAX
  return Math.round(((z - z0) / (z1 - z0)) * POI_DOT_TOL_MAX)
}
