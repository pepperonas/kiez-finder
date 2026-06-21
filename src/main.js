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
import { loadKieze, loadOutline, loadLevels, levelFC, loadKiezNames, findKiez, bezirkName,
  kmFromBerlin, featureForLevel, levelName } from './kiez.js'
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
}

const state = {
  map: null,
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
  deferredInstall: null,
  busy: false,
  tilt: null,
  plr: null,        // current Kiez feature
  pos: null,        // current position { lat, lon, accuracy }
  level: 'plr',     // active highlight level: plr | bez | bzr | pgr
  overlay: 'off',   // map sector overlay: off | bezirke | bzr
  overlayReady: false,
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

const topbar = h('header', { class: 'topbar' },
  h('a', { class: 'brand', href: '/', aria: { label: 'Kiez-Finder Startseite' } },
    h('span', { class: 'brand-mark', html: ICONS.pin }),
    h('span', { class: 'brand-name' },
      h('strong', { text: 'Kiez' }), h('span', { text: '-Finder' }))),
  h('div', { class: 'topbar-actions' }, installBtn, overlayBtn, themeBtn),
)

const mapEl = h('div', { id: 'map', aria: { hidden: 'true' } })
const card = h('section', { class: 'pass', aria: { live: 'polite' } })
// drag handle (mobile bottom-sheet grabber) + scrolling content region
const sheetHandle = h('button', {
  class: 'sheet-handle', type: 'button',
  aria: { label: 'Karte ein- oder ausklappen', expanded: 'true' },
})
const passScroll = h('div', { class: 'pass-scroll' })
card.append(sheetHandle, passScroll)
const stage = h('div', { class: 'stage' }, card)

app.append(mapEl, stage, topbar)

// delegated: clicking a hierarchy level highlights it on the map (persists across renders)
passScroll.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-level]')
  if (btn && passScroll.contains(btn)) selectLevel(btn.getAttribute('data-level'))
})

// ── state renderers ─────────────────────────────────────────────────────────
function setCard(node, animate = true) {
  passScroll.replaceChildren(node)
  requestAnimationFrame(fitKiezName)
  sheetOnRender()
  if (animate && !reduceMotion()) {
    const rows = node.querySelectorAll('[data-reveal]')
    if (rows.length) revealStagger([...rows])
  }
}

