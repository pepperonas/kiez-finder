// ─────────────────────────────────────────────────────────────────────────
// Kiez-Finder
//
// Concept: "Ein Kiez-Pass." You check in at your location and Berlin tells you
// which Kiez claims you right now. Every layer obeys it — the copy ("einchecken"),
// the card (a stamped pass), the signature moment (lock-on: the camera flies to
// you and your Kiez boundary draws itself in), the empty state (outside the city
// limits the pass doesn't apply).
// ─────────────────────────────────────────────────────────────────────────
import './style.css'
import { KiezMap } from './map.js'
import { loadKieze, loadOutline, loadLevels, levelFC, loadKiezNames, loadWall, loadStreets,
  findKiez, bezirkName, kmFromBerlin, featureForLevel, levelName, kiezAreaFor, kiezeFC,
  kiezAreasFC, osmKiezeFC, findOsmKiez, pointInGeometry } from './kiez.js'
import { buildSearchIndex, search } from './search.js'
import { readBoolPref, writeBoolPref } from './prefs.js'
import { loadStats, loadKiezInfo, statsData, infoData, selectorFor, selectorForFeature,
  aggregate, ranksFor, geodesicAreaM2, infoFor, infoForBezirk, kiezFallbackText, plrIdsFor,
  fmtInt, fmtKm2, fmtDichte, fmtAlter, fmtAnteil, fmtEuroM2 } from './stats.js'
import { loadPois, poisData, poiUrl, poisNear, readProgress, writeProgress, markVisited,
  overallProgress, scopeProgress, isVisited, rankFor, RADIUS_M, nearestPois, fmtDist, mergeProgress } from './hunt.js'
import { loadPreise, preiseData, METRICS, metricByKey, standFor, buildHeatFC,
  quantileBreaks, classIndex, heatPaint, legendFor, RAMPS } from './heat.js'
import { fetchMe, syncProgress, pushProgress, logout, loginUrl, readLoginFlag, stripLoginFlag } from './account.js'
import { getPosition, reverseGeocode } from './geo.js'
import { revealStagger, tweenNumber, spring, SPRINGS, reduceMotion, finePointer, damdamper } from './motion.js'

// ── tiny safe DOM builder (no innerHTML for dynamic content) ───────────────
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k === 'html') el.innerHTML = v // only ever called with static strings
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (k === 'aria') for (const [a, av] of Object.entries(v)) el.setAttribute('aria-' + a, av)
    else if (v === true) el.setAttribute(k, '')
    else if (v !== false && v != null) el.setAttribute(k, v)
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid))
  return el
}

const ICONS = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><g stroke-linecap="round"><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9"/></g></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
  install: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v10.5m0 0 4-4m-4 4-4-4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" stroke-linecap="round"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" stroke-linecap="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.4 7-11.3A7 7 0 0 0 5 9.7C5 14.6 12 21 12 21Z"/><circle cx="12" cy="9.6" r="2.4" fill="var(--surface)"/></svg>',
  layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 3.5 8 12 12.5 20.5 8 12 3.5Z" stroke-linejoin="round"/><path d="M4 12.2 12 16.5l8-4.3M4 15.9 12 20.2l8-4.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wall: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="1" stroke-linejoin="round"/><path d="M3.5 9.83h17M3.5 14.17h17M9.17 5.5v4.33M14.83 5.5v4.33M6.33 9.83v4.34M12 9.83v4.34M17.67 9.83v4.34M9.17 14.17v4.33M14.83 14.17v4.33" stroke-linecap="round"/></svg>',
  heat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13.8V5.2a2 2 0 1 1 4 0v8.6a4.6 4.6 0 1 1-4 0Z" stroke-linejoin="round"/><path d="M12 9.2v7.3" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.4" fill="currentColor" stroke="none"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5" stroke-linecap="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/></svg>',
  loc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.6v3M12 19.4v3M1.6 12h3M19.4 12h3" stroke-linecap="round"/></svg>',
  chevronL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevronR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  road: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4 5.5 20M16 4l2.5 16" stroke-linecap="round"/><path d="M12 4.6v3M12 10.7v3M12 16.8v3" stroke-linecap="round"/></svg>',
  // auto-fit frame (corner brackets + centre) — reads as "auto-zoom to the area"
  autozoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.3"/></svg>',
}

const state = {
  map: null,
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
  deferredInstall: null,
  busy: false,
  tilt: null,
  plr: null,        // current Kiez feature
  pos: null,        // current position { lat, lon, accuracy }
  level: 'kiez',    // active highlight level: kiez | bez | bzr | pgr (default = colloquial Kiez = merged group)
  overlay: 'off',   // map sector overlay: off | bezirke | bzr
  overlayReady: false,
  // auto-zoom: when on, a map-tap frames the tapped Kiez; off keeps the camera
  // put (only the tap path — explicit "centre"/level/search actions always frame)
  autoZoom: (() => { try { return readBoolPref(localStorage, 'kf-autozoom', true) } catch (e) { return true } })(),
  searchReady: false,
  selectedPlace: null,
  kiezArea: null,   // resolved highlight area for the active Kiez (OSM or merged group)
  wall: false,      // Berliner-Mauer retro mode active
  wallData: null,   // { wall: FC, west: Feature } once loaded
  overlayBeforeWall: null, // overlay mode to restore when leaving wall mode
  // Schnitzeljagd: Fortschritt lokal; Format ist merge-fähig für einen
  // späteren Konto-Sync (siehe hunt.js `mergeProgress`)
  hunt: (() => { try { return readProgress(localStorage) } catch (e) { return { v: 1, visited: {} } } })(),
  poiList: null,
  account: { authed: false }, // { authed, name } — rein additiv, App läuft ohne
  heat: 'off',      // heatmap metric key (dichte/alter/u18/o65/miete/brw) or 'off'
  heatFC: null,     // built heat FeatureCollection (kieze geometry + metric props)
  heatBreaks: null, // active metric's quantile breaks (chip dot colour)
}

// ── shell ──────────────────────────────────────────────────────────────────
const app = document.getElementById('app')

const installBtn = h('button', {
  class: 'icon-btn install-btn', type: 'button', hidden: true,
  title: 'App installieren', aria: { label: 'App installieren' },
  html: ICONS.install,
})
const themeBtn = h('button', {
  class: 'icon-btn', type: 'button',
  title: 'Hell/Dunkel umschalten', aria: { label: 'Hell- oder Dunkelmodus umschalten' },
  html: state.theme === 'dark' ? ICONS.sun : ICONS.moon,
})
// 3-state overlay toggle: aus → Bezirke → Bezirksregionen
const overlayLabelEl = h('span', { class: 'seg-label' })
const overlayBtn = h('button', {
  class: 'icon-btn seg-btn', type: 'button', 'data-mode': 'off',
  title: 'Bezirke einblenden', aria: { label: 'Flächen einblenden: aus' },
},
  h('span', { class: 'seg-icon', html: ICONS.layers }), overlayLabelEl)
// Berliner Mauer 1989 — retro B&W view with the historical wall course
const wallBtn = h('button', {
  class: 'icon-btn wall-btn', type: 'button',
  title: 'Berliner Mauer 1989 (Retro-Ansicht)',
  aria: { label: 'Berliner Mauer 1989: Retro-Schwarz-Weiß-Ansicht umschalten', pressed: 'false' },
  html: ICONS.wall,
})
// Heatmap-Control: Button öffnet ein kompaktes Popover mit Metrik-Chips
// (aus · Dichte · Ø Alter · U18 · 65+ · Miete · Bodenrichtwert)
const heatBtn = h('button', {
  class: 'icon-btn heat-btn', type: 'button',
  title: 'Heatmap (Dichte, Alter, Preise …)',
  aria: { label: 'Heatmap-Ebene wählen', haspopup: 'true', expanded: 'false' },
  html: ICONS.heat,
})
const heatPop = h('div', { class: 'heat-pop', hidden: true, role: 'menu', aria: { label: 'Heatmap-Metriken' } })
// Legende der aktiven Heatmap (Quantil-Farbrampe + Min/Max)
const legendTitle = h('p', { class: 'legend-title' })
const legendBar = h('div', { class: 'legend-bar', 'aria-hidden': 'true' })
const legendMin = h('span', { class: 'legend-min' })
const legendMax = h('span', { class: 'legend-max' })
const legendStand = h('p', { class: 'legend-stand' })
const heatLegend = h('div', { class: 'heat-legend', hidden: true, aria: { live: 'polite' } },
  legendTitle, legendBar,
  h('div', { class: 'legend-range' }, legendMin, legendMax), legendStand)

// Auto-Zoom beim Antippen der Karte — an (Default) = Tap rahmt den Kiez; aus =
// Kamera bleibt stehen (nur markieren). Active-Look = an, wie beim Mauer-Button.
const autoZoomBtn = h('button', {
  class: 'icon-btn autozoom-btn' + (state.autoZoom ? ' is-active' : ''), type: 'button',
  title: state.autoZoom ? 'Auto-Zoom beim Antippen: an' : 'Auto-Zoom beim Antippen: aus',
  aria: { label: 'Automatisch heranzoomen beim Antippen der Karte umschalten', pressed: String(state.autoZoom) },
  html: ICONS.autozoom,
})

// ── fuzzy search (Bezirke / Bezirksregionen / Prognoseräume / Kieze / Planungsräume) ──
const searchInput = h('input', {
  class: 'search-input', type: 'search', enterkeyhint: 'search',
  placeholder: 'Kiez, Bezirk, Ortsteil …', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  aria: { label: 'Berlin durchsuchen', autocomplete: 'list', controls: 'search-results', expanded: 'false' },
  role: 'combobox',
})
const searchClear = h('button', { class: 'search-clear', type: 'button', hidden: true, title: 'Löschen', aria: { label: 'Suche löschen' }, html: ICONS.x })
const searchResults = h('div', { id: 'search-results', class: 'search-results', role: 'listbox', hidden: true })
const searchBox = h('div', { class: 'search' },
  h('span', { class: 'search-icon', 'aria-hidden': 'true', html: ICONS.search }),
  searchInput, searchClear, searchResults)

const topbar = h('header', { class: 'topbar' },
  h('a', { class: 'brand', href: '/', aria: { label: 'Kiez-Finder Startseite' } },
    h('span', { class: 'brand-mark', html: ICONS.pin }),
    h('span', { class: 'brand-name' },
      h('strong', { text: 'Kiez' }), h('span', { text: '-Finder' }))),
  searchBox,
  h('div', { class: 'topbar-actions' }, installBtn, overlayBtn, heatBtn, wallBtn, autoZoomBtn, themeBtn),
)

// floating "current area" chip — names the coloured region under the map centre
// whenever an overlay is active (so every colour always has a label, at any zoom)
const areaChipDot = h('span', { class: 'area-chip-dot', 'aria-hidden': 'true' })
const areaChipName = h('span', { class: 'area-chip-name' })
const areaChipLevel = h('span', { class: 'area-chip-level' })
const areaChip = h('div', { class: 'area-chip', hidden: true, aria: { live: 'polite' } },
  areaChipDot, areaChipName, areaChipLevel)

