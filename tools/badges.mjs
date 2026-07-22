#!/usr/bin/env node
// Auto-Badges: misst die Suite (Tests + Coverage), zählt die LOC und SCHREIBT
// die drei dynamischen Badges (Unit-Tests · Lines of Code · Coverage) sowie die
// „N Tests"-Textstellen in README.md / CLAUDE.md. Die Zahlen können so nie still
// veralten — `.github/workflows/badges.yml` führt das bei jedem Push auf main aus
// und committet die Änderung automatisch zurück ([skip ci] gegen Loops).
//
//   node tools/badges.mjs           # misst + SCHREIBT die Badges
//   node tools/badges.mjs --check   # nur prüfen (exit 1 bei Abweichung), nichts schreiben
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

// ── Suite mit Coverage ausführen (genau einmal) ──
const testFiles = readdirSync(join(root, 'tests'))
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join('tests', f)) // NICHT fs.globSync — Node 20 hat es nicht
let out
try {
  out = execFileSync(process.execPath, ['--test', '--experimental-test-coverage', ...testFiles], {
    cwd: root, encoding: 'utf8',
  })
} catch (e) {
  process.stdout.write(e.stdout || '')
  process.stderr.write(e.stderr || '')
  console.error('\n✗ Badges: Testsuite fehlgeschlagen')
  process.exit(1)
}
process.stdout.write(out)

const grab = (re, label) => {
  const m = out.match(re)
  if (!m) { console.error(`✗ Badges: "${label}" nicht im Testoutput gefunden`); process.exit(1) }
  return m[1]
}
const tests = parseInt(grab(/^# tests (\d+)$/m, '# tests'), 10)
const fails = parseInt(grab(/^# fail (\d+)$/m, '# fail'), 10)
const lines = grab(/^# all files\s*\|\s*([\d.]+)/m, 'all files line %')
if (fails !== 0) { console.error(`✗ Badges: ${fails} Tests rot`); process.exit(1) }

// ── LOC: Summe der Zeilen aller src/*.js ──
const srcDir = join(root, 'src')
const loc = readdirSync(srcDir)
  .filter((f) => f.endsWith('.js'))
  .reduce((n, f) => n + readFileSync(join(srcDir, f), 'utf8').split('\n').length, 0)

// ── Badges + Textzahlen ersetzen ──
const rewrites = {
  'README.md': [
    [/unit_tests-\d+-/g, `unit_tests-${tests}-`],
    [/lines_of_code-\d+-/g, `lines_of_code-${loc}-`],
    [/coverage_\(unit\)-[\d.]+%25_lines/g, `coverage_(unit)-${lines}%25_lines`],
    [/\d+ Unit-Tests/g, `${tests} Unit-Tests`],
    [/\*\*\d+ Tests\b/g, `**${tests} Tests`],
  ],
  'CLAUDE.md': [
    [/\d+ tests, 100% line/g, `${tests} tests, 100% line`],
  ],
}

const changed = []
for (const [file, transforms] of Object.entries(rewrites)) {
  const p = join(root, file)
  const before = readFileSync(p, 'utf8')
  let after = before
  for (const [re, repl] of transforms) after = after.replace(re, repl)
  if (after !== before) {
    changed.push(file)
    if (!checkOnly) writeFileSync(p, after)
  }
}

const summary = `${tests} Tests · ${loc} LOC · ${lines} % Lines`
if (checkOnly) {
  if (changed.length) {
    console.error(`\n✗ Badges veraltet in: ${changed.join(', ')} — führe \`node tools/badges.mjs\` aus.`)
    process.exit(1)
  }
  console.log(`\n✓ Badges aktuell: ${summary}`)
} else {
  console.log(`\n✓ Badges ${changed.length ? 'aktualisiert (' + changed.join(', ') + ')' : 'unverändert'}: ${summary}`)
}