// ── mobile bottom sheet (MD3): drag handle, peek/open snap with spring ────────
const sheet = { y: 0, H: 0, peek: 0, state: 'open', entered: false, cancel: null }
function sheetEnabled() { return window.matchMedia('(max-width: 839px)').matches }
function setSheetY(y) {
  sheet.y = y
  card.style.setProperty('--sheet-y', y.toFixed(1) + 'px')
}
function measureSheet() {
  sheet.H = card.offsetHeight
  const cardTop = card.getBoundingClientRect().top
  const titleEl = card.querySelector('.level-title, .kiez-name, .locating-title') || passScroll.firstElementChild
  let peek = 176
  if (titleEl) peek = (titleEl.getBoundingClientRect().bottom - cardTop) + 20
  sheet.peek = Math.max(120, Math.min(sheet.H - 48, peek))
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
function sheetOnRender() {
  if (!sheetEnabled()) { card.style.removeProperty('--sheet-y'); card.removeAttribute('data-sheet'); return }
  requestAnimationFrame(() => {
    measureSheet()
    if (!sheet.entered) { sheet.entered = true; setSheetY(sheet.H); requestAnimationFrame(() => snapTo('open')) }
    else snapTo('open')
  })
}
function initSheetDrag() {
  let dragging = false, startY = 0, startSheetY = 0, lastY = 0, lastT = 0, vel = 0, moved = false
  const toggle = () => { if (sheetEnabled()) snapTo(sheet.state === 'open' ? 'peek' : 'open') }
  sheetHandle.addEventListener('pointerdown', (e) => {
    if (!sheetEnabled()) return
    dragging = true; moved = false
    startY = lastY = e.clientY; startSheetY = sheet.y; lastT = e.timeStamp; vel = 0
    if (sheet.cancel) { sheet.cancel(); sheet.cancel = null }
    card.classList.add('dragging')
    try { sheetHandle.setPointerCapture(e.pointerId) } catch (err) {}
  })
  sheetHandle.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dy = e.clientY - startY
    if (Math.abs(dy) > 4) moved = true
    const max = snapTarget('peek')
    let y = startSheetY + dy
    if (y < 0) y *= 0.3            // rubber-band past fully open
    else if (y > max) y = max + (y - max) * 0.3
    setSheetY(y)
    const dt = e.timeStamp - lastT
    if (dt > 0) vel = (e.clientY - lastY) / dt // px/ms
    lastY = e.clientY; lastT = e.timeStamp
  })
  const end = (e) => {
    if (!dragging) return
    dragging = false
    card.classList.remove('dragging')
    try { sheetHandle.releasePointerCapture(e.pointerId) } catch (err) {}
    if (!moved) { toggle(); return } // pointer tap → toggle here (no reliance on click)
    const max = snapTarget('peek')
    let target
    if (vel > 0.45) target = 'peek'
    else if (vel < -0.45) target = 'open'
    else target = sheet.y > max * 0.5 ? 'peek' : 'open'
    snapTo(target)
  }
  sheetHandle.addEventListener('pointerup', end)
  sheetHandle.addEventListener('pointercancel', end)
  // keyboard activation only (Enter/Space → click with detail 0); pointer taps
  // are handled in pointerup, so ignore pointer-generated clicks (detail > 0).
  sheetHandle.addEventListener('click', (e) => { if (e.detail === 0) toggle() })
}

// Shrink the Kiez title only when it would overflow (a long single word like
// "Schulenburgpark" can't wrap); multi-word names keep their full size + wrap.
function fitKiezName() {
  const el = card.querySelector('.kiez-name')
  if (!el) return
  el.style.fontSize = '' // reset to the stylesheet clamp
  const base = parseFloat(getComputedStyle(el).fontSize) || 34
  const min = Math.max(18, base * 0.5)
  let size = base, guard = 0
  while (el.scrollWidth > el.clientWidth + 1 && size > min && guard++ < 80) {
    size -= 1
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

// When OSM knows the colloquial Kiez name (e.g. "Flughafenkiez"), promote it to
// the title and demote the official LOR Planungsraum name to a subline.
let _kiezOfficialEl = null
function patchKiezName(colloquial, official) {
  const nameEl = card.querySelector('.kiez-name')
  const titleBtn = card.querySelector('.level-title')
  if (!nameEl || !colloquial || colloquial === official) return
  nameEl.textContent = colloquial
  if (_kiezOfficialEl) {
    _kiezOfficialEl.textContent = `amtl. Planungsraum · ${official}`
    _kiezOfficialEl.hidden = false
  }
  if (titleBtn) titleBtn.setAttribute('aria-label', `Kiez ${colloquial} (amtlich ${official}) auf der Karte zeigen`)
  fitKiezName()
}

function renderFound({ kiez, pos, address }) {
  state.plr = kiez
  state.pos = pos
  const p = kiez.properties
  const coordsEl = h('span', { class: 'coords-val', text: '52.00000, 13.00000' })
  const titleActive = state.level === 'plr'

  const recheck = h('button', { class: 'btn btn-filled', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.refresh }), 'Erneut einchecken')
  recheck.addEventListener('click', () => checkIn())

  const showMap = h('button', { class: 'btn btn-tonal', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.target }), 'Auf Karte zentrieren')
  showMap.addEventListener('click', () => fitActive())

  const body = h('div', { class: 'pass-body pass-found' },
    h('div', { class: 'stamp', 'aria-hidden': 'true' },
      h('span', { class: 'stamp-ring' }), h('span', { class: 'stamp-pin', html: ICONS.pin })),
    h('p', { class: 'eyebrow', 'data-reveal': '', text: 'Du stehst im Kiez' }),
    h('button', {
      class: 'level-title' + (titleActive ? ' is-active' : ''),
      type: 'button', 'data-level': 'plr', 'data-reveal': '',
      aria: { pressed: titleActive ? 'true' : 'false', label: `Kiez ${p.plr_name} auf der Karte zeigen` },
    },
      h('h1', { class: 'kiez-name', text: p.plr_name }),
      (_kiezOfficialEl = h('p', { class: 'kiez-official', hidden: true }))),
    // ordered by ascending area size (Kiez = title above; then bigger → biggest).
    // The Prognoseraum is hidden when it only duplicates the Bezirk name.
    h('div', { class: 'meta' },
      levelRow('bzr', 'Bezirksregion', p.bzr_name),
      p.pgr_name && p.pgr_name !== bezirkName(p.bez)
        ? levelRow('pgr', 'Prognoseraum', p.pgr_name) : null,
      levelRow('bez', 'Bezirk', bezirkName(p.bez)),
      addressRow(address && address.line),
    ),
    h('p', { class: 'hint', 'data-reveal': '', text:
      'Tippe eine Ebene an, um sie hervorzuheben — oder tippe auf die Karte.' }),
    h('div', { class: 'coords', 'data-reveal': '' },
      h('span', { class: 'coords-label', text: 'Koordinaten' }), coordsEl),
    h('div', { class: 'actions' }, recheck, showMap),
    h('p', { class: 'source', 'data-reveal': '', html:
      'Kiez-Grenzen: LOR 2021 · Geoportal Berlin / Amt für Statistik Berlin-Brandenburg' }),
  )
  setCard(body)
  tweenCoords(coordsEl, pos)
}