const mapEl = h('div', { id: 'map', aria: { hidden: 'true' } })
const card = h('section', { class: 'pass', aria: { live: 'polite' } })
// drag handle (mobile bottom-sheet grabber) + scrolling content region
const sheetHandle = h('button', {
  class: 'sheet-handle', type: 'button',
  aria: { label: 'Karte ein- oder ausklappen', expanded: 'true' },
})
const passScroll = h('div', { class: 'pass-scroll' })
// desktop collapse control (the bottom-sheet handle is mobile-only); collapses the
// pass off-screen left, leaving a reopen tab
const collapseBtn = h('button', {
  class: 'pass-collapse', type: 'button', title: 'Info einklappen',
  aria: { label: 'Info-Panel einklappen', expanded: 'true' }, html: ICONS.chevronL,
})
card.append(sheetHandle, passScroll, collapseBtn)
const stage = h('div', { class: 'stage' }, card)

const reopenBtn = h('button', {
  class: 'pass-reopen', type: 'button', title: 'Info einblenden',
  aria: { label: 'Info-Panel einblenden', expanded: 'false' },
},
  h('span', { class: 'pr-icon', 'aria-hidden': 'true', html: ICONS.pin }),
  h('span', { class: 'pr-label', text: 'Kiez-Pass' }),
  h('span', { class: 'pr-chev', 'aria-hidden': 'true', html: ICONS.chevronR }))

// Entdeckungs-Meldungen der Schnitzeljagd (oben zentriert, selbst-schließend)
const toastWrap = h('div', { class: 'toasts', aria: { live: 'polite' } })

app.append(mapEl, stage, topbar, heatPop, heatLegend, areaChip, reopenBtn, toastWrap)

// ── desktop: collapse / expand the info panel ────────────────────────────────
function setPanelCollapsed(collapsed, moveFocus = true) {
  app.classList.toggle('panel-collapsed', collapsed)
  collapseBtn.setAttribute('aria-expanded', String(!collapsed))
  reopenBtn.setAttribute('aria-expanded', String(!collapsed))
  try { localStorage.setItem('kf-panel', collapsed ? 'collapsed' : 'open') } catch (e) {}
  if (moveFocus) (collapsed ? reopenBtn : collapseBtn).focus()
}
collapseBtn.addEventListener('click', () => setPanelCollapsed(true))
reopenBtn.addEventListener('click', () => setPanelCollapsed(false))
// desktop-only restore: on phones the bottom sheet owns the card — a persisted
// collapsed state must not fight the sheet logic (the class is inert there, but
// aria/focus state would still be wrong)
try {
  if (!sheetEnabled() && localStorage.getItem('kf-panel') === 'collapsed') setPanelCollapsed(true, false)
} catch (e) {}

// delegated: clicking a hierarchy level highlights it on the map (persists across renders)
passScroll.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-level]')
  if (btn && passScroll.contains(btn)) selectLevel(btn.getAttribute('data-level'))
})

// ── state renderers ─────────────────────────────────────────────────────────
function setCard(node, animate = true, forceOpen = true) {
  passScroll.replaceChildren(node)
  requestAnimationFrame(fitKiezName)
  sheetOnRender(forceOpen)
  if (animate && !reduceMotion()) {
    const rows = node.querySelectorAll('[data-reveal]')
    if (rows.length) revealStagger([...rows])
  }
}

// ── mobile bottom sheet (MD3): drag handle, peek/open snap with spring ────────
const sheet = { y: 0, H: 0, peek: 0, state: 'open', entered: false, cancel: null }
function sheetEnabled() { return window.matchMedia('(max-width: 839.98px)').matches } // keep in sync with style.css
function setSheetY(y) {
  sheet.y = y
  card.style.setProperty('--sheet-y', y.toFixed(1) + 'px')
}
function measureSheet() {
  sheet.H = card.offsetHeight
  const cardTop = card.getBoundingClientRect().top
  // the peeked strip is just grabber + title — stamp/radar/eyebrow/subline
  // collapse via CSS ([data-sheet='peek']). Measure the title's real position
  // and subtract exactly what will collapse ABOVE it (works measured in either
  // state: collapsed elements simply contribute 0).
  const nameEl = card.querySelector('.kiez-name, .locating-title')
  let peek = 176
  if (nameEl) {
    const outerH = (el) => {
      if (!el) return 0
      const cs = getComputedStyle(el)
      return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
    }
    const deco = outerH(card.querySelector('.stamp, .radar')) + outerH(card.querySelector('.eyebrow'))
    peek = (nameEl.getBoundingClientRect().bottom - cardTop) - deco + 10
  } else {
    const titleEl = card.querySelector('.level-title') || passScroll.firstElementChild
    if (titleEl) peek = (titleEl.getBoundingClientRect().bottom - cardTop) + 20
  }
  sheet.peek = Math.max(76, Math.min(sheet.H - 48, peek))
}
function snapTarget(state) { return state === 'peek' ? Math.max(0, sheet.H - sheet.peek) : 0 }
function snapTo(state, instant = false) {
  sheet.state = state
  card.setAttribute('data-sheet', state)
  sheetHandle.setAttribute('aria-expanded', state === 'open' ? 'true' : 'false')
  const target = snapTarget(state)
  if (sheet.cancel) { sheet.cancel(); sheet.cancel = null }
  if (instant || reduceMotion()) { setSheetY(target); return }
  sheet.cancel = spring(sheet.y, target, SPRINGS.spatialDefault, setSheetY)
}
function sheetOnRender(forceOpen = true) {
  if (!sheetEnabled()) { card.style.removeProperty('--sheet-y'); card.removeAttribute('data-sheet'); return }
  requestAnimationFrame(() => {
    measureSheet()
    // first render always opens; afterwards a map-pick keeps the current state
    // (so a peeked sheet stays out of the way of the map you're exploring)
    if (!sheet.entered) { sheet.entered = true; setSheetY(sheet.H); requestAnimationFrame(() => snapTo('open')) }
    else snapTo(forceOpen ? 'open' : sheet.state)
  })
}
function toggleSheet() { if (sheetEnabled()) snapTo(sheet.state === 'open' ? 'peek' : 'open') }

// shared drag core (used by touch gestures from the handle, the peeked sheet, or
// a pull-down from the top of the scrolled content)
let justDragged = false
const drag = { active: false, startY: 0, startSheetY: 0, lastY: 0, lastT: 0, vel: 0, t: 0 }
function beginDrag(startY, t) {
  if (sheet.cancel) { sheet.cancel(); sheet.cancel = null }
  drag.active = true; drag.startY = startY; drag.startSheetY = sheet.y; drag.lastY = startY; drag.lastT = t; drag.vel = 0
  card.classList.add('dragging')
}
function moveDrag(y, t) {
  const max = snapTarget('peek')
  let ny = drag.startSheetY + (y - drag.startY)
  if (ny < 0) ny *= 0.28          // rubber-band past fully open
  else if (ny > max) ny = max + (ny - max) * 0.28
  setSheetY(ny)
  const dt = t - drag.lastT
  if (dt > 0) drag.vel = (y - drag.lastY) / dt // px/ms
  drag.lastY = y; drag.lastT = t
}
function endDrag() {
  if (!drag.active) return
  drag.active = false
  card.classList.remove('dragging')
  const max = snapTarget('peek')
  let target
  if (drag.vel > 0.35) target = 'peek'          // light downward flick → collapse
  else if (drag.vel < -0.35) target = 'open'    // light upward flick → open
  else target = sheet.y > max * 0.4 ? 'peek' : 'open' // else nearest (biased toward collapse)
  snapTo(target)
  justDragged = true
  clearTimeout(drag.t); drag.t = setTimeout(() => { justDragged = false }, 400)
}

function initSheetDrag() {
  let downY = 0, downX = 0, startScroll = 0, fromHandle = false, pending = false

  card.addEventListener('touchstart', (e) => {
    if (!sheetEnabled() || e.touches.length !== 1) { pending = false; return }
    const t = e.touches[0]
    downY = t.clientY; downX = t.clientX
    startScroll = passScroll.scrollTop
    fromHandle = !!e.target.closest('.sheet-handle')
    pending = true; drag.active = false
  }, { passive: true })

  card.addEventListener('touchmove', (e) => {
    if (!pending && !drag.active) return
    const t = e.touches[0]; if (!t) return
    const dy = t.clientY - downY, dx = t.clientX - downX
    if (!drag.active) {
      if (Math.abs(dy) < 6) return
      if (Math.abs(dx) > Math.abs(dy)) { pending = false; return } // horizontal → leave it
      // start a sheet drag from: the handle (any dir) · the peeked sheet (any vert)
      // · the content only when at the top and pulling down → else it's a scroll
      const canStart = fromHandle || sheet.state === 'peek' || (dy > 0 && startScroll <= 0)
      if (!canStart) { pending = false; return }
      beginDrag(downY, e.timeStamp)
    }
    e.preventDefault() // we own the gesture → stop native scroll
    moveDrag(t.clientY, e.timeStamp)
  }, { passive: false })

  const finish = (e) => {
    if (drag.active) { endDrag(); pending = false; e.preventDefault(); return }
    if (!pending) return
    pending = false
    const ct = e.changedTouches && e.changedTouches[0]
    if (!ct || Math.abs(ct.clientY - downY) > 8 || Math.abs(ct.clientX - downX) > 8) return // not a tap
    if (fromHandle) { toggleSheet(); e.preventDefault() }
    else if (sheet.state === 'peek') { snapTo('open'); e.preventDefault() } // first tap opens
  }
  card.addEventListener('touchend', finish, { passive: false })
  card.addEventListener('touchcancel', () => { if (drag.active) endDrag(); pending = false })

  // mouse / keyboard fallback (touch taps preventDefault their synthetic click)
  sheetHandle.addEventListener('click', () => { if (sheetEnabled() && !justDragged) toggleSheet() })
}

// Shrink the Kiez title only when it would overflow (a long single word like
// "Schulenburgpark" can't wrap); multi-word names keep their full size + wrap.
function fitKiezName() {
  const el = card.querySelector('.kiez-name')
  if (!el) return
  el.style.fontSize = '' // reset to the stylesheet clamp
  const base = parseFloat(getComputedStyle(el).fontSize) || 34
  const min = Math.max(18, base * 0.5)
  // text width scales ~linearly with font size → jump straight to the fitting
  // size in one write instead of a 1px-per-reflow loop, then nudge if rounding
  // still overflows (bounded, ~O(1) reflows instead of up to 80)
  let size = base, guard = 0
  while (el.scrollWidth > el.clientWidth + 1 && size > min && guard++ < 4) {
    size = Math.max(min, Math.floor(size * ((el.clientWidth + 1) / el.scrollWidth)))
    el.style.fontSize = size + 'px'
  }
}

