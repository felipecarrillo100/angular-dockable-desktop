/**
 * M1 — scaffold. The rules that make the later gates trustworthy are themselves in place.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './lib/config.mjs';

const failures = [];
const read = p => readFileSync(join(ROOT, p), 'utf8');
/** JSONC (tsconfig style): comments and trailing commas, both outside strings only. */
function jsonc(text) {
  let out = '', i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i], d = text[i + 1];
    if (inStr) { out += c; if (c === '\\') { out += d; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && d === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i = text.indexOf('*/', i + 2) + 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
const json = p => jsonc(read(p));

// Boundaries (plan B1, ADR 0010)
if (existsSync(join(ROOT, '.git'))) failures.push('a .git directory exists — the port is developed without git (ADR 0010)');

// Decisions recorded
for (const n of ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010']) {
  const hit = spawnSync('ls', [join(ROOT, 'docs/decisions')], { encoding: 'utf8' }).stdout.split('\n').some(f => f.startsWith(n + '-'));
  if (!hit) failures.push(`ADR ${n} missing from docs/decisions`);
}

// Library package: Angular 22 peers only, tslib only, stylesheet exported (ADRs 0004, 0005, 0007)
const lib = json('projects/angular-dockable-desktop/package.json');
if (JSON.stringify(lib.peerDependencies) !== JSON.stringify({ '@angular/common': '^22.0.0', '@angular/core': '^22.0.0' })) failures.push(`peerDependencies must be exactly @angular/core + @angular/common ^22.0.0, got ${JSON.stringify(lib.peerDependencies)}`);
if (Object.keys(lib.dependencies ?? {}).join() !== 'tslib') failures.push(`runtime dependencies must be tslib only, got ${Object.keys(lib.dependencies ?? {})}`);
if (!lib.exports?.['./styles.css']) failures.push('package.json does not export ./styles.css');
const built = join(ROOT, 'dist/angular-dockable-desktop');
if (!existsSync(join(built, 'styles.css'))) failures.push('the built package does not contain styles.css');
else if (!JSON.parse(readFileSync(join(built, 'package.json'), 'utf8')).exports?.['./styles.css']) failures.push('the built package.json does not export ./styles.css');

// Strictness
const ts = json('tsconfig.json');
if (ts.compilerOptions?.strict !== true) failures.push('tsconfig.json: strict is not true');
if (ts.angularCompilerOptions?.strictTemplates !== true) failures.push('tsconfig.json: strictTemplates is not true');
if (!/^~6\.0/.test(json('package.json').devDependencies?.typescript ?? '')) failures.push('typescript is not pinned to ~6.0 (ADR 0004)');

// Lint prefix
if (!/prefix:\s*'ndd'/.test(read('projects/angular-dockable-desktop/eslint.config.js'))) failures.push('library eslint selector prefix is not ndd');

// Tests live outside src/, so helpers can never be packaged
const angular = json('angular.json');
const inc = angular.projects['angular-dockable-desktop'].architect.test.options?.include ?? [];
if (!inc.includes('../test/**/*.spec.ts')) failures.push('library tests are not included from projects/angular-dockable-desktop/test');

// The M0 decision is on record
if (!/\*\*PASS\*\*/.test(read('docs/evidence/M0.md'))) failures.push('docs/evidence/M0.md does not record a PASS');

// Selftest: every standing rule can fail
const st = spawnSync('node', [join(ROOT, 'scripts/gates/selftest.mjs')], { stdio: 'inherit' });
if (st.status !== 0) failures.push('gate selftest failed');

if (failures.length) { console.error('M1: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M1: ok');
