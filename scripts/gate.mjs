#!/usr/bin/env node
/**
 * The gate runner.   npm run gate -- M<n>
 *
 * Runs the standing gate, then the milestone's own rules (scripts/gates/m<n>.mjs, required),
 * then its browser gate (scripts/gates/browser/m<n>.mjs, when present). Writes the outcome to
 * artifacts/M<n>/gate.json. Exit 0 only if every step passed.
 *
 * Integrity (docs/IMPLEMENTATION_PLAN.md B1): this file and the rules it runs are never
 * edited to make a milestone pass.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const milestone = (process.argv[2] ?? '').toUpperCase();
if (!/^M\d+$/.test(milestone)) { console.error('usage: npm run gate -- M<n>'); process.exit(2); }
const n = Number(milestone.slice(1));
const OUT = `artifacts/${milestone}`;
mkdirSync(OUT, { recursive: true });

const env = { ...process.env, NDD_GATE_MILESTONE: String(n), NG_CLI_ANALYTICS: 'false', CI: '1' };
const steps = [];
const run = (name, cmd) => {
  process.stdout.write(`\n── ${name}\n`);
  const t = Date.now();
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', env });
  const step = { name, ok: r.status === 0, status: r.status, seconds: Math.round((Date.now() - t) / 1000) };
  steps.push(step);
  return step.ok;
};

run('build:lib', 'npx ng build angular-dockable-desktop');
run('types:spec', 'npx tsc -p projects/angular-dockable-desktop/tsconfig.spec.json --noEmit');
run('lint', 'npx ng lint');
run('unit', 'npx ng test angular-dockable-desktop --reporters=json --output-file=artifacts/.vitest.json --reporters=default');
run('counts', 'node scripts/gates/counts.mjs');
run('css-prefix', 'node scripts/gates/css-prefix.mjs');
run('api-surface', 'node scripts/gates/api-surface.mjs');
run('docs-api', 'node scripts/gates/docs-api.mjs');
run('build:playground', 'npx ng build playground');
run('build:demo', 'npx ng build demo');
run('zone', 'node scripts/gates/zone.mjs');

const own = `scripts/gates/m${n}.mjs`;
if (existsSync(own)) run(milestone, `node ${own}`);
else { steps.push({ name: milestone, ok: false, missing: true }); console.error(`\n── ${milestone}\n  no ${own}: a milestone without its own gate cannot pass`); }
const browser = `scripts/gates/browser/m${n}.mjs`;
if (existsSync(browser)) run(`${milestone} browser`, `node ${browser}`);

let tests = null;
try {
  const r = JSON.parse(readFileSync('artifacts/.vitest.json', 'utf8'));
  tests = { total: r.numTotalTests, passed: r.numPassedTests, failed: r.numFailedTests, files: r.testResults?.length ?? 0 };
} catch { /* the unit step failed */ }

const passed = steps.every(s => s.ok);
writeFileSync(`${OUT}/gate.json`, JSON.stringify({ milestone, passed, at: new Date().toISOString(), tests, steps }, null, 2) + '\n');
console.log('\n' + '─'.repeat(60));
for (const s of steps) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'}  ${s.name}${s.seconds !== undefined ? ` (${s.seconds}s)` : ''}`);
if (tests) console.log(`  tests: ${tests.passed}/${tests.total} across ${tests.files} file(s)`);
console.log(`${milestone} GATE: ${passed ? 'PASS' : 'FAIL'}`);
process.exit(passed ? 0 : 1);