function renderLocating() {
  setCard(
    h('div', { class: 'pass-body pass-locating' },
      h('div', { class: 'radar', 'aria-hidden': 'true' },
        h('span', { class: 'radar-sweep' }),
        h('span', { class: 'radar-ring' }), h('span', { class: 'radar-ring r2' }),
        h('span', { class: 'radar-core' })),
      h('p', { class: 'eyebrow', 'data-reveal': '' , text: 'Kiez-Pass' }),
      h('h1', { class: 'locating-title', 'data-reveal': '', text: 'Wir checken dich ein …' }),
      h('p', { class: 'muted', 'data-reveal': '', text: 'Einen Moment — wir gleichen deinen Standort mit den offiziellen Berliner Kiez-Grenzen ab.' }),
    ), false
  )
  // the radar/locating visual is CSS-driven; reveal the copy
  const rows = card.querySelectorAll('[data-reveal]')
  revealStagger([...rows])
}

function metaRow(label, value) {
  return h('div', { class: 'meta-row', 'data-reveal': '' },
    h('span', { class: 'meta-label', text: label }),
    h('span', { class: 'meta-value', text: value || '—' }))
}

// a selectable hierarchy level (button) — clicking highlights it on the map
function levelRow(level, label, value) {
  const active = state.level === level
  return h('button', {
    class: 'meta-row meta-row--btn' + (active ? ' is-active' : ''),
    type: 'button', 'data-level': level, 'data-reveal': '',
    aria: { pressed: active ? 'true' : 'false', label: `${label} ${value} auf der Karte zeigen` },
  },
    h('span', { class: 'meta-label', text: label }),
    h('span', { class: 'meta-value', text: value || '—' }),
    h('span', { class: 'meta-go', 'aria-hidden': 'true', html: ICONS.layers }))
}

let _addrValueEl = null
function addressRow(line) {
  _addrValueEl = h('span', {
    class: 'meta-value' + (line ? '' : ' meta-value--pending'),
    text: line || 'wird ermittelt …',
  })
  return h('div', { class: 'meta-row', 'data-reveal': '' },
    h('span', { class: 'meta-label', text: 'Adresse' }), _addrValueEl)
}
function patchAddress(line) {
  if (!_addrValueEl) return
  _addrValueEl.textContent = line
  _addrValueEl.classList.remove('meta-value--pending')
}

// ── wall mode: which side of the wall a position falls on (1989) ─────────────
function sectorFor(pos) {
  const wd = state.wallData
  if (!wd || !wd.west || !pos) return null
  if (pointInGeometry(wd.west.geometry, pos.lon, pos.lat)) return 'west'
  const ost = wd.ost ? pointInGeometry(wd.ost.geometry, pos.lon, pos.lat) : !!findKiez(pos.lon, pos.lat)
  return ost ? 'ost' : null
}
// Fill the card's sector slot with the archival stamp. Rendered whenever the
// wall data is available; visibility is CSS-gated on #app.wall-mode so toggling
// the mode needs no re-render.
function fillSectorSlot(slot, pos) {
  slot.replaceChildren()
  const s = sectorFor(pos)
  if (!s) return
  const west = s === 'west'
  slot.append(h('div', { class: 'sector-stamp', 'data-reveal': '' },
    h('span', { class: 'sector-kicker', text: 'Sektor · 1989' }),
    h('span', { class: 'sector-name', text: west ? 'West-Berlin' : 'Ost-Berlin' }),
    h('span', { class: 'sector-sub', text: west
      ? 'Amerikanischer · Britischer · Französischer Sektor'
      : 'Sowjetischer Sektor' }),
  ))
}
// patch the live card once the wall data lands (first mode activation)
function updateSectorStamp() {
  const slot = passScroll.querySelector('.sector-slot')
  if (slot) fillSectorSlot(slot, state.pos)
}

// ── Schnitzeljagd ────────────────────────────────────────────────────────────
// Entdeckt wird per Standort: liegt ein POI beim Check-in im Umkreis, gilt er
// als besucht. Antippen zeigt ihn nur an — sonst wäre es keine Jagd.
function toast(icon, title, sub) {
  const el = h('div', { class: 'toast' },
    h('span', { class: 'toast-icon', 'aria-hidden': 'true', text: icon }),
    h('div', { class: 'toast-text' },
      h('strong', { text: title }),
      sub ? h('span', { text: sub }) : null))
  toastWrap.append(el)
  // selbst-schließend; kein Klick-Handler, da .toast pointer-events:none hat
  // (sonst blockierten Toasts die Topbar-Controls)
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400) }, 4200)
}

let _pushTimer = 0
function saveHunt() {
  try { writeProgress(localStorage, state.hunt) } catch (e) {}
  if (state.map) state.map.setVisited(new Set(Object.keys(state.hunt.visited).map(Number)))
  // angemeldet? gebündelt hochladen — scheitert das, bleibt alles lokal gültig
  if (state.account.authed) {
    clearTimeout(_pushTimer)
    _pushTimer = setTimeout(() => { pushProgress(state.hunt) }, 1500)
  }
}

/** Nach einem Check-in: alle POIs im Umkreis als besucht eintragen. */
function discoverAt(pos) {
  if (!state.poiList || !pos) return []
  const found = []
  for (const { poi } of poisNear(state.poiList, pos.lat, pos.lon)) {
    const r = markVisited(state.hunt, poi.qid)
    if (r.changed) { state.hunt = r.progress; found.push(poi) }
  }
  if (found.length) {
    saveHunt()
    const before = overallProgress(state.poiList, state.hunt).visited - found.length
    for (const p of found) toast('🎉', 'Entdeckt: ' + p.name, p.desc || '')
    // Rangaufstieg extra feiern
    const now = rankFor(before + found.length), was = rankFor(before)
    if (now.title !== was.title) toast('🏅', 'Neuer Rang: ' + now.title, `${before + found.length} POIs entdeckt`)
  }
  return found
}

// POI-Liste eines Bereichs für die Card
function poiItem(p, distM) {
  const done = isVisited(state.hunt, p.qid)
  const item = h('li', { class: 'poi-item' + (done ? ' is-done' : '') },
    h('button', {
      class: 'poi-go', type: 'button',
      aria: { label: `${p.name} auf der Karte zeigen` },
    },
      h('span', { class: 'poi-mark', 'aria-hidden': 'true', text: done ? '✓' : '' }),
      h('span', { class: 'poi-text' },
        h('span', { class: 'poi-name', text: p.name }),
        h('span', { class: 'poi-desc', text: [distM != null ? fmtDist(distM) : null, p.desc].filter(Boolean).join(' · ') }))),
    h('a', { class: 'poi-wiki', href: poiUrl(p), target: '_blank', rel: 'noopener',
      title: 'Wikipedia-Artikel', aria: { label: `Wikipedia-Artikel zu ${p.name}` }, text: 'W' }))
  item.querySelector('.poi-go').addEventListener('click', () => {
    if (state.map) state.map.flyToPoi(p.lon, p.lat)
  })
  return item
}

// Konto-Zeile: sichert den Fortschritt geräteübergreifend — rein optional.
function accountRow() {
  if (state.account.authed) {
    const out = h('button', { class: 'acct-link', type: 'button', text: 'abmelden' })
    out.addEventListener('click', async () => {
      await logout()
      state.account = { authed: false }
      toast('👋', 'Abgemeldet', 'Dein Fortschritt bleibt auf diesem Gerät.')
      patchHunt()
    })
    return h('p', { class: 'acct' },
      h('span', { text: `✓ Als ${state.account.name || 'angemeldet'} gesichert · ` }), out)
  }
  const login = h('a', { class: 'acct-link', href: loginUrl(), text: 'Mit Google anmelden' })
  return h('p', { class: 'acct' },
    h('span', { text: 'Fortschritt nur auf diesem Gerät · ' }), login)
}

function huntSection(sel) {
  if (!state.poiList || !sel) return null
  const scope = scopeProgress(state.poiList, state.hunt, plrIdsFor(kiezeFC(), sel))
  // 162 der 427 Kieze enthalten keinen der 1000 POIs — dort wäre die Sektion
  // leer. Stattdessen: die nächstgelegenen Ziele in der Umgebung.
  if (!scope.total) {
    if (!state.pos) return null
    const near = nearestPois(state.poiList, state.pos.lat, state.pos.lon, 5)
    if (!near.length) return null
    const list = h('ul', { class: 'poi-list' })
    for (const n of near) list.append(poiItem(n.poi, n.dist))
    return h('section', { class: 'hunt', 'data-reveal': '' },
      h('p', { class: 'stats-head' }, 'Schnitzeljagd',
        h('span', { class: 'stats-scope', text: 'in der Nähe' })),
      h('p', { class: 'poi-more', text: 'In diesem Kiez liegt keiner der 1000 Orte — die nächsten:' }),
      list,
      accountRow(),
      h('p', { class: 'stats-note', text: `Ein POI zählt als entdeckt, wenn du beim Einchecken höchstens ${RADIUS_M} m entfernt bist.` }))
  }
  const list = h('ul', { class: 'poi-list' })
  // besuchte ans Ende, sonst nach Prominenz
  const sorted = scope.pois.slice().sort((a, b) =>
    (isVisited(state.hunt, a.qid) - isVisited(state.hunt, b.qid)) || b.sl - a.sl)
  for (const p of sorted.slice(0, 12)) {
    list.append(poiItem(p, null))
  }
  const pct = Math.round((scope.visited / scope.total) * 100)
  const bar = h('div', { class: 'poi-bar', role: 'progressbar',
    aria: { valuenow: String(scope.visited), valuemin: '0', valuemax: String(scope.total),
      label: `${scope.visited} von ${scope.total} POIs entdeckt` } },
    h('span', { class: 'poi-bar-fill' }))
  bar.querySelector('.poi-bar-fill').style.width = pct + '%'
  return h('section', { class: 'hunt', 'data-reveal': '' },
    h('p', { class: 'stats-head' }, 'Schnitzeljagd',
      h('span', { class: 'stats-scope', text: `${scope.visited}/${scope.total} entdeckt` })),
    bar,
    list,
    scope.pois.length > 12 ? h('p', { class: 'poi-more', text: `… und ${scope.pois.length - 12} weitere` }) : null,
    accountRow(),
    h('p', { class: 'stats-note', text: `Ein POI zählt als entdeckt, wenn du beim Einchecken höchstens ${RADIUS_M} m entfernt bist.` }))
}

/** Hunt-Sektion der aktuellen Auswahl (neu) rendern — auch nach Level-Wechsel. */
function patchHunt() {
  const slot = passScroll.querySelector('.hunt-slot')
  if (!slot) return
  const selection = statsSelection(state.level)
  const node = selection && selection.sel ? huntSection(selection.sel) : null
  slot.replaceChildren(...(node ? [node] : []))
}

