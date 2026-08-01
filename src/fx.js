// ─────────────────────────────────────────────────────────────────────────
// Delight layer — Anime.js v4 choreography on top of the M3 spring core
// (motion.js). Spatial sheet/map physics stay in motion.js; this module owns
// entrance sequences, micro-interactions, and celebration pops.
//
// Why Anime.js (not Motion): vanilla ESM, timelines + stagger + spring easings,
// ~framework-free. Motion shines in React layout animations we don't have.
// Honors prefers-reduced-motion everywhere; scales down on coarse pointers.
// ─────────────────────────────────────────────────────────────────────────

import { animate, createTimeline, spring, stagger, utils } from 'animejs'
import { reduceMotion, finePointer } from './motion.js'

export const fxEnabled = () => !reduceMotion()

/** Coarse pointer (phones) → shorter/softer motion so the UI stays snappy. */
export const coarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/** Mobile sheet breakpoint — keep in sync with style.css / main.js. */
export const isNarrow = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 839.98px)').matches

/** Duration multiplier: phones get ~75 % so choreography doesn't feel laggy. */
export function fxDur(ms) {
  return Math.round(ms * (coarsePointer() ? 0.75 : 1))
}

/** Letter-split titles only on roomy, fine-pointer surfaces (layout + a11y). */
export function shouldSplitTitle() {
  return fxEnabled() && finePointer() && !isNarrow()
}

const bounce = (b = 0.45, d = 420) => spring({ bounce: b, duration: fxDur(d) })
const soft = (d = 380) => spring({ bounce: 0.22, duration: fxDur(d) })

/** Kill leftover inline transforms so CSS (sheet tilt, chip centering) wins again. */
function clearInline(el) {
  if (!el || !el.style) return
  el.style.removeProperty('opacity')
  el.style.removeProperty('transform')
  el.style.removeProperty('translate')
  el.style.removeProperty('scale')
  el.style.removeProperty('rotate')
  el.style.removeProperty('filter')
}

/**
 * Card body entrance — spring stagger. No CSS `filter: blur` — animating blur
 * on text (esp. WebKit/mobile) leaves an illegible white smear on titles.
 * Never touches `.pass` itself (tilt + sheet own that transform).
 */
export function cardReveal(els, { distance = 22, base = 48 } = {}) {
  const list = [...els].filter(Boolean)
  if (!list.length) return
  if (!fxEnabled()) {
    list.forEach((el) => {
      el.style.setProperty('--reveal', '1')
      el.style.setProperty('--reveal-y', '0px')
      clearInline(el)
    })
    return
  }
  const dist = coarsePointer() ? Math.round(distance * 0.7) : distance
  list.forEach((el) => {
    el.classList.add('fx-live')
    el.style.setProperty('--reveal', '1')
    el.style.setProperty('--reveal-y', '0px')
    el.style.removeProperty('filter')
  })
  utils.set(list, { opacity: 0, y: dist })
  animate(list, {
    opacity: 1,
    y: 0,
    delay: stagger(fxDur(base), { start: fxDur(40) }),
    ease: soft(520),
    onComplete: () => list.forEach((el) => {
      el.classList.remove('fx-live')
      clearInline(el)
    }),
  })
}

/** Toast / snackbar entrance — spring pop from above. */
export function toastIn(el) {
  if (!el) return
  if (!fxEnabled()) return
  el.classList.add('fx-toast')
  utils.set(el, { opacity: 0, y: -18, scale: 0.92 })
  animate(el, {
    opacity: 1,
    y: 0,
    scale: 1,
    ease: bounce(0.55, 480),
  })
  const icon = el.querySelector('.toast-icon')
  if (icon) {
    utils.set(icon, { scale: 0.4, rotate: -18 })
    animate(icon, { scale: 1, rotate: 0, delay: fxDur(80), ease: bounce(0.7, 560) })
  }
}

