/**
 * M17 gate — brand surfaces and corner scale (1.2.0), ported from react-dockable-desktop 7.3.0
 * (ADR 0016).
 *
 *   1  the release files: the package version equals VERSION and has its own CHANGELOG entry
 *      (ADR 0015's rule); the 1.2.0 entry, which introduced this, states a parity line naming
 *      react-dockable-desktop 7.3.0 and has every section. No current-version pin.
 *   2  the decision is recorded: ADR 0016 exists and is indexed
 *   3  the manual documents the feature: "Your surfaces" and "Corners" under Brand your app, the
 *      three variables in the token reference, the dark-scheme selector a missing attribute
 *      matches, and the scale's exclusions as the stylesheet has them
 *   4  PARITY.md maps the rdd 7.3.0 names and tests to ndd's
 *   5  the browser gate's 1.1.0 corner baseline is in the repository, covering all 14 scenes
 *
 * The stylesheet contract (every corner scaled, every surface derived, the guarded base) is
 * unit-tested in stylesheet.spec.ts; the rendered result is the M17 browser gate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, STYLES } from './lib/config.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg) }
const read = p => (existsSync(resolve(ROOT, p)) ? readFileSync(resolve(ROOT, p), 'utf8') : '');
const SKINS = ['vscode', 'macos', 'chrome', 'slate', 'nord', 'obsidian', 'tokyo'];

// ── 1. Release files ────────────────────────────────────────────────────────
const pkg = JSON.parse(read('projects/angular-dockable-desktop/package.json') || '{}');
must(read('projects/angular-dockable-desktop/src/lib/version.ts').includes(`'${pkg.version}'`), `VERSION does not match the package version ${pkg.version}`);
const changelog = read('CHANGELOG.md');
const entryOf = v => {
  const start = changelog.indexOf(`## [${v}]`);
  return start < 0 ? '' : changelog.slice(start, changelog.indexOf('\n## [', start + 1));
}
must(entryOf(pkg.version) !== '', `CHANGELOG.md has no entry for the package version ${pkg.version}`);
const entry = entryOf('1.2.0');
must(entry !== '', 'CHANGELOG.md has no 1.2.0 entry');
must(/\*\*Parity:[^*]*react-dockable-desktop[^*]*7\.3\.0/.test(entry),
  'the 1.2.0 entry must state its parity line, naming react-dockable-desktop 7.3.0');
for (const section of ['### Added', '### Fixed', '### Tests', '### Docs']) {
  must(entry.includes(section), `the 1.2.0 entry has no "${section}" section`);
}

// ── 2. The decision ─────────────────────────────────────────────────────────
must(existsSync(resolve(ROOT, 'docs/decisions/0016-brand-surfaces-and-corners.md')), 'docs/decisions/0016-brand-surfaces-and-corners.md is missing');
must(read('docs/decisions/README.md').includes('(0016-brand-surfaces-and-corners.md)'), 'the ADR index does not list 0016');

// ── 3. The manual ───────────────────────────────────────────────────────────
const theming = read('docs/manual/10-theming.md');
must(/^### Your surfaces$/m.test(theming), 'the theming chapter has no "Your surfaces" section');
must(/^### Corners$/m.test(theming), 'the theming chapter has no "Corners" section');
for (const v of ['--ndd-brand-surface', '--ndd-brand-text', '--ndd-radius-scale']) {
  must(new RegExp(`^\\| \`${v}\` \\|`, 'm').test(theming), `the token reference has no row for ${v}`);
}
// rdd's design draft wrote [data-color-scheme="dark"], which matches nothing when the attribute is absent.
must(theming.includes(':root:not([data-color-scheme="light"])'), 'Your surfaces must show the dark selector that matches a missing attribute');
must(!/\[data-color-scheme="dark"\]\s*\{\s*--ndd-brand-surface/.test(theming), 'the manual sets --ndd-brand-surface under [data-color-scheme="dark"], which a missing attribute does not match');
const sheet = readFileSync(STYLES, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
for (const kept of ['50%', '999px']) {
  must(new RegExp(`border-radius:\\s*${kept}`).test(sheet), `the stylesheet no longer keeps a ${kept} corner — update Corners in the manual`);
}

// ── 4. PARITY ───────────────────────────────────────────────────────────────
const parity = read('docs/PARITY.md');
for (const [rdd, ndd] of [
  ['--rdd-brand-surface', '--ndd-brand-surface'],
  ['--rdd-radius-scale', '--ndd-radius-scale'],
  ['radius.browser.ts', 'scripts/gates/browser/m17.mjs'],
]) {
  must(parity.includes(rdd) && parity.includes(ndd), `PARITY.md does not map ${rdd} to ${ndd}`);
}

// ── 5. The corner baseline ──────────────────────────────────────────────────
const fixturePath = resolve(ROOT, 'scripts/gates/browser/fixtures/m17-radius-baseline.json');
const fixture = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null
must(!!fixture, `the M17 corner baseline (${fixturePath}) is missing`);
if (fixture) {
  for (const skin of SKINS) for (const cs of ['dark', 'light']) {
    must(Object.keys(fixture.scenes?.[`${skin}/${cs}`] ?? {}).length >= 10, `the corner baseline has no full ${skin}/${cs} scene`);
  }
}

if (failures.length) {
  console.error('M17: FAIL');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log('M17: ok — release files, ADR 0016, manual, PARITY, corner baseline');