// ── Bereichs-Statistik (Einwohner · Fläche · Dichte + Wikipedia-Kurztext) ────
// Ein Block pro Karte; patchbar ohne Re-Render (Level-Wechsel, Daten-Nachzug).
let _statsEls = null
function buildStatsBlock() {
  const scope = h('span', { class: 'stats-scope' })
  const tile = (label) => {
    const val = h('span', { class: 'stat-val', text: '—' })
    return { val, el: h('div', { class: 'stat-tile' }, val, h('span', { class: 'stat-label', text: label })) }
  }
  const pop = tile('Einwohner'), area = tile('Fläche'), dens = tile('Einw./km²')
  const age = tile('Ø Alter'), u18 = tile('unter 18'), o65 = tile('ab 65')
  const ageRow = h('div', { class: 'stats-tiles stats-tiles--age', hidden: true }, age.el, u18.el, o65.el)
  const miete = tile('Ø Miete (2022)'), brw = tile('Bodenwert')
  const preisRow = h('div', { class: 'stats-tiles stats-tiles--preis', hidden: true }, miete.el, brw.el)
  const rank = h('p', { class: 'stats-rank', hidden: true })
  const aboutText = h('p', { class: 'about-text' })
  const aboutLink = h('a', { class: 'about-a', target: '_blank', rel: 'noopener' })
  const aboutSrc = h('span', { class: 'about-src' })
  const about = h('div', { class: 'kiez-about', hidden: true },
    aboutText,
    h('p', { class: 'about-meta' }, aboutLink, aboutSrc))
  const note = h('p', { class: 'stats-note' })
  const root = h('section', { class: 'stats', 'data-reveal': '', hidden: true },
    h('p', { class: 'stats-head' }, 'Statistik', scope),
    h('div', { class: 'stats-tiles' }, pop.el, area.el, dens.el),
    ageRow, preisRow, rank, about, note)
  _statsEls = { root, scope, pop: pop.val, area: area.val, dens: dens.val,
    ageRow, age: age.val, u18: u18.val, o65: o65.val,
    preisRow, miete: miete.val, brw: brw.val, rank, about, aboutText, aboutLink, aboutSrc, note }
  return root
}

// Beschreibt die aktuelle Auswahl für den Stats-Block (Karten-Flow).
function statsSelection(level) {
  if (!state.plr) return null
  const p = state.plr.properties
  // feiner OSM-Kiez als Titel → keine amtliche Einwohnerzahl (er ist kleiner
  // als ein Planungsraum); Fläche geodätisch aus dem Polygon, Text per Name
  const osm = level === 'kiez' && state.kiezArea && state.kiezArea.properties.gid == null
    && state.kiezArea.properties.name
  if (osm) return { level, name: state.kiezArea.properties.name, osmGeom: state.kiezArea.geometry }
  const name = level === 'kiez' ? (p.kiez || p.plr_name) : levelName(level, state.plr)
  return { level, sel: selectorFor(level, state.plr), name }
}

// Füllt den Block aus einer Auswahl { level, sel?, name, osmGeom? } — oder blendet ihn aus.
function patchStats(selection) {
  if (!_statsEls) return
  const els = _statsEls
  const data = statsData()
  if (!selection || (!selection.sel && !selection.osmGeom)) { els.root.hidden = true; return }
  const { level, sel, name, osmGeom } = selection

  els.scope.textContent = name || ''
  let hasNumbers = false
  let lastAgg = null
  if (osmGeom) {
    els.pop.textContent = '—'
    els.dens.textContent = '—'
    els.area.textContent = fmtKm2(geodesicAreaM2(osmGeom))
    els.ageRow.hidden = true
    els.preisRow.hidden = true
    els.rank.hidden = true
    els.note.textContent = 'Feiner OSM-Kiez — amtliche Einwohnerzahlen gibt es erst ab Planungsraum-Ebene.'
    hasNumbers = true
  } else if (data) {
    const agg = aggregate(data, kiezeFC(), sel, preiseData())
    lastAgg = agg
    if (agg) {
      els.pop.textContent = agg.pop == null ? 'k. A.' : (agg.partial ? '≥ ' : '') + fmtInt(agg.pop)
      els.area.textContent = fmtKm2(agg.m2)
      els.dens.textContent = fmtDichte(agg.pop, agg.m2) || '—'
      // Altersstruktur: Ø approximativ (Bandmitten), U18/65+ exakte Bandsummen
      if (agg.avgAge != null) {
        els.age.textContent = '≈ ' + fmtAlter(agg.avgAge)
        els.u18.textContent = fmtAnteil(agg.u18, agg.pop) || '—'
        els.o65.textContent = fmtAnteil(agg.o65, agg.pop) || '—'
        els.ageRow.hidden = false
      } else els.ageRow.hidden = true
      // Preise (einwohnergewichtete Mittel der Mitglieds-PLRs)
      if (agg.miete != null || agg.brw != null) {
        els.miete.textContent = fmtEuroM2(agg.miete, 2) || '—'
        els.brw.textContent = fmtEuroM2(agg.brw) || '—'
        els.preisRow.hidden = false
      } else els.preisRow.hidden = true
      const r = ranksFor(data, kiezeFC(), level, sel)
      if (r && r.of > 1) {
        els.rank.textContent = `№ ${r.popRank} von ${r.of} nach Einwohnern · № ${r.densRank} nach Dichte`
        els.rank.hidden = false
      } else els.rank.hidden = true
      const pd = preiseData()
      els.note.textContent = `Einwohner: Amt für Statistik Berlin-Brandenburg · Stand ${data.stand}` +
        (agg.miete != null && pd ? ` · Miete: Wohnatlas ${pd.standMiete}` : '') +
        (agg.brw != null && pd ? ` · Bodenwert: BORIS ${pd.standBrw}` : '')
      hasNumbers = true
    } else { els.rank.hidden = true; els.ageRow.hidden = true; els.preisRow.hidden = true }
  }

  // Beschreibung: recherchierter Text (Wikipedia/Wikidata/OSM) — und wenn es
  // für diesen Bereich keinen gibt, eine aus den amtlichen Zahlen erzeugte
  // Faktenzeile. So steht ÜBERALL Kontext, ohne dass etwas erfunden wird.
  const inf = level === 'bez' ? infoForBezirk(infoData(), name) : infoFor(infoData(), name)
  if (inf) {
    els.aboutText.textContent = inf.x
    els.aboutLink.textContent = inf.t
    els.aboutLink.href = inf.u || '#'
    els.aboutLink.hidden = !inf.u
    els.aboutSrc.textContent = inf.src === 'wd' ? ' · Wikidata (CC0)'
      : inf.src === 'osm' ? ' · OpenStreetMap (ODbL)' : ' · Text: Wikipedia (CC BY-SA)'
    els.about.hidden = false
  } else if (!osmGeom) {
    els.aboutText.textContent = kiezFallbackText({ level, plr: state.plr, agg: lastAgg })
    els.aboutLink.hidden = true
    els.aboutSrc.textContent = ' · Angaben: Amt für Statistik Berlin-Brandenburg / LOR 2021'
    els.about.hidden = false
  } else els.about.hidden = true

  els.root.hidden = !hasNumbers && els.about.hidden
}

function renderFound({ kiez, pos, address, kiezName, openSheet = true }) {
  state.plr = kiez
  state.pos = pos
  const p = kiez.properties
  const coordsEl = h('span', { class: 'coords-val', text: '52.00000, 13.00000' })
  const titleActive = state.level === 'kiez'
  // Title = the colloquial Kiez: a precise OSM Kiez (kiezName) if standing in one,
  // else the precomputed Kiez (groups several Planungsräume). The exact official
  // Planungsraum becomes the subline.
  const colloquial = kiezName || (p.kiez && p.kiez !== p.plr_name ? p.kiez : null)
  const titleText = colloquial || p.plr_name

  const recheck = h('button', { class: 'btn btn-filled', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.refresh }), 'Erneut einchecken')
  recheck.addEventListener('click', () => checkIn())

  const showMap = h('button', { class: 'btn btn-tonal', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.target }), 'Auf Karte zentrieren')
  showMap.addEventListener('click', () => fitActive())

  const sectorSlot = h('div', { class: 'sector-slot' })
  fillSectorSlot(sectorSlot, pos)
  const huntSlot = h('div', { class: 'hunt-slot' })

  const body = h('div', { class: 'pass-body pass-found' },
    h('div', { class: 'stamp', 'aria-hidden': 'true' },
      h('span', { class: 'stamp-ring' }), h('span', { class: 'stamp-pin', html: ICONS.pin })),
    h('p', { class: 'eyebrow', 'data-reveal': '', text: 'Du stehst im Kiez' }),
    h('button', {
      class: 'level-title' + (titleActive ? ' is-active' : ''),
      type: 'button', 'data-level': 'kiez', 'data-reveal': '',
      aria: { pressed: titleActive ? 'true' : 'false', label: `Kiez ${titleText} auf der Karte zeigen` },
    },
      h('h1', { class: 'kiez-name', text: titleText }),
      colloquial ? h('p', { class: 'kiez-official', text: `amtl. Planungsraum · ${p.plr_name}` }) : null),
    sectorSlot,
    // ordered by ascending area size (Kiez = title above; then bigger → biggest).
    // The Prognoseraum is hidden when it only duplicates the Bezirk name.
    h('div', { class: 'meta' },
      levelRow('bzr', 'Bezirksregion', p.bzr_name),
      p.pgr_name && p.pgr_name !== bezirkName(p.bez)
        ? levelRow('pgr', 'Prognoseraum', p.pgr_name) : null,
      levelRow('bez', 'Bezirk', bezirkName(p.bez)),
      addressRow(address && address.line),
    ),
    buildStatsBlock(),
    huntSlot,
    h('p', { class: 'hint', 'data-reveal': '', text:
      'Tippe eine Ebene an, um sie hervorzuheben — oder tippe auf die Karte.' }),
    h('div', { class: 'coords', 'data-reveal': '' },
      h('span', { class: 'coords-label', text: 'Koordinaten' }), coordsEl),
    h('div', { class: 'actions' }, recheck, showMap),
    h('p', { class: 'source', 'data-reveal': '', html:
      'Kiez-Grenzen: LOR 2021 · Geoportal Berlin / Amt für Statistik Berlin-Brandenburg' }),
  )
  setCard(body, true, openSheet)
  tweenCoords(coordsEl, pos)
  patchHunt()
  // Daten sind ggf. noch unterwegs (Boot) — dann patcht der Loader-Callback nach
  patchStats(statsSelection(state.level))
  Promise.all([loadStats(), loadKiezInfo(), loadPreise()]).then(() => {
    if (_statsEls && document.contains(_statsEls.root)) patchStats(statsSelection(state.level))
  })
}