// reflect the active level in the card chrome without re-rendering (no replay)
function syncLevelUI() {
  card.querySelectorAll('[data-level]').forEach((el) => {
    const on = el.getAttribute('data-level') === state.level
    el.classList.toggle('is-active', on)
    el.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
}

async function selectLevel(level) {
  if (!state.plr || !state.map) return
  state.level = level
  syncLevelUI()
  await loadLevels().catch(() => null)
  const feature = featureForLevel(level, state.plr)
  if (feature) state.map.highlight(feature, { fit: true })
}

function fitActive() {
  if (!state.plr || !state.map) return
  const feature = featureForLevel(state.level, state.plr)
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

function renderOutside({ pos }) {
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
    )
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

// ── core flow ────────────────────────────────────────────────────────────────
let _seq = 0 // guards against out-of-order results when picks overlap

// Geolocation check-in — the dramatic lock-on flight.
async function checkIn() {
  if (state.busy) return
  state.busy = true
  renderLocating()
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
  state.level = 'plr'
  const kiez = findKiez(pos.lon, pos.lat)

  if (state.map) {
    if (fly) state.map.lockOn(pos.lon, pos.lat, kiez || null)
    else state.map.goTo(pos.lon, pos.lat, kiez || null)
  }

  if (!kiez) {
    state.plr = null
    renderOutside({ pos })
    return
  }

  renderFound({ kiez, pos, address: null }) // show instantly (official LOR name)
  const address = await reverseGeocode(pos.lat, pos.lon).catch(() => null)
  if (mine !== _seq || !address) return
  if (address.line) patchAddress(address.line)
  // promote the colloquial Kiez name to the title when OSM has one
  if (address.kiez) patchKiezName(address.kiez, kiez.properties.plr_name)
}

// ── theme toggle with MD3-expressive circular reveal (View Transitions) ──────
function applyTheme(next, origin) {
  const run = () => {
    document.documentElement.setAttribute('data-theme', next)
    state.theme = next
    try { localStorage.setItem('kf-theme', next) } catch (e) {}
    themeBtn.innerHTML = next === 'dark' ? ICONS.sun : ICONS.moon
    document.querySelector('meta[name="theme-color"]')
    state.map && state.map.setTheme(next)
  }
  if (!document.startViewTransition || reduceMotion()) { run(); return }
  const x = origin ? origin.x : innerWidth - 40
  const y = origin ? origin.y : 40
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const t = document.startViewTransition(run)
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
      { duration: 620, easing: 'cubic-bezier(0.2,0,0,1)', pseudoElement: '::view-transition-new(root)' }
    )
  })
}

