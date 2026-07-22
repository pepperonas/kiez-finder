// ─────────────────────────────────────────────────────────────────────────
// <ThemeScene> — EINE atmosphärische WebGL-Ebene (three.js) über der Karte,
// unter der UI (pointer-events:none). Dezente, langsam driftende Akzent-
// Partikel; Farbe/Deckkraft kommen live aus den Theme-Tokens und werden beim
// Theme-Wechsel weich gelerpt (kein Neuaufbau der Szene).
//
// Kapselt ALLE harten Constraints:
//  · three.js NUR dynamisch importiert (eigener Chunk, kein Initial-Bundle).
//  · Start erst nach requestIdleCallback (First Paint der Karte bleibt frei).
//  · prefers-reduced-motion / kein WebGL / Context-Loss → statisches CSS-
//    Gradient-Fallback (data-fallback), three.js wird gar nicht geladen.
//  · Pausiert bei document.hidden UND wenn die Ebene außer Sicht ist (IO).
//  · Mobile: reduzierte Partikelzahl + DPR ≤ 2 (via resolvedPreset).
//  · Dispose räumt Geometrie/Material/Textur/Renderer vollständig ab.
//
// Vanilla (die App ist kein React) — mountThemeScene() liefert einen kleinen
// Controller { setTheme, destroy } zurück.
// ─────────────────────────────────────────────────────────────────────────
import { presetFor, resolvedPreset } from './scenePresets.js'

const MOBILE_MQ = '(max-width: 839.98px)'
const REDUCED_MQ = '(prefers-reduced-motion: reduce)'
const LERP_MS = 900 // weicher Farb-/Deckkraft-Übergang beim Theme-Wechsel

/**
 * Mountet die Ebene in `container` (fixed/absolute, pointer-events:none, über
 * der Karte). `getTheme()` liefert das aktive Theme ('dark'|'light'|'wall').
 * @returns {{ setTheme(name:string):void, destroy():void }}
 */
export function mountThemeScene({ container, getTheme }) {
  let disposed = false
  let engine = null
  let currentTheme = (getTheme && getTheme()) || 'dark'

  const controller = {
    setTheme(name) {
      currentTheme = name || 'dark'
      if (engine) engine.setTheme(currentTheme)
    },
    destroy() {
      disposed = true
      if (engine) { engine.destroy(); engine = null }
    },
  }

  const useFallback = () => container.setAttribute('data-fallback', '')
  // Reduced-motion oder kein WebGL → gar kein three.js laden, nur CSS-Fallback.
  if (matchMedia(REDUCED_MQ).matches || !hasWebGL()) { useFallback(); return controller }

  const start = () => {
    if (disposed) return
    import('three')
      .then((THREE) => {
        if (disposed) return
        try {
          engine = createEngine(THREE, container, () => currentTheme)
          engine.setTheme(currentTheme)
        } catch (e) { useFallback() }
      })
      .catch(() => useFallback()) // Chunk-Ladefehler → stiller Fallback
  }
  const ric = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ didTimeout: true }), 300))
  ric(start, { timeout: 2000 })
  return controller
}

/** Billiger WebGL-Support-Check (ohne einen Context zu behalten). */
function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')))
  } catch (e) { return false }
}

/** Token-Farbe → THREE.Color (Fallback dark-accent bei Parse-Fehler). */
function readColor(THREE, token) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  try { return new THREE.Color(raw || '#7da2ff') } catch (e) { return new THREE.Color('#7da2ff') }
}

/** Weiche, runde Partikel-Textur (Radial-Gradient auf 64² Canvas). */
function makeSprite(THREE) {
  const s = 64
  const cv = document.createElement('canvas'); cv.width = cv.height = s
  const g = cv.getContext('2d')
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd; g.fillRect(0, 0, s, s)
  const tex = new THREE.CanvasTexture(cv)
  tex.needsUpdate = true
  return tex
}