// reflect the active level in the card chrome without re-rendering (no replay)
function syncLevelUI() {
  card.querySelectorAll('[data-level]').forEach((el) => {
    const on = el.getAttribute('data-level') === state.level
    el.classList.toggle('is-active', on)
    el.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
}

// resolve the polygon for a level — the Kiez level uses the resolved area
// (precise OSM Kiez if standing in one, else the merged Planungsraum-group)
function levelFeature(level) {
  if (level === 'kiez' && state.kiezArea) return state.kiezArea
  return featureForLevel(level, state.plr)
}

async function selectLevel(level) {
  if (!state.plr || !state.map) return
  state.level = level
  syncLevelUI()
  patchStats(statsSelection(level)) // Stats folgen der gewählten Ebene (kein Re-Render)
  patchHunt()
  await loadLevels().catch(() => null)
  const feature = levelFeature(level)
  if (feature) state.map.highlight(feature, { fit: true })
}

function fitActive() {
  if (!state.plr || !state.map) return
  const feature = levelFeature(state.level)
  if (feature) state.map.fitTo(feature)
}

function tweenCoords(el, pos) {
  const fmt = (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`
  if (reduceMotion()) { el.textContent = fmt(pos.lat, pos.lon); return }
  const start = performance.now(), dur = 700
  const ease = (t) => 1 - Math.pow(1 - t, 3)
  const fromLat = pos.lat - 0.02, fromLon = pos.lon - 0.02
  const tick = (now) => {
    const t = Math.min((now - start) / dur, 1), e = ease(t)
    el.textContent = fmt(fromLat + (pos.lat - fromLat) * e, fromLon + (pos.lon - fromLon) * e)
    if (t < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function renderOutside({ pos, openSheet = true }) {
  const km = Math.round(kmFromBerlin(pos.lon, pos.lat))
  const recheck = h('button', { class: 'btn btn-filled', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.refresh }), 'Erneut einchecken')
  recheck.addEventListener('click', () => checkIn())
  setCard(
    h('div', { class: 'pass-body pass-outside' },
      h('div', { class: 'stamp stamp--void', 'aria-hidden': 'true' },
        h('span', { class: 'stamp-ring' }), h('span', { class: 'stamp-pin', html: ICONS.pin })),
      h('p', { class: 'eyebrow', 'data-reveal': '', text: 'Außerhalb der Stadtgrenze' }),
      h('h1', { class: 'kiez-name', 'data-reveal': '', text: 'Kein Berliner Kiez' }),
      h('p', { class: 'muted', 'data-reveal': '', text:
        `Du bist rund ${km} km vom Berliner Zentrum entfernt. Der Kiez-Pass gilt nur innerhalb der Stadtgrenze.` }),
      h('div', { class: 'actions' }, recheck),
    ), true, openSheet,
  )
}

function renderError(err) {
  const denied = err.kind === 'denied'
  const retry = h('button', { class: 'btn btn-filled', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.refresh }), denied ? 'Erneut versuchen' : 'Nochmal einchecken')
  retry.addEventListener('click', () => checkIn())
  setCard(
    h('div', { class: 'pass-body pass-error' },
      h('div', { class: 'stamp stamp--void', 'aria-hidden': 'true' },
        h('span', { class: 'stamp-ring' }), h('span', { class: 'stamp-pin', html: ICONS.pin })),
      h('p', { class: 'eyebrow', 'data-reveal': '', text: 'Standort' }),
      h('h1', { class: 'kiez-name', 'data-reveal': '', text: denied ? 'Freigabe nötig' : 'Kein Standort' }),
      h('p', { class: 'muted', 'data-reveal': '', text: err.message }),
      denied ? h('p', { class: 'muted small', 'data-reveal': '', text:
        'Tippe auf das Schloss-/Info-Symbol in der Adressleiste und erlaube den Standortzugriff.' }) : null,
      h('div', { class: 'actions' }, retry),
    )
  )
}

// Core boundary data failed to load (offline first visit, 404, malformed JSON).
// Without this card a load failure would masquerade as "not in Berlin".
function renderDataError() {
  const retry = h('button', { class: 'btn btn-filled', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.refresh }), 'Erneut laden')
  retry.addEventListener('click', async () => {
    retry.disabled = true
    const ok = await loadKieze().catch(() => null)
    if (ok) checkIn()
    else { retry.disabled = false }
  })
  setCard(
    h('div', { class: 'pass-body pass-error' },
      h('div', { class: 'stamp stamp--void', 'aria-hidden': 'true' },
        h('span', { class: 'stamp-ring' }), h('span', { class: 'stamp-pin', html: ICONS.pin })),
      h('p', { class: 'eyebrow', 'data-reveal': '', text: 'Kartendaten' }),
      h('h1', { class: 'kiez-name', 'data-reveal': '', text: 'Daten nicht geladen' }),
      h('p', { class: 'muted', 'data-reveal': '', text:
        'Die Berliner Kiez-Grenzen konnten nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.' }),
      h('div', { class: 'actions' }, retry),
    )
  )
}

// ── core flow ────────────────────────────────────────────────────────────────
let _seq = 0 // guards against out-of-order results when picks overlap

// Geolocation check-in — the dramatic lock-on flight.
async function checkIn() {
  if (state.busy) return
  state.busy = true
  // boot already shows the locating card — don't re-render (double reveal-stagger)
  if (!passScroll.querySelector('.pass-locating')) renderLocating()
  try {
    const pos = await getPosition()
    await locateAt(pos, { fly: true })
  } catch (err) {
    state.plr = null
    renderError(err)
  } finally {
    state.busy = false
  }
}

// Map click — pick a new point; always resolves to its Kiez.
async function pickAt(lon, lat) {
  await locateAt({ lat, lon, accuracy: null }, { fly: false })
}

// Shared: resolve a position → Kiez, move the map, render the card.
async function locateAt(pos, { fly = false } = {}) {
  const mine = ++_seq
  state.level = 'kiez'
  if (!kiezeFC()) { state.plr = null; renderDataError(); return } // data never loaded ≠ outside Berlin
  const kiez = findKiez(pos.lon, pos.lat)
  // Prefer a precise OSM-defined Kiez (e.g. Scheunenviertel) when standing inside
  // one — finer than a Planungsraum; else the merged Planungsraum-group.
  const osm = kiez ? findOsmKiez(pos.lon, pos.lat) : null
  const area = osm || (kiez ? kiezAreaFor(kiez) : null)
  const kiezName = osm ? osm.properties.name : null
  state.kiezArea = area

  if (state.map) {
    if (fly) state.map.lockOn(pos.lon, pos.lat, area)
    else state.map.goTo(pos.lon, pos.lat, area, { fit: state.autoZoom })
  }

  if (!kiez) {
    state.plr = null
    renderOutside({ pos, openSheet: fly })
    return
  }

  // geolocation check-in (fly) opens the sheet for the lock-on; a map-pick keeps
  // the current sheet state so the map you're exploring stays visible
  // Schnitzeljagd: nur der echte Standort-Check-in entdeckt POIs
  if (fly) discoverAt(pos)
  renderFound({ kiez, pos, kiezName, address: null, openSheet: fly }) // title precomputed → instant
  const address = await reverseGeocode(pos.lat, pos.lon).catch(() => null)
  if (mine !== _seq) return
  // always resolve the pending "wird ermittelt …" — even a null/empty geocode
  patchAddress(address && address.line ? address.line : '—')
}

// POI-Karte: Klick auf einen Kartenpunkt der Schnitzeljagd
function renderPoi(qid) {
  const p = state.poiList && state.poiList.find((x) => x.qid === qid)
  if (!p) return
  const done = isVisited(state.hunt, p.qid)
  const kat = (poisData() && poisData().kat[p.kat]) || 'Ort'
  const back = h('button', { class: 'btn btn-filled', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.loc }), 'Mein Standort')
  back.addEventListener('click', () => checkIn())
  const show = h('button', { class: 'btn btn-tonal', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.target }), 'Auf Karte zentrieren')
  show.addEventListener('click', () => state.map && state.map.flyToPoi(p.lon, p.lat))
  setCard(
    h('div', { class: 'pass-body pass-found' },
      h('div', { class: 'stamp' + (done ? '' : ' stamp--void'), 'aria-hidden': 'true' },
        h('span', { class: 'stamp-ring' }), h('span', { class: 'stamp-pin', html: ICONS.pin })),
      h('p', { class: 'eyebrow', 'data-reveal': '', text: (done ? '✓ Entdeckt · ' : 'Schnitzeljagd · ') + kat }),
      h('h1', { class: 'kiez-name', 'data-reveal': '', text: p.name }),
      p.desc ? h('p', { class: 'muted', 'data-reveal': '', text: p.desc }) : null,
      h('p', { class: 'hint', 'data-reveal': '', text: done
        ? 'Diesen Ort hast du bereits besucht.'
        : `Noch nicht entdeckt — komm auf ${RADIUS_M} m heran und checke ein.` }),
      h('div', { class: 'actions' }, back, show),
      h('p', { class: 'source', 'data-reveal': '', html:
        'POI-Auswahl: Wikidata (CC0) · Beschreibung: Wikidata' }),
    )
  )
  const meta = passScroll.querySelector('.source')
  if (meta) meta.append(' · ', h('a', { class: 'about-a', href: poiUrl(p), target: '_blank', rel: 'noopener', text: 'Wikipedia' }))
}

// ── theme toggle with MD3-expressive circular reveal (View Transitions) ──────
function updateThemeColor(theme) {
  let m = document.querySelector('meta[name="theme-color"]:not([media])')
  if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'theme-color'); document.head.appendChild(m) }
  m.setAttribute('content', theme === 'dark' ? '#0b0e14' : '#f3f4fb')
}
// Fallback ohne View Transitions (ältere Browser): ein einzelner, einfarbiger
// Kreis-Layer wächst per clip-path vom Button auf (compositor-only), darunter
// wird unsichtbar das Theme gewechselt + die Karte umgefärbt, dann blendet der
// Kreis weich aus — 1:1 der themeRipple der celox-Website, Farben = Kiez-Tokens.
let themeRippleActive = false
let fauxThemeTok = 0 // guards rapid re-toggles: only the latest restyle removes the faux-map filter
let themeBusy = false // cooldown: a theme switch fully serializes (see the click handler)
function themeRipple(next, x, y, end, swap, restyle) {
  themeRippleActive = true
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;inset:0;z-index:9999;pointer-events:none;' +
    `background:${next === 'dark' ? '#0b0e14' : '#f3f4fb'};` +
    `clip-path:circle(0px at ${x}px ${y}px);will-change:clip-path,opacity;`
  document.body.appendChild(el)
  const cleanup = () => { el.remove(); themeRippleActive = false }
  el.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
    { duration: 420, easing: 'cubic-bezier(0.22, 0.08, 0, 1)', fill: 'forwards' }
  ).finished
    .then(() => {
      swap(); restyle()
      return el.animate({ opacity: [1, 0] }, { duration: 260, delay: 60, easing: 'ease-out', fill: 'forwards' }).finished
    })
    .then(cleanup)
    .catch(() => { swap(); restyle(); cleanup() })
}

function applyTheme(next, origin) {
  // Update STATE synchronously so the next toggle always computes the right
  // direction — the View Transition snapshots the full-screen WebGL map and can
  // run its callback late/aborted, which previously lost every other toggle.
  state.theme = next
  try { localStorage.setItem('kf-theme', next) } catch (e) {}
  themeBtn.innerHTML = next === 'dark' ? ICONS.sun : ICONS.moon
  updateThemeColor(next)
  // always target the *current* theme (not the captured `next`) so a late/stale
  // transition callback from an overlapping toggle can't overwrite a newer flip.
  // Faux-Map-Theme: das WebGL-Canvas kann erst NACH der Transition echt
  // restylen — swap() legt sofort einen invert-Filter aufs Canvas (nähert
  // dark-matter ↔ positron an), damit der Kreis auch über der KARTE das neue
  // Theme aufdeckt; entfernt, sobald der echte Style geladen ist (setTheme).
  const swap = () => {
    document.documentElement.setAttribute('data-theme', state.theme)
    // Ein noch aktives Veil vom VORHERIGEN Wechsel muss hier weg (läuft im
    // VT-Callback → der alte Snapshot behält den Veil-Look, die neue Seite
    // zeigt das Canvas): sonst deckt es mit seinem festen alten Look den
    // ganzen Reveal ab und wird danach hart weggerissen.
    if (state.map) state.map.dropVeil()
    // Filter nur, wenn die Karte das Ziel-Theme noch NICHT hat — nach einem
    // schnellen Hin-und-zurück-Toggle rendert das Canvas schon das Ziel;
    // blindes Invertieren zeigte dann das falsche Theme (und snappte hart)
    app.classList.toggle('map-faux-theme', !!state.map && state.map.theme !== state.theme)
  }
  // Returns a promise that resolves when the map restyle (setStyle + tile load
  // + veil fade) is COMPLETE. The cooldown waits for this whole thing: two
  // overlapping restyles race MapLibre's setStyle (+ veil placement) even when
  // the View Transitions themselves don't overlap — that was the remaining
  // "harter Wechsel"-Bug when re-toggling right after the visible reveal while
  // the previous restyle was still running in the background.
  const restyle = () => {
    const tok = ++fauxThemeTok
    const unfaux = () => { if (tok === fauxThemeTok) app.classList.remove('map-faux-theme') }
    if (!state.map) { unfaux(); return Promise.resolve() }
    // Veil-Restyle: der Live-Canvas-Filter darf erst fallen, wenn das
    // eingefrorene Veil das Canvas deckt — sonst blitzt die restylende Karte
    // durch (alter Look / halbgeladene Tiles = harter Flash nach dem Reveal)
    return Promise.resolve(state.map.setThemeVeiled(state.theme, unfaux))
      .catch(() => {}).finally(() => {
        unfaux() // belt & braces if the veil path bailed early
        // Heat-Rampe + Legende sind theme-abhängig → nach dem Restyle neu anwenden
        if (state.heat !== 'off') applyHeat(state.heat)
      })
  }
  if (reduceMotion()) { swap(); return restyle() }
  const x = origin ? origin.x : innerWidth - 40
  const y = origin ? origin.y : 40
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  if (!document.startViewTransition) {
    return new Promise((resolve) => themeRipple(next, x, y, end, swap, () => restyle().finally(resolve)))
  }
  // celox-Reveal: Desktop 900 ms, Mobile/Touch 520 ms (entschlackt gegen
  // Ruckeln — html.theme-transition schaltet währenddessen backdrop-filter ab)
  const dur = matchMedia('(max-width: 768px), (pointer: coarse)').matches ? 520 : 900
  return new Promise((resolve) => {
    document.documentElement.classList.add('theme-transition')
    let swapped = false
    const t = document.startViewTransition(() => { swap(); swapped = true })
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: dur, easing: 'cubic-bezier(0.22, 0.08, 0, 1)', pseudoElement: '::view-transition-new(root)' }
      )
    }).catch(() => {})
    // never let a stuck VT strand the palette. 2500ms, NOT weniger: der
    // VT-Callback (Snapshot der WebGL-Seite) braucht auf beschäftigter GPU
    // real >600ms (gemessen 611ms) — feuert der Timer vor dem Callback, passiert
    // der komplette Swap OHNE Animation (= harter Wechsel bei schnellen Toggles)
    const fb = setTimeout(() => { if (!swapped) { swap(); swapped = true } }, 2500)
    // guarantee the swap + map restyle even if the VT is skipped/aborted; the
    // cooldown holds until restyle() settles (full serialization, no race)
    t.finished.catch(() => {}).finally(() => {
      clearTimeout(fb); if (!swapped) swap()
      document.documentElement.classList.remove('theme-transition')
      restyle().finally(resolve)
    })
  })
}

themeBtn.addEventListener('click', (e) => {
  // Cooldown: ein Theme-Wechsel läuft VOLLSTÄNDIG durch (Reveal + der ganze
  // Karten-Restyle: setStyle + Tile-Load + Veil-Fade), bevor der nächste
  // startet. Sonst racen zwei setStyle-Aufrufe + zwei Veil-Platzierungen —
  // auch wenn die View Transitions dank Guard NICHT mehr überlappen (das war
  // der verbleibende „harte Wechsel", wenn man direkt nach dem sichtbaren
  // Reveal erneut klickt, während der Hintergrund-Restyle noch lief). Auf
  // echter Hardware ~2–4 s; der Safety-Timeout (16 s) löst nur einen echten
  // Hänger (z.B. Tab im Hintergrund → VT-Snapshot pausiert) und liegt bewusst
  // ÜBER der gebundenen Worst-Case-Summe (Reveal + 3 s Snapshot + 4 s setTheme
  // + 4 s Unveil), damit er eine legitime Auflösung nie vorzeitig freigibt.
  if (themeRippleActive || themeBusy) return
  themeBusy = true
  themeBtn.classList.add('busy') // visuelles Feedback: Klick bewusst gesperrt
  const release = () => { themeBusy = false; themeBtn.classList.remove('busy'); clearTimeout(safety) }
  const safety = setTimeout(release, 16000)
  // Origin = Klickpunkt (wie celox); Tastatur-Klicks (clientX/Y = 0) → Button-Mitte
  const r = themeBtn.getBoundingClientRect()
  const x = e.clientX || r.left + r.width / 2
  const y = e.clientY || r.top + r.height / 2
  Promise.resolve(applyTheme(state.theme === 'dark' ? 'light' : 'dark', { x, y }))
    .catch(() => {}).finally(release)
})

// ── sector overlay toggle: aus → Bezirke → Bezirksregionen → Kieze ────────────
const OVERLAY_ORDER = ['off', 'bezirke', 'bzr', 'kiez']
// label suffix L/M/S = how coarse→fine the highlighted area is
const OVERLAY_META = {
  off:     { label: '',             aria: 'aus',             next: 'Bezirke einblenden' },
  bezirke: { label: 'Bezirke (L)',  aria: 'Bezirke',         next: 'Bezirksregionen einblenden' },
  bzr:     { label: 'Regionen (M)', aria: 'Bezirksregionen', next: 'Kieze einblenden' },
  kiez:    { label: 'Kieze (S)',    aria: 'Kieze',           next: 'Flächen ausblenden' },
}
const OVERLAY_LEVEL_LABEL = { bezirke: 'Bezirk', bzr: 'Bezirksregion', kiez: 'Kiez' }
// the topbar only moves on resize — cache its bottom edge instead of forcing a
// layout read inside the chip's per-frame retry loop
let _topbarBottom = -1
function positionAreaChip() {
  if (_topbarBottom < 0) _topbarBottom = topbar.getBoundingClientRect().bottom
  areaChip.style.top = (_topbarBottom + 8) + 'px'
}
// Update the chip from the area under the map centre. Returns false if nothing was
// found (e.g. fill not painted yet, or no area there) WITHOUT hiding — the caller
// decides, so panning over not-yet-loaded tiles keeps the last label (no flicker).
function applyAreaChip() {
  if (!state.map || !state.overlayReady) return false
  const a = state.map.areaAtCenter(state.overlay)
  if (!a || !a.name) return false
  areaChipDot.style.background = a.col
  areaChipName.textContent = a.name
  areaChipLevel.textContent = OVERLAY_LEVEL_LABEL[state.overlay] || ''
  positionAreaChip()
  areaChip.hidden = false
  return true
}
// Refresh on move/toggle: try now, then retry on rAF until the area lands (tiles
// for a new viewport / a freshly-shown layer take a few frames). Only hide after
// the deadline with still nothing (genuinely outside an area).
// Wall mode repurposes the chip as an Ost/West side readout for the map centre —
// pure point-in-polygon against the stitched West-Berlin ring (no rendered-tile
// timing involved, so no retry loop needed).
function applyWallChip() {
  if (!state.map || !state.wallData || !state.wallData.west) { areaChip.hidden = true; return }
  // Die Plakette zeigt die Seite des MARKERS (Standort/ausgewählter Punkt) —
  // wie der Sektor-Stempel in der Card (beide nutzen state.pos). Vorher las
  // sie die Kartenmitte: nach Lock-on/Fit verschiebt das Panel-/Sheet-Padding
  // die Mitte vom Marker weg, nahe der Mauer auf die FALSCHE Seite → Plakette
  // widersprach Stempel und Marker. Ohne Marker (Boot/Fehler) Fallback: Mitte.
  const [lon, lat] = state.pos ? [state.pos.lon, state.pos.lat] : state.map.centerLngLat()
  const west = pointInGeometry(state.wallData.west.geometry, lon, lat)
  // precise Ost polygon (Berlin minus wall ring — correctly puts the DDR-run
  // West-Staaken exclave in the East); fallback: any Kiez hit = within Berlin
  const ost = !west && (state.wallData.ost
    ? pointInGeometry(state.wallData.ost.geometry, lon, lat)
    : !!findKiez(lon, lat))
  if (!west && !ost) { areaChip.hidden = true; return } // outside Berlin
  areaChipDot.style.background = west ? '#f2efe4' : '#2b2b2b'
  areaChipName.textContent = west ? 'West-Berlin' : 'Ost-Berlin'
  areaChipLevel.textContent = '1989'
  positionAreaChip()
  areaChip.hidden = false
}

let _chipRaf = 0
function refreshAreaChip() {
  if (_chipRaf) { cancelAnimationFrame(_chipRaf); _chipRaf = 0 }
  if (state.wall) { applyWallChip(); return }
  const heatOn = state.heat !== 'off' && metricByKey(state.heat)
  if (state.overlay === 'off' && !heatOn) { areaChip.hidden = true; return }
  const apply = heatOn ? applyHeatChip : applyAreaChip
  const deadline = performance.now() + 1500
  const tick = () => {
    _chipRaf = 0
    if (apply()) return
    if (performance.now() < deadline) { _chipRaf = requestAnimationFrame(tick); return }
    areaChip.hidden = true
  }
  tick()
}
function applyOverlay(mode) {
  // the colour choropleth is meaningless under the B&W wall filter → the two
  // modes are mutually exclusive; turning an overlay on leaves wall mode
  if (mode !== 'off' && state.wall) { state.overlayBeforeWall = null; applyWall(false) }
  // ebenso exklusiv zur Heatmap (zwei konkurrierende Vollflächen-Färbungen)
  if (mode !== 'off' && state.heat !== 'off') applyHeat('off')
  state.overlay = mode
  try { localStorage.setItem('kf-overlay', mode) } catch (e) {}
  const m = OVERLAY_META[mode]
  overlayBtn.setAttribute('data-mode', mode)
  overlayBtn.setAttribute('title', m.next)
  overlayBtn.setAttribute('aria-label', `Flächen einblenden: ${m.aria}. Tippen für: ${m.next}`)
  overlayLabelEl.textContent = m.label
  if (state.map && state.overlayReady) state.map.setOverlayMode(mode)
  refreshAreaChip()
}
overlayBtn.addEventListener('click', () => {
  const i = OVERLAY_ORDER.indexOf(state.overlay)
  applyOverlay(OVERLAY_ORDER[(i + 1) % OVERLAY_ORDER.length])
})

// ── Berliner Mauer 1989: retro B&W view mode ─────────────────────────────────
async function applyWall(on) {
  if (on && state.heat !== 'off') applyHeat('off') // Heatmap-Farben wären unterm S/W-Filter sinnlos
  state.wall = on
  try { localStorage.setItem('kf-wall', on ? '1' : '0') } catch (e) {}
  wallBtn.setAttribute('aria-pressed', String(on))
  wallBtn.classList.toggle('is-active', on)
  app.classList.toggle('wall-mode', on)
  if (on && state.overlay !== 'off') {
    state.overlayBeforeWall = state.overlay // restore when leaving wall mode
    applyOverlay('off')
  } else if (!on && state.overlayBeforeWall) {
    const prev = state.overlayBeforeWall
    state.overlayBeforeWall = null
    if (state.overlay === 'off') applyOverlay(prev)
  }
  if (on && !state.wallData) {
    try {
      state.wallData = await loadWall()
    } catch (e) {
      // data unavailable (offline first use) — back out cleanly, retry on next tap
      state.wall = false
      wallBtn.setAttribute('aria-pressed', 'false')
      wallBtn.classList.remove('is-active')
      app.classList.remove('wall-mode')
      return
    }
    if (!state.wall) return // toggled off again while the data was loading
    await state.map.setWallData(state.wallData)
    updateSectorStamp() // the visible card rendered before the data existed
  }
  if (state.map) state.map.setWallMode(state.wall)
  refreshAreaChip()
}
wallBtn.addEventListener('click', () => applyWall(!state.wall))

// ── Heatmap: Choroplethen je Planungsraum (Dichte/Alter/U18/65+/Miete/BRW) ────
let _heatReady = false
function heatValues(key) {
  return state.heatFC.features.map((f) => f.properties[key]).filter((v) => v != null)
}
function renderHeatPop() {
  const mk = (key, label) => {
    const active = state.heat === key
    const b = h('button', {
      class: 'heat-item' + (active ? ' is-active' : ''), type: 'button', role: 'menuitemradio',
      aria: { checked: String(active) },
    }, key !== 'off' ? h('span', { class: 'heat-dot', 'aria-hidden': 'true' }) : null, label)
    if (key !== 'off') {
      // Mini-Vorschau: Punkt in der Mitte der aktiven Theme-Rampe
      b.querySelector('.heat-dot').style.background = RAMPS[state.theme][4]
    }
    b.addEventListener('click', () => { applyHeat(key); closeHeatPop() })
    return b
  }
  heatPop.replaceChildren(
    h('p', { class: 'heat-pop-title', text: 'Heatmap' }),
    mk('off', 'Aus'),
    ...METRICS.map((m) => mk(m.key, m.label)))
}
function openHeatPop() {
  renderHeatPop()
  // unter dem Button ausrichten (rechtsbündig zur Action-Reihe)
  const r = heatBtn.getBoundingClientRect()
  heatPop.style.top = (r.bottom + 8) + 'px'
  heatPop.style.right = Math.max(8, innerWidth - r.right) + 'px'
  heatPop.hidden = false
  heatBtn.setAttribute('aria-expanded', 'true')
}
function closeHeatPop() {
  heatPop.hidden = true
  heatBtn.setAttribute('aria-expanded', 'false')
}
heatBtn.addEventListener('click', () => (heatPop.hidden ? openHeatPop() : closeHeatPop()))
document.addEventListener('click', (e) => {
  if (!heatPop.hidden && !heatPop.contains(e.target) && !heatBtn.contains(e.target)) closeHeatPop()
})
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !heatPop.hidden) closeHeatPop() })

function applyHeat(key) {
  // exklusiv zu Mauer-Modus und Farb-Overlay (drei konkurrierende Vollflächen-Looks)
  if (key !== 'off') {
    if (state.wall) { state.overlayBeforeWall = null; applyWall(false) }
    if (state.overlay !== 'off') applyOverlay('off')
  }
  state.heat = key
  try { localStorage.setItem('kf-heat', key) } catch (e) {}
  const metric = metricByKey(key)
  heatBtn.classList.toggle('is-active', !!metric)
  if (!metric) {
    state.heatBreaks = null
    if (state.map) state.map.setHeatMode(false)
    heatLegend.hidden = true
    refreshAreaChip()
    return
  }
  if (!_heatReady || !state.map) return // Daten kommen noch — Boot ruft erneut
  const values = heatValues(key)
  const breaks = quantileBreaks(values, 7)
  state.heatBreaks = breaks
  state.map.setHeatMode(true, heatPaint(key, breaks, state.theme))
  const leg = legendFor(metric, breaks, values, state.theme)
  if (leg) {
    legendTitle.textContent = leg.title
    legendBar.replaceChildren(...leg.colors.map((c) => {
      const s = h('span', { class: 'legend-swatch' }); s.style.background = c; return s
    }))
    legendMin.textContent = leg.min
    legendMax.textContent = leg.max + ' ' + leg.unit
    const stand = standFor(metric, statsData(), preiseData())
    legendStand.textContent = stand ? `Stand ${stand} · je Planungsraum` : 'je Planungsraum'
    heatLegend.hidden = false
  }
  refreshAreaChip()
}

// Chip im Heat-Modus: PLR unter der Kartenmitte + Wert der aktiven Metrik
function applyHeatChip() {
  const metric = metricByKey(state.heat)
  if (!state.map || !metric) return false
  const hit = state.map.heatAtCenter()
  if (!hit || !hit.name) return false
  const v = hit.props[state.heat]
  areaChipDot.style.background = v != null && state.heatBreaks
    ? RAMPS[state.theme][Math.min(classIndex(v, state.heatBreaks), RAMPS[state.theme].length - 1)]
    : 'transparent'
  areaChipName.textContent = hit.name
  areaChipLevel.textContent = v != null ? `${metric.fmt(v)} ${metric.unit}` : 'keine Daten'
  positionAreaChip()
  areaChip.hidden = false
  return true
}

// ── Auto-Zoom toggle: frame the tapped Kiez on a map-tap, or leave the camera ──
function applyAutoZoom(on) {
  state.autoZoom = on
  try { writeBoolPref(localStorage, 'kf-autozoom', on) } catch (e) {}
  autoZoomBtn.classList.toggle('is-active', on)
  autoZoomBtn.setAttribute('aria-pressed', String(on))
  autoZoomBtn.setAttribute('title', on ? 'Auto-Zoom beim Antippen: an' : 'Auto-Zoom beim Antippen: aus')
}
autoZoomBtn.addEventListener('click', () => applyAutoZoom(!state.autoZoom))

// ── search controller ────────────────────────────────────────────────────────
const TYPE_ICON = { bez: ICONS.layers, bzr: ICONS.layers, pgr: ICONS.layers, kiez: ICONS.pin, plr: ICONS.pin, str: ICONS.road }
let _hits = [], _active = -1

function highlightMatch(label, query) {
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const fq = fold(query.trim())
  const i = fq ? fold(label).indexOf(fq) : -1
  if (i < 0) return document.createTextNode(label)
  const frag = document.createDocumentFragment()
  frag.append(document.createTextNode(label.slice(0, i)))
  const mk = document.createElement('mark'); mk.textContent = label.slice(i, i + fq.length); frag.append(mk)
  frag.append(document.createTextNode(label.slice(i + fq.length)))
  return frag
}

function setActive(i) {
  _active = i
  const items = searchResults.querySelectorAll('.search-item')
  items.forEach((el, k) => {
    el.classList.toggle('is-active', k === i)
    el.setAttribute('aria-selected', String(k === i)) // listbox contract for screen readers
  })
  if (i >= 0 && items[i]) {
    items[i].scrollIntoView({ block: 'nearest' })
    searchInput.setAttribute('aria-activedescendant', items[i].id)
  } else searchInput.removeAttribute('aria-activedescendant')
}

function renderSearchResults(hits) {
  _hits = hits; _active = -1
  if (!hits.length) {
    searchResults.replaceChildren(); searchResults.hidden = true
    searchInput.setAttribute('aria-expanded', 'false')
    return
  }
  const items = hits.map((e, i) => {
    const item = h('button', { class: 'search-item', type: 'button', role: 'option', id: 'sr-' + i, 'aria-selected': 'false' },
      h('span', { class: 'search-item-icon', 'aria-hidden': 'true', html: TYPE_ICON[e.type] || ICONS.pin }),
      h('span', { class: 'search-item-text' },
        h('span', { class: 'search-item-name' }, highlightMatch(e.label, searchInput.value)),
        e.sub ? h('span', { class: 'search-item-sub', text: e.sub }) : null),
      h('span', { class: 'search-item-type', text: e.typeLabel }))
    item.addEventListener('click', () => selectPlace(e))
    item.addEventListener('pointermove', () => { if (_active !== i) setActive(i) })
    return item
  })
  searchResults.replaceChildren(...items)
  searchResults.hidden = false
  searchInput.setAttribute('aria-expanded', 'true')
}

function selectPlace(e) {
  searchResults.hidden = true
  searchInput.setAttribute('aria-expanded', 'false')
  searchInput.value = e.label
  searchClear.hidden = false
  searchInput.blur()
  state.selectedPlace = e
  if (e.type === 'str') { selectStreet(e); return }
  if (state.map) state.map.highlight(e.feature, { fit: true })
  renderPlace(e)
}

// A street has no LOR polygon — resolve its Kiez from the on-street point,
// highlight that, and frame the camera on the street's own extent.
function selectStreet(e) {
  state.plr = null
  const [lon, lat] = e.pt
  const kiez = kiezeFC() ? findKiez(lon, lat) : null
  const osm = kiez ? findOsmKiez(lon, lat) : null
  const area = osm || (kiez ? kiezAreaFor(kiez) : null)
  state.kiezArea = area
  const kiezLabel = osm ? osm.properties.name
    : kiez ? (kiez.properties.kiez || kiez.properties.plr_name) : null
  const frame = () => state.map && state.map.frameStreet(lon, lat, area, e.bbox)
  frame()
  // Stats des aufgelösten Kiezes, in dem die Straße liegt
  const stats = osm ? { level: 'kiez', name: osm.properties.name, osmGeom: osm.geometry }
    : kiez ? { level: 'kiez', sel: selectorFor('kiez', kiez), name: kiezLabel } : null
  renderPlace(e, { sub: 'in ' + [kiezLabel, e.sub].filter(Boolean).join(' · '), onCenter: frame, stats })
}

function renderPlace(e, opts = {}) {
  state.plr = null
  const back = h('button', { class: 'btn btn-filled', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.loc }), 'Mein Standort')
  back.addEventListener('click', () => { searchInput.value = ''; searchClear.hidden = true; checkIn() })
  const center = h('button', { class: 'btn btn-tonal', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.target }), 'Auf Karte zentrieren')
  center.addEventListener('click', () => { if (!state.map) return; opts.onCenter ? opts.onCenter() : state.map.fitTo(e.feature) })
  const subText = opts.sub != null ? opts.sub
    : e.sub ? (e.sub === 'Berlin' ? 'Berliner Bezirk' : `in ${e.sub}`) : null
  setCard(
    h('div', { class: 'pass-body pass-found' },
      h('div', { class: 'stamp', 'aria-hidden': 'true' },
        h('span', { class: 'stamp-ring' }), h('span', { class: 'stamp-pin', html: ICONS.pin })),
      h('p', { class: 'eyebrow', 'data-reveal': '', text: 'Ausgewählt · ' + e.typeLabel }),
      h('h1', { class: 'kiez-name', 'data-reveal': '', text: e.label }),
      subText ? h('p', { class: 'muted', 'data-reveal': '', text: subText }) : null,
      buildStatsBlock(),
      h('div', { class: 'actions' }, back, center),
      h('p', { class: 'source', 'data-reveal': '', html: e.type === 'str'
        ? 'Straßen: © OpenStreetMap-Mitwirkende (ODbL) · Grenzen: LOR 2021 · Geoportal Berlin'
        : 'Grenzen: LOR 2021 · Geoportal Berlin / Amt für Statistik Berlin-Brandenburg' }),
    )
  )
  // Suche: Stats der gewählten Einheit; Straße: Stats ihres aufgelösten Kiezes.
  // Feiner OSM-Kiez (kein gid) → geodätische Fläche + Wikipedia statt Amtszahlen.
  const osmPick = e.type === 'kiez' && e.feature && e.feature.properties.gid == null && e.feature.geometry
  const selection = opts.stats !== undefined ? opts.stats
    : osmPick ? { level: 'kiez', name: e.label, osmGeom: e.feature.geometry }
      : e.feature ? { level: e.type, sel: selectorForFeature(e.type, e.feature), name: e.label } : null
  patchStats(selection)
  Promise.all([loadStats(), loadKiezInfo(), loadPreise()]).then(() => {
    if (_statsEls && document.contains(_statsEls.root)) patchStats(selection)
  })
}

// debounce the fuzzy scan (~950 entries) while typing; clearing stays instant
let _searchTimer = 0
function runSearch() {
  _searchTimer = 0
  if (!state.searchReady) return
  renderSearchResults(searchInput.value.trim() ? search(searchInput.value, 8) : [])
}
searchInput.addEventListener('input', () => {
  searchClear.hidden = !searchInput.value
  if (_searchTimer) clearTimeout(_searchTimer)
  if (!searchInput.value.trim()) { runSearch(); return }
  _searchTimer = setTimeout(runSearch, 120)
})
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim() && state.searchReady && _hits.length) { searchResults.hidden = false; searchInput.setAttribute('aria-expanded', 'true') }
})
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (_hits.length) setActive((_active + 1) % _hits.length) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (_hits.length) setActive((_active - 1 + _hits.length) % _hits.length) }
  else if (e.key === 'Enter') {
    // flush a pending debounce so Enter acts on the freshly typed query, not stale hits
    if (_searchTimer) { clearTimeout(_searchTimer); runSearch() }
    const e2 = _hits[_active] || _hits[0]; if (e2) { e.preventDefault(); selectPlace(e2) }
  }
  else if (e.key === 'Escape') { e.preventDefault(); if (searchResults.hidden) { searchInput.value = ''; searchClear.hidden = true } else { searchResults.hidden = true; searchInput.setAttribute('aria-expanded', 'false') } }
})
searchClear.addEventListener('click', () => {
  searchInput.value = ''; searchClear.hidden = true
  renderSearchResults([]); searchInput.focus()
})
// the whole pill is tappable — clicking the icon or padding focuses the input too
searchBox.addEventListener('pointerdown', (e) => {
  if (e.target === searchInput || e.target.closest('.search-clear')) return
  e.preventDefault()
  searchInput.focus()
})
document.addEventListener('click', (e) => {
  if (!searchBox.contains(e.target)) { searchResults.hidden = true; searchInput.setAttribute('aria-expanded', 'false') }
})

// ── install prompt (bespoke, not the browser default mini-infobar) ───────────
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  state.deferredInstall = e
  installBtn.hidden = false
})
installBtn.addEventListener('click', async () => {
  if (!state.deferredInstall) return
  state.deferredInstall.prompt()
  await state.deferredInstall.userChoice
  // the event is single-use — hide the button either way (a dead button is worse;
  // the browser re-fires beforeinstallprompt when install becomes possible again)
  installBtn.hidden = true
  state.deferredInstall = null
})
window.addEventListener('appinstalled', () => { installBtn.hidden = true })

// ── reactive card tilt (desktop fine-pointers only) ──────────────────────────
function enableTilt() {
  if (!finePointer() || reduceMotion()) return
  state.tilt = damdamper((rx, ry) => {
    card.style.setProperty('--tilt-x', rx.toFixed(2) + 'deg')
    card.style.setProperty('--tilt-y', ry.toFixed(2) + 'deg')
  })
  // measure once per hover — a per-move getBoundingClientRect forces layout and
  // reads a rect the tilt transform itself is wobbling
  let tiltRect = null
  card.addEventListener('pointerenter', () => { tiltRect = card.getBoundingClientRect() })
  card.addEventListener('pointermove', (e) => {
    const r = tiltRect || (tiltRect = card.getBoundingClientRect())
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    state.tilt.set(-py * 4, px * 4) // max ~4°
  })
  card.addEventListener('pointerleave', () => { tiltRect = null; state.tilt.set(0, 0) })
}

// ── keyboard: R rechecks ──────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase()
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); checkIn() }
})

// ── boot ───────────────────────────────────────────────────────────────────
async function boot() {
  updateThemeColor(state.theme) // match the browser chrome to the (possibly persisted) theme
  renderLocating()
  const outline = await loadOutline().catch(() => null)
  state.map = new KiezMap(mapEl, state.theme, outline)
  state.map.onPick((lon, lat) => pickAt(lon, lat))
  state.map.onMove(refreshAreaChip)
  // restore the persisted overlay mode in the button immediately (map applies once ready)
  try {
    const saved = localStorage.getItem('kf-overlay')
    if (saved && OVERLAY_ORDER.includes(saved)) state.overlay = saved
  } catch (e) {}
  applyOverlay(state.overlay)
  // restore the persisted wall mode (lazy-loads its data on first activation)
  try { if (localStorage.getItem('kf-wall') === '1') applyWall(true) } catch (e) {}
  // Bereichs-Statistiken + Wikipedia-Kurztexte (nicht-blockierend; die Karte
  // patcht sich nach, sobald sie da sind — ohne sie fehlt nur der Stats-Block)
  loadStats()
  loadKiezInfo()
  loadPreise()
  // Konto (optional): Login-Rückmeldung auswerten, dann Fortschritt mergen.
  // Alles fehlertolerant — ohne Backend bleibt die Jagd rein lokal.
  const flag = readLoginFlag()
  if (flag) { stripLoginFlag(); if (flag === 'fehler') toast('⚠️', 'Anmeldung fehlgeschlagen', 'Der Fortschritt bleibt lokal gespeichert.') }
  fetchMe().then(async (me) => {
    if (!me.authed) return
    state.account = me
    const merged = await syncProgress(state.hunt, mergeProgress)
    if (merged) {
      const before = Object.keys(state.hunt.visited).length
      state.hunt = { v: 1, visited: merged.visited }
      try { writeProgress(localStorage, state.hunt) } catch (e) {}
      if (state.map) state.map.setVisited(new Set(Object.keys(state.hunt.visited).map(Number)))
      const after = Object.keys(state.hunt.visited).length
      if (flag === 'ok') toast('☁️', `Angemeldet als ${me.name || 'dir'}`, `${after} Orte entdeckt${after > before ? ` (+${after - before} von anderen Geräten)` : ''}`)
    }
    patchHunt()
  }).catch(() => null)

  // Schnitzeljagd-POIs (nicht-blockierend; ohne sie fehlt nur die Jagd)
  loadPois().then((d) => {
    if (!d || !state.map) return
    state.poiList = d.list
    state.map.setPoiData({
      type: 'FeatureCollection',
      features: d.list.map((p) => ({
        type: 'Feature', id: p.qid,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { qid: p.qid, name: p.name, sl: p.sl },
      })),
    }).then(() => {
      state.map.setVisited(new Set(Object.keys(state.hunt.visited).map(Number)))
      patchHunt() // die Card steht ggf. schon
    })
    state.map.onPoiClick(renderPoi)
  }).catch(() => null)
  // load polygons + map shell in parallel, then check in
  await Promise.all([loadKieze().catch(() => null), state.map.whenReady()])
  // Heatmap-Daten: kieze-Geometrie + Metriken joinen, Layer anlegen, dann den
  // persistierten Modus wiederherstellen (Fehlschlag → Feature entfällt still)
  Promise.all([loadStats(), loadPreise()]).then(() => {
    const fc = buildHeatFC(kiezeFC(), statsData(), preiseData())
    if (!fc || !state.map) return
    state.map.setHeatData(fc).then(() => {
      state.heatFC = fc
      _heatReady = true
      try {
        const saved = localStorage.getItem('kf-heat')
        if (saved && saved !== 'off' && metricByKey(saved) && !state.wall) applyHeat(saved)
        else if (state.heat !== 'off') applyHeat(state.heat)
      } catch (e) {}
    })
  }).catch(() => null)
  // aggregate levels feed the level-switch highlight + sector overlay;
  // colloquial OSM Kiez names feed the accent map labels
  Promise.all([loadLevels(), loadKiezNames().catch(() => null), loadStreets().catch(() => null)]).then(([, kiezNames, streets]) => {
    const fc = levelFC()
    if (fc && state.map) {
      state.map.setOverlayData({
        bez: fc.bez, bzr: fc.bzr, areas: kiezAreasFC(), bezPts: fc.bezPts, bzrPts: fc.bzrPts, kiezNames,
      }).then(() => {
        state.overlayReady = true
        state.map.setOverlayMode(state.overlay)
        refreshAreaChip() // a restored overlay must name the area even before any pan
      })
    }
    // build the fuzzy search index across all levels + colloquial Kieze + streets
    if (fc) {
      buildSearchIndex({ kieze: kiezeFC(), areas: kiezAreasFC(), osmKieze: osmKiezeFC(), bez: fc.bez, bzr: fc.bzr, pgr: fc.pgr, streets })
      state.searchReady = true
    }
  }).catch(() => null)
  enableTilt()
  initSheetDrag()
  // coalesce resize bursts (window-edge drag, mobile URL-bar) to one pass per frame —
  // each pass does a WebGL resize + forced layout reads
  let resizeRaf = 0
  window.addEventListener('resize', () => {
    if (resizeRaf) return
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0
      state.map && state.map.resize()
      fitKiezName()
      _topbarBottom = -1 // topbar may have rewrapped — re-measure lazily
      if (!areaChip.hidden) positionAreaChip()
      if (sheetEnabled()) { measureSheet(); snapTo(sheet.state, true) }
      else { card.style.removeProperty('--sheet-y'); card.removeAttribute('data-sheet') }
    })
  })
  checkIn()
}

boot()
