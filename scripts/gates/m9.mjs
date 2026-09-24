/**
 * M9 — sidebar, secondary sidebar, toolbar.
 *
 * The ported tests cover behaviour. These rules pin the structural decisions behind it, which a
 * jsdom test cannot see (after vdd's own M9 gate, adapted to Angular):
 *
 *   1  D12   the sidebar's layout is in the stylesheet; only per-render values are inline
 *   2        left and right come from one template, shared by primary and secondary
 *   3        each pane gets its own injector, so injectSidebarTab() knows its tab
 *   4        the secondary takes its side from the primary and refuses to nest
 *   5  SB47  the resize flag is per instance
 *   6        toolbar state is the workspace's; controlled means *present*, false/null included
 *   7        the flyout escapes the strip, and every way of leaving it removes its listeners
 *   8        only the collapsed size is inline, never the open size
 *   9  D13   no @keyframes or animation name the host page can hijack
 *   10       rail entries are told apart by explicit discriminators
 *   11       every vdd test that writes or listens to a model has a passing `[( )]` twin
 *   12       required tests passed; browser gate control rejected; non-vacuity
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT, STYLES, VITEST_JSON } from './lib/config.mjs';
import { animationRefs, keyframeNames, stripComments } from './lib/css.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const code = f => readFileSync(join(LIB, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

const css = stripComments(readFileSync(STYLES, 'utf8'));
const sidebar = code('src/lib/sidebar/sidebar.ts');
const toolbar = code('src/lib/toolbar/toolbar.ts');
const types = code('src/lib/core/sidebar-types.ts');
const toolbarState = code('src/lib/core/toolbar-state.ts');

/** Every declaration of every rule whose selector list contains `selector` exactly. */
function declarationsFor(selector) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map(s => s.trim());
    if (selectors.includes(selector)) out.push(...m[2].split(';').map(d => d.trim().replace(/\s+/g, ' ')).filter(Boolean));
  }
  return out.join('; ');
}

