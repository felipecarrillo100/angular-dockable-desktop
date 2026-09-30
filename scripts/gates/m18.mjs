/**
 * M18 gate — the field-report fixes (1.3.0), ported from react-dockable-desktop 7.4.0 (ADR 0017).
 *
 *   1  the release files: the package version equals VERSION and has its own CHANGELOG entry
 *      (ADR 0015's rule); the 1.3.0 entry states a parity line naming react-dockable-desktop
 *      7.4.0's fixes and has every section
 *   2  the package ships the CHANGELOG: ng-package.json copies it, and the library project's copy
 *      is the root CHANGELOG as scripts/sync-package-readme.mjs writes it (no drift)
 *   3  the decision is recorded: ADR 0017 exists and is indexed
 *   4  the manual documents each fix — frost and reduced motion in the theming chapter, title
 *      functions, the sidebar/toast direction and the CDK Directionality recipe in the i18n chapter
 *   5  PARITY.md traces the rdd 7.4.0 fixes
 *
 * The stylesheet contract is unit-tested in stylesheet.spec.ts, the title functions and finite
 * geometry in field-report.spec.ts; the rendered result is the M18 browser gate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './lib/config.mjs';
import { packageChangelog } from '../sync-package-readme.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const read = p => (existsSync(resolve(ROOT, p)) ? readFileSync(resolve(ROOT, p), 'utf8') : '');

// ── 1. Release files ────────────────────────────────────────────────────────
const pkg = JSON.parse(read('projects/angular-dockable-desktop/package.json') || '{}');
must(read('projects/angular-dockable-desktop/src/lib/version.ts').includes(`'${pkg.version}'`), `VERSION does not match the package version ${pkg.version}`);
const changelog = read('CHANGELOG.md');
const entryOf = v => {
  const start = changelog.indexOf(`## [${v}]`);
  return start < 0 ? '' : changelog.slice(start, changelog.indexOf('\n## [', start + 1));
};
must(entryOf(pkg.version) !== '', `CHANGELOG.md has no entry for the package version ${pkg.version}`);
const entry = entryOf('1.3.0');
must(entry !== '', 'CHANGELOG.md has no 1.3.0 entry');
must(/\*\*Parity:[^*]*react-dockable-desktop[^*]*7\.4\.0/.test(entry), 'the 1.3.0 entry must state its parity line, naming react-dockable-desktop 7.4.0');
for (const section of ['### Added', '### Fixed', '### Tests', '### Docs']) must(entry.includes(section), `the 1.3.0 entry has no "${section}" section`);
must(/^\[1\.3\.0\]: /m.test(changelog), 'CHANGELOG.md has no link for [1.3.0]');

// ── 2. The CHANGELOG in the package ─────────────────────────────────────────
const ngPackage = JSON.parse(read('projects/angular-dockable-desktop/ng-package.json') || '{}');
must((ngPackage.assets ?? []).some(a => typeof a === 'object' && a.glob === 'CHANGELOG.md'), 'ng-package.json does not copy CHANGELOG.md into the package');
must(read('projects/angular-dockable-desktop/CHANGELOG.md') === packageChangelog(changelog), "the package's CHANGELOG has drifted from CHANGELOG.md — run node scripts/sync-package-readme.mjs");

// ── 3. The decision ─────────────────────────────────────────────────────────
must(existsSync(resolve(ROOT, 'docs/decisions/0017-frost-on-a-pseudo-element.md')), 'docs/decisions/0017-frost-on-a-pseudo-element.md is missing');
must(read('docs/decisions/README.md').includes('(0017-frost-on-a-pseudo-element.md)'), 'the ADR index does not list 0017');

// ── 4. The manual ───────────────────────────────────────────────────────────
const theming = read('docs/manual/10-theming.md');
const i18n = read('docs/manual/11-i18n.md');
must(/^## Frosted glass and your own overlays$/m.test(theming), 'the theming chapter has no "Frosted glass and your own overlays" section');
must(theming.includes('prefers-reduced-motion'), 'the theming chapter does not mention prefers-reduced-motion');
must(/^### A function, for your own translation function$/m.test(i18n), 'the i18n chapter does not document title functions');
must(i18n.includes('string | MessageDescriptor | (() => string)'), 'the i18n chapter states the old Label type');
must(/^### Angular Material and the CDK$/m.test(i18n) && i18n.includes('provideWorkspaceDirectionality'), 'the i18n chapter has no Directionality recipe');
must(!/Chrome you own around the desktop does not follow it on its own; bind it:\n\n```html\n<div class="app-shell" \[attr\.dir\]="ws\.dir\(\)">\n  <ndd-sidebar/.test(i18n), 'the i18n chapter still says the sidebar needs a dir binding');

// ── 5. PARITY ───────────────────────────────────────────────────────────────
const parity = read('docs/PARITY.md');
must(/^### Field-report fixes \(1\.3\.0, from rdd 7\.4\.0\)$/m.test(parity), 'PARITY.md does not trace the rdd 7.4.0 fixes');
for (const name of ['frost.browser.ts', 'scripts/gates/browser/m18.mjs']) must(parity.includes(name), `PARITY.md does not name ${name}`);

if (failures.length) {
  console.error('M18: FAIL');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log('M18: ok — release files, package CHANGELOG, ADR 0017, manual, PARITY');
