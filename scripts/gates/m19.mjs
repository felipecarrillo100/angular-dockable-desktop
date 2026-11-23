/**
 * M19 gate — pop-out windows (1.12.0), ported from react-dockable-desktop 7.12.2 by way of
 * vue-dockable-desktop 1.14.0 (ADR 0019).
 *
 *   1  the release files: the package version equals VERSION and has its own CHANGELOG entry
 *      (ADR 0015's rule); the 1.12.0 entry states a parity line naming react-dockable-desktop
 *      7.12.2 and has every section, under a fresh [Unreleased]; the package's CHANGELOG copy is
 *      the root one as scripts/sync-package-readme.mjs writes it; M19 is in `gate:release`
 *   2  the decision is recorded: ADR 0019 exists, is indexed, and records the zone.js decision
 *   3  the manual documents it: chapter 15 exists, is in the manual's index and the README, and
 *      covers what rdd's guide does plus Angular's own points (the gesture rule, popoutUrl and why,
 *      --base-href, the wrapper and its context by injection, zone.js, ShadowDom, the Playwright
 *      traps, the limits, the messages, the differences from rdd and vdd); the migration chapter
 *      names the five message keys; the API reference names every new public name
 *   4  PARITY.md traces rdd 7.12.x: the API map, the test map with what is not ported, and the
 *      divergences
 *   5  the pieces the M19 browser gate drives exist: the windows registry, the styles, the frame,
 *      the wrapper, every ported spec file (traced in PARITY and floored in the counts), the
 *      playground's pop-out pages; and the demo uses it (popOut, a canPopOut type, a relative
 *      popoutUrl with its page in public/)
 *
 * The behaviour is unit-tested in the nine pop-out spec files named below; the real windows are the
 * M19 browser gate (scripts/gates/browser/m19.mjs), which `npm run gate -- M19` runs after this.
 *
 * `NDD_GATE_M19_ROOT` points the rules at another tree (the selftest's seeded copies,
 * scripts/gates/selftest-m19.mjs); by default they read this repository.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT as REPO } from './lib/config.mjs';
import { packageChangelog } from '../sync-package-readme.mjs';

const ROOT = process.env['NDD_GATE_M19_ROOT'] ? resolve(process.env['NDD_GATE_M19_ROOT']) : REPO;
const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const read = p => (existsSync(resolve(ROOT, p)) ? readFileSync(resolve(ROOT, p), 'utf8') : '');
const has = p => existsSync(resolve(ROOT, p));
const escape = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LIB = 'projects/angular-dockable-desktop';

// ── 1. Release files ────────────────────────────────────────────────────────
const pkg = JSON.parse(read(`${LIB}/package.json`) || '{}');
must(read(`${LIB}/src/lib/version.ts`).includes(`'${pkg.version}'`), `VERSION does not match the package version ${pkg.version}`);
const changelog = read('CHANGELOG.md');
const entryOf = v => {
  const start = changelog.indexOf(`## [${v}]`);
  return start < 0 ? '' : changelog.slice(start, changelog.indexOf('\n## [', start + 1));
};
must(entryOf(pkg.version) !== '', `CHANGELOG.md has no entry for the package version ${pkg.version}`);
const entry = entryOf('1.12.0');
must(entry !== '', 'CHANGELOG.md has no 1.12.0 entry');
must(/^## \[1\.12\.0\] — \d{4}-\d{2}-\d{2}$/m.test(changelog), 'the 1.12.0 entry has no dated heading');
must(/\*\*Parity:[^*]*react-dockable-desktop[^*]*7\.12\.2/.test(entry), 'the 1.12.0 entry must state its parity line, naming react-dockable-desktop 7.12.2');
for (const section of ['### Added', '### Fixed', '### Tests', '### Documentation']) must(entry.includes(section), `the 1.12.0 entry has no "${section}" section`);
const unreleased = changelog.indexOf('## [Unreleased]');
must(unreleased >= 0 && unreleased < changelog.indexOf('## [1.12.0]'), 'CHANGELOG.md has no [Unreleased] section above 1.12.0');
must(read(`${LIB}/CHANGELOG.md`) === packageChangelog(changelog), "the package's CHANGELOG has drifted from CHANGELOG.md — run node scripts/sync-package-readme.mjs");
const scripts = JSON.parse(read('package.json') || '{}').scripts ?? {};
must(/\bM19\b/.test(scripts['gate:release'] ?? ''), 'gate:release does not run M19');

// ── 2. The decision ─────────────────────────────────────────────────────────
const adr = read('docs/decisions/0019-popout-windows.md');
must(adr !== '', 'docs/decisions/0019-popout-windows.md is missing');
must(read('docs/decisions/README.md').includes('(0019-popout-windows.md)'), 'the ADR index does not list 0019');
must(adr.includes('patchEventTarget') && adr.includes('Zone.root'), 'ADR 0019 does not record the zone.js decision (the per-window patch, the poll outside the zone)');

// ── 3. The manual ───────────────────────────────────────────────────────────
const chapter = read('docs/manual/15-popout-windows.md');
must(chapter !== '', 'docs/manual/15-popout-windows.md is missing');
must(read('docs/manual/README.md').includes('(15-popout-windows.md)'), 'the manual index does not list chapter 15');
must(read('README.md').includes('(docs/manual/15-popout-windows.md)'), 'README.md does not link chapter 15');
for (const heading of [
  '## Turning it on', '## From code: `popOutPanel()` and `returnPanel()`', '## The page the window opens: `popoutUrl`',
  '### Where it comes back to', '### Saving the layout', '## Styles in the window', '### CSS-in-JS needs `popoutWrapper`',
  '## Code in a pop-out window', '### Change detection and zone.js', '### What reloads', '## Widgets in their own window',
  '## Focus and activation', '## Toasts', '## Events', '## Testing pop-outs with Playwright', '## Things to know',
  '## Coming from react-dockable-desktop or vue-dockable-desktop',
]) {
  must(new RegExp(`^${escape(heading)}$`, 'm').test(chapter), `chapter 15 has no "${heading}" section`);
}
// The rules a reader can't guess, each where rdd's guide (or Angular) makes them matter.
const prose = chapter.replace(/\s+/g, ' ');
must(prose.includes("A click in any of the app's windows counts"), 'chapter 15 does not state the gesture rule for a click in a pop-out');
must(prose.includes('error 153'), 'chapter 15 does not say why popoutUrl exists (YouTube error 153)');
must(prose.includes('--base-href'), 'chapter 15 does not say how popoutUrl meets --base-href');
must(prose.includes('one cache per document'), 'chapter 15 does not say to keep one CSS-in-JS cache per document');
must(chapter.includes('readonly window = input.required<Window>();') && chapter.includes("template: '<ng-content />'"), "chapter 15 does not show the wrapper's inputs and its <ng-content />");
must(/context is dependency injection/i.test(prose), "chapter 15 does not say the wrapper's context is its providers");
must(prose.includes('read when each panel is created'), 'chapter 15 does not say the wrapper is read once');
must(prose.includes('custom `nddContextMenuTemplate` menu is not wrapped'), 'chapter 15 does not say a custom nddContextMenuTemplate menu is not wrapped');
must(prose.includes('`ViewEncapsulation.ShadowDom` is not covered'), 'chapter 15 does not say ShadowDom is not covered');
must(prose.includes("zone.js's own `EventTarget` patch"), 'chapter 15 does not state the zone.js patch per window');
must(prose.includes('runs **outside the zone**'), "chapter 15 does not say the library's polls and observers run outside the zone");
must(chapter.includes('document.hasFocus = () => false'), 'chapter 15 does not show the hasFocus stub');
must(/about 5 seconds/.test(prose), "chapter 15 does not warn about Playwright's 5 s user activation");
for (const limit of ['Leaflet', 'LuciadRIA', '`maximizePanel` and `floatPanel` are ignored', '`canPopOut` changing']) {
  must(prose.includes(limit), `chapter 15 does not state the limit "${limit}"`);
}
const migrating = read('docs/manual/12-migrating.md');
for (const key of ['popOutWindow', 'returnToDesktop', 'backIntoPanel', 'popOutBlocked', 'inOwnWindow']) {
  must(chapter.includes(`\`${key}\``), `chapter 15 does not name the message key ${key}`);
  must(migrating.includes(`\`${key}\``), `the migration chapter does not name the message key ${key}`);
}
const reference = read('docs/manual/13-api-reference.md');
for (const name of [
  'popOutPanel', 'returnPanel', 'focusPanelWindow', 'injectPanelWindow()', 'isPoppedOut', 'canPopOut', 'popOut',
  'popoutUrl', 'popoutWrapper', 'PopOutResult', 'PanelWindow', 'PopoutWrapper',
  'panel:popping-out', 'panel:popped-out', 'panel:returning', 'panel:returned',
]) {
  must(reference.includes(`\`${name}`), `the API reference does not name ${name}`);
}
must(reference.includes('(15-popout-windows.md'), 'the API reference does not link chapter 15');

// ── 4. PARITY ───────────────────────────────────────────────────────────────
const parity = read('docs/PARITY.md');
must(/^### Pop-out windows \(1\.12\.0, from rdd 7\.12\.0 and 7\.12\.1 \/ vdd 1\.14\.0\)$/m.test(parity), 'PARITY.md §1 has no pop-out windows API map');
must(/^### rdd 7\.12\.0 and 7\.12\.1 pop-out windows, traced$/m.test(parity), 'PARITY.md does not trace rdd 7.12.x');
must(/^### 4\.5 Pop-out windows \(1\.12\.0\)$/m.test(parity), 'PARITY.md §4 has no pop-out windows divergences');
const traceAt = parity.indexOf('### rdd 7.12.0 and 7.12.1 pop-out windows, traced');
const trace = traceAt < 0 ? '' : parity.slice(traceAt, parity.indexOf('\n### ', traceAt + 1));
must(trace.includes('**rdd cases not ported, each with its reason:**'), 'PARITY.md does not list the rdd pop-out cases it did not port');
for (const id of ['XDA', 'XPO', 'XFP', 'XPS', 'XPW', 'XPC', 'XWG', 'XPF']) must(trace.includes(id), `PARITY.md's pop-out trace does not name the ${id} tests`);

// ── 5. The pieces, the new tests, the demo ──────────────────────────────────
const TESTS = [
  'test/components/document-aware.spec.ts', 'test/store/pop-out-store.spec.ts',
  'test/components/pop-out-windows.spec.ts', 'test/components/pop-out-styles.spec.ts',
  'test/components/popout-wrapper.spec.ts', 'test/components/pop-out-chrome.spec.ts',
  'test/components/pop-out-widgets.spec.ts', 'test/components/pop-out-focus.spec.ts',
  'test/components/pop-out-from-pop-out.spec.ts',
].map(f => `${LIB}/${f}`);
for (const f of [
  `${LIB}/src/lib/core/pop-out-windows.ts`, `${LIB}/src/lib/core/pop-out-styles.ts`,
  `${LIB}/src/lib/desktop/pop-out-frame.ts`, `${LIB}/src/lib/panel/panel-window.ts`,
  `${LIB}/src/lib/common/popout-wrap.ts`, `${LIB}/src/styles/parts/26a-popout.css`, ...TESTS,
  'projects/playground/public/popout.html', 'projects/playground/src/app/pop-panel.ts',
  'projects/playground/src/app/pop-widget.ts', 'projects/playground/src/app/runtime-css.ts',
  'scripts/gates/browser/m19.mjs',
]) must(has(f), `${f} is missing`);
// Each new spec is traced in PARITY and floored in the counts.
const baseline = JSON.parse(read(`${LIB}/test/baseline-counts.json`) || '{}');
for (const f of TESTS) {
  const name = f.split('/').pop();
  must(trace.includes(name), `PARITY.md's pop-out trace does not name ${name}`);
  must((baseline[name] ?? 0) > 0, `${LIB}/test/baseline-counts.json has no floor for ${name}`);
}
must(trace.includes('scripts/gates/browser/m19.mjs'), "PARITY.md's pop-out trace does not name the M19 browser gate");
// The demo shows it, with a page that follows --base-href.
const demoMain = read('projects/demo/src/main.ts');
const cameras = read('projects/demo/src/app/panels/cameras-table-toggle.ts');
must(/\bpopOut: true\b/.test(demoMain), "the demo's workspace does not set popOut: true");
must(/leafletMap:[^\n]*canPopOut: true/.test(demoMain), "the demo's Leaflet map type has no canPopOut");
must(/canPopOut: true/.test(cameras) && /w\.popOut\(\)/.test(cameras), "the demo's Cameras widget has no canPopOut and no item calling w.popOut()");
const url = read('projects/demo/src/app/app.ts').match(/popoutUrl="([^"]+)"/)?.[1];
must(!!url, "the demo's <ndd-desktop> has no popoutUrl");
must(!!url && !/^(\/|[a-z]+:)/i.test(url), `the demo's popoutUrl "${url}" is not relative, so it would not follow --base-href`);
must(!!url && has(`projects/demo/public/${url}`), `the demo's popoutUrl names projects/demo/public/${url}, which is missing`);

if (failures.length) {
  console.error('M19: FAIL');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log('M19: ok — release files, ADR 0019, manual chapter 15 and the API reference, PARITY, the pop-out pieces, tests and demo');
