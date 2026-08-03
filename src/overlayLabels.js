// ─────────────────────────────────────────────────────────────────────────
// Overlay / selection label placement — maplibre-free pure core.
//
// AAA anchor = approximate pole of inaccessibility (point inside the polygon
// farthest from any boundary). Bbox centres fall outside L-shapes / near
// edges (Neukölln's SE bulge pulled the old label off-centre).
//
// The on-screen anchor is the pole of inaccessibility of *polygon ∩ viewport*:
// every candidate is scored `min(distance to polygon boundary, distance to
// screen edge)` and the deepest wins. Fully visible area → the screen term is
// large everywhere → reduces to the plain visual centre. Clipped area → the
// label centres itself in the VISIBLE mass instead of drifting to its border.
// The old fallback (mid of bbox∩viewport, then nearest interior point) put
// labels ON the boundary whenever that midpoint fell in a neighbouring area —
// measured over the 12 Bezirke it reached only ~76 % of the achievable depth,
// with labels up to 3.4 km off.
//
// All distances are aspect-corrected (`kx = cos(lat)`): 1° lon is ~0.61× the
// ground length of 1° lat at 52.5°N, so a raw-degree metric is stretched
// horizontally and tolerates sitting close to left/right borders.
// ─────────────────────────────────────────────────────────────────────────

/** Metric x-scale so lon/lat distances are comparable (≈ ground, ≈ screen). */
export function lonScale(lat) {
  const k = Math.cos((lat || 0) * Math.PI / 180)
  return k > 0.15 ? k : 0.15 // guard the poles; Berlin ≈ 0.61
}

function bboxOf(feature) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0]
      if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1]
      return
    }
    for (const x of c) walk(x)
  }
  if (feature && feature.geometry) walk(feature.geometry.coordinates)
  return [minX, minY, maxX, maxY]
}

function ringsOf(geom) {
  if (!geom) return []
  if (geom.type === 'Polygon') return geom.coordinates
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat()
  return []
}

/** Outer rings only (holes ignored for pip — even-odd still handles holes). */
function outerRings(geom) {
  if (!geom) return []
  if (geom.type === 'Polygon') return [geom.coordinates[0]]
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0])
  return []
}

function ringHas(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    const hit = ((yi > pt[1]) !== (yj > pt[1]))
      && (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-15) + xi)
    if (hit) inside = !inside
  }
  return inside
}

function pipEvenOdd(pt, geom) {
  let inside = false
  for (const ring of ringsOf(geom)) if (ringHas(pt, ring)) inside = !inside
  return inside
}

/** Squared distance from point to segment a→b. */
function dist2Seg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-24) {
    const ex = px - ax, ey = py - ay
    return ex * ex + ey * ey
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const qx = ax + t * dx - px, qy = ay + t * dy - py
  return qx * qx + qy * qy
}

/** Min distance from point to any outer-ring edge, x scaled by `kx`. */
function distToBoundary(pt, geom, kx = 1) {
  let best = Infinity
  const px = pt[0] * kx, py = pt[1]
  for (const ring of outerRings(geom)) {
    for (let i = 0; i < ring.length - 1; i++) {
      const d = dist2Seg(px, py, ring[i][0] * kx, ring[i][1], ring[i + 1][0] * kx, ring[i + 1][1])
      if (d < best) best = d
    }
  }
  return Math.sqrt(best)
}

function approxArea(geom) {
  let tot = 0
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : []
  for (const poly of polys) {
    poly.forEach((ring, ri) => {
      let s = 0
      for (let i = 0; i < ring.length - 1; i++) {
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
      }
      tot += (ri === 0 ? 1 : -1) * Math.abs(s) / 2
    })
  }
  return tot
}

/** Fallback / minimum grid resolution for candidate clouds. */
export const LABEL_GRID = 11
/** Target spacing between candidates, in metric degrees (≈ 500 m). */
export const LABEL_STEP = 0.0045
/** Upper bound so a huge area can't explode the point cloud. */
export const LABEL_GRID_MAX = 25

