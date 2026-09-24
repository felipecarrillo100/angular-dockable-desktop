/**
 * M6 — drag and dock.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT, VITEST_JSON } from './lib/config.mjs';

const failures = [];
const VDD = join(ROOT, '../vue-dockable-desktop');
const code = f => readFileSync(join(LIB, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

// 1. High-frequency drag listeners are registered outside Angular's zone (ADR 0006).
const dock = code('src/lib/desktop/drag-dock.ts');
const adds = [...dock.matchAll(/addEventListener\('pointermove'/g)].length;
const outside = [...dock.matchAll(/runOutsideAngular\(\(\) => \{[\s\S]*?addEventListener\('pointermove'/g)].length;
if (adds === 0) failures.push('drag-dock: found no pointermove listeners — the check is not reading the source');
if (outside < adds) failures.push(`drag-dock: ${adds - outside} pointermove listener(s) registered inside Angular's zone (ADR 0006)`);
if (/setPointerCapture/.test(dock.slice(dock.indexOf('private startMouse'), dock.indexOf('private startTouch'))))
  failures.push('drag-dock: the mouse path captures the pointer — that suppresses hover on the drop zones');

// 2. Promise tests.
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = new Set(report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title)));
for (const t of [
  'mirrors left and right drop sides under RTL',
  'corrects the insertion index when reordering within the same leaf',
  'a long press that never moves reports itself rather than starting a drag',
  'hovering a cross target box clears the active edge-drop highlight',
]) if (!passed.has(t)) failures.push(`required test did not pass: "${t}"`);

// 3. The differential gate: vdd is the oracle. Build vdd's playground from its read-only checkout
//    into our artifacts, proving the checkout is untouched, then diff; and the planted-bug control
//    must be caught.
if (!existsSync(join(VDD, 'playground'))) failures.push('vue-dockable-desktop checkout not found beside this repo');
else {
  const status = () => spawnSync('git', ['status', '--porcelain'], { cwd: VDD, encoding: 'utf8' }).stdout;
  const before = status();
  const build = spawnSync('npx', ['vite', 'build', 'playground', '--outDir', join(ROOT, 'artifacts/vdd-playground'), '--emptyOutDir'], { cwd: VDD, encoding: 'utf8' });
  if (build.status !== 0) failures.push(`building vdd's playground failed: ${(build.stderr || build.stdout).slice(-300)}`);
  if (status() !== before) failures.push('building vdd\'s playground modified the vue-dockable-desktop checkout (it is read-only)');
  const diff = spawnSync('node', [join(ROOT, 'scripts/gates/browser/m6-diff.mjs')], { stdio: 'inherit' });
  if (diff.status !== 0) failures.push('differential gate: ndd\'s layouts differ from vdd\'s for the same gestures');
  const control = spawnSync('node', [join(ROOT, 'scripts/gates/browser/m6-diff.mjs'), '--control'], { encoding: 'utf8' });
  if (control.status === 0) failures.push('differential gate accepted a planted direction-mirroring bug — the diff proves nothing');
}

// 4. Non-vacuity for the modules M6 touched.
const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '6', '--exact'], { stdio: 'inherit' });
if (nv.status !== 0) failures.push('non-vacuity sweep failed');

if (failures.length) { console.error('M6: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M6: ok');
