/**
 * Which CSS class names does the library's own source emit?
 *
 * Shared by the prefix gate (every emitted class must be `ndd-`) and, from M13, the
 * class↔rule correspondence gate (every emitted class has a rule, every rule a class). Two
 * gates asking the same question with two scanners would be two chances to be wrong.
 *
 * Angular emits classes through templates and code. Covered forms:
 *   template  class="a b"            [class.a]="…"           [class]="{ a: …, 'b': … }"
 *             [ngClass]="{ a: … }"   [class]="'a b'"         class="a {{ x }} b"
 *   host      host: { class: 'a b', '[class.a]': '…' }
 *   code      el.classList.add('a', 'b') / .remove / .toggle / .contains
 *             el.className = 'a b'
 *             addClass(el, 'a') (Renderer2)
 * Dynamic parts ({{ }}, `${}`, identifiers) are skipped — only literals are claims.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LIB_SRC } from './config.mjs';

export function sourceFiles(root = LIB_SRC) {
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name)) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

// A literal ending in `-` is the fixed half of a composed name (`'ndd-resize-' + dir`), not a class;
// the composed classes are enumerated exactly in COMPOSED_CLASSES instead.
const words = s => s.split(/\s+/).map(w => w.trim()).filter(w => /^-?[A-Za-z_][\w-]*$/.test(w) && !w.endsWith('-'));
const stripInterp = s => s.replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/\$\{[\s\S]*?\}/g, ' ');

/** Object-literal keys of a `[class]` / `[ngClass]` binding, e.g. `{ 'a b': x, c: y }`. */
function objectKeys(expr) {
  const out = [];
  for (const m of expr.matchAll(/(?:^|[{,])\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w-]*))\s*:/g)) {
    out.push(...words(m[1] ?? m[2] ?? m[3]));
  }
  return out;
}

export function emittedClasses(file) {
  const src = readFileSync(file, 'utf8');
  const found = new Set();
  const add = list => list.forEach(c => found.add(c));

  // static class="…" (templates; also matches inline templates inside .ts)
  for (const m of src.matchAll(/(?<![\w\].-])class\s*=\s*"([^"]*)"/g)) add(words(stripInterp(m[1])));
  // [class.x] bindings, in templates and in host metadata keys
  for (const m of src.matchAll(/\[class\.([A-Za-z_][\w-]*)\]/g)) found.add(m[1]);
  // [class]="…" / [ngClass]="…": object keys, or a quoted string literal
  for (const m of src.matchAll(/\[(?:class|ngClass)\]\s*=\s*"([^"]*)"/g)) {
    const expr = m[1].trim();
    if (expr.startsWith('{')) add(objectKeys(expr));
    for (const s of expr.matchAll(/'([^']*)'/g)) if (!expr.startsWith('{')) add(words(s[1]));
  }
  // host: { class: 'a b' }
  for (const m of src.matchAll(/(?:^|[{,\s])class\s*:\s*'([^']*)'/g)) add(words(m[1]));
  // classList.add/remove/toggle/contains('a', 'b')
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle|contains)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/'([^']*)'|"([^"]*)"/g)) add(words(s[1] ?? s[2]));
  }
  // pointer-drag activeClasses: [{ el, classes: ['a', 'b'] }]
  for (const m of src.matchAll(/classes:\s*\[([^\]]*)\]/g)) {
    for (const x of m[1].matchAll(/'([^']*)'/g)) add(words(x[1]));
  }
  // className = 'a b'
  for (const m of src.matchAll(/className\s*=\s*'([^']*)'/g)) add(words(stripInterp(m[1])));
  // Renderer2 addClass/removeClass(el, 'a')
  for (const m of src.matchAll(/(?:addClass|removeClass)\([^,]+,\s*'([^']*)'/g)) add(words(m[1]));
  return found;
}

/** Every file's statically readable classes, by class. */
export function allEmittedClasses(root = LIB_SRC) {
  const byClass = new Map();
  for (const file of sourceFiles(root)) {
    for (const cls of emittedClasses(file)) {
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push(file);
    }
  }
  return byClass;
}

/**
 * Classes the library composes at runtime, enumerated exactly — after vdd's lesson that a
 * *prefix* wildcard matches everything (`'ndd-' + side()` has the prefix `ndd-`) and so
 * silently passes every dead rule. Each entry names the expression it stands for, so the list
 * can be checked against the source; the M13 rules do check it.
 */
