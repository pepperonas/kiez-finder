#!/usr/bin/env node
// Doc-sync guard: runs the unit-test suite WITH coverage, then verifies that
// the numbers the docs claim match the measurement — the README coverage badge
// is a static shields.io badge, so without this check it would silently rot.
//
// Checks (fails the process → fails CI):
//   1. suite passes (fail count 0)
//   2. README badge  coverage_(unit)-<X>%25_lines  == measured all-files line %
//   3. every "<N> Unit-Tests" / "**<N> Tests" in README.md == actual test count
//   4. the "<N> tests" claim in CLAUDE.md's Tests paragraph == actual test count
//
// Usage: node tools/check-doc-sync.mjs   (CI runs this INSTEAD of a bare test
// step — the suite runs exactly once, output is passed through)
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testFiles = readdirSync(join(root, 'tests'))
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join('tests', f)) // NOT fs.globSync — Node 20 doesn't have it

let out
try {
  out = execFileSync(process.execPath, ['--test', '--experimental-test-coverage', ...testFiles], {
    cwd: root, encoding: 'utf8',
  })
} catch (e) {
  process.stdout.write(e.stdout || '')
  process.stderr.write(e.stderr || '')
  console.error('\n✗ Doc-Sync: Testsuite fehlgeschlagen')
  process.exit(1)
}
process.stdout.write(out)

const num = (re, label) => {
  const m = out.match(re)
  if (!m) { console.error(`✗ Doc-Sync: "${label}" nicht im Testoutput gefunden`); process.exit(1) }
  return parseFloat(m[1])
}
const tests = num(/^# tests (\d+)$/m, '# tests')
const fails = num(/^# fail (\d+)$/m, '# fail')
const lines = num(/^# all files\s*\|\s*([\d.]+)/m, 'all files line %')
if (fails !== 0) { console.error(`✗ Doc-Sync: ${fails} Tests rot`); process.exit(1) }

const problems = []
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')

// 2) coverage badge vs measured line %
const badge = readme.match(/coverage_\(unit\)-([\d.]+)%25_lines/)
if (!badge) problems.push('README: Coverage-Badge (coverage_(unit)-…%25_lines) fehlt')
else if (Math.abs(parseFloat(badge[1]) - lines) > 0.005)
  problems.push(`README: Coverage-Badge sagt ${badge[1]} %, gemessen sind ${lines} % Lines`)

// 3+4) test-count claims
const countClaims = [
  { file: 'README.md', text: readme, re: /(\d+) Unit-Tests/g },
  { file: 'README.md', text: readme, re: /\*\*(\d+) Tests\b/g },
  { file: 'CLAUDE.md', text: claude, re: /(\d+) tests, 100% line/g },
]
for (const c of countClaims) {
  const matches = [...c.text.matchAll(c.re)]
  if (!matches.length) { problems.push(`${c.file}: erwartete Testanzahl-Angabe (${c.re}) fehlt`); continue }
  for (const m of matches) {
    if (parseInt(m[1], 10) !== tests)
      problems.push(`${c.file}: behauptet ${m[1]} Tests ("${m[0]}"), tatsächlich sind es ${tests}`)
  }
}

if (problems.length) {
  console.error('\n✗ Doc-Sync: Doku weicht von der Messung ab —')
  for (const p of problems) console.error('  · ' + p)
  console.error('  → Zahlen in README.md/CLAUDE.md aktualisieren (Badge + Test-Anzahl).')
  process.exit(1)
}
console.log(`\n✓ Doc-Sync: ${tests} Tests, ${lines} % Lines — Doku und Messung stimmen überein`)
