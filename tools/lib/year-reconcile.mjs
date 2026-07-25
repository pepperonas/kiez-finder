// Reine Entscheidungslogik für tools/reconcile-poi-year-facts.mjs — dateifrei
// und damit unit-testbar (tests/year-reconcile.test.js).
//
// contradictoryYear(fact, extract): Widerspricht das Jahr-Eckdatum `fact`
// („Eröffnet 1993" etc.) der Prosa `extract`? Liefert das/die vom Text am Verb
// genannten Jahr(e) (Array) bei Widerspruch, sonst null. Der Aufrufer STREICHT
// dann das Jahr-Eckdatum (ersetzt bewusst nicht — s. Skript-Kopf).

const YEARVERBS = ['Eröffnet', 'Erbaut', 'Angelegt', 'Errichtet']
const YEAR = '(1[1-9]\\d\\d|20\\d\\d)'
// Eröffnungs-Verben — „Wieder…" AUSGESCHLOSSEN (Wiedereröffnung 2009 ist ein
// Wieder-Öffnen, nicht die Erst-Eröffnung → sonst z.B. Ägyptisches Museum 1828
// fälschlich als widersprüchlich markiert).
const VERB = '(?<![Ww]ieder ?)(?:er[öo]ffnet|er[öo]ffnung|erbaut|errichtet|angelegt|eingeweiht|geweiht|fertiggestellt)'
const NEAR = new RegExp(`${YEAR}\\D{0,18}${VERB}|${VERB}\\D{0,18}${YEAR}`, 'gi')

// Personen-Lebensdaten in Klammern raus, bevor Jahre am Verb gesucht werden —
// sonst matcht „(* 1953) erbaut" (Architekten-Geburtsjahr) als Baujahr (James-Simon).
export const stripLifeDates = (x) => (x || '')
  .replace(/\([^)]*[*†✝‡][^)]*\)/g, ' ')          // (* 1953), (* 1867; † 1940)
  .replace(/\(\s*\d{3,4}\s*[–-]\s*\d{3,4}\s*\)/g, ' ') // (1849–1932) Lebensspanne
  .replace(/\((?:geb|gest|gestorben|geboren)\.?[^)]*\)/gi, ' ')
  .replace(/\*\s*\d{3,4}|†\s*\d{3,4}/g, ' ')      // freistehende * 1953 / † 1940

export const isYearFact = (f) => typeof f === 'string' &&
  YEARVERBS.some((v) => f.startsWith(v)) && /\b(1[1-9]\d\d|20\d\d)\b/.test(f)
export const yearOf = (f) => { const m = String(f).match(/\b(1[1-9]\d\d|20\d\d)\b/); return m ? +m[1] : null }

/** Widerspruch? → Array der Text-Jahre am Verb (≥1), sonst null. Widerspruch =
 *  Chip-Jahr steht NIRGENDS im Extrakt UND der Extrakt nennt ein Jahr direkt an
 *  einem (Nicht-„Wieder"-)Eröffnungs-Verb. */
export function contradictoryYear(fact, extract) {
  if (!isYearFact(fact) || !extract || typeof extract !== 'string') return null
  const chip = yearOf(fact)
  if (extract.includes(String(chip))) return null // korroboriert → behalten
  const x = stripLifeDates(extract)
  const near = new Set()
  for (const m of x.matchAll(NEAR)) near.add(+(m[1] || m[2]))
  return near.size ? [...near] : null
}

/** Gibt die bereinigte facts-Liste zurück (Jahr-Chip entfernt, falls er der
 *  Prosa widerspricht) + ob etwas entfernt wurde. Nicht-mutierend. */
export function reconcileFacts(facts, extract) {
  if (!Array.isArray(facts) || !facts.length) return { facts, dropped: null }
  const i = facts.findIndex(isYearFact)
  if (i < 0) return { facts, dropped: null }
  const textYears = contradictoryYear(facts[i], extract)
  if (!textYears) return { facts, dropped: null }
  const out = facts.slice(); const removed = out.splice(i, 1)[0]
  return { facts: out, dropped: { fact: removed, chip: yearOf(removed), textYears } }
}
