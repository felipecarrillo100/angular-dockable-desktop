/**
 * M8 — context menus.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT, VITEST_JSON } from './lib/config.mjs';

const failures = [];
const code = f => readFileSync(join(LIB, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

// 1. The menu is WAI-ARIA shaped (ADR 0005): role=menu, menuitem roles, keyboard handling.
const menu = code('src/lib/context-menu/context-menu.ts');
for (const [re, what] of [
  [/role="menu"/, 'role="menu"'],
  [/'menuitemcheckbox' : 'menuitem'/, 'menuitem / menuitemcheckbox roles'],
  [/aria-haspopup="menu"/, 'aria-haspopup on submenu parents'],
  [/case 'ArrowDown'/, 'arrow-key navigation'],
  [/case 'Home'/, 'Home/End'],
  [/returnFocus/, 'focus restoration'],
]) if (!re.test(menu)) failures.push(`context-menu: missing ${what}`);
// Dismissal keeps both listeners (capture pointerdown + bubbled click) — rdd learned this against maps.
if (!/addEventListener\('pointerdown', onOutside, \{ capture: true \}\)/.test(menu) || !/addEventListener\('click', onOutside\)/.test(menu))
  failures.push('context-menu: dismissal must listen to capture-phase pointerdown AND bubbled click');

// 2. Promise tests.
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = new Set(report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title)));
for (const t of [
  "Maximize actually maximises — rdd's did nothing at all",
  'renders the template instead of the library markup, with the items, position and a close',
  'moves focus into the menu, and roves across enabled items with arrows, Home and End',
  'enters a submenu with ArrowRight and leaves it with ArrowLeft (mirrored under RTL)',
  'also closes on a bubbled click, which survives stopPropagation on pointerdown',
]) if (!passed.has(t)) failures.push(`required test did not pass: "${t}"`);

// 3. The browser gate must reject vdd's overlapping preview animation (N2).
const control = spawnSync('node', [join(ROOT, 'scripts/gates/browser/m8.mjs'), '--control'], { encoding: 'utf8' });
if (control.status === 0) failures.push('M8 browser gate accepted a preview that covers its icon — N2 is not being measured');

// 4. Non-vacuity for the modules M8 touched.
const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '8', '--exact'], { stdio: 'inherit' });
if (nv.status !== 0) failures.push('non-vacuity sweep failed');

if (failures.length) { console.error('M8: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M8: ok');