/**
 * Candidate grid resolution for one bbox. What matters is the ABSOLUTE spacing
 * (an anchor should be accurate to a few hundred metres), not a fixed count: a
 * 24-km Bezirk on an 11×11 grid only resolves to 2.2 km, while the same grid is
 * overkill for a 1-km Kiez. Scaling by size makes the coarse levels accurate
 * AND the 427 Kiez areas cheaper than the old fixed grid.
 */
export function gridFor(bb) {
  const kx = lonScale((bb[1] + bb[3]) / 2)
  const span = Math.max((bb[2] - bb[0]) * kx, bb[3] - bb[1])
  const n = Math.ceil(span / LABEL_STEP)
  if (!(n > LABEL_GRID)) return LABEL_GRID
  return n < LABEL_GRID_MAX ? n : LABEL_GRID_MAX
}

/**
 * Visual centre ≈ pole of inaccessibility: interior point maximizing distance
 * to the boundary. Two-pass (coarse → refine) — fast enough for ~12 Bezirke
 * and ~500 Kieze at setOverlayData time.
 */
export function visualCenter(feature, { coarse = 14, refine = 7 } = {}) {
  if (!feature || !feature.geometry) return null
  const geom = feature.geometry
  const bb = bboxOf(feature)
  const w = bb[2] - bb[0], h = bb[3] - bb[1]
  if (!(w > 0 && h > 0)) return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]
  const kx = lonScale((bb[1] + bb[3]) / 2)

  const scan = (n, x0, x1, y0, y1) => {
    let best = null, bestD = -1
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = x0 + (x1 - x0) * (i + 0.5) / n
      const y = y0 + (y1 - y0) * (j + 0.5) / n
      if (!pipEvenOdd([x, y], geom)) continue
      const d = distToBoundary([x, y], geom, kx)
      if (d > bestD) { bestD = d; best = [x, y] }
    }
    return best
  }

  let best = scan(coarse, bb[0], bb[2], bb[1], bb[3])
  if (!best) {
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2
    return pipEvenOdd([cx, cy], geom) ? [cx, cy] : [cx, cy]
  }
  // Refine in a cell around the winner (~2 coarse cells)
  const rw = w / coarse, rh = h / coarse
  const refined = scan(
    refine,
    Math.max(bb[0], best[0] - rw), Math.min(bb[2], best[0] + rw),
    Math.max(bb[1], best[1] - rh), Math.min(bb[3], best[1] + rh),
  )
  return refined || best
}

/**
 * Interior candidate cloud for one feature: dense grid + the visual centre
 * (guaranteed anchor). Each point is `[lon, lat, boundaryDist]` — the boundary
 * distance is viewport-independent, so precomputing it here (once per dataset)
 * keeps `pickLabelPoint` O(#points) on every camera settle.
 */
function candidatePoints(feature, vc, bb, grid) {
  const geom = feature.geometry
  const kx = lonScale((bb[1] + bb[3]) / 2)
  const pts = [[vc[0], vc[1], distToBoundary(vc, geom, kx)]]
  for (let gi = 0; gi < grid; gi++) for (let gj = 0; gj < grid; gj++) {
    const x = bb[0] + (bb[2] - bb[0]) * (gi + 0.5) / grid
    const y = bb[1] + (bb[3] - bb[1]) * (gj + 0.5) / grid
    if (pipEvenOdd([x, y], geom)) pts.push([x, y, distToBoundary([x, y], geom, kx)])
  }
  return pts
}

/**
 * Build per-feature label candidates. `c` = visual centre (not bbox mid).
 * `pts` = interior cloud, see candidatePoints. `grid` overrides the adaptive
 * resolution (tests / callers that want a fixed cloud).
 */
export function labelCandidates(featureColl, nameOf, { grid = 0 } = {}) {
  if (!featureColl || !featureColl.features) return []
  const cands = featureColl.features.map((f, i) => {
    const bb = bboxOf(f)
    const vc = visualCenter(f) || [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]
    const pts = candidatePoints(f, vc, bb, grid || gridFor(bb))
    return { id: i, name: nameOf(f), c: vc, bb, pts, area: approxArea(f.geometry), feature: f }
  })
  const byArea = cands.slice().sort((a, b) => b.area - a.area)
  byArea.forEach((c, rank) => {
    c.sort = rank
    const q = rank / Math.max(1, byArea.length - 1)
    c.szf = q < 0.2 ? 1.14 : q < 0.6 ? 1 : 0.88
  })
  return cands
}

