/**
 * M14 gate — the demo.
 *
 * The walkthrough is in `scripts/gates/browser/m14.mjs`; this checks what is true of the demo's
 * *source* rather than of a run. Ported from vdd's M14 rules.
 *
 *   1  the demo is an Angular CLI application, built by the standing gate, with the library's
 *      stylesheet wired the way a consumer wires it
 *   2  the demo does not leak into the library: no `dd-` class in the library's stylesheet, and
 *      the demo's own stylesheet restyles no `ndd-` class globally
 *   3  the demo uses the library as a consumer would: by package name, never by relative path
 *   4  every capability is *called* (or bound) somewhere in the demo's code, not merely mentioned
 *   5  an object-valued model is never bound as a literal (vdd 1.0.0's R1, in Angular's form)
 *   6  every attribute the stylesheet keys on is emitted, and no token lives only in a scheme block
 *   7  the dependencies: the demo's are ADR 0012's, no React or Vue ones, and the library ships
 *      with no runtime dependency at all
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, STYLES } from './lib/config.mjs';
import { selectorClasses, stripComments } from './lib/css.mjs';
import { sourceFiles } from './lib/emitted.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const read = p => readFileSync(resolve(ROOT, p), 'utf8');
const walk = dir => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
/** TypeScript with its comments removed, so prose can never satisfy a rule. */
const stripTs = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');

const DEMO = join(ROOT, 'projects/demo/src');
const files = existsSync(DEMO) ? walk(DEMO) : [];
const sources = files.filter(f => f.endsWith('.ts'));
must(sources.length >= 20, `the demo has ${sources.length} TypeScript sources; its shell and 18 panels alone are more`);

// ── 1. An Angular CLI application, built by the standing gate ───────────────
const ng = JSON.parse(read('angular.json'));
const demo = ng.projects?.demo;
must(demo?.projectType === 'application', 'angular.json has no `demo` application');
const build = demo?.architect?.build;
must(build?.builder === '@angular/build:application', 'the demo must build with @angular/build:application');
const styles = build?.options?.styles ?? [];
must(styles.includes('dist/angular-dockable-desktop/styles.css'), 'the demo must take the library stylesheet from the built package, as a consumer does');
for (const vendor of ['leaflet/dist/leaflet.css', 'katex/dist/katex.min.css']) must(styles.some(s => s.includes(vendor)), `the demo's styles lack ${vendor}`);
must(read('scripts/gate.mjs').includes("'npx ng build demo'"), 'the standing gate must build the demo');
const pkg = JSON.parse(read('package.json'));
must(/ng serve demo/.test(pkg.scripts?.demo ?? ''), 'npm run demo must serve it');

// ── 2. The demo does not leak into the library ──────────────────────────────
const libraryCss = read(STYLES);
for (const cls of selectorClasses(libraryCss)) must(!cls.startsWith('dd-'), `the library's stylesheet carries the demo class .${cls}`);
const libPkg = JSON.parse(read('projects/angular-dockable-desktop/package.json'));
must(!JSON.stringify(libPkg).includes('demo'), 'the library package must not mention the demo');
must(!existsSync(join(ROOT, 'dist/angular-dockable-desktop/demo')), 'the built library contains a demo directory');

const demoCss = files.filter(f => f.endsWith('.css')).map(f => readFileSync(f, 'utf8')).join('\n');
for (const cls of selectorClasses(demoCss)) {
  must(cls.startsWith('dd-') || cls.startsWith('leaflet-') || cls.startsWith('ndd-') || cls.startsWith('hljs') || cls.startsWith('katex'),
    `the demo's CSS defines .${cls}, which is neither dd- nor a dependency's`);
}
// An `ndd-` selector may only reach *into* the library's chrome from a `dd-` ancestor, never
// restyle it globally — that would be a fork of the library's look hiding in an application.
for (const rule of stripComments(demoCss).matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
  for (const part of rule[2].split(',')) {
    const sel = part.trim();
    if (/^\.ndd-/.test(sel)) failures.push(`the demo's CSS restyles ${sel} globally — scope it under a dd- ancestor`);
  }
}