/** Toast exit — quick settle down + fade. */
export function toastOut(el) {
  if (!el) return Promise.resolve()
  if (!fxEnabled()) {
    el.classList.add('out')
    return new Promise((r) => setTimeout(r, 40))
  }
  return new Promise((resolve) => {
    animate(el, {
      opacity: 0,
      y: -10,
      scale: 0.96,
      duration: fxDur(280),
      ease: 'in(2)',
      onComplete: () => resolve(),
    })
  })
}

/** Rubber-stamp slam when a Kiez is found. */
export function stampHit(el) {
  if (!el || !fxEnabled()) return
  utils.set(el, { scale: 1.55, rotate: -14, opacity: 0 })
  createTimeline().add(el, {
    opacity: 1,
    scale: 1,
    rotate: 0,
    ease: bounce(0.62, 640),
  }).add(el.querySelector('.stamp-pin') || el, {
    scale: [1, 1.18, 1],
    ease: bounce(0.5, 360),
  }, '-=420')
}

/**
 * Soft title entrance. No char-split + no filter — splitting fought cardReveal
 * and left unreadable titles on mobile; blur smeared glyphs white.
 */
export function titleArrive(el) {
  if (!el || !fxEnabled()) return
  // Already orchestrated via cardReveal when the title has [data-reveal]
  if (el.hasAttribute('data-reveal') || el.closest?.('[data-reveal]')) return
  const text = el.textContent || ''
  if (!text.trim()) return
  utils.set(el, { opacity: 0, y: 12 })
  animate(el, {
    opacity: 1,
    y: 0,
    ease: bounce(0.35, 480),
    onComplete: () => clearInline(el),
  })
}

/** Active hierarchy row / title — tactile pulse on select. */
export function levelPulse(el) {
  if (!el || !fxEnabled()) return
  animate(el, {
    scale: [1, 1.035, 1],
    ease: bounce(0.55, 420),
  })
}

/** Area chip content change — soft morph (throttled so pans don't strobe). */
let _chipPulseAt = 0
export function chipPulse(el) {
  if (!el || el.hidden || !fxEnabled()) return
  const now = performance.now()
  if (now - _chipPulseAt < 420) return
  _chipPulseAt = now
  animate(el, {
    scale: [1, 1.06, 1],
    ease: bounce(0.5, 380),
  })
  const dot = el.querySelector('.area-chip-dot')
  if (dot) {
    animate(dot, {
      scale: [1, 1.35, 1],
      ease: bounce(0.65, 420),
    })
  }
}

/** Topbar controls cascade in once after first paint. */
export function topbarIntro(root) {
  if (!root || !fxEnabled()) return
  const kids = [...root.querySelectorAll('.brand, .search, .icon-btn, .seg-btn, .city-btn')]
  if (!kids.length) return
  utils.set(kids, { opacity: 0, y: -10, scale: 0.9 })
  const safety = setTimeout(() => kids.forEach(clearInline), fxDur(2000))
  animate(kids, {
    opacity: 1,
    y: 0,
    scale: 1,
    delay: stagger(fxDur(28), { start: fxDur(80) }),
    ease: soft(480),
    onComplete: () => { clearTimeout(safety); kids.forEach(clearInline) },
  })
}

/** POI fact chips cascade. */
export function factsIn(els) {
  const list = [...els].filter(Boolean)
  if (!list.length || !fxEnabled()) return
  utils.set(list, { opacity: 0, y: 8, scale: 0.85 })
  animate(list, {
    opacity: 1,
    y: 0,
    scale: 1,
    delay: stagger(fxDur(45)),
    ease: bounce(0.45, 400),
  })
}

/** Visit mark / unmark — satisfying check bounce. */
export function visitPop(btn, marked) {
  if (!btn || !fxEnabled()) return
  animate(btn, {
    scale: marked ? [1, 1.08, 1] : [1, 0.94, 1],
    ease: bounce(marked ? 0.65 : 0.35, 420),
  })
}

