// ─────────────────────────────────────────────────────────────────────────
// Pro-Theme-Konfiguration der atmosphärischen 3D-Ebene (src/themeScene.js).
//
// Farben werden NICHT hier dupliziert — sie kommen zur Laufzeit aus den
// bestehenden CSS-Tokens (`accentToken`, via getComputedStyle in themeScene.js)
// und werden beim Theme-Wechsel weich gelerpt. Hier stehen nur die
// nicht-farblichen Parameter je Theme: Partikeldichte, Drift-Tempo, Deckkraft,
// Tiefe, Variante. Pure (kein three.js, kein DOM) → unit-getestet.
// ─────────────────────────────────────────────────────────────────────────

export const SCENE_PRESETS = {
  // Dark: kühle Akzent-Partikel, „ruhige Nachtluft über der Stadt".
  dark: { accentToken: '--accent', particleCount: 150, speed: 0.55, opacity: 0.09, depth: 34, variant: 'dust' },
  // Light: hellere, wärmere Partikel, „diesig-heller Tag", noch dezenter.
  light: { accentToken: '--accent', particleCount: 110, speed: 0.42, opacity: 0.05, depth: 34, variant: 'dust' },
  // Mauer-Modus: monochrome Tinte (Token wird im wall-mode auf Ink überschrieben),
  // damit der Archiv-Look rein bleibt.
  wall: { accentToken: '--on-surface', particleCount: 70, speed: 0.35, opacity: 0.045, depth: 34, variant: 'dust' },
}

/** Preset für ein Theme ('dark' | 'light' | 'wall') — Fallback = dark. */
export function presetFor(theme) {
  return SCENE_PRESETS[theme] || SCENE_PRESETS.dark
}

/**
 * Viewport-Anpassung (Constraint): auf Mobile weniger Partikel (×0.4, min. 20)
 * und DPR hart auf ≤ 2 gedeckelt. Reine Transformation — kein Seiteneffekt.
 */
export function resolvedPreset(preset, { mobile = false, dprCap = 2 } = {}) {
  return {
    ...preset,
    particleCount: mobile ? Math.max(20, Math.round(preset.particleCount * 0.4)) : preset.particleCount,
    dprCap: Math.min(2, dprCap),
  }
}
