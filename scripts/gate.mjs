#!/usr/bin/env node
/**
 * The gate runner.   npm run gate -- M<n> [M<n> …]      npm run gate:release
 *
 * Runs the standing gate, then each milestone's own rules (scripts/gates/m<n>.mjs, required),
 * then its browser gate (scripts/gates/browser/m<n>.mjs, when present). Writes each outcome to
 * artifacts/M<n>/gate.json. Exit 0 only if every step passed.
 *
 * Several milestones in one call are one *release pass*: the standing gate runs once, not once
 * per milestone, and a sub-gate that already passed in this pass (M15 re-runs every browser gate
 * M13 already ran, and the consumer smoke and round trips) is reused rather than run again — see
 * scripts/gates/lib/subgate.mjs. A sub-gate that failed is never reused, and a single milestone
 * runs everything it always did. Every run, reused or not, is listed with its time in
 * artifacts/gate-runs.jsonl.
 *
 * Integrity (docs/IMPLEMENTATION_PLAN.md B1): this file and the rules it runs are never
 * edited to make a milestone pass.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const milestones = process.argv.slice(2).map(a => a.toUpperCase());
if (milestones.length === 0 || !milestones.every(m => /^M\d+$/.test(m))) {
  console.error('usage: npm run gate -- M<n> [M<n> …]');
  process.exit(2);
}

// A release pass is a session; sub-gates read it from the environment (lib/subgate.mjs).
if (milestones.length > 1) process.env['NDD_GATE_SESSION'] = `${Date.now()}-${process.pid}`;
const session = process.env['NDD_GATE_SESSION'] ?? null;
Object.assign(process.env, { NG_CLI_ANALYTICS: 'false', CI: '1' });
const { runSub } = await import('./gates/lib/subgate.mjs');

const run = (steps, name, cmd) => {
  process.stdout.write(`\n── ${name}\n`);
  const t = Date.now();
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', env: process.env });
  const step = { name, ok: r.status === 0, status: r.status, seconds: Math.round((Date.now() - t) / 1000) };
  steps.push(step);
  return step.ok;
};

// ── The standing gate, once ────────────────────────────────────────────────
const prelude = [];
process.env['NDD_GATE_MILESTONE'] = milestones[0].slice(1);
run(prelude, 'build:lib', 'npx ng build angular-dockable-desktop');
run(prelude, 'types:spec', 'npx tsc -p projects/angular-dockable-desktop/tsconfig.spec.json --noEmit');
run(prelude, 'lint', 'npx ng lint');
run(prelude, 'unit', 'npx ng test angular-dockable-desktop --reporters=json --output-file=artifacts/.vitest.json --reporters=default');
run(prelude, 'counts', 'node scripts/gates/counts.mjs');
run(prelude, 'css-prefix', 'node scripts/gates/css-prefix.mjs');
run(prelude, 'api-surface', 'node scripts/gates/api-surface.mjs');
run(prelude, 'docs-api', 'node scripts/gates/docs-api.mjs');
run(prelude, 'build:playground', 'npx ng build playground');
run(prelude, 'build:demo', 'npx ng build demo');
run(prelude, 'zone', 'node scripts/gates/zone.mjs');

let tests = null;
try {
  const r = JSON.parse(readFileSync('artifacts/.vitest.json', 'utf8'));
  tests = { total: r.numTotalTests, passed: r.numPassedTests, failed: r.numFailedTests, files: r.testResults?.length ?? 0 };
} catch { /* the unit step failed */ }

// ── Each milestone ─────────────────────────────────────────────────────────
const results = [];
for (const milestone of milestones) {
  const n = Number(milestone.slice(1));
  const OUT = `artifacts/${milestone}`;
  mkdirSync(OUT, { recursive: true });
  process.env['NDD_GATE_MILESTONE'] = String(n);
  const steps = [...prelude];

  const own = `scripts/gates/m${n}.mjs`;
  if (existsSync(own)) run(steps, milestone, `node ${own}`);
  else { steps.push({ name: milestone, ok: false, missing: true }); console.error(`\n── ${milestone}\n  no ${own}: a milestone without its own gate cannot pass`); }
  const browser = `scripts/gates/browser/m${n}.mjs`;
  if (existsSync(browser)) {
    // Through runSub, so that a later milestone re-running this browser gate in the same pass reuses it.
    process.stdout.write(`\n── ${milestone} browser\n`);
    const t = Date.now();
    const ok = runSub(browser, [], { from: `${milestone} runner` });
    steps.push({ name: `${milestone} browser`, ok, status: ok ? 0 : 1, seconds: Math.round((Date.now() - t) / 1000) });
  }

  const passed = steps.every(s => s.ok);
  writeFileSync(`${OUT}/gate.json`, JSON.stringify({ milestone, passed, at: new Date().toISOString(), session, tests, steps }, null, 2) + '\n');
  results.push({ milestone, passed, steps });
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
for (const s of prelude) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'}  ${s.name} (${s.seconds}s)`);
for (const { steps } of results) {
  for (const s of steps.slice(prelude.length)) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'}  ${s.name}${s.seconds !== undefined ? ` (${s.seconds}s)` : ''}`);
}
if (tests) console.log(`  tests: ${tests.passed}/${tests.total} across ${tests.files} file(s)`);
for (const { milestone, passed } of results) console.log(`${milestone} GATE: ${passed ? 'PASS' : 'FAIL'}`);
process.exit(results.every(r => r.passed) ? 0 : 1);
