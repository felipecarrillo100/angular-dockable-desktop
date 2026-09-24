/**
 * Proves every standing gate rule can fail (integrity rule 6).
 *
 * Each case builds a scratch tree under artifacts/selftest/, points one rule at it through the
 * NDD_GATE_* environment variables (scripts/gates/lib/config.mjs), and requires the expected
 * exit code: 0 for the clean seed, non-zero for every seeded violation. A rule that passes a
 * violation is broken, and this fails.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './lib/config.mjs';

const BASE = join(ROOT, 'artifacts/selftest');
rmSync(BASE, { recursive: true, force: true });
let caseNo = 0;
const results = [];

function tree(files) {
  const dir = join(BASE, `case-${++caseNo}`);
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}
function expect(rule, label, shouldPass, env) {
  const r = spawnSync('node', [join(ROOT, 'scripts/gates', rule)], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const passed = r.status === 0;
  const ok = passed === shouldPass;
  results.push({ rule, label, ok, got: passed ? 'pass' : 'fail', wanted: shouldPass ? 'pass' : 'fail', out: (r.stdout + r.stderr).trim().split('\n').slice(0, 3).join(' | ') });
}

// ── counts ────────────────────────────────────────────────────────────────
const vitest = (tests, extra = {}) => ({
  numFailedTests: 0, ...extra,
  testResults: Object.entries(tests).map(([name, list]) => ({ name: `/x/${name}`, assertionResults: list.map(s => ({ status: s, title: `t-${Math.random()}` })) })),
});
const countsEnv = (files, baseline, portMap = { suites: [] }, milestone = 5) => {
  const d = tree({ 'v.json': files, 'b.json': baseline, 'p.json': portMap, 'progress.md': '# p\n' });
  return { NDD_GATE_VITEST: join(d, 'v.json'), NDD_GATE_BASELINE: join(d, 'b.json'), NDD_GATE_PORTMAP: join(d, 'p.json'), NDD_GATE_PROGRESS: join(d, 'progress.md'), NDD_GATE_MILESTONE: String(milestone) };
};
expect('counts.mjs', 'clean', true, countsEnv(vitest({ 'a.spec.ts': ['passed', 'passed'] }), { 'a.spec.ts': 2 }));
expect('counts.mjs', 'below floor', false, countsEnv(vitest({ 'a.spec.ts': ['passed'] }), { 'a.spec.ts': 2 }));
expect('counts.mjs', 'file disappeared', false, countsEnv(vitest({ 'b.spec.ts': ['passed'] }), { 'a.spec.ts': 1 }));
expect('counts.mjs', 'skipped test', false, countsEnv(vitest({ 'a.spec.ts': ['passed', 'skipped'] }), {}));
expect('counts.mjs', 'failing test', false, countsEnv(vitest({ 'a.spec.ts': ['passed'] }, { numFailedTests: 1 }), {}));
expect('counts.mjs', 'ported suite missing', false, countsEnv(vitest({ 'a.spec.ts': ['passed'] }), {}, { suites: [{ vdd: 'x.test.ts', ndd: 'x.spec.ts', min: 1, milestone: 3 }] }));
expect('counts.mjs', 'ported suite below vdd', false, countsEnv(vitest({ 'x.spec.ts': ['passed'] }), {}, { suites: [{ vdd: 'x.test.ts', ndd: 'x.spec.ts', min: 2, milestone: 3 }] }));
expect('counts.mjs', 'ported suite not yet due', true, countsEnv(vitest({ 'a.spec.ts': ['passed'] }), {}, { suites: [{ vdd: 'x.test.ts', ndd: 'x.spec.ts', min: 2, milestone: 9 }] }));

// ── css-prefix ────────────────────────────────────────────────────────────
const cssEnv = (css, src = { 'lib/ok.ts': "@Component({ template: `<div class=\"ndd-ok\" [class.ndd-on]=\"x\"></div>` })" }) => {
  const d = tree({ 'styles.css': css, ...Object.fromEntries(Object.entries(src).map(([k, v]) => [`src/${k}`, v])) });
  return { NDD_GATE_STYLES: join(d, 'styles.css'), NDD_GATE_LIB_SRC: join(d, 'src') };
};
const CLEAN_CSS = ':root { --ndd-a: 1; } .ndd-x { animation: ndd-fade 1s ease; } @keyframes ndd-fade { from { opacity: 0 } } [data-ndd-skin="a"] .ndd-y { color: red } [class*="ndd-"] { box-sizing: border-box }';
expect('css-prefix.mjs', 'clean', true, cssEnv(CLEAN_CSS));
expect('css-prefix.mjs', 'bare class', false, cssEnv(CLEAN_CSS + ' .active { color: red }'));
expect('css-prefix.mjs', 'bare class inside @media', false, cssEnv(CLEAN_CSS + ' @media (min-width: 1px) { .ndd-x .open { color: red } }'));
expect('css-prefix.mjs', 'unprefixed property', false, cssEnv(CLEAN_CSS + ' .ndd-x { --accent: red }'));
expect('css-prefix.mjs', 'unprefixed keyframes', false, cssEnv(CLEAN_CSS + ' @keyframes fadeIn { from { opacity: 0 } }'));
expect('css-prefix.mjs', 'animation references unprefixed', false, cssEnv(CLEAN_CSS + ' .ndd-x { animation: fadeIn 1s }'));
expect('css-prefix.mjs', 'styles body (D6)', false, cssEnv(CLEAN_CSS + ' body { margin: 0 }'));
expect('css-prefix.mjs', 'unscoped token-only block (ADR 0011)', true, cssEnv(CLEAN_CSS + ' [data-color-scheme="light"] { --ndd-a: 2; --ndd-b: 3 }'));
expect('css-prefix.mjs', 'unscoped block with a real property (ADR 0011)', false, cssEnv(CLEAN_CSS + ' [data-color-scheme="light"] { --ndd-a: 2; color: red }'));
expect('css-prefix.mjs', 'styles bare element (D6)', false, cssEnv(CLEAN_CSS + ' button { margin: 0 }'));
expect('css-prefix.mjs', 'component emits bare class=', false, cssEnv(CLEAN_CSS, { 'a.ts': 'template: `<div class="ndd-a btn"></div>`' }));
expect('css-prefix.mjs', 'component emits [class.x]', false, cssEnv(CLEAN_CSS, { 'a.ts': "host: { '[class.active]': 'on()' }" }));
expect('css-prefix.mjs', 'component emits classList', false, cssEnv(CLEAN_CSS, { 'a.ts': "el.classList.add('ndd-a', 'open')" }));
expect('css-prefix.mjs', 'component emits host class', false, cssEnv(CLEAN_CSS, { 'a.ts': "host: { class: 'ndd-a panel' }" }));
expect('css-prefix.mjs', 'component emits [class]={}', false, cssEnv(CLEAN_CSS, { 'a.html': '<div [class]="{ \'ndd-a\': x, hidden: y }"></div>' }));

// ── api-surface ───────────────────────────────────────────────────────────
const apiEnv = (esmExports, dtsExtra, expected, { stale = false } = {}) => {
  const d = tree({
    'dist/package.json': { module: 'fesm2022/x.mjs', typings: 'types/x.d.ts' },
    'dist/fesm2022/x.mjs': `const A = 1; class B {}\nexport { ${esmExports.join(', ')} };\n`,
    'dist/types/x.d.ts': `declare const A = 1;\ndeclare class B {}\n${dtsExtra}\nexport { ${esmExports.join(', ')} };\n`,
    'src/a.ts': 'export const A = 1;',
    'api.json': expected,
  });
  const old = new Date(Date.now() - 3600_000), now = new Date();
  for (const f of ['dist/fesm2022/x.mjs', 'dist/types/x.d.ts']) utimesSync(join(d, f), stale ? old : now, stale ? old : now);
  utimesSync(join(d, 'src/a.ts'), stale ? now : old, stale ? now : old);
  return { NDD_GATE_DIST: join(d, 'dist'), NDD_GATE_LIB_SRC: join(d, 'src'), NDD_GATE_API: join(d, 'api.json') };
};
const SURF = { exports: ['A', 'B'], types: ['T'] };
expect('api-surface.mjs', 'clean', true, apiEnv(['A', 'B'], 'export type T = 1;', SURF));
expect('api-surface.mjs', 'extra runtime export', false, apiEnv(['A', 'B', 'C'], 'export type T = 1;', SURF));
expect('api-surface.mjs', 'missing runtime export', false, apiEnv(['A'], 'export type T = 1;', SURF));
expect('api-surface.mjs', 'extra type export', false, apiEnv(['A', 'B'], 'export type T = 1;\nexport interface U {}', SURF));
expect('api-surface.mjs', 'stale build', false, apiEnv(['A', 'B'], 'export type T = 1;', SURF, { stale: true }));

// ── docs-api ──────────────────────────────────────────────────────────────
const docsEnv = md => {
  const d = tree({ 'api.json': { exports: ['provideDockableDesktop'], types: ['PanelRef'] }, 'docs/a.md': md, 'dist/package.json': { module: 'x.mjs' }, 'dist/x.mjs': 'selector: "ndd-desktop"' });
  return { NDD_GATE_API: join(d, 'api.json'), NDD_GATE_DOCS: join(d, 'docs'), NDD_GATE_DIST: join(d, 'dist') };
};
expect('docs-api.mjs', 'clean', true, docsEnv("```ts\nimport { provideDockableDesktop, type PanelRef } from 'angular-dockable-desktop';\n```\n```html\n<ndd-desktop />\n```"));
expect('docs-api.mjs', 'imports a missing name', false, docsEnv("```ts\nimport { WorkspaceClient } from 'angular-dockable-desktop';\n```"));
expect('docs-api.mjs', 'uses an unknown element', false, docsEnv('```html\n<ndd-window-manager />\n```'));

// ── non-vacuity stubber (the sweep itself runs the suite; here, only its parsing) ──────
{
  const { stub } = await import('./non-vacuity.mjs');
  const sample = [
    'export function a(x: number): { b: string; c: number[] } { return { b: "}", c: [x] }; }',
    'export function g<T extends { k: string }>(v: T): Promise<Map<string, T>> { return Promise.resolve(new Map()); }',
    'export const h = (x: number): number => x + 1;',
    'export const k = async <T,>(x: T): Promise<T> => x;',
    'export const DATA = { a: 1 };',
    '@Component({ selector: \'x-c\', imports: [A, B], template: `<b>{{ a }}</b>` })',
    'export class C {}',
    'export class W {',
    '  constructor(private x = 1) {}',
    '  open<I extends object = Record<string, unknown>>(id: string, o?: I): void {',
    '    const y = this.x',
    '      ?? helper(id);',
    '  }',
    '  private helper(): { a: number } { return { a: 1 }; }',
    '}',
  ].join('\n');
  const { out, count } = stub(sample);
  const ok = count === 7 && /imports: \[\], template: `<!-- non-vacuity stub -->`/.test(out) && !/\):\s*\{\s*throw/.test(out) && /export const DATA = \{ a: 1 \}/.test(out)
    && /open<I extends object = Record<string, unknown>>\(id: string, o\?: I\): void \{ throw new Error\('non-vacuity stub: open'\)/.test(out)
    && /helper\(\): \{ a: number \} \{ throw new Error\('non-vacuity stub: helper'\)/.test(out)
    && /constructor\(private x = 1\) \{\}/.test(out)
    && /Promise<Map<string, T>> \{ throw/.test(out) && out.startsWith('// @ts-nocheck');
  results.push({ rule: 'non-vacuity.mjs', label: 'stubs functions and class methods, not return types, calls or constructors', ok, got: ok ? 'pass' : 'fail', wanted: 'pass', out: out.replace(/\n/g, ' ⏎ ').slice(0, 300) });
}

// ── non-vacuity runner: never lends one module another module's red ─────────────────
{
  const src = (await import('node:fs')).readFileSync(join(ROOT, 'scripts/gates/non-vacuity.mjs'), 'utf8');
  const body = src.slice(src.indexOf("const report = join(ROOT, 'artifacts/.nv.json');"));
  const ok = /^const report[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*rmSync\(report, \{ force: true \}\);/.test(body);
  results.push({ rule: 'non-vacuity.mjs', label: 'removes the previous report before each module runs', ok, got: ok ? 'pass' : 'fail', wanted: 'pass', out: body.slice(0, 200) });
}

// ── report ────────────────────────────────────────────────────────────────
const bad = results.filter(r => !r.ok);
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.rule.padEnd(16)} ${r.label}${r.ok ? (process.argv.includes("-v") && r.wanted === "fail" ? `  → ${r.out}` : "") : `  (wanted ${r.wanted}, got ${r.got}: ${r.out})`}`);
rmSync(BASE, { recursive: true, force: true });
console.log(bad.length ? `selftest: FAIL — ${bad.length} rule case(s) did not behave` : `selftest: ok — ${results.length} cases, every violation rejected`);
process.exit(bad.length ? 1 : 0);
