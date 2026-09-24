/**
 * M7 — minimise, the taskbar, live previews.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT, VITEST_JSON } from './lib/config.mjs';

const failures = [];
const code = f => readFileSync(join(LIB, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

// 1. The preview holds the live panel through the persistence port only, and gives it back
//    with the ownership check (a closing preview must never steal it from a new slot).
const preview = code('src/lib/desktop/taskbar-preview.ts');
if (!/this\.host\.dom\.moveTo\(this\.panelId\(\), el, \{ refocus: false \}\)/.test(preview)) failures.push('taskbar-preview: no longer moves the live panel in (refocus: false)');
if (!/this\.host\.dom\.hostOf\(id\) === this\.mine/.test(preview)) failures.push('taskbar-preview: releases the panel without the ownership check');
if (/cloneNode|innerHTML/.test(preview)) failures.push('taskbar-preview: copies DOM — a preview must be the live panel, never a copy');

// 2. Promise tests.
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = new Set(report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title)));
for (const t of [
  "moves the panel's own element into the preview — the same DOM node",
  'returns the panel to the off-screen store when the preview closes',
  'emits the mode class the stylesheet is keyed on (rdd shipped this broken)',
  'first tap opens the preview, second restores',
]) if (!passed.has(t)) failures.push(`required test did not pass: "${t}"`);

// 3. The browser gate must reject rdd's D11 defect (non-vacuity of the gate).
const control = spawnSync('node', [join(ROOT, 'scripts/gates/browser/m7.mjs'), '--control'], { encoding: 'utf8' });
if (control.status === 0) failures.push('M7 browser gate accepted rdd\'s dead-thumbnail preview — D11 is not being measured');
else if (!/D11: the thumbnail is not hit-testable/.test(control.stdout + control.stderr)) failures.push('M7 control failed, but not on D11');

// 4. Non-vacuity for the modules M7 touched.
const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '7', '--exact'], { stdio: 'inherit' });
if (nv.status !== 0) failures.push('non-vacuity sweep failed');

if (failures.length) { console.error('M7: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M7: ok');