// ── 3. The library as a consumer uses it ────────────────────────────────────
const byPath = sources.filter(f => /from '(\.\.\/)+(projects|angular-dockable-desktop\/src|dist)\//.test(readFileSync(f, 'utf8')));
must(byPath.length === 0, `these demo files reach into the library by path: ${byPath.join(', ')}`);
const main = stripTs(readFileSync(join(DEMO, 'main.ts'), 'utf8'));
must(/from 'angular-dockable-desktop'/.test(main), 'main.ts must import the library by name');
must(/provideDockableDesktop\(/.test(main), 'main.ts must provide the workspace the way the manual shows');
must(/loadComponent:/.test(main), 'the demo must show lazy panels (loadComponent)');

// ── 4. Every capability is represented ─────────────────────────────────────
const all = sources.map(f => stripTs(readFileSync(f, 'utf8'))).join('\n');
const CAPABILITIES = {
  'zero-unmount state': /injectPanel\(\)/,
  'dirty state': /setDirty\(/,
  'close guards': /onBeforeClose\(/,
  'saved panel state': /onSaveState\(/,
  'panel context menus': /injectPanelContextMenu\(/,
  'contributions': /injectPanelContribution\(/,
  'merged chrome': /injectMergedToolbarItems\(/,
  'merged sidebar tabs': /injectMergedSidebarTabs\(/,
  'the event bus': /\.publish\(/,
  'event subscriptions': /\.subscribe\(/,
  'side panels': /injectSidePanels\(\)|openLeftPanel\(/,
  'modals': /injectModals\(\)/,
  'toasts': /toast\.(info|success|warning|error|promise)\(/,
  'the panel overlay': /<ndd-panel-overlay/,
  'panel toolbars': /<ndd-panel-toolbar/,
  'floating widgets': /<ndd-floating-widget/,
  'floating widgets from data': /injectFloatingWidgets\(\)/,
  'stretch placement': /stretch: 'width'|stretch: 'height'|stretch: 'both'/,
  'the sidebar': /<ndd-sidebar\b/,
  'a secondary sidebar': /<ndd-secondary-sidebar/,
  'the sidebar from inside': /injectSidebar\(\)/,
  'the workspace toolbar': /<ndd-toolbar\b/,
  'the toolbar state': /injectToolbar\(\)/,
  'i18n': /formatMessage/,
  'reading direction': /setDirection\(/,
  'the colour scheme': /injectColorScheme\(\)/,
  'layout persistence': /saveLayout\(\)/,
  'layout restore': /loadLayout\(/,
  'drag primitives': /startPointerDrag\(/,
  'panel size': /\.size\(\)/,
  'two-way models': /\[\((activeTabId|visible|placement|active)\)\]/,
  'skins': /<ndd-desktop[^>]*\[skin\]=/,
  'taskbar modes': /<ndd-desktop[^>]*\[taskbar\]=/,
  'the zone build': /provideZoneChangeDetection\(/,
};
for (const [capability, pattern] of Object.entries(CAPABILITIES)) must(pattern.test(all), `no demo code demonstrates ${capability}`);

// ── 5. An object-valued model is never bound as a literal ───────────────────
// vdd 1.0.0's defect: a `placement` model bound as a fresh `{ … }` literal was reset on every
// render. Angular's `model()` does not reset from an unchanged binding (N10), but a literal still
// discards the write-back, so the rule stands.
for (const f of [...sources, ...sourceFiles()]) {
  must(!/\[\(?placement\)?\]="\s*\{/.test(readFileSync(f, 'utf8')), `${f} binds an object literal to placement — hold it in a signal and bind [(placement)]`);
}

// ── 6. Stylesheet hookups ───────────────────────────────────────────────────
{
  const sheet = stripComments(libraryCss);
  const keyed = new Set(Array.from(sheet.matchAll(/\[(data-[a-z0-9-]+)/g), m => m[1]));
  const emitted = new Set();
  for (const file of sourceFiles()) for (const m of readFileSync(file, 'utf8').matchAll(/\b(data-[a-z0-9-]+)\b/g)) emitted.add(m[1]);
  // `data-color-scheme` is the application's attribute, which the library reads and never sets.
  emitted.add('data-color-scheme');
  for (const attribute of keyed) must(emitted.has(attribute), `the stylesheet keys on [${attribute}], which no component emits — the rules never match`);

  const blockFor = selector => {
    const found = Array.from(sheet.matchAll(/([^{}]*)\{([^{}]*)\}/g)).find(m => m[1].replace(/\s+/g, ' ').trim() === selector);
    return found ? Array.from(found[2].matchAll(/(--ndd-[\w-]+)\s*:/g), m => m[1]) : [];
  };
  const base = new Set(blockFor(':root'));
  must(base.size > 50, `only ${base.size} tokens found on :root — the parse is wrong`);
  for (const scheme of ['[data-color-scheme="dark"]', '[data-color-scheme="light"]']) {
    for (const token of blockFor(scheme)) must(base.has(token), `${token} is declared in ${scheme} but not on :root — it is undefined in the other scheme`);
  }
}

// ── 7. Dependencies ─────────────────────────────────────────────────────────
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const kept of ['monaco-editor', 'leaflet', 'unified', 'remark-gfm', 'remark-math', 'rehype-katex', 'rehype-highlight', 'rehype-raw', 'rehype-slug', 'katex', 'highlight.js']) must(kept in deps, `ADR 0012 keeps ${kept}, and it is not installed`);
for (const swapped of ['react', 'react-dom', 'react-intl', 'react-markdown', '@monaco-editor/react', 'vue', 'ngx-monaco-editor', '@asymmetrik/ngx-leaflet']) must(!(swapped in deps), `${swapped} is a framework wrapper the demo does not need`);
must(Object.keys(libPkg.dependencies ?? {}).length === 0, `the library's source package.json must declare no dependencies; found ${Object.keys(libPkg.dependencies ?? {}).join(', ')}`);
// What is published is the *built* manifest, and ng-packagr adds `tslib` to every library's
// dependencies whether or not it is used. That one is allowed; anything else is a real dependency.
const builtPkg = JSON.parse(read('dist/angular-dockable-desktop/package.json'));
const builtDeps = Object.keys(builtPkg.dependencies ?? {}).filter(d => d !== 'tslib');
must(builtDeps.length === 0, `the published package declares runtime dependencies: ${builtDeps.join(', ')}`);
must(libPkg.peerDependencies?.['@angular/core'] && libPkg.peerDependencies?.['@angular/common'], '@angular/core and @angular/common must be peer dependencies');
for (const f of readdirSync(join(ROOT, 'dist/angular-dockable-desktop/fesm2022')).filter(f => f.endsWith('.mjs'))) {
  const bundle = readFileSync(join(ROOT, 'dist/angular-dockable-desktop/fesm2022', f), 'utf8');
  const imports = [...bundle.matchAll(/\bfrom\s*["']([^"'.][^"']*)["']/g)].map(m => m[1]).filter(s => !s.startsWith('@angular/'));
  must(imports.length === 0, `${f} imports ${[...new Set(imports)].join(', ')} — the library must import nothing but Angular`);
}

if (failures.length) {
  console.error('M14: FAIL');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`M14: ok — ${sources.length} demo sources, ${Object.keys(CAPABILITIES).length} capabilities demonstrated, no demo classes in the library, no runtime dependencies beyond tslib`);
