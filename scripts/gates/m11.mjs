/**
 * M11 — the panel overlay: toolbars, floating widgets, stretch, the toolbar controls.
 *
 * Handle sets, stretch placement and snapping are covered by the ported tests; hit areas and
 * real tracking are measured in scripts/gates/browser/m11.mjs. These pin the structural
 * decisions neither can see — after vdd's M11 gate, adapted to Angular:
 *
 *   1  the geometry rules are pure functions in core
 *   2  stretch is two pins, not a width; a stretched axis keeps its stored size
 *   3  one placement model, written in one place
 *   4  a press is not a detach
 *   5  effects that write the stacks do so untracked (Angular's form of vdd's explicit sources)
 *   6  the toolbar re-measures, releases its inset, and inlines only position
 *   7  stacking uses the placement's buckets
 *   8  one store, provided once; records replaced, never mutated
 *   9  stacking and clipping in CSS; no handle at a negative inset (D5); the dropdown portalled
 *   10 every host that replaced a vdd <div> declares its display (found by this milestone)
 *   11 required tests passed; browser control rejected; non-vacuity
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT, STYLES, VITEST_JSON } from './lib/config.mjs';
import { stripComments } from './lib/css.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const code = f => readFileSync(join(LIB, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|<!--[\s\S]*?-->/gm, '');

const css = stripComments(readFileSync(STYLES, 'utf8'));
const core = code('src/lib/core/panel-overlay.ts');
const store = code('src/lib/panel-overlay/overlay-store.ts');
const widget = code('src/lib/panel-overlay/floating-widget.ts');
const overlay = code('src/lib/panel-overlay/panel-overlay.ts');
const search = code('src/lib/panel-overlay/toolbar-search.ts');
const toolbar = overlay.slice(overlay.indexOf("selector: 'ndd-panel-toolbar'"), overlay.indexOf('export function injectPanelOverlay'));
const root = overlay.slice(0, overlay.indexOf("selector: 'ndd-panel-toolbar'"));

/** Every declaration of every rule whose selector list contains `selector` exactly. */
const declarationsFor = selector => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(m => m[1].split(',').map(s => s.trim()).includes(selector))
  .map(m => m[2]).join(';');

// ── 1. Pure geometry ────────────────────────────────────────────────────────
for (const fn of ['handleDirs', 'dockedBand', 'anchorAfterRelease', 'stackOffset', 'hoveredZone']) {
  must(new RegExp(`export function ${fn}\\(`).test(core), `${fn} must be a pure function in core`);
}
must(!/from '@angular\/core'/.test(core), 'the geometry core must not import Angular — that is what keeps it testable');
must(/const freeBlock: ResizeDir = anchor\.startsWith\('top-'\) \? 's' : 'n'/.test(core), 'the free block edge must follow the anchor');
must(/const pinsPhysicalRight = anchor\.endsWith\('-right'\) !== isRtl/.test(core), 'the free inline edge must account for reading direction');
must(/if \(!inlineStretched && !blockStretched\) dirs\.push/.test(core), 'the corner belongs only to the all-pinned state');

