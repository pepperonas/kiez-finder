// ─────────────────────────────────────────────────────────────────────────
// Which topbar actions stay visible and which collapse into the overflow menu.
// DOM-free so the rule is unit-testable (main.js only moves the elements).
//
// Material 3: a top app bar orders its actions by frequency of use and pushes
// the rest into an overflow menu — "actions collapse into an overflow menu at
// smaller breakpoints, and become visible again at larger sizes". Every target
// is ≥48dp, which is what forced this: eight 44px buttons in one row overflowed
// the viewport (the last one was clipped off-screen at 320px) AND every one of
// them was below the minimum touch target.
//
// Priority order = how often the action is used on a map screen. The two map
// LAYERS (areas, heatmap) come first, then the city-specific signature feature
// (Mauer), then preferences. `install` is last on purpose: it is `hidden` until
// the browser fires beforeinstallprompt, so it must never occupy a bar slot.
// ─────────────────────────────────────────────────────────────────────────

export const ACTION_ORDER = ['overlay', 'heat', 'wall', 'autozoom', 'account', 'theme', 'install']

/** Visible action slots next to the city pill + overflow button. */
export const COMPACT_SLOTS = 3
export const NARROW_SLOTS = 2
/** Below this width even 3 slots + city pill + overflow would crowd the row. */
export const NARROW_WIDTH = 360
/**
 * Up to this width the actions stay collapsed. Deliberately ABOVE the app's
 * 840px panel breakpoint: at 840 the full seven-button row leaves the search
 * box 129px — narrower than its own placeholder. The row only "becomes visible
 * again at larger sizes" once it genuinely fits next to brand + search.
 */
export const COMPACT_MAX_WIDTH = 1000

export function isCompact(width) { return width < COMPACT_MAX_WIDTH }

export function compactSlots(width) {
  return width < NARROW_WIDTH ? NARROW_SLOTS : COMPACT_SLOTS
}

/**
 * @param {{compact:boolean, width?:number, hasWall?:boolean}} opts
 * @returns {{bar:string[], menu:string[]}} action keys, in render order
 */
export function topbarPlan({ compact, width = 1280, hasWall = true } = {}) {
  const available = ACTION_ORDER.filter((k) => k !== 'wall' || hasWall)
  if (!compact) return { bar: available, menu: [] }
  const n = compactSlots(width)
  return { bar: available.slice(0, n), menu: available.slice(n) }
}
