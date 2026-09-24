/**
 * M4 — the desktop grid and zero unmount, wired in for real.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LIB, ROOT, VITEST_JSON } from './lib/config.mjs';

const failures = [];
const SRC = join(LIB, 'src/lib');
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(SRC).filter(f => f.endsWith('.ts'));
const rel = f => relative(ROOT, f);

// 1. Panels are created in exactly one place (ADR 0002), on a library-owned element, attached
//    to ApplicationRef — never through a ViewContainerRef a layout component owns.
for (const f of files) {
  const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // code, not prose
  if (/createComponent\(/.test(code) && !f.endsWith('panel/panel-host.ts')) failures.push(`${rel(f)} creates components — only panel-host.ts may (ADR 0002)`);
  if (/ViewContainerRef/.test(code) && /panel|desktop/.test(f)) failures.push(`${rel(f)} uses ViewContainerRef for panels (ADR 0002)`);
}
const host = readFileSync(join(SRC, 'panel/panel-host.ts'), 'utf8');
if (!/hostElement: this\.dom\.contentFor\(id\)/.test(host)) failures.push('panel-host.ts no longer creates panels on the library-owned content element');
if (!/this\.appRef\.attachView\(ref\.hostView\)/.test(host)) failures.push('panel-host.ts no longer attaches panels to ApplicationRef');

// 2. Modern Angular only: signal inputs/outputs, host metadata, standalone, OnPush default.
const FORBIDDEN = [
  [/@Input\(/, '@Input() — use input()'],
  [/@Output\(/, '@Output() — use output()'],
  [/@HostBinding\(/, '@HostBinding — use host: {}'],
  [/@HostListener\(/, '@HostListener — use host: {}'],
  [/@ViewChild\(|@ContentChild\(|@ViewChildren\(|@ContentChildren\(/, 'decorator queries — use viewChild()/contentChild()'],
  [/@NgModule\(/, 'NgModule — standalone only'],
  [/standalone:\s*false/, 'standalone: false'],
  [/ChangeDetectionStrategy\.(Default|Eager)/, 'non-OnPush change detection'],
  [/\*ngIf|\*ngFor|\[ngSwitch\]/, 'structural directives — use built-in control flow'],
];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const [re, what] of FORBIDDEN) if (re.test(src)) failures.push(`${rel(f)}: ${what}`);
}

// 3. No static inline layout (vdd D12): layout belongs in the stylesheet. Per-render values
//    (split sizes, cursor from panel options) may bind [style.x]; a static style="…" may not.
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (/\sstyle="/.test(src)) failures.push(`${rel(f)}: static style="…" in a template (D12)`);
  if (/host:\s*\{[^}]*\bstyle:/.test(src)) failures.push(`${rel(f)}: static host style (D12)`);
}

// 4. Promise tests.
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = new Set(report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title)));
for (const t of [
  "keeps a panel's own DOM node identical across every placement change",
  "parks a background tab's panel off-screen, alive, with no slot of its own",
  'shows a placeholder, then the real component, in the same panel element, created once',
  'skips keys the component does not declare, without an error',
  'a panel can inject what is provided above <ndd-desktop>',
]) if (!passed.has(t)) failures.push(`required test did not pass: "${t}"`);

// 5. Non-vacuity for the modules M4 touched.
const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '4', '--exact'], { stdio: 'inherit' });
if (nv.status !== 0) failures.push('non-vacuity sweep failed');

if (failures.length) { console.error('M4: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M4: ok');