// ── 2. Stretch is two pins ──────────────────────────────────────────────────
must(/style\['inset-inline-start'\] = `\$\{insets\.inlineStart \+ DOCK_INSET\}px`/.test(widget), 'an inline-stretched widget must pin inline-start');
must(/style\['inset-inline-end'\] = `\$\{insets\.inlineEnd \+ DOCK_INSET\}px`/.test(widget), 'an inline-stretched widget must pin inline-end');
must(/if \(stretchesInline\(stretch\)\) \{[\s\S]{0,260}\} else \{[\s\S]{0,200}style\['width'\]/.test(widget), 'a width may only be written on the *unstretched* branch');
must(/if \(stretchesBlock\(stretch\)\) \{\s*style\['top'\][\s\S]{0,80}style\['bottom'\]/.test(widget), 'a block-stretched widget must pin both block ends');
must(/stretchesInline\(effective\) \? current\.w : rect\.w/.test(widget), 'a still-stretched axis must keep its stored size during a resize');
must(/w: armed\.inline \? from\.w : current\.w/.test(widget), 'snapping must restore the pre-drag size on the snapped axis');

// ── 3. One placement model ──────────────────────────────────────────────────
must(/private applyPlacement\(/.test(widget), 'placement must have a single write path');
must((widget.match(/this\.placement\.set\(/g) ?? []).length === 1, 'placement must be written in exactly one place');
must(/readonly placement = model<PanelFloatPlacement>\(/.test(widget), 'anchor and stretch must be one model, not two inputs plus a callback');
must(/readonly open = model\(true\)/.test(widget), 'open must be a model');

// ── 4. A press is not a detach ──────────────────────────────────────────────
must(/DRAG_THRESHOLD\) return;/.test(widget), 'undocking must wait for the drag threshold');
const headerDown = widget.slice(widget.indexOf('protected onHeaderDown('), widget.indexOf('protected onPointerMove('));
must(headerDown.length > 0 && !/this\.mode\.set\(/.test(headerDown), 'the header press handler must not change mode — only a real drag may');

// ── 5. Effects that write what they read ────────────────────────────────────
// Registering in a stack reads the stacks to skip a no-op write. vdd's answer was explicit watch
// sources; Angular's is reading the stacks untracked inside the store's writers.
must(/const current = untracked\(stacks\)/.test(store), 'dock() must read the stacks untracked, or the widget effect that calls it re-triggers itself');
must(/untracked\(\(\) => \{\s*if \(!this\.store \|\| !isOpen\) return;/.test(widget), 'the stack-registration effect must write untracked');

// ── 6. The toolbar ──────────────────────────────────────────────────────────
must(/new ResizeObserver\(measure\)/.test(toolbar), 'the toolbar must re-measure, or a layout restore bakes in a wrong inset permanently');
must(/onCleanup\(\(\) => \{[\s\S]{0,120}unregisterToolbar/.test(toolbar), 'a toolbar must release its inset when it goes away');
must(/'inset-inline-start': '0px'/.test(toolbar) && !/padding|gap|backdrop/.test(toolbar), 'only position may be inline on a toolbar — the rest belongs in the stylesheet (D12)');

// ── 7. Stacking buckets ─────────────────────────────────────────────────────
must(/bucketsFor\(this\.anchor\(\), this\.stretch\(\)\)/.test(widget), "stacking must use the placement's buckets, not just its anchor");
must(/offset = Math\.max\(offset, own\)/.test(core), 'a widget must clear the tallest of the buckets it occupies');

// ── 8. One store ────────────────────────────────────────────────────────────
must(/export function createPanelOverlayStore\(\)/.test(store), 'the overlay state must be one store');
must((root.match(/provide: /g) ?? []).length === 1 && /useFactory: createPanelOverlayStore/.test(root), 'the overlay root must provide exactly one thing, the store');
must(!/\.push\(|\.splice\(|delete [a-z]+\[/.test(store), 'store records must be replaced, never mutated — a mutated record notifies nothing');
must(/if \(id in untracked\(managedPlacements\)\)/.test(store), "a gesture landing after a close must not resurrect the widget's placement");

// ── 9. CSS ──────────────────────────────────────────────────────────────────
must(/position:\s*absolute/.test(declarationsFor('.ndd-panel-float')), 'a widget must be absolutely positioned within its panel, not fixed to the viewport');
must(/var\(--ndd-z-base/.test(declarationsFor('.ndd-panel-toolbar-search__dropdown')), 'the search dropdown must stack against --ndd-z-base');
must(/nddPortal\s+class="ndd-panel-toolbar-search__dropdown"/.test(search), "the dropdown must be portalled out, or the toolbar's bounds clip it");
must(/own\.signal\.aborted/.test(search), 'a superseded search result must be discarded — an abort cannot retract a resolved promise');
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const selector of m[1].split(',').map(s => s.trim())) {
    if (!/\.ndd-resize-[a-z]{1,2}$/.test(selector)) continue;
    for (const d of m[2].matchAll(/(top|right|bottom|left):\s*(-[\d.]+)/g)) failures.push(`${selector} places its ${d[1]} at ${d[2]}px — outside its own box, so overflow clips it (D5)`);
  }
}

// ── 10. Hosts that replaced a <div> declare their display ───────────────────
// A custom element is display: inline by default, and an inline box reports clientWidth 0.
for (const cls of ['ndd-panel-overlay-root', 'ndd-panel-toolbar', 'ndd-panel-toolbar-search', 'ndd-panel-toolbar__item', 'ndd-panel-toolbar__center', 'ndd-sidebar-layout', 'ndd-toolbar-strip']) {
  must(/display\s*:/.test(declarationsFor(`.${cls}`)), `.${cls} is a component host that replaced a <div>, so it must declare display (a custom element is inline)`);
}

// ── 11. Tests, control, non-vacuity ─────────────────────────────────────────
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = new Set(report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title)));
for (const t of [
  'a toolbar does not re-render when a widget gains focus',
  'an injectFloatingWidgets() consumer does not re-render when a widget gains focus',
  'does not keep a gesture the parent answers with its own placement',
  'PO32: a stretched managed widget is not reset when another widget opens',
  'PO35: the placement record does not outlive its widget',
  'aborts a superseded request and discards its result',
]) must(passed.has(t), `required test did not pass: "${t}"`);

const control = spawnSync('node', [join(ROOT, 'scripts/gates/browser/m11.mjs'), '--control'], { encoding: 'utf8' });
must(control.status !== 0, "M11 browser gate accepted rdd's -4px handles — D5 is not being measured");

const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '11', '--exact'], { stdio: 'inherit' });
must(nv.status === 0, 'non-vacuity sweep failed');

if (failures.length) { console.error('M11: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M11: ok');
