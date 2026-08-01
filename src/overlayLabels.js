// ─────────────────────────────────────────────────────────────────────────
// Overlay / selection label placement — maplibre-free pure core.
//
// AAA anchor = approximate pole of inaccessibility (point inside the polygon
// farthest from any boundary). Bbox centres fall outside L-shapes / near
// edges (Neukölln's SE bulge pulled the old label off-centre). Viewport logic
// only kicks in when that visual centre is clipped.
// ─────────────────────────────────────────────────────────────────────────

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

/** Min distance from point to any outer-ring edge (degrees ≈ relative). */
function distToBoundary(pt, geom) {
  let best = Infinity
  for (const ring of outerRings(geom)) {
    for (let i = 0; i < ring.length - 1; i++) {
      const d = dist2Seg(pt[0], pt[1], ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1])
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

/** Grid resolution for candidate clouds / PoI search. */
export const LABEL_GRID = 11

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

  const scan = (n, x0, x1, y0, y1) => {
    let best = null, bestD = -1
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = x0 + (x1 - x0) * (i + 0.5) / n
      const y = y0 + (y1 - y0) * (j + 0.5) / n
      if (!pipEvenOdd([x, y], geom)) continue
      const d = distToBoundary([x, y], geom)
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
 * Build per-feature label candidates. `c` = visual centre (not bbox mid).
 * `pts` = dense interior grid + the visual centre (guaranteed anchor).
 */
export function labelCandidates(featureColl, nameOf, { grid = LABEL_GRID } = {}) {
  if (!featureColl || !featureColl.features) return []
  const N = grid
  const cands = featureColl.features.map((f, i) => {
    const bb = bboxOf(f)
    const vc = visualCenter(f) || [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]
    const pts = [vc]
    for (let gi = 0; gi < N; gi++) for (let gj = 0; gj < N; gj++) {
      const x = bb[0] + (bb[2] - bb[0]) * (gi + 0.5) / N
      const y = bb[1] + (bb[3] - bb[1]) * (gj + 0.5) / N
      if (pipEvenOdd([x, y], f.geometry)) pts.push([x, y])
    }
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
  }
}

const inBox = (p, W, E, S, N) => p[0] >= W && p[0] <= E && p[1] >= S && p[1] <= N

/**
 * Pick the best on-screen interior point for a candidate.
 * Prefer the visual centre when comfortably on screen; else the point nearest
 * the centre of this feature's visible bbox∩viewport.
 */
export function pickLabelPoint(c, view) {
  if (!c || !c.pts || !c.pts.length || !view) return null
  const { W, E, S, N, iW, iE, iS, iN } = view
  const visW = Math.max(c.bb[0], W), visE = Math.min(c.bb[2], E)
  const visS = Math.max(c.bb[1], S), visN = Math.min(c.bb[3], N)
  if (visW >= visE || visS >= visN) return null

  let tx, ty
  if (c.c && inBox(c.c, iW, iE, iS, iN)) {
    tx = c.c[0]; ty = c.c[1]
  } else {
    tx = (visW + visE) / 2
    ty = (visS + visN) / 2
  }

  let best = null, bd = Infinity, bestInner = null, bdInner = Infinity
  for (const p of c.pts) {
    if (!inBox(p, W, E, S, N)) continue
    const d = (p[0] - tx) ** 2 + (p[1] - ty) ** 2
    if (d < bd) { bd = d; best = p }
    if (inBox(p, iW, iE, iS, iN) && d < bdInner) { bdInner = d; bestInner = p }
  }
  return bestInner || best
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
  const pts = [vc]
  const N = 9
  for (let gi = 0; gi < N; gi++) for (let gj = 0; gj < N; gj++) {
    const x = bb[0] + (bb[2] - bb[0]) * (gi + 0.5) / N
    const y = bb[1] + (bb[3] - bb[1]) * (gj + 0.5) / N
    if (pipEvenOdd([x, y], feature.geometry)) pts.push([x, y])
  }
  return pickLabelPoint({ c: vc, bb, pts }, view) || vc
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