// ── 1. D12: structure in the stylesheet ─────────────────────────────────────
const structural = {
  '.ndd-sidebar-layout': ['display: flex', 'height: 100%', 'overflow: hidden'],
  '.ndd-sidebar-strip-outer': ['overflow: hidden', 'flex-shrink: 0', 'transition: width'],
  '.ndd-sidebar-main': ['flex-basis: 0', 'min-width: 0', 'overflow: hidden'],
  '.ndd-sidebar-content-drawer': ['overflow: hidden', 'transition:'],
  '.ndd-sidebar-drawer-pane': ['flex-direction: column', 'height: 100%'],
};
for (const [selector, properties] of Object.entries(structural)) {
  const decl = declarationsFor(selector);
  must(decl.length > 0, `${selector} has no rule — the layout must be in CSS, not inline (D12)`);
  for (const p of properties) must(decl.includes(p), `${selector} must declare ${p}`);
}
// Per-render values only: the animating sizes, each pane's display, the drag's transition
// switch — plus the resizer's hit-area box, which vdd also keeps inline.
const allowedInline = new Set(['width', 'height', 'flex-basis', 'min-width', 'max-width', 'display', 'transition', 'cursor', 'flex-shrink', 'z-index']);
const inlineKeys = [
  ...[...sidebar.matchAll(/\[style\.([\w-]+)/g)].map(m => m[1]),
  ...[...sidebar.matchAll(/\sstyle="([^"]*)"/g)].flatMap(m => m[1].split(';').map(d => d.split(':')[0].trim()).filter(Boolean)),
];
must(inlineKeys.length > 0, 'expected the sidebar to bind its animating sizes inline');
for (const key of inlineKeys) must(allowedInline.has(key), `inline style "${key}" belongs in the stylesheet (D12)`);
must(!/\[style\]=/.test(sidebar), 'the sidebar must not bind a whole style object — each inline value is reviewed by name (D12)');

// ── 2. One template for both sides and both sidebars ────────────────────────
must((sidebar.match(/template: TEMPLATE/g) ?? []).length === 2, 'primary and secondary must share one template, not fork it');
must((sidebar.match(/extends NddSidebarBase/g) ?? []).length === 2, 'primary and secondary must share one base class');
must(/this\.side\(\) === 'left' \? LEFT : RIGHT/.test(sidebar), 'the piece order must be one list keyed on the side, not duplicated markup');
must((sidebar.match(/class="ndd-sidebar-strip-outer"/g) ?? []).length === 1, 'the rail must be rendered exactly once — a second copy for the other side will drift');
must((sidebar.match(/class="ndd-sidebar-content-drawer"/g) ?? []).length === 1, 'the drawer must be rendered exactly once');

// ── 3. Per-pane tab context ─────────────────────────────────────────────────
must(/Injector\.create\(\{ providers: \[\{ provide: SIDEBAR_TAB/.test(sidebar), 'each pane must get its own injector providing its tab context');
must((sidebar.match(/injector: paneInjector\(tab\.id\)/g) ?? []).length >= 3, 'the tab template, the header template and the tab component must all be created with the pane injector');
must(/descendants: false/.test(sidebar), 'template queries must be direct-children only, or a primary picks up its secondary\'s templates');

// ── 4. The secondary ────────────────────────────────────────────────────────
must(/inject\(SIDEBAR, \{ optional: true, skipSelf: true \}\)/.test(sidebar), 'the secondary must look for its primary above itself (skipSelf)');
must(/this\.primary\.isSecondary/.test(sidebar), 'nesting a secondary in a secondary must be refused');
must(/position: \{ get: \(\) => this\.side\(\)/.test(sidebar), 'the context\'s position must be read live — inputs are not set when the context is built');

// ── 5. Resize state per instance (SB47) ─────────────────────────────────────
must(/^\s+protected readonly resizing = signal\(false\);/m.test(sidebar), 'each sidebar instance must own its resizing flag');
must(!/^(const|let) resizing/m.test(sidebar), 'a module-level resizing flag suppresses the wrong drawer\'s transition');
must(/\[style\.transition\]="resizing\(\) \? 'none' : null"/.test(sidebar), 'only the resizing drawer may drop its transition');

// ── 6. Toolbar state ────────────────────────────────────────────────────────
must(/return injectWorkspace\(\)\.toolbar;/.test(toolbar), 'injectToolbar() must read the workspace, not a provider of its own');
must(!/providers:/.test(toolbar), 'the toolbar must not introduce a provider');
must(/createToolbarState\(\)/.test(code('src/lib/workspace/workspace.ts')), 'the workspace must create the toolbar state, so it is live before any component');
must(/item\.active !== undefined/.test(toolbar), 'a toggle is controlled when `active` is present at all, including false');
must(/item\.activeItemId !== undefined/.test(toolbar), 'a group is controlled when `activeItemId` is present at all, including null');

// ── 7. The flyout ───────────────────────────────────────────────────────────
must(/nddPortal\s+class="ndd-toolbar-group-flyout"/.test(toolbar), 'the flyout must be portalled out, or the strip\'s overflow: hidden clips it');
must(/addEventListener\('pointerdown', this\.onOutside, \{ capture: true \}\)/.test(toolbar), 'the flyout needs a capture-phase pointerdown to dismiss');
must(/removeEventListener\('pointerdown', this\.onOutside, \{ capture: true \}\)/.test(toolbar), 'closing must remove the capture listener with the same options');
must(/key === 'Escape'/.test(toolbar), 'Escape must dismiss the flyout');
must(/onDestroy\(\(\) => this\.closeFlyout\(\)\)/.test(toolbar), 'destroying with the flyout open must remove its document listeners');
must(/target instanceof Node/.test(toolbar), 'the dismiss handler must guard non-Node targets — contains() throws on them');

// ── 8. Collapsed size only ──────────────────────────────────────────────────
must(/'\[style\.width\]': "collapsed\(\) && vertical\(\) \? '0px' : null"/.test(toolbar), 'a visible vertical toolbar must set no inline width');
must(/'\[style\.height\]': "collapsed\(\) && !vertical\(\) \? '0px' : null"/.test(toolbar), 'a visible horizontal toolbar must set no inline height');
must(/\.ndd-toolbar-btn\b/.test(css), 'the toolbar button size must be in CSS, where a media query can override it');

// ── 9. D13: prefixed keyframes ──────────────────────────────────────────────
const keyframes = keyframeNames(css);
must(keyframes.size > 0, 'expected the stylesheet to define keyframes');
for (const name of keyframes) must(name.startsWith('ndd-'), `@keyframes ${name} is unprefixed — the host page can redefine it`);
for (const name of animationRefs(css)) must(name.startsWith('ndd-'), `animation "${name}" names an unprefixed keyframe`);

// ── 10. Rail discriminators ─────────────────────────────────────────────────
must(/'custom' in entry && entry\.custom === true/.test(types), 'a custom entry must be identified by an explicit marker, not by carrying a component');
must(/!isCustomEntry\(entry\) && 'onClick' in entry/.test(types), 'an action button must be distinguished from a custom entry, not merely from a tab');
must(/\[id\] === true/.test(toolbarState), 'an unset toggle must read as false, not undefined');

// ── 11. Every model test has a [( )] twin ───────────────────────────────────
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title));
/** `SB11-SB14` → 11..14; `SB9/SB13` → 9, 13. */
const numbers = (title, prefix) => {
  const out = new Set();
  for (const m of title.matchAll(new RegExp(`${prefix}(\\d+)(?:-${prefix}(\\d+))?`, 'g'))) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let n = from; n <= to; n++) out.add(n);
  }
  return out;
};
const VDD = join(ROOT, '../vue-dockable-desktop/test/components');
for (const [file, prefix] of [['sidebar.test.ts', 'SB'], ['toolbar.test.ts', 'TB']]) {
  const path = join(VDD, file);
  if (!existsSync(path)) { failures.push(`cannot read vdd's ${file} to derive the model tests`); continue; }
  const src = readFileSync(path, 'utf8');
  const required = new Set();
  for (const block of src.split(/\ndescribe\(/).slice(1)) {
    const describeTitle = block.slice(0, block.indexOf('\n'));
    const fallback = [...numbers(describeTitle, prefix)][0];
    for (const test of block.split(/\n\s+it\(/).slice(1)) {
      // A model test writes one (`setProps({ visible: … })`) or listens to one (`onUpdate:…`).
      if (!/'onUpdate:|setProps\(\{ (visible|stripVisible|width|activeTabId)\b/.test(test)) continue;
      const own = numbers(test.slice(0, test.indexOf('\n')), prefix);
      for (const n of own.size ? own : [fallback]) if (n !== undefined) required.add(n);
    }
  }
  must(required.size > 0, `${file}: derived no model tests — the derivation is broken`);
  const twins = new Set(passed.filter(t => t.startsWith('[(')).flatMap(t => [...numbers(t, prefix)]));
  for (const n of [...required].sort((a, b) => a - b)) must(twins.has(n), `${prefix}${n} writes or listens to a model but has no passing [( )] twin`);
  if (!failures.length) console.log(`M9: ${prefix} model tests ${[...required].map(n => prefix + n).join(' ')} — all twinned`);
}

// ── 12. Required tests, browser control, non-vacuity ────────────────────────
for (const t of [
  "dragging the primary's resize handle leaves the secondary's drawer transition untouched, and vice versa",
  'closing from inside the secondary tab closes the secondary, not the primary',
  'each level sees its own correct context value',
  'a tab template wins over the component, gets the typed context, and scopes injectSidebarTab()',
  '[(activeTabId)] and [(width)] in a template: both directions, on the primary',
  'TB36: active=false ignores workspace state even if that id is toggled there',
  'TB23: clicking group button renders flyout in document.body',
]) must(passed.includes(t), `required test did not pass: "${t}"`);

const control = spawnSync('node', [join(ROOT, 'scripts/gates/browser/m9.mjs'), '--control'], { encoding: 'utf8' });
must(control.status !== 0, 'M9 browser gate accepted a sidebar whose content wrapper can be inflated by a wide panel — D12 is not being measured');

const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '9', '--exact'], { stdio: 'inherit' });
must(nv.status === 0, 'non-vacuity sweep failed');

if (failures.length) { console.error('M9: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M9: ok');