export const COMPOSED_CLASSES = {
  // `'ndd-' + side()` — sidebar rail and drawer
  "'ndd-' + side()": ['ndd-left', 'ndd-right'],
  // `'ndd-' + position()` — the toolbar group flyout
  "'ndd-' + position()": ['ndd-left', 'ndd-right', 'ndd-top', 'ndd-bottom'],
  // `'ndd-resize-' + dir` — the floating widget's handles
  "'ndd-resize-' + dir": ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map(d => `ndd-resize-${d}`),
  // `'ndd-confirmation-alert-' + alertType()` — NddConfirm
  "'ndd-confirmation-alert-' + alertType()": ['info', 'warning', 'success', 'danger'].map(t => `ndd-confirmation-alert-${t}`),
  // `ndd-modal-size-${…size}` — the modal host
  'ndd-modal-size-${': ['small', 'medium', 'large', 'fullscreen', 'auto'].map(x => `ndd-modal-size-${x}`),
  // `'ndd-toast--' + type()` — a toast card
  "'ndd-toast--' + type()": ['info', 'success', 'warning', 'error'].map(t => `ndd-toast--${t}`),
  // `'ndd-toast-container--' + position()` — the toast host
  "'ndd-toast-container--' + position()": ['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(p => `ndd-toast-container--${p}`),
  // `'ndd-panel-float-dropzone--' + zone` — the panel overlay's drop zones
  "'ndd-panel-float-dropzone--' + zone": ['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(z => `ndd-panel-float-dropzone--${z}`),
};

/**
 * Classes held in code as literals and applied through a binding a template scan cannot follow:
 * the overlay frame's class maps (`[class]="c().header"`), the side-panel window class, and the
 * toast card's entry states (a signal). Each names where it lives.
 */
export const LITERAL_MAP_CLASSES = {
  'overlay-host.ts MODAL': ['ndd-modal-header', 'ndd-modal-icon', 'ndd-modal-title', 'ndd-modal-close-button', 'ndd-modal-body'],
  'overlay-host.ts SIDE_PANEL': ['ndd-side-panel-header', 'ndd-side-panel-icon', 'ndd-side-panel-title', 'ndd-side-panel-close-button', 'ndd-side-panel-body'],
  'overlay-host.ts windowClass()': ['ndd-side-panel-window'],
  'toasts.ts entryClass': ['ndd-toast--entering', 'ndd-toast--entering-left', 'ndd-toast--fade-entering', 'ndd-toast--visible'],
};

/** `'ndd-context-menu--' + theme()` takes a caller's string, so the set is open. */
export const OPEN_ENDED_PREFIXES = ['ndd-context-menu--'];

/** Every class the library emits: statically readable, composed, and held in literal maps. */
export function everyEmittedClass(root = LIB_SRC) {
  const all = new Set(allEmittedClasses(root).keys());
  for (const list of [...Object.values(COMPOSED_CLASSES), ...Object.values(LITERAL_MAP_CLASSES)]) for (const cls of list) all.add(cls);
  return all;
}

/**
 * Classes emitted with no rule, deliberately: stable names a consumer can hang their own styling
 * on. A framework-agnostic library wants these; what it must not have is the reverse — a rule
 * nothing emits. vdd and rdd emit the same hooks with no rule of their own.
 */
export const CONSUMER_HOOKS = new Set([
  'ndd-taskbar-mode-always', // the default bar; only autohide needs rules
  'ndd-taskbar-mode-compact', // likewise
  'ndd-btn-more-actions', // the floating window's overflow button
  'ndd-panel-toolbar-search--open', // the search field's expanded state
  'ndd-sidebar-header-action-btn', // a pinned rail button, vs a tab button
  'ndd-toolbar-btn-action', // an action button, vs a radio or a toggle
  'ndd-tooltip-title-text', // the taskbar preview's title
]);

/**
 * Utility classes the library *offers* and never applies itself: a consumer puts them on their
 * own elements (documented in the theming chapter). The only rules allowed to have no emitter.
 */
export const OPT_IN_UTILITIES = new Map([
  ['ndd-fill-viewport', 'sizes the consumer\'s own container to the viewport — the zero-height warning points at it'],
  ['ndd-scrollbar-hidden', 'hides the scrollbar of a consumer\'s own scroller'],
]);
