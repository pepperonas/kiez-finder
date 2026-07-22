// ─────────────────────────────────────────────────────────────────────────
// Heatmap (Choroplethen) — färbt ganz Berlin je Planungsraum nach einer
// Kennzahl: Dichte/Alter (aus stats.json) + Miete/Bodenrichtwert
// (aus preise.json). Kern ist PURE (injizierte Daten) und unit-testbar;
// Klassengrenzen sind QUANTILE (7 Klassen) — Berliner Verteilungen sind so
// schief, dass eine lineare Skala fast einfarbig wäre.
// ─────────────────────────────────────────────────────────────────────────

import { dpath } from './datapath.js'
let _preise = null
let _preiseP = null
export function loadPreise() {
  if (!_preiseP) {
    _preiseP = fetch(dpath('preise.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (_preise = d))
      .catch(() => null)
  }
  return _preiseP
}
export const preiseData = () => _preise

// ── Metrik-Katalog ───────────────────────────────────────────────────────────
// stand: 's' = stats.json-Stichtag · 'm'/'b' = Miete/BRW aus preise.json
const de = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })
export const METRICS = [
  { key: 'dichte', label: 'Bevölkerungsdichte', unit: 'Einw./km²', stand: 's', fmt: (v) => de(Math.round(v)) },
  { key: 'alter', label: 'Ø Alter (≈)', unit: 'Jahre', stand: 's', fmt: (v) => de(v, 1) },
  { key: 'miete', label: 'Angebotsmiete', unit: '€/m² netto kalt', stand: 'm', fmt: (v) => de(v, 2) },
  { key: 'brw', label: 'Bodenrichtwert Wohnen', unit: '€/m²', stand: 'b', fmt: (v) => de(Math.round(v)) },
]
export const metricByKey = (key) => METRICS.find((m) => m.key === key) || null

/** Welche Metriken haben für die aktuell geladenen Daten überhaupt Werte?
 *  dichte = immer (sobald stats da); alter nur mit Altersdaten; miete/brw nur mit
 *  preise.json. So zeigt das Heat-Popover in Frankfurt nur „Dichte", nicht drei
 *  leere Metriken. Pure — unit-getestet. */
export function availableMetrics(stats, preise) {
  const has = { dichte: !!stats, alter: false, miete: false, brw: false }
  if (stats) { for (const r of Object.values(stats.plr)) if (r[2] != null) { has.alter = true; break } }
  if (preise) for (const r of Object.values(preise.plr)) { if (r[0] != null) has.miete = true; if (r[1] != null) has.brw = true }
  return METRICS.filter((m) => has[m.key])
}

/** Stichtags-Text für die Legende (aus den geladenen Daten). */
export function standFor(metric, stats, preise) {
  if (!metric) return null
  if (metric.stand === 's') return stats ? stats.stand : null
  if (metric.stand === 'm') return preise ? preise.standMiete + ', Wohnatlas' : null
  return preise ? preise.standBrw : null
}

// ── Heat-FeatureCollection: kieze-Geometrie + Metrikwerte je PLR ─────────────
// Fehlende Werte werden WEGGELASSEN (kein null-Property) — die Karten-Expression
// prüft per ['has', key] und lässt „keine Daten" transparent.
export function buildHeatFC(kiezeFC, stats, preise) {
  if (!kiezeFC || !stats) return null
  const features = []
  for (const f of kiezeFC.features) {
    const id = f.properties.plr_id
    const row = stats.plr[id]
    if (!row) continue
    const props = { plr_id: id, name: f.properties.kiez || f.properties.plr_name }
    const [pop, m2, ageSum] = row
    if (pop != null && m2) props.dichte = pop / (m2 / 1e6)
    if (pop != null && ageSum != null && pop > 0) props.alter = ageSum / pop
    const pr = preise && preise.plr[id]
    if (pr) {
      if (pr[0] != null) props.miete = pr[0]
      if (pr[1] != null) props.brw = pr[1]
    }
    features.push({ type: 'Feature', geometry: f.geometry, properties: props })
  }
  return { type: 'FeatureCollection', features }
}

// ── Quantil-Klassengrenzen ───────────────────────────────────────────────────
/** k-Quantil-Grenzen (k-1 Schnittpunkte) über die Werte; dedupliziert, damit
 *  eine step-Expression nie zwei identische Stops bekommt. */
export function quantileBreaks(values, k = 7) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length < 2) return []
  const breaks = []
  for (let i = 1; i < k; i++) {
    const q = v[Math.min(v.length - 1, Math.floor((v.length * i) / k))]
    if (!breaks.length || q > breaks[breaks.length - 1]) breaks.push(q)
  }
  return breaks
}

/** Klassenindex 0…breaks.length für einen Wert (fürs Chip-Farbpünktchen). */
export function classIndex(v, breaks) {
  let i = 0
  for (const b of breaks) { if (v >= b) i++; else break }
  return i
}

// ── Farbrampen (sequenziell, farbfehlsichten-tauglich) ───────────────────────
// dark = Inferno-artig (dunkles Violett → glühendes Orange — leuchtet auf
// dark-matter); light = Viridis invertiert (hell → dunkles Blauviolett = mehr).
export const RAMPS = {
  dark: ['#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06'],
  light: ['#fde725', '#a0da39', '#4ac16d', '#1fa187', '#277f8e', '#365c8d', '#46327e'],
}

/** MapLibre fill-color-Expression: transparent ohne Daten, sonst Quantil-Step. */
export function heatPaint(metricKey, breaks, theme) {
  const ramp = RAMPS[theme] || RAMPS.dark
  if (!breaks.length) return 'rgba(0,0,0,0)'
  const step = ['step', ['get', metricKey], ramp[0]]
  breaks.forEach((b, i) => step.push(b, ramp[Math.min(i + 1, ramp.length - 1)]))
  return ['case', ['!', ['has', metricKey]], 'rgba(0,0,0,0)', step]
}

/** Legenden-Daten: Farbe + „ab"-Wert je Klasse (erste Klasse = Minimum). */
export function legendFor(metric, breaks, values, theme) {
  const ramp = RAMPS[theme] || RAMPS.dark
  if (!metric || !breaks.length) return null
  const v = values.filter((x) => x != null && Number.isFinite(x))
  const min = Math.min(...v), max = Math.max(...v)
  return {
    title: metric.label, unit: metric.unit,
    min: metric.fmt(min), max: metric.fmt(max),
    colors: ramp.slice(0, breaks.length + 1),
  }
}