/** Der eigentliche three.js-Motor. Nur nach erfolgreichem dynamischem Import. */
function createEngine(THREE, container, getTheme) {
  const mobile = matchMedia(MOBILE_MQ).matches
  const preset = resolvedPreset(presetFor(getTheme()), { mobile })

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.dprCap))
  const canvas = renderer.domElement
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
  container.appendChild(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200)
  camera.position.z = 42

  // Partikelfeld: N Punkte in einer Box, minimale per-Partikel-Drift-Rate.
  const N = preset.particleCount
  const SPREAD_X = 62, SPREAD_Y = 42, DEPTH = preset.depth
  const positions = new Float32Array(N * 3)
  const drift = new Float32Array(N)
  const phase = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    positions[i * 3] = (Math.random() - 0.5) * SPREAD_X
    positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD_Y
    positions[i * 3 + 2] = -Math.random() * DEPTH
    drift[i] = 0.4 + Math.random() * 0.6
    phase[i] = Math.random() * Math.PI * 2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const sprite = makeSprite(THREE)
  const mat = new THREE.PointsMaterial({
    size: mobile ? 1.5 : 1.15,
    map: sprite,
    transparent: true,
    opacity: preset.opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    color: readColor(THREE, presetFor(getTheme()).accentToken),
  })
  const points = new THREE.Points(geo, mat)
  scene.add(points)

  // Theme-Lerp-Zustand (Farbe + Deckkraft), completes in LERP_MS.
  const fromColor = mat.color.clone(), toColor = mat.color.clone()
  let fromOpacity = mat.opacity, toOpacity = mat.opacity, lerpT = 1

  function setTheme(name) {
    const p = presetFor(name)
    fromColor.copy(mat.color)
    toColor.copy(readColor(THREE, p.accentToken))
    fromOpacity = mat.opacity
    toOpacity = mobile ? p.opacity : p.opacity
    lerpT = 0
  }

  function resize() {
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()

  // ── Lauf-/Pause-Gating ──
  let raf = 0, last = 0, running = false, inView = true
  const posArr = geo.attributes.position.array
  const speed = preset.speed

  function frame(ts) {
    if (!running) return
    const dt = Math.min(50, ts - last || 16); last = ts
    const dy = speed * dt * 0.001
    for (let i = 0; i < N; i++) {
      posArr[i * 3 + 1] += drift[i] * dy // sehr langsame Aufwärts-Drift
      if (posArr[i * 3 + 1] > SPREAD_Y / 2) posArr[i * 3 + 1] = -SPREAD_Y / 2
      posArr[i * 3] += Math.sin(ts * 0.00006 + phase[i]) * dy * 0.35 // zarte Seitwärts-Wiege
    }
    geo.attributes.position.needsUpdate = true
    if (lerpT < 1) {
      lerpT = Math.min(1, lerpT + dt / LERP_MS)
      mat.color.copy(fromColor).lerp(toColor, lerpT)
      mat.opacity = fromOpacity + (toOpacity - fromOpacity) * lerpT
    }
    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }
  function play() {
    if (running || document.hidden || !inView) return
    running = true; last = performance.now(); raf = requestAnimationFrame(frame)
  }
  function pause() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const onVis = () => (document.hidden ? pause() : play())
  const onResize = () => resize()
  const onLost = (e) => { e.preventDefault(); pause() }
  document.addEventListener('visibilitychange', onVis)
  window.addEventListener('resize', onResize)
  canvas.addEventListener('webglcontextlost', onLost)

  const io = new IntersectionObserver((es) => {
    inView = es[0] ? es[0].isIntersecting : true
    inView ? play() : pause()
  }, { threshold: 0 })
  io.observe(container)

  play()

  return {
    setTheme,
    destroy() {
      pause()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('webglcontextlost', onLost)
      io.disconnect()
      scene.remove(points)
      geo.dispose(); mat.dispose(); sprite.dispose()
      renderer.dispose()
      if (renderer.forceContextLoss) { try { renderer.forceContextLoss() } catch (e) {} }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      // Leak-Check: renderer.info.memory sollte danach 0 Geometrien/Texturen zeigen.
    },
  }
}
