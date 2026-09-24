/**
 * M13 — parity and hardening: the closing gate for the port.
 *
 * It asserts what is only true of the *whole* port, then runs every sub-gate:
 *
 *   1  every vdd suite ported at or above its count; ≥ 765 tests; none failing or skipped
 *   2  every rdd suite accounted for in PARITY.md §3, and every divergence numbered without gaps
 *   3  the static class↔rule correspondence is exact: every emitted class has a rule or is a
 *      declared hook, every rule has an emitter or is a declared opt-in utility, and every
 *      enumerated composed class names an expression that really is in the source
 *   4  every ADR settled
 *   5  round trips vdd↔ndd byte-identical (with control); the consumer smoke (npm pack → a fresh
 *      `ng new --ssr --zoneless` app: build, prerender, serve, hydrate); coexistence with
 *      Bootstrap / Tailwind / Material (with control); the M13 browser gate's control
 *   6  every earlier browser gate re-run green, and the vdd differential
 *   7  the full non-vacuity sweep: every registered module, of every milestone, turns the suite red
 *
 * The M13 browser gate itself (axe, keyboard, tick bounds, live class sweep) runs after this, as
 * every milestone's does.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PORT_MAP, ROOT, STYLES, VITEST_JSON } from './lib/config.mjs';
import { selectorClasses } from './lib/css.mjs';
import { COMPOSED_CLASSES, CONSUMER_HOOKS, LITERAL_MAP_CLASSES, OPT_IN_UTILITIES, everyEmittedClass, sourceFiles } from './lib/emitted.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const step = name => console.log(`\n── M13: ${name}`);
const sub = (script, args = [], { expectFail = false, env = {} } = {}) => {
  const r = spawnSync('node', [join(ROOT, script), ...args], { stdio: expectFail ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, ...env } });
  return expectFail ? r.status !== 0 : r.status === 0;
};

// ── 1. The suite ────────────────────────────────────────────────────────────
step('suite');
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : null;
if (!report) failures.push('no vitest report — the gate runner must run the suite first');
else {
  const by = Object.fromEntries(report.testResults.map(f => [basename(f.name), f.assertionResults]));
  const map = JSON.parse(readFileSync(PORT_MAP, 'utf8'));
  for (const s of map.suites) {
    const n = by[s.ndd]?.length ?? 0;
    must(n >= s.min, `${s.vdd} → ${s.ndd}: ${n} tests, below vdd's ${s.min}`);
  }
  must(map.suites.length === 33, `the port map lists ${map.suites.length} vdd suites; vdd has 33`);
  must(report.numTotalTests >= 765, `the suite has ${report.numTotalTests} tests; vdd's is 765`);
  must(report.numFailedTests === 0, `${report.numFailedTests} tests are failing`);
  const skipped = report.testResults.flatMap(f => f.assertionResults).filter(a => a.status !== 'passed');
  must(skipped.length === 0, `${skipped.length} tests are skipped or pending: ${skipped.slice(0, 5).map(a => a.title).join('; ')}`);
  console.log(`  ${report.numTotalTests} tests, ${map.suites.length} vdd suites at or above their counts`);
}

// ── 2. PARITY.md ────────────────────────────────────────────────────────────
step('PARITY.md');
const parity = readFileSync(join(ROOT, 'docs/PARITY.md'), 'utf8');
must(!/\b(TBD|TODO)\b/.test(parity) && !/Draft/.test(parity.slice(0, 400)), 'PARITY.md is still a draft (TBD / TODO / "Draft")');
for (const h of ['## 1. API map', '## 2. Layout compatibility', '## 3. Test map', '## 4. Deliberate divergences', '## 5. Known gaps']) must(parity.includes(h), `PARITY.md lacks "${h}"`);
const RDD_SUITES = ['CoreLayout', 'DomStability', 'EventBus', 'FloatingWindows', 'FormContainer', 'Internationalization', 'LayoutSerialization', 'PanelContribution', 'PanelOverlay', 'PanelRegistry', 'PanelSystem', 'Sidebar', 'SpawnLifecycle', 'StateTransitions', 'StyleHookups', 'TabOperations', 'Toast', 'Toolbar', 'TouchSupport', 'V2Features', 'V3Diagnostics', 'anchorGeometry', 'dragResize', 'serializable', 'sidePanelPositioning', 'useColorScheme'];
const testMap = parity.slice(parity.indexOf('## 3. Test map'), parity.indexOf('## 4.'));
for (const s of RDD_SUITES) must(testMap.includes(`\`${s}\``), `PARITY.md §3 does not account for rdd's \`${s}\``);
for (const series of ['D', 'N']) {
  const nums = [...parity.matchAll(new RegExp(`^\\| ${series}(\\d+) \\|`, 'gm'))].map(m => Number(m[1]));
  must(nums.length > 0, `PARITY.md lists no ${series}-series`);
  nums.forEach((n, i) => must(n === i + 1, `${series}-series numbering jumps at ${series}${n}, expected ${series}${i + 1}`));
  for (const row of parity.split('\n').filter(l => new RegExp(`^\\| ${series}\\d+ \\|`).test(l))) must(row.split('|').length >= 6, `${row.slice(0, 20)}… must fill every column`);
}
must((parity.match(/^\| D\d+ \|/gm) ?? []).length === 16, 'every one of vdd\'s D1–D16 must be carried in §4.1');

// ── 3. Class↔rule correspondence ────────────────────────────────────────────
step('class↔rule correspondence');
const styled = selectorClasses(readFileSync(STYLES, 'utf8'));
const emitted = everyEmittedClass();
for (const c of emitted) if (!styled.has(c) && !CONSUMER_HOOKS.has(c)) failures.push(`.${c} is emitted but has no rule; add one, or declare it in CONSUMER_HOOKS`);
for (const c of styled) if (!emitted.has(c) && !OPT_IN_UTILITIES.has(c)) failures.push(`.${c} has a rule nothing emits — a dead rule (or declare it an OPT_IN_UTILITY)`);
for (const c of CONSUMER_HOOKS) { must(!styled.has(c), `.${c} is a declared hook but is now styled`); must(emitted.has(c), `.${c} is a declared hook but nothing emits it`); }
for (const c of OPT_IN_UTILITIES.keys()) must(styled.has(c), `.${c} is a declared utility but has no rule`);
const source = sourceFiles().filter(f => !f.endsWith('.nv-orig')).map(f => readFileSync(f, 'utf8')).join('\n');
for (const expr of Object.keys(COMPOSED_CLASSES)) must(source.includes(expr), `COMPOSED_CLASSES names "${expr}", which is no longer in the source`);
for (const list of Object.values(LITERAL_MAP_CLASSES)) for (const c of list) must(source.includes(`'${c}'`), `LITERAL_MAP_CLASSES names '${c}', which is no longer a literal in the source`);
console.log(`  ${emitted.size} emitted, ${styled.size} styled, ${CONSUMER_HOOKS.size} hooks, ${OPT_IN_UTILITIES.size} utilities`);

// ── 4. ADRs ─────────────────────────────────────────────────────────────────
step('decisions');
const decisions = readdirSync(join(ROOT, 'docs/decisions')).filter(f => /^\d{4}-.*\.md$/.test(f));
must(decisions.length >= 11, 'expected the decision records');
for (const f of decisions) {
  const status = readFileSync(join(ROOT, 'docs/decisions', f), 'utf8').match(/^\*\*Status:\*\*\s*(\w+)/m)?.[1];
  must(/^(Accepted|Superseded|Rejected)$/.test(status ?? ''), `${f} is not settled (status: ${status ?? 'none'})`);
}

// ── 5. Sub-gates ────────────────────────────────────────────────────────────
step('round trips vdd ↔ ndd');
must(sub('scripts/gates/browser/m13-roundtrip.mjs'), 'the vdd↔ndd round-trip gate failed');
must(sub('scripts/gates/browser/m13-roundtrip.mjs', ['--control'], { expectFail: true }), 'the round-trip control passed — byte identity is not being checked');
step('consumer smoke (npm pack → ng new --ssr --zoneless)');
must(sub('scripts/gates/m13-consumer.mjs'), 'the consumer smoke failed');
step('coexistence');
must(sub('scripts/gates/browser/m13-coexist.mjs'), 'the coexistence gate failed');
must(sub('scripts/gates/browser/m13-coexist.mjs', ['--control'], { expectFail: true }), 'the coexistence control passed — leaks are not being measured');
step('M13 browser control');
must(sub('scripts/gates/browser/m13.mjs', ['--control'], { expectFail: true }), 'the M13 browser gate accepted a prohibited aria-label and a tick per pointer move');

// ── 6. The full browser sweep ───────────────────────────────────────────────
step('every earlier browser gate');
for (let n = 4; n <= 12; n++) {
  const script = `scripts/gates/browser/m${n}.mjs`;
  if (existsSync(join(ROOT, script))) must(sub(script), `the M${n} browser gate no longer passes`);
}
must(sub('scripts/gates/browser/m6-diff.mjs'), 'the vdd differential no longer passes');

// ── 7. The full non-vacuity sweep ───────────────────────────────────────────
step('non-vacuity, every module');
must(sub('scripts/gates/non-vacuity.mjs', ['--milestone', '13']), 'the full non-vacuity sweep failed');

if (failures.length) { console.error('\nM13: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('\nM13: ok');
