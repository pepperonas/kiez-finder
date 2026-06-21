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
import { loadKieze, loadOutline, findKiez, bezirkName, kmFromBerlin } from './kiez.js'
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
}

const state = {
  map: null,
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
  deferredInstall: null,
  busy: false,
  tilt: null,
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

const topbar = h('header', { class: 'topbar' },
  h('a', { class: 'brand', href: '/', aria: { label: 'Kiez-Finder Startseite' } },
    h('span', { class: 'brand-mark', html: ICONS.pin }),
    h('span', { class: 'brand-name' },
      h('strong', { text: 'Kiez' }), h('span', { text: '-Finder' }))),
  h('div', { class: 'topbar-actions' }, installBtn, themeBtn),
)

const mapEl = h('div', { id: 'map', aria: { hidden: 'true' } })
const card = h('section', { class: 'pass', aria: { live: 'polite' } })
const stage = h('div', { class: 'stage' }, card)

app.append(mapEl, stage, topbar)

// ── state renderers ─────────────────────────────────────────────────────────
function setCard(node, animate = true) {
  card.replaceChildren(node)
  if (animate && !reduceMotion()) {
    const rows = node.querySelectorAll('[data-reveal]')
    if (rows.length) revealStagger([...rows])
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

function renderFound({ kiez, pos, address }) {
  const p = kiez.properties
  const coordsEl = h('span', { class: 'coords-val', text: '52.00000, 13.00000' })

  const recheck = h('button', { class: 'btn btn-filled', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.refresh }), 'Erneut einchecken')
  recheck.addEventListener('click', () => checkIn())

  const showMap = h('button', { class: 'btn btn-tonal', type: 'button', 'data-reveal': '' },
    h('span', { class: 'btn-icon', html: ICONS.target }), 'Auf Karte zeigen')
  showMap.addEventListener('click', () => state.map && state.map.recenter())

  const body = h('div', { class: 'pass-body pass-found' },
    h('div', { class: 'stamp', 'aria-hidden': 'true' },
      h('span', { class: 'stamp-ring' }), h('span', { class: 'stamp-pin', html: ICONS.pin })),
    h('p', { class: 'eyebrow', 'data-reveal': '', text: 'Du stehst im Kiez' }),
    h('h1', { class: 'kiez-name', 'data-reveal': '', text: p.plr_name }),
    h('div', { class: 'meta', },
      metaRow('Bezirk', bezirkName(p.bez)),
      metaRow('Bezirksregion', p.bzr_name),
      metaRow('Prognoseraum', p.pgr_name),
      address && address.line ? metaRow('Adresse', address.line) : null,
    ),
    h('div', { class: 'coords', 'data-reveal': '' },
      h('span', { class: 'coords-label', text: 'Koordinaten' }), coordsEl),
    h('div', { class: 'actions' }, recheck, showMap),
    h('p', { class: 'source', 'data-reveal': '', html:
      'Kiez-Grenzen: LOR 2021 · Geoportal Berlin / Amt für Statistik Berlin-Brandenburg' }),
  )
  setCard(body)
  // coordinate readout arrives, it doesn't just appear
  const fmt = (n) => n // placeholder, overwritten below
  tweenCoords(coordsEl, pos)
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
async function checkIn() {
  if (state.busy) return
  state.busy = true
  renderLocating()
  try {
    const pos = await getPosition()
    const kiez = findKiez(pos.lon, pos.lat)
    // start the camera flight immediately; enrich the address in parallel
    state.map && state.map.lockOn(pos.lon, pos.lat, kiez || null)
    if (kiez) {
      const address = await Promise.race([
        reverseGeocode(pos.lat, pos.lon),
        new Promise((r) => setTimeout(() => r(null), 4000)),
      ])
      renderFound({ kiez, pos, address })
    } else {
      renderOutside({ pos })
    }
  } catch (err) {
    renderError(err)
  } finally {
    state.busy = false
  }
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
  // load polygons + map shell in parallel, then check in
  await Promise.all([loadKieze().catch(() => null), state.map.whenReady()])
  enableTilt()
  window.addEventListener('resize', () => state.map && state.map.resize())
  checkIn()
}

boot()
