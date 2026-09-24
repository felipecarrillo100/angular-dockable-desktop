/**
 * Standing gate — test counts are monotonic, ported suites meet their vdd floor, and nothing
 * is skipped.
 *
 * Integrity rules 3 and 4 (docs/IMPLEMENTATION_PLAN.md B1):
 *   - every spec file has a floor in baseline-counts.json; dropping below it fails, and a
 *     file disappearing fails. Floors ratchet up automatically when counts rise;
 *   - every vdd suite in port-map.json whose milestone has been reached must exist and hold
 *     at least vdd's own test count (B3);
 *   - a skipped/todo test fails unless listed, with a reason, in docs/PROGRESS.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { BASELINE, MILESTONE, PORT_MAP, PROGRESS, VITEST_JSON } from './lib/config.mjs';

if (!existsSync(VITEST_JSON)) {
  console.error(`counts: ${VITEST_JSON} missing — the gate runner must run the tests with the json reporter first`);
  process.exit(1);
}
const report = JSON.parse(readFileSync(VITEST_JSON, 'utf8'));
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const portMap = existsSync(PORT_MAP) ? JSON.parse(readFileSync(PORT_MAP, 'utf8')) : { suites: [] };

const actual = {};
const skipped = [];
for (const file of report.testResults ?? []) {
  const name = basename(file.name);
  actual[name] = (actual[name] ?? 0) + (file.assertionResults ?? []).length;
  for (const a of file.assertionResults ?? []) {
    if (['pending', 'todo', 'skipped', 'disabled'].includes(a.status)) skipped.push(`${name} › ${a.fullName ?? a.title}`);
  }
}

const failures = [];
for (const [file, floor] of Object.entries(baseline)) {
  const now = actual[file];
  if (now === undefined) failures.push(`${file}: file disappeared (floor was ${floor})`);
  else if (now < floor) failures.push(`${file}: ${now} tests, floor is ${floor}`);
}

for (const s of portMap.suites ?? []) {
  if (s.milestone > MILESTONE) continue;
  const now = actual[s.ndd];
  if (now === undefined) failures.push(`${s.ndd}: ported suite missing (vdd ${s.vdd}, due at M${s.milestone})`);
  else if (now < s.min) failures.push(`${s.ndd}: ${now} tests, vdd's ${s.vdd} has ${s.min}`);
}

if (skipped.length) {
  const progress = existsSync(PROGRESS) ? readFileSync(PROGRESS, 'utf8') : '';
  for (const s of skipped) {
    const title = s.split('›').pop().trim();
    if (!progress.includes(title)) failures.push(`skipped test not listed in PROGRESS.md: ${s}`);
  }
}

const total = Object.values(actual).reduce((a, b) => a + b, 0);
if (report.numFailedTests > 0) failures.push(`${report.numFailedTests} failing test(s)`);
if (failures.length) {
  console.error('counts: FAIL');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}

const next = { ...baseline };
let raised = 0;
for (const [file, n] of Object.entries(actual)) if ((next[file] ?? -1) < n) { next[file] = n; raised++; }
if (raised) writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
console.log(`counts: ok — ${total} tests across ${Object.keys(actual).length} files${raised ? `, ${raised} floor(s) raised` : ''}`);