themeBtn.addEventListener('click', (e) => {
  const r = themeBtn.getBoundingClientRect()
  applyTheme(state.theme === 'dark' ? 'light' : 'dark', { x: r.left + r.width / 2, y: r.top + r.height / 2 })
})

// ── sector overlay toggle: aus → Bezirke → Bezirksregionen ───────────────────
const OVERLAY_ORDER = ['off', 'bezirke', 'bzr']
const OVERLAY_META = {
  off:     { label: '',         aria: 'aus',                   next: 'Bezirke einblenden' },
  bezirke: { label: 'Bezirke',  aria: 'Bezirke',               next: 'Bezirksregionen einblenden' },
  bzr:     { label: 'Regionen', aria: 'Bezirksregionen',       next: 'Flächen ausblenden' },
}
function applyOverlay(mode) {
  state.overlay = mode
  try { localStorage.setItem('kf-overlay', mode) } catch (e) {}
  const m = OVERLAY_META[mode]
  overlayBtn.setAttribute('data-mode', mode)
  overlayBtn.setAttribute('title', m.next)
  overlayBtn.setAttribute('aria-label', `Flächen einblenden: ${m.aria}. Tippen für: ${m.next}`)
  overlayLabelEl.textContent = m.label
  if (state.map && state.overlayReady) state.map.setOverlayMode(mode)
}
overlayBtn.addEventListener('click', () => {
  const i = OVERLAY_ORDER.indexOf(state.overlay)
  applyOverlay(OVERLAY_ORDER[(i + 1) % OVERLAY_ORDER.length])
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
  const { outcome } = await state.deferredInstall.userChoice
  if (outcome === 'accepted') installBtn.hidden = true
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
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    state.tilt.set(-py * 4, px * 4) // max ~4°
  })
  card.addEventListener('pointerleave', () => state.tilt.set(0, 0))
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
  renderLocating()
  const outline = await loadOutline().catch(() => null)
  state.map = new KiezMap(mapEl, state.theme, outline)
  state.map.onPick((lon, lat) => pickAt(lon, lat))
  // restore the persisted overlay mode in the button immediately (map applies once ready)
  try {
    const saved = localStorage.getItem('kf-overlay')
    if (saved && OVERLAY_ORDER.includes(saved)) state.overlay = saved
  } catch (e) {}
  applyOverlay(state.overlay)
  // load polygons + map shell in parallel, then check in
  await Promise.all([loadKieze().catch(() => null), state.map.whenReady()])
  // aggregate levels feed the level-switch highlight + sector overlay;
  // colloquial OSM Kiez names feed the accent map labels
  Promise.all([loadLevels(), loadKiezNames().catch(() => null)]).then(([, kiezNames]) => {
    const fc = levelFC()
    if (fc && state.map) {
      state.map.setOverlayData({
        bez: fc.bez, bzr: fc.bzr, bezPts: fc.bezPts, bzrPts: fc.bzrPts, kiezNames,
      }).then(() => {
        state.overlayReady = true
        state.map.setOverlayMode(state.overlay)
      })
    }
  }).catch(() => null)
  enableTilt()
  initSheetDrag()
  window.addEventListener('resize', () => {
    state.map && state.map.resize()
    fitKiezName()
    if (sheetEnabled()) { measureSheet(); snapTo(sheet.state, true) }
    else { card.style.removeProperty('--sheet-y'); card.removeAttribute('data-sheet') }
  })
  checkIn()
}

boot()
