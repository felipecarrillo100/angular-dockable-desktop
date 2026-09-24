/**
 * M15 — documentation and release readiness: the last gate.
 *
 *   1  the release files exist and agree: LICENSE (MIT, also in the package), CHANGELOG with a
 *      1.0.0 entry whose parity line names vdd 1.1.1 and rdd 6.3.1, package version = VERSION
 *   2  the quick start is the code the consumer smoke proves: the panel and the root component of
 *      `m13-consumer.mjs` appear verbatim in README.md and in manual chapter 1
 *   3  the package README is the root README's user-facing half (scripts/sync-package-readme.mjs)
 *   4  the manual: 13 chapters and an index; every relative link resolves; the API reference
 *      names every export and type in api-surface.json; the theming chapter's token tables match
 *      the stylesheet's :root tokens in both directions
 *   5  PARITY.md and the migration chapter carry every N-series row; every ADR is indexed
 *   6  the CI workflows are well-formed, run this gate, and use a Node the toolchain supports
 *   7  everything again: every browser gate M4–M14 and its controls, the vdd differential, the
 *      round trips, the consumer smoke and coexistence — so the release is judged on one run.
 *      `NDD_NO_VDD=1` (set by CI, which has no vue-dockable-desktop checkout) skips the two vdd
 *      comparisons, and says so.
 *
 * The clean install (`rm -rf node_modules dist && npm ci`) precedes the run; the evidence says so.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { API_SURFACE, ROOT, STYLES } from './lib/config.mjs';
import { packageReadme } from '../sync-package-readme.mjs';

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const read = p => readFileSync(resolve(ROOT, p), 'utf8');
const step = name => console.log(`\n── M15: ${name}`);
const sub = (script, args = [], { expectFail = false } = {}) => {
  const r = spawnSync('node', [join(ROOT, script), ...args], { stdio: expectFail ? 'pipe' : 'inherit', encoding: 'utf8' });
  return expectFail ? r.status !== 0 : r.status === 0;
};

// ── 1. Release files ────────────────────────────────────────────────────────
step('release files');
const license = existsSync(join(ROOT, 'LICENSE')) ? read('LICENSE') : '';
must(/^MIT License/.test(license), 'LICENSE must be the MIT licence');
must(existsSync(join(ROOT, 'dist/angular-dockable-desktop/LICENSE')), 'the built package does not carry LICENSE');
must(existsSync(join(ROOT, 'dist/angular-dockable-desktop/README.md')), 'the built package does not carry README.md');
const changelog = read('CHANGELOG.md');
const entry = changelog.slice(changelog.indexOf('## [1.0.0]'));
must(changelog.includes('## [1.0.0]'), 'CHANGELOG.md has no 1.0.0 entry');
must(/Parity: vue-dockable-desktop 1\.1\.1, react-dockable-desktop 6\.3\.1/.test(entry), 'the 1.0.0 entry must state its parity line');
const libPkg = JSON.parse(read('projects/angular-dockable-desktop/package.json'));
must(libPkg.version === '1.0.0', `the package version is ${libPkg.version}, not 1.0.0`);
must(read('projects/angular-dockable-desktop/src/lib/version.ts').includes(`'${libPkg.version}'`), 'VERSION does not match the package version');
must(libPkg.license === 'MIT', 'the package must declare the MIT licence');

// ── 2. The quick start is the proven code ───────────────────────────────────
step('quick start = consumer smoke');
const consumer = read('scripts/gates/m13-consumer.mjs');
const proven = [...consumer.matchAll(/writeFileSync\(join\(APP, 'src\/app\/(hello-panel|app)\.ts'\), `([\s\S]*?)`\);/g)]
  .map(m => ({ file: m[1], code: m[2].replace(/\\`/g, '`').trim() }));
must(proven.length === 2, `expected the consumer smoke's two quick-start files, found ${proven.length}`);
const readme = read('README.md');
const chapter1 = read('docs/manual/01-getting-started.md');
for (const { file, code } of proven) {
  must(readme.includes(code), `README.md's quick start does not contain the consumer smoke's ${file}.ts verbatim`);
  must(chapter1.includes(code), `chapter 1 does not contain the consumer smoke's ${file}.ts verbatim`);
}
const providerLine = consumer.match(/(provideDockableDesktop\(\{ panels: \{ hello: .*? \} \} \} \}\))/)?.[1];
must(!!providerLine, 'could not read the consumer smoke\'s provider line');
if (providerLine) {
  must(readme.includes(providerLine), 'README.md does not register the panel the way the consumer smoke does');
  must(chapter1.includes(providerLine), 'chapter 1 does not register the panel the way the consumer smoke does');
}
must(readme.includes('"angular-dockable-desktop/styles.css"'), 'README.md must show the stylesheet in angular.json');

// ── 3. The package README ───────────────────────────────────────────────────
step('package README');
must(read('projects/angular-dockable-desktop/README.md') === packageReadme(readme), 'the package README has drifted from README.md — run node scripts/sync-package-readme.mjs');

// ── 4. The manual ───────────────────────────────────────────────────────────
step('manual');
const MANUAL = join(ROOT, 'docs/manual');
const chapters = readdirSync(MANUAL).filter(f => /^\d\d-.*\.md$/.test(f)).sort();
must(chapters.length === 13, `the manual has ${chapters.length} chapters, not 13`);
must(existsSync(join(MANUAL, 'README.md')), 'the manual has no index');
const index = existsSync(join(MANUAL, 'README.md')) ? read('docs/manual/README.md') : '';
for (const c of chapters) must(index.includes(`(${c})`), `the manual index does not link ${c}`);

// Every relative link in the README, the manual, PARITY and the ADR index must resolve.
const docs = ['README.md', 'CHANGELOG.md', 'docs/PARITY.md', 'docs/decisions/README.md', 'docs/manual/README.md', ...chapters.map(c => `docs/manual/${c}`)];
let links = 0;
for (const doc of docs) {
  const body = read(doc).replace(/```[\s\S]*?```/g, '');
  for (const m of body.matchAll(/\]\(([^)\s#]+)(#[^)\s]*)?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    links++;
    must(existsSync(resolve(ROOT, dirname(doc), target)), `${doc} links to ${target}, which does not exist`);
  }
}
console.log(`  ${chapters.length} chapters; ${links} relative links resolve`);

const surface = JSON.parse(read(API_SURFACE));
const reference = read('docs/manual/13-api-reference.md');
for (const name of [...surface.exports, ...surface.types]) must(new RegExp(`\\b${name}\\b`).test(reference), `the API reference does not name ${name}`);

const sheet = read(STYLES).replace(/\/\*[\s\S]*?\*\//g, '');
const rootTokens = new Set([...sheet.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
  .filter(m => m[1].replace(/\s+/g, ' ').trim() === ':root')
  .flatMap(m => [...m[2].matchAll(/(--ndd-[\w-]+)\s*:/g)].map(t => t[1])));
must(rootTokens.size > 100, `only ${rootTokens.size} :root tokens parsed — the parse is wrong`);
const theming = read('docs/manual/10-theming.md');
for (const token of rootTokens) must(theming.includes(token), `${token} is declared on :root but missing from the theming chapter`);
const known = new Set([...sheet.matchAll(/(--ndd-[\w-]+)/g)].map(m => m[1]));
for (const token of new Set([...theming.matchAll(/(--ndd-[\w-]+)/g)].map(m => m[1]))) {
  must(known.has(token), `the theming chapter documents ${token}, which the stylesheet neither declares nor reads`);
}
console.log(`  ${surface.exports.length + surface.types.length} API names referenced; ${rootTokens.size} tokens documented`);

// ── 5. PARITY, migration, ADRs ──────────────────────────────────────────────
step('parity and decisions');
const parity = read('docs/PARITY.md');
const nRows = [...parity.matchAll(/^\| (N\d+) \|/gm)].map(m => m[1]);
must(nRows.length >= 17, `PARITY.md lists ${nRows.length} N-series rows`);
const migrating = read('docs/manual/12-migrating.md');
for (const n of nRows) must(new RegExp(`^\\| ${n} \\|`, 'm').test(migrating), `the migration chapter has no row for ${n}`);
must(readme.includes(`N1–N${nRows.length}`), `README.md must cite the N-series as N1–N${nRows.length}`);
const adrs = readdirSync(join(ROOT, 'docs/decisions')).filter(f => /^\d{4}-.*\.md$/.test(f));
const adrIndex = read('docs/decisions/README.md');
for (const f of adrs) must(adrIndex.includes(`(${f})`), `docs/decisions/README.md does not index ${f}`);

// ── 6. CI workflows ─────────────────────────────────────────────────────────
step('workflows');
const engines = JSON.parse(read('node_modules/@angular/core/package.json')).engines?.node ?? '';
for (const wf of ['gate.yml', 'pages.yml']) {
  const path = `.github/workflows/${wf}`;
  if (!existsSync(join(ROOT, path))) { failures.push(`${path} is missing`); continue; }
  const y = read(path);
  must(!y.includes('\t'), `${path} contains a tab, which YAML forbids for indentation`);
  must(/^on:/m.test(y) && /^jobs:/m.test(y) && /^\s+runs-on: ubuntu-latest/m.test(y), `${path} lacks on/jobs/runs-on`);
  must(/run: npm ci/.test(y), `${path} must install with npm ci`);
  const node = y.match(/node-version: (\d+)/)?.[1];
  must(node && new RegExp(`\\^${node}\\.|>=${node}`).test(engines), `${path} uses Node ${node}, outside Angular's engines (${engines})`);
}
must(read('.github/workflows/gate.yml').includes('npm run gate -- M15'), 'the gate workflow must run the release gate');
must(read('.github/workflows/pages.yml').includes('ng build demo'), 'the pages workflow must build the demo');

// ── 7. Everything again ─────────────────────────────────────────────────────
step('every browser gate, M4–M14');
for (let n = 4; n <= 14; n++) {
  const script = `scripts/gates/browser/m${n}.mjs`;
  if (existsSync(join(ROOT, script))) must(sub(script), `the M${n} browser gate no longer passes`);
}
must(sub('scripts/gates/browser/m13.mjs', ['--control'], { expectFail: true }), 'the M13 browser control passed');
must(sub('scripts/gates/browser/m15.mjs', ['--control'], { expectFail: true }), 'the M15 divider control passed — direction is not being measured');
// The vdd comparisons need vdd's playground, built from a checkout beside this repository.
// CI has none and sets NDD_NO_VDD=1; the skip is announced, never silent.
const noVdd = process.env['NDD_NO_VDD'] === '1';
if (noVdd) console.log('  skipped (NDD_NO_VDD=1): the vdd differential and the vdd↔ndd round trips');
else must(sub('scripts/gates/browser/m6-diff.mjs'), 'the vdd differential no longer passes');
step('round trips, coexistence, consumer smoke');
if (!noVdd) must(sub('scripts/gates/browser/m13-roundtrip.mjs'), 'the vdd↔ndd round trips no longer pass');
must(sub('scripts/gates/browser/m13-coexist.mjs'), 'the coexistence gate no longer passes');
must(sub('scripts/gates/m13-consumer.mjs'), 'the consumer smoke no longer passes');

if (failures.length) {
  console.error('\nM15: FAIL');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log('\nM15: ok');
