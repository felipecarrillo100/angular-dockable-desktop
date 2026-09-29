/**
 * M16 — skin branding (1.1.0), ported from react-dockable-desktop 7.2.0 (ADR 0014).
 *
 *   1  the release files agree: package version 1.1.0 = VERSION; CHANGELOG has a 1.1.0 entry
 *      whose parity line names react-dockable-desktop 7.2.0, and a link for it
 *   2  the decision is recorded: ADR 0014 exists and is indexed
 *   3  the manual documents the feature, and agrees with the stylesheet: the theming chapter has
 *      "Brand your app" with the three variables, and its skin-font table carries, for every
 *      built-in skin, exactly the `--ndd-skin-font-family` stack the stylesheet declares; and
 *      M15's token check (the chapter and the :root tokens agree in both directions), which no
 *      longer runs anywhere else once M15's 1.0.0 version pin fails on 1.1.0
 *   4  the browser minimum (CSS color-mix(): Chrome/Edge 111, Safari 16.2, Firefox 113) is stated
 *      in the README, the package README and chapter 1
 *   5  PARITY.md maps the rdd 7.2.0 names and tests to ndd's
 *   6  the browser gate's 1.0.0 baseline is in the repository, covering all 14 scenes
 *
 * The stylesheet contract itself (read-only brand variables, one accent source, the font token
 * on :root only, the on-accent rules) is unit-tested in stylesheet.spec.ts, which the standing
 * gate runs; the rendered result is the M16 browser gate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, STYLES } from './lib/config.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const read = p => (existsSync(resolve(ROOT, p)) ? readFileSync(resolve(ROOT, p), 'utf8') : '');
const step = name => console.log(`\n── M16: ${name}`);
const SKINS = ['vscode', 'macos', 'chrome', 'slate', 'nord', 'obsidian', 'tokyo'];

// ── 1. Release files ────────────────────────────────────────────────────────
step('release files');
const libPkg = JSON.parse(read('projects/angular-dockable-desktop/package.json') || '{}');
must(libPkg.version === '1.1.0', `the package version is ${libPkg.version}, not 1.1.0`);
must(read('projects/angular-dockable-desktop/src/lib/version.ts').includes(`'${libPkg.version}'`), 'VERSION does not match the package version');
const changelog = read('CHANGELOG.md');
const start = changelog.indexOf('## [1.1.0]');
must(start >= 0, 'CHANGELOG.md has no 1.1.0 entry');
const entry = start >= 0 ? changelog.slice(start, changelog.indexOf('\n## [', start + 1)) : '';
must(/\*\*Parity:[^*]*react-dockable-desktop\s+7\.2\.0/.test(entry), 'the 1.1.0 entry must state its parity line, naming react-dockable-desktop 7.2.0');
for (const section of ['### Added', '### Changed', '### Fixed', '### Tests', '### Docs']) must(entry.includes(section), `the 1.1.0 entry has no "${section}" section`);
must(/^\[1\.1\.0\]: /m.test(changelog), 'CHANGELOG.md has no link for [1.1.0]');

// ── 2. The decision ─────────────────────────────────────────────────────────
step('decision record');
must(existsSync(resolve(ROOT, 'docs/decisions/0014-brand-variables.md')), 'docs/decisions/0014-brand-variables.md is missing');
must(read('docs/decisions/README.md').includes('(0014-brand-variables.md)'), 'the ADR index does not list 0014');

// ── 3. The manual, against the stylesheet ───────────────────────────────────
step('manual');
const theming = read('docs/manual/10-theming.md');
must(/^## Brand your app$/m.test(theming), 'the theming chapter has no "Brand your app" section');
for (const v of ['--ndd-brand-accent', '--ndd-brand-on-accent', '--ndd-font-family', '--ndd-skin-font-family']) must(theming.includes(`\`${v}\``), `the theming chapter does not document ${v}`);
const sheet = readFileSync(STYLES, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const root = sheet.match(/--ndd-font-family:\s*var\(--ndd-skin-font-family,\s*([^;]+)\);/)?.[1]?.trim();
must(!!root, 'the stylesheet does not declare --ndd-font-family as var(--ndd-skin-font-family, …)');
for (const skin of SKINS) {
  const declared = sheet.match(new RegExp(`\\[data-ndd-skin="${skin}"\\]\\s*\\{[^}]*?--ndd-skin-font-family:\\s*([^;]+);`))?.[1]?.trim() ?? root;
  const row = theming.match(new RegExp(`^\\| \`${skin}\` \\|.*$`, 'm'))?.[0] ?? '';
  must(row.includes(`\`${declared}\``), `the skin-font table's ${skin} row does not show the stylesheet's stack \`${declared}\``);
}

// M15 rule 4's token check, carried here because M15 pins version 1.0.0: every :root token is
// in the theming chapter, and every token the chapter names is declared or read by the stylesheet.
const rootTokens = new Set([...sheet.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
  .filter(m => m[1].replace(/\s+/g, ' ').trim() === ':root')
  .flatMap(m => [...m[2].matchAll(/(--ndd-[\w-]+)\s*:/g)].map(t => t[1])));
must(rootTokens.size > 100, `only ${rootTokens.size} :root tokens parsed — the parse is wrong`);
for (const token of rootTokens) must(theming.includes(token), `${token} is declared on :root but missing from the theming chapter`);
const known = new Set([...sheet.matchAll(/(--ndd-[\w-]+)/g)].map(m => m[1]));
for (const token of new Set([...theming.matchAll(/(--ndd-[\w-]+)/g)].map(m => m[1]))) {
  must(known.has(token), `the theming chapter documents ${token}, which the stylesheet neither declares nor reads`);
}

// ── 4. The browser minimum ──────────────────────────────────────────────────
step('browser minimum');
const minimum = /color-mix\(\)`?[^.]*Chrome \/ Edge 111, Safari 16\.2, Firefox 113/s;
for (const doc of ['README.md', 'projects/angular-dockable-desktop/README.md', 'docs/manual/01-getting-started.md']) {
  must(minimum.test(read(doc)), `${doc} does not state the browser minimum (color-mix(): Chrome / Edge 111, Safari 16.2, Firefox 113)`);
}

// ── 5. PARITY ───────────────────────────────────────────────────────────────
step('parity');
const parity = read('docs/PARITY.md');
for (const [rdd, ndd] of [['--rdd-brand-accent', '--ndd-brand-accent'], ['--rdd-brand-on-accent', '--ndd-brand-on-accent'], ['--rdd-skin-font-family', '--ndd-skin-font-family'], ['branding.browser.ts', 'scripts/gates/browser/m16.mjs']]) {
  must(parity.includes(rdd) && parity.includes(ndd), `PARITY.md does not map ${rdd} to ${ndd}`);
}

// ── 6. The baseline ─────────────────────────────────────────────────────────
step('baseline fixture');
const fixturePath = resolve(ROOT, 'scripts/gates/browser/fixtures/m16-branding-baseline.json');
const fixture = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
must(!!fixture, 'the M16 browser baseline (scripts/gates/browser/fixtures/m16-branding-baseline.json) is missing');
if (fixture) {
  for (const skin of SKINS) for (const cs of ['dark', 'light']) must(Object.keys(fixture.scenes?.[`${skin}/${cs}`] ?? {}).length > 400, `the baseline has no full ${skin}/${cs} scene`);
  must((fixture.tokens?.length ?? 0) > 100, 'the baseline carries no token list');
}

if (failures.length) {
  console.error('\nM16: FAIL');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log('\nM16: ok');