/**
 * Viewport box + centre. `margin` (0–0.45) shrinks the usable box so labels
 * don't sit on the clipped edge (text would half-overflow).
 */
export function viewBox(W, E, S, N, margin = 0.12) {
  const dx = (E - W) * margin, dy = (N - S) * margin
  return {
    W, E, S, N,
    iW: W + dx, iE: E - dx, iS: S + dy, iN: N - dy,
    cx: (W + E) / 2, cy: (S + N) / 2,
    kx: lonScale((S + N) / 2),
  }
}

const inBox = (p, W, E, S, N) => p[0] >= W && p[0] <= E && p[1] >= S && p[1] <= N

/** Metric distance from p to the nearest viewport edge (negative = off-screen). */
function edgeDist(p, view) {
  const kx = view.kx || lonScale((view.S + view.N) / 2)
  return Math.min(
    (p[0] - view.W) * kx, (view.E - p[0]) * kx,
    p[1] - view.S, view.N - p[1],
  )
}

/**
 * How deep inside "polygon ∩ viewport" a candidate sits — the quantity the
 * anchor maximizes. `p[2]` is the precomputed distance to the polygon boundary.
 */
export function labelDepth(p, view) {
  const b = p.length > 2 ? p[2] : Infinity
  const e = edgeDist(p, view)
  return b < e ? b : e
}

/**
 * A kept anchor survives while it is still within this fraction of the best
 * available depth — pure position-based hysteresis let a label stay pinned to a
 * spot that panning had pushed against a border.
 */
export const LABEL_KEEP_RATIO = 0.75

/**
 * Pick the deepest on-screen interior point (pole of inaccessibility of
 * polygon ∩ viewport). `kept` = the previous anchor: it is reused while it is
 * comfortably on screen AND still nearly as deep as the new best, which keeps
 * labels from twitching on every pan without letting them go stale.
 * Returns a `[lon, lat, boundaryDist]` candidate (slice for GeoJSON).
 */
export function pickLabelPoint(c, view, kept = null) {
  if (!c || !c.pts || !c.pts.length || !view) return null
  const { W, E, S, N } = view
  if (c.bb && (Math.max(c.bb[0], W) >= Math.min(c.bb[2], E)
    || Math.max(c.bb[1], S) >= Math.min(c.bb[3], N))) return null

  // Maximizing the depth is itself the overflow guard: a point near the screen
  // edge scores low and only wins when the visible slice is that thin. An extra
  // hard "must sit inside the margin" rule made it WORSE — for an area clipped
  // down to a band it banished the label from the band's middle (Reinickendorf
  // at the top edge dropped to 26 % of the achievable depth).
  let best = null, bd = 0
  for (const p of c.pts) {
    if (!inBox(p, W, E, S, N)) continue
    const d = labelDepth(p, view)
    if (d > bd) { bd = d; best = p }
  }
  if (!best) return null
  if (kept && shouldKeepLabel(kept, view)
    && labelDepth(kept, view) >= LABEL_KEEP_RATIO * bd) return kept
  return best
}

/**
 * Anchor for a single selected feature (same algorithm as overlay labels).
 * Optional `view` = current map bounds; without it → pure visual centre.
 */
export function selectionAnchor(feature, view = null) {
  if (!feature) return null
  const vc = visualCenter(feature)
  if (!vc) return null
  if (!view) return vc
  const bb = bboxOf(feature)
  const pts = candidatePoints(feature, vc, bb, gridFor(bb))
  const p = pickLabelPoint({ c: vc, bb, pts }, view)
  return p ? [p[0], p[1]] : vc
}

/**
 * Hysteresis: keep the previous point while it stays comfortably inside the
 * viewport (not just barely in view — that was the edge-hug stutter).
 */
export function shouldKeepLabel(kept, view) {
  if (!kept || !view) return false
  const { iW, iE, iS, iN } = view
  return inBox(kept, iW, iE, iS, iN)
}