/** Soft discovery burst near a host (toast or card). DOM dots only — no canvas. */
export function celebrate(host, { count } = {}) {
  if (!host || !fxEnabled()) return
  const n = count ?? (coarsePointer() ? 8 : 14)
  const rect = host.getBoundingClientRect()
  const layer = document.createElement('div')
  layer.className = 'fx-burst'
  layer.setAttribute('aria-hidden', 'true')
  document.body.append(layer)
  const cx = rect.left + rect.width / 2
  const cy = rect.top + Math.min(rect.height / 2, 40)
  const dots = []
  for (let i = 0; i < n; i++) {
    const d = document.createElement('span')
    d.className = 'fx-burst-dot'
    d.style.left = cx + 'px'
    d.style.top = cy + 'px'
    layer.append(d)
    dots.push(d)
  }
  animate(dots, {
    x: () => (Math.random() - 0.5) * (coarsePointer() ? 120 : 180),
    y: () => -40 - Math.random() * (coarsePointer() ? 80 : 140),
    opacity: [1, 0],
    scale: [1, 0.2],
    delay: stagger(fxDur(18)),
    duration: fxDur(720),
    ease: 'out(3)',
    onComplete: () => layer.remove(),
  })
}

/** Icon-button press spring — pointer events, works on touch (no hover needed).
 *  Topbar controls skip scale (fixed slots; scale made the badge row jitter). */
export function bindPressFx(root = document) {
  if (!root || root.__kfPressFx) return
  root.__kfPressFx = true
  const hit = (e) => {
    const el = e.target.closest?.('.icon-btn, .seg-btn, .city-btn, .browse-btn, .pb-close, .pass-collapse, .pass-reopen')
    if (!el) return null
    if (el.closest?.('.topbar-actions')) return null
    return el
  }
  root.addEventListener('pointerdown', (e) => {
    if (!fxEnabled()) return
    const el = hit(e)
    if (!el || el.disabled) return
    animate(el, { scale: 0.88, duration: fxDur(90), ease: 'out(2)' })
  }, { passive: true })
  const release = (e) => {
    if (!fxEnabled()) return
    const el = hit(e)
    if (!el) return
    animate(el, { scale: 1, ease: bounce(0.55, 380) })
  }
  root.addEventListener('pointerup', release, { passive: true })
  root.addEventListener('pointercancel', release, { passive: true })
}

/** Search result list stagger when the dropdown opens / refreshes. */
export function searchItemsIn(els) {
  const list = [...els].filter(Boolean)
  if (!list.length || !fxEnabled()) return
  utils.set(list, { opacity: 0, x: -8 })
  animate(list, {
    opacity: 1,
    x: 0,
    delay: stagger(fxDur(28)),
    duration: fxDur(260),
    ease: 'out(2)',
  })
}

/** POI browser sheet open polish (children, not the panel transform). */
export function browserOpen(panel) {
  if (!panel || !fxEnabled()) return
  const head = panel.querySelector('.pb-head, .pb-search-wrap, .pb-filters')
  const items = panel.querySelectorAll('.pb-item, .pb-empty')
  if (head) {
    utils.set(head, { opacity: 0, y: 12 })
    animate(head, { opacity: 1, y: 0, ease: soft(420) })
  }
  if (items.length) {
    utils.set(items, { opacity: 0, y: 10 })
    animate(items, {
      opacity: 1,
      y: 0,
      delay: stagger(fxDur(22), { start: fxDur(80) }),
      ease: soft(400),
    })
  }
}

/** Soft active flash for mode toggles — no scale/rotate (those shoved the topbar). */
export function modeKick(btn) {
  if (!btn || !fxEnabled()) return
  animate(btn, {
    opacity: [1, 0.72, 1],
    duration: fxDur(280),
    ease: 'inOut(2)',
  })
}

/** Stats block numbers — tiny pop when values patch in (throttled). */
let _statsPopAt = 0
export function statsPop(root) {
  if (!root || !fxEnabled()) return
  const now = performance.now()
  if (now - _statsPopAt < 500) return
  _statsPopAt = now
  const vals = root.querySelectorAll('.stat-val, .stats-val')
  if (!vals.length) return
  animate(vals, {
    scale: [0.92, 1],
    opacity: [0.5, 1],
    delay: stagger(fxDur(40)),
    ease: bounce(0.4, 360),
  })
}
