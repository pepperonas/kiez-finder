// ─────────────────────────────────────────────────────────────────────────
// Shared data-directory for ALL data loaders (kiez, stats, heat, hunt). One
// place so switching city (setDataDir, called from city.js via kiez.js) repoints
// every `/data/*` fetch at once. Berlin default '/data' = 100% backward-compat;
// Frankfurt '/data/frankfurt'. A city without a given enrichment file just gets
// a 404 → each loader already degrades to null (no Berlin data leaks in).
// ─────────────────────────────────────────────────────────────────────────
let _dir = '/data'
export function setDataDir(dir) { _dir = dir || '/data' }
export function dataDir() { return _dir }
export function dpath(file) { return `${_dir}/${file}` }
