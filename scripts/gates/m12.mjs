/**
 * M12 — contributions, i18n, direction, colour scheme, diagnostics.
 *
 * After vdd's M12 gate, adapted, plus the plan's own promise that the diagnostics are absent
 * from a production bundle — checked against the real bundle, with a development build of the
 * same app as the negative control:
 *
 *   1  a contribution is read from activePanelId and nothing else (D2)
 *   2  withdrawal is guarded, and publishing comes first
 *   3  merging is a plain function first; nothing-to-add returns the same array
 *   4  the i18n surface is on the workspace; ids namespaced; stored titles are Labels
 *   5  the consumer classes reach their elements
 *   6  diagnostics are actionable and dev-guarded *inline* (a helper function defeats folding)
 *   7  the colour scheme reads the attribute and disconnects
 *   8  the production bundle carries no dev-only message; the development build does (control)
 *   9  required tests passed; non-vacuity
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT, VITEST_JSON } from './lib/config.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const code = f => readFileSync(join(LIB, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|<!--[\s\S]*?-->/gm, '');
const libFiles = dir => readdirSync(join(LIB, dir), { recursive: true }).filter(f => String(f).endsWith('.ts') && !String(f).endsWith('.nv-orig')).map(f => join(dir, String(f)));

const contributions = code('src/lib/core/contributions.ts');
const inject = code('src/lib/contributions/inject-contributions.ts');
const workspace = code('src/lib/workspace/workspace.ts');
const messages = code('src/lib/core/messages.ts');
const colorScheme = code('src/lib/core/color-scheme.ts');
const desktop = code('src/lib/desktop/desktop.ts');
const store = code('src/lib/panel-overlay/overlay-store.ts');
const widget = code('src/lib/panel-overlay/floating-widget.ts');

// ── 1. The invariant ────────────────────────────────────────────────────────
must(/activeContributionSignal\(this\.contributions, \(\) => this\._state\(\)\.activePanelId\)/.test(workspace), 'the active contribution must be read from activePanelId, the single resolution point');
must(!/Object\.keys\([^)]*panels\)\[0\]/.test(workspace), 'nothing may seed or read an active panel from insertion order (D2)');
must(!/from '\.\.\/workspace/.test(contributions), 'the contribution store must not import the workspace — it is handed the active id');

// ── 2. Withdrawal guarded, publish first ────────────────────────────────────
must(/if \(map\(\)\.get\(panelId\) === stored\)/.test(contributions), 'a withdrawal must only clear the registration it belongs to');
must(/const previous = withdraw;\s*withdraw = workspace\.contributions\.publish\(id, next\);\s*previous\(\);/.test(inject), 'a republish must publish before withdrawing');
must(/injectPanelContribution\(contribution: \(\) => PanelContribution\)/.test(inject), 'injectPanelContribution must take a getter, so republishing is the framework\'s job');
must(/onDestroy\(\(\) => withdraw\(\)\)/.test(inject), 'a contribution must be withdrawn with its component');

// ── 3. Merging ──────────────────────────────────────────────────────────────
for (const fn of ['sectionToTab', 'mergeToolbarItems', 'mergeSidebarTabs']) must(new RegExp(`export function ${fn}\\(`).test(contributions), `${fn} must be a plain function`);
must(/if \(!contributed\?\.length\) return staticItems;/.test(contributions), 'a merge with nothing to add must return the original array');
must(/if \(!sections\?\.length\) return staticTabs;/.test(contributions), 'the same, for tabs');
must(!/eagerMount|preserveState/.test(contributions.replace(/`[^`]*`/g, '')), 'a contributed section must not set eagerMount or preserveState');

// ── 4. i18n on the workspace ────────────────────────────────────────────────
must(/format\(label: Label \| undefined\): string/.test(workspace), 'format must be on the workspace');
must(/readonly messages: Record<keyof typeof defaultMessages, MessageDescriptor>/.test(workspace), 'the message table must be on the workspace');
must(/readonly classes: Required<HostClasses>/.test(workspace), 'the consumer classes must be on the workspace, with every field present');
const ids = [...messages.matchAll(/id: '([^']+)'/g)].map(m => m[1]);
must(ids.length > 10, 'expected the built-in message table');
for (const id of ids) must(id.startsWith('ndd.'), `message id "${id}" is not namespaced under ndd.`);
must(/title: Label;/.test(store), 'ManagedWidget.title must be a Label — a stored string can never follow a locale change');
must(/\{\{ workspace\.format\(title\(\)\) \}\}/.test(widget), 'the widget header must resolve its title on every render');

// ── 5. Consumer classes reach their elements ────────────────────────────────
const host = code('src/lib/overlays/overlay-host.ts');
must(/workspace\.classes\.modalBody : this\.workspace\.classes\.sidePanelBody/.test(host), 'the frame must apply the configured body class');
must(/classes\.modal\b/.test(host) && /classes\.sidePanel\b/.test(host), 'the modal and side-panel hosts must apply their classes');
const win = code('src/lib/desktop/floating-window.ts');
must(/workspace\.classes\.window\b/.test(win) && /workspace\.classes\.windowBody/.test(win), 'the floating window must apply window and windowBody');

// ── 6. Diagnostics ──────────────────────────────────────────────────────────
must(/--ndd-styles-loaded/.test(desktop), 'the stylesheet sentinel must be checked');
must(/"styles": \["angular-dockable-desktop\/styles\.css"/.test(desktop), 'the sentinel message must contain the exact configuration to paste');
must(/catch \{/.test(desktop), 'a missing getComputedStyle (SSR) must not throw');
must(/Zero height starts at:/.test(desktop) && /warnedZeroHeight/.test(desktop), 'the zero-height warning must name where the chain breaks, and fire once');
for (const f of libFiles('src/lib')) {
  const src = code(f);
  must(!/\bdevMode\(\)/.test(src), `${f} guards dev code behind a helper call — it cannot fold away in production; inline the ngDevMode check`);
}

// ── 7. Colour scheme ────────────────────────────────────────────────────────
must(/new MutationObserver/.test(colorScheme) && /data-color-scheme/.test(colorScheme), 'the scheme must follow the attribute');
must(/onDestroy\(\(\) => observer\.disconnect\(\)\)/.test(colorScheme), 'the observer must be disconnected with its component');
must(/=== 'light' \? 'light' : 'dark'/.test(colorScheme), 'anything other than "light" must read as dark');

// ── 8. The production bundle ────────────────────────────────────────────────
const DEV_ONLY = ['stylesheet is not loaded', 'has no height', 'has no effect because the default drawer header', 'was called outside a panel', 'Repaired the saved layout', 'is not registered', 'stretches the block axis', 'has no content: give it'];
const bundle = dir => readdirSync(dir).filter(f => f.endsWith('.js')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
const prodDir = join(ROOT, 'dist/playground/browser');
if (!existsSync(prodDir)) failures.push('no production playground build to inspect (the standing gate builds it)');
else {
  const prod = bundle(prodDir);
  for (const m of DEV_ONLY) must(!prod.includes(m), `the production bundle still carries the dev-only message "${m}"`);
  must(prod.includes('Could not load panel'), 'the production bundle is missing a real runtime error message — the grep is not reading the library\'s code');
}
const devOut = join(ROOT, 'artifacts/M12-devbuild');
rmSync(devOut, { recursive: true, force: true });
const dev = spawnSync('npx', ['ng', 'build', 'playground', '--configuration', 'development', '--output-path', devOut], { cwd: ROOT, encoding: 'utf8' });
if (dev.status !== 0) failures.push(`the development build (the control) failed: ${dev.stderr.slice(-400)}`);
else {
  const devBundle = bundle(join(devOut, 'browser'));
  const missing = DEV_ONLY.filter(m => !devBundle.includes(m));
  must(missing.length === 0, `control: the development bundle lacks ${JSON.stringify(missing)} — the absence check proves nothing`);
}

// ── 9. Tests, non-vacuity ───────────────────────────────────────────────────
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = new Set(report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title)));
for (const t of [
  'PC12: surfaces the contribution of the panel that is actually visible',
  'a minimised panel keeps publishing but is not the active one',
  'a background tab keeps publishing but is not the active one',
  'a panel never momentarily publishes nothing while updating',
  'every configured class reaches its own element',
  "a formatter reading a signal re-renders the library's own labels",
]) must(passed.has(t), `required test did not pass: "${t}"`);

const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '12', '--exact'], { stdio: 'inherit' });
must(nv.status === 0, 'non-vacuity sweep failed');

if (failures.length) { console.error('M12: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M12: ok');
