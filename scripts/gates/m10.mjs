/**
 * M10 — side panels, modals, confirm, toasts, dirty state and guards.
 *
 * After vdd's M10 gate, adapted to Angular:
 *
 *   1  one close sequence, in the store; refusal is the default when nothing can ask
 *   2  asking is the default, not something each call site remembers
 *   3  Escape routing, stated once, with the answering overlay marking the event handled
 *   4  shared chrome, literal class names, stacking against --ndd-z-base
 *   5  body padding inline only when supplied
 *   6  the toast queue is state (a signal), not an emitter; maxVisible is a derived slice
 *   7  the lifecycle divergence is written down; a panel's injected id always wins
 *   8  trackDirty is an effect bound to the panel's injector (so it stops with the panel)
 *   9  required tests passed; browser control rejected; non-vacuity
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT, STYLES, VITEST_JSON } from './lib/config.mjs';
import { stripComments } from './lib/css.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
// JS comments and template (HTML) comments both go: a rule about handlers must not match prose.
const code = f => readFileSync(join(LIB, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|<!--[\s\S]*?-->/gm, '');

const css = stripComments(readFileSync(STYLES, 'utf8'));
const overlays = code('src/lib/core/overlays.ts');
const workspace = code('src/lib/workspace/workspace.ts');
const host = code('src/lib/overlays/overlay-host.ts');
const modals = code('src/lib/overlays/modals.ts');
const confirm = code('src/lib/overlays/confirm.ts');
const toast = code('src/lib/toast/toast.ts');
const toasts = code('src/lib/toast/toasts.ts');
const panelHost = code('src/lib/panel/panel-host.ts');
const panelRef = code('src/lib/panel/panel-ref.ts');

// Split the overlay host into its shared function and the two host components.
const shared = host.slice(host.indexOf('function createOverlayHost'), host.indexOf('const MODAL = {'));
const modalHost = host.slice(host.indexOf("selector: 'ndd-modal-host'"), host.indexOf("selector: 'ndd-side-panel-host'"));
const sideHost = host.slice(host.indexOf("selector: 'ndd-side-panel-host'"));
must(shared.length > 0 && modalHost.length > 0 && sideHost.length > 0, 'could not find createOverlayHost and both host components');

// ── 1. One close sequence ───────────────────────────────────────────────────
must(/async function requestClose\(/.test(overlays), 'the close sequence must live in the store, once');
must(!/\.dirty\)/.test(modalHost) && !/\.dirty\)/.test(sideHost), 'neither host may re-implement the dirty check — that is what requestClose is for');
must((host.match(/overlays\.requestClose\(/g) ?? []).length === 1, 'every overlay close must go through the one shared requestOverlayClose');
must(/createOverlayHost\(this\.instance\)/.test(modalHost) && /createOverlayHost\(this\.instance\)/.test(sideHost), 'both hosts must use the shared host state rather than their own logic');
must(/if \(!options\?\.confirm\) return;/.test(overlays), 'a dirty overlay with no way to ask must stay open');
must(/confirmRenderer\?\.\(request\) \?\? Promise\.resolve\(false\)/.test(overlays), 'confirmDiscard must resolve false when no renderer is registered, never true');
must(/settle\(id, result\)/.test(overlays) && (overlays.match(/settle\(/g) ?? []).length >= 5, 'every removal path must settle afterClosed() waiters, or a ref awaits forever');

// ── 2. Asking is the default ────────────────────────────────────────────────
must(/options\?\.onConfirm \?\?[\s\S]{0,200}this\.overlays\.confirmDiscard/.test(workspace), 'requestClosePanel must default to the built-in question');
must(/this\.overlays\.setConfirmRenderer\(request => this\.confirmDiscard\(request\)\)/.test(modals), '<ndd-modals> must register the question renderer');
must(/onDestroy\(\(\) => this\.overlays\.setConfirmRenderer\(null\)\)/.test(modals), 'destroying the host must deregister it, or a dirty close awaits a modal nothing renders');
must(/onDestroy\(\(\) => this\.settle\(false\)\)/.test(confirm), 'the question must resolve when dismissed by Escape, the backdrop or the ×');
must(/if \(this\.settled\) return;/.test(confirm), 'it must resolve exactly once');

// ── 3. Escape routing, stated once ─────────────────────────────────────────
must(/const onKeydown = \(event: KeyboardEvent\)/.test(shared), 'Escape routing belongs in the shared host state');
must(!/Escape/.test(modalHost) && !/Escape/.test(sideHost), 'neither host component may carry its own Escape handler');
must(/overlays\.topmostModal\(\)\?\.id !== self\.id/.test(shared), 'only the topmost modal may answer Escape');
must(/overlays\.state\(\)\.modals\.length > 0/.test(shared), 'a drawer must ignore Escape while any modal is open');
must(/event\.defaultPrevented/.test(shared) && /event\.preventDefault\(\)/.test(shared),
  'the answering overlay must mark the event handled, and others must honour it — or a drawer opened after a modal closes with it (N9)');
must(/removeEventListener\('keydown', onKeydown\)/.test(shared), 'the Escape listener must be removed with the host');

// ── 4. Shared chrome ────────────────────────────────────────────────────────
must(/<ndd-overlay-frame/.test(modalHost) && /<ndd-overlay-frame/.test(sideHost), 'the header and body chrome must be shared');
for (const name of ['ndd-modal-header', 'ndd-modal-body', 'ndd-side-panel-header', 'ndd-side-panel-body']) {
  must(host.includes(`'${name}'`), `${name} must appear as a literal, so it is findable in the source and to the gates`);
}
must(/var\(--ndd-z-base/.test(modalHost), 'modal stacking must be relative to --ndd-z-base');
must(/role="dialog"/.test(modalHost) && /aria-modal="true"/.test(modalHost), 'a modal must be a dialog to assistive technology');
const message = (css.match(/\.ndd-confirmation-message\s*\{([^}]*)\}/) ?? [])[1] ?? '';
must(/font-size/.test(message) && /line-height/.test(message), '.ndd-confirmation-message must style its type in CSS');
must(!/<hr/.test(confirm), 'the separator must be a border, not a presentational <hr>');

// ── 5. Body padding ─────────────────────────────────────────────────────────
must(/if \(value == null\) return null;/.test(shared) && /\[style\.padding\]="bodyPadding\(\)"/.test(host), 'body padding must be set only when supplied');

// ── 6. The toast queue is state ─────────────────────────────────────────────
must(/const items = signal<readonly ToastRecord\[\]>\(\[\]\)/.test(toast), 'the queue must be module-level signal state, so toast() works outside components');
must(!/subscribe|emitter|listeners/.test(toast), 'there must be no emitter: the store is the state');
must(/protected readonly visible = computed\(/.test(toasts), 'the visible set must be derived, not a second array shifted from');
must(/shown >= this\.maxVisible\(\)/.test(toasts), 'maxVisible must bound that slice');
must(/if \(item\.exiting\) \{\s*result\.push\(item\);\s*continue;/.test(toasts), 'a toast animating out must keep its place, or the next one yanks it off screen');
must(/item\.exiting && !onScreen\.has\(item\.id\)/.test(toasts), 'a queued toast that is dismissed must be removed, not left as an invisible record');
must(/scrollHeight/.test(toasts), 'the height cap must be read from scrollHeight — offsetHeight returns the stale cap');
must(/observer\.observe\(this\.body\(\)\.nativeElement\)/.test(toasts), 'the observer must watch the inner body: the card holds its own height and never resizes');
must(/typeof ResizeObserver !== 'undefined'/.test(toasts), 'the height sync is a browser refinement and must not be required');
must(/EXIT_FALLBACK_MS = 520/.test(toasts), 'a transition that never runs must not strand the record');

// ── 7. Lifecycle divergence written down; the injected id wins ──────────────
const parity = readFileSync(join(ROOT, 'docs/PARITY.md'), 'utf8');
must(/\| N8 \|/.test(parity) && /panel:activated/.test(parity), 'the Angular form of D14 (no synchronous effect) must be recorded as a divergence');
must(/\| N9 \|/.test(parity), 'the Escape double-close fix must be recorded as a divergence');
const applied = panelHost.indexOf('this.applyInputs(id, hosted, ref);');
const injected = panelHost.indexOf("if (hosted.inputs.has('panelId')) ref.setInput('panelId', id);");
must((panelHost.match(/k !== 'panelId'/g) ?? []).length === 2 && applied > 0 && injected > applied,
  'the injected panelId must be applied after the caller inputs, and never taken from them');
must(/out\['panelId'\] = instance\(\)\.id/.test(shared), 'overlay content must get the injected id too, after the caller inputs');

// ── 8. trackDirty ───────────────────────────────────────────────────────────
must(/trackDirty: \(source, options\) =>[\s\S]{0,300}\{ injector \}/.test(panelRef), 'trackDirty must be an effect on the panel\'s own injector, so it stops with the panel');

// ── 9. Tests, control, non-vacuity ──────────────────────────────────────────
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = new Set(report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title)));
for (const t of [
  'deactivation is observable before the close is published, through the synchronous panel:activated event',
  'a caller-supplied prop named panelId can never override the injected id',
  "follows a Signal Forms form's dirty() both ways, with no setDirty call",
  'a tracked-dirty panel asks before closing, and the options getter says what is wrong right now',
  'Escape closes only the modal when a drawer was opened after it, whose listener runs last',
  'injectModals().open() returns a ref whose afterClosed() resolves with what the content passed to injectModalRef().close()',
  'afterClosed() resolves undefined for every other way out — Escape, the ×, the backdrop, closeAll',
  'closing a dirty panel with nothing able to ask should silently abort (no modal, no close)',
]) must(passed.has(t), `required test did not pass: "${t}"`);

const control = spawnSync('node', [join(ROOT, 'scripts/gates/browser/m10.mjs'), '--control'], { encoding: 'utf8' });
must(control.status !== 0, 'M10 browser gate accepted a dirty close that never asked — the question is not being measured');

const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '10', '--exact'], { stdio: 'inherit' });
must(nv.status === 0, 'non-vacuity sweep failed');

if (failures.length) { console.error('M10: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M10: ok');
