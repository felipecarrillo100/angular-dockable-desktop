#!/usr/bin/env node
/**
 * The fast check, for while you work.   npm run verify
 *
 * Types, lint and the unit suite, then the non-vacuity stub sweep for only the source modules
 * changed since the last commit (`git diff HEAD` plus untracked files) — each must still turn the
 * suite red when stubbed. A couple of minutes, against the release pass's much longer run.
 *
 * It is not a gate and replaces none: before a release, `npm run gate:release` runs every gate,
 * with the full sweep over every module.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PORT_MAP } from './gates/lib/config.mjs';

Object.assign(process.env, { NG_CLI_ANALYTICS: 'false', CI: '1' });
const steps = [];
const run = (name, cmd, args) => {
  process.stdout.write(`\n── ${name}\n`);
  const t = Date.now();
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  steps.push({ name, ok: r.status === 0, seconds: Math.round((Date.now() - t) / 1000) });
};

run('types:spec', 'npx', ['tsc', '-p', 'projects/angular-dockable-desktop/tsconfig.spec.json', '--noEmit']);
run('lint', 'npx', ['ng', 'lint']);
run('unit', 'npx', ['ng', 'test', 'angular-dockable-desktop']);

const git = args => spawnSync('git', args, { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const changed = new Set([...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])]);
const modules = JSON.parse(readFileSync(PORT_MAP, 'utf8')).modules
  .map(m => m.file)
  .filter(f => changed.has(`projects/angular-dockable-desktop/${f}`));
if (modules.length === 0) console.log('\n── non-vacuity\n  no registered source module changed since HEAD');
for (const file of modules) run(`non-vacuity ${file}`, 'node', ['scripts/gates/non-vacuity.mjs', '--only', file]);

console.log('\n' + '─'.repeat(60));
for (const s of steps) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'}  ${s.name} (${s.seconds}s)`);
const passed = steps.every(s => s.ok);
console.log(`VERIFY: ${passed ? 'PASS' : 'FAIL'}${passed ? ' — run `npm run gate:release` before a release' : ''}`);
process.exit(passed ? 0 : 1);
