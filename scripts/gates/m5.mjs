/**
 * M5 — floating windows.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT, VITEST_JSON } from './lib/config.mjs';

const failures = [];
const code = f => readFileSync(join(LIB, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const fw = code('src/lib/desktop/floating-window.ts');
const desktop = code('src/lib/desktop/desktop.ts');

// 1. Anchored windows are placed by logical insets, so RTL mirrors them with no JS (vdd).
if (!/\[style\.inset-inline-start\]/.test(fw) || !/\[style\.inset-inline-end\]/.test(fw))
  failures.push('floating-window: anchored placement no longer uses inset-inline-start/-end');
if (/\bisRtl\b|dir\(\)\s*===\s*'rtl'/.test(fw)) failures.push('floating-window: placement branches on direction — the logical insets must do the mirroring');

// 2. The clamp is identity-guarded (it writes to the list it reads).
if (!/clampFloatingRect\(/.test(desktop) || !/if \(next !== current\)/.test(desktop))
  failures.push('desktop: the viewport clamp is missing or no longer identity-guarded');

// 3. Promise tests.
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = new Set(report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title)));
for (const t of [
  'renders focused chrome on the active window and not on the others (D2)',
  'squares off a maximized window, matching the class the component renders (D9)',
  're-mirrors an already-anchored window when direction is switched live, with no other action taken',
  'clamps a free-floating window back into reach, position included',
]) if (!passed.has(t)) failures.push(`required test did not pass: "${t}"`);

// 4. The browser gate's D5 check must reject rdd's handle geometry (non-vacuity of the gate).
const control = spawnSync('node', [join(ROOT, 'scripts/gates/browser/m5.mjs'), '--control'], { encoding: 'utf8' });
if (control.status === 0) failures.push('M5 browser gate accepted rdd\'s clipped handle geometry — D5 is not being measured');
else if (!/extends outside the window/.test(control.stdout + control.stderr)) failures.push('M5 control failed, but not on D5 containment');

// 5. Non-vacuity for the modules M5 touched.
const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '5', '--exact'], { stdio: 'inherit' });
if (nv.status !== 0) failures.push('non-vacuity sweep failed');

if (failures.length) { console.error('M5: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M5: ok');
