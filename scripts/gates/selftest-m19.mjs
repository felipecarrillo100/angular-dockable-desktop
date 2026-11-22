/**
 * The M19 rules' seeded violations (integrity rule 6), run by selftest.mjs and runnable alone:
 *
 *   node scripts/gates/selftest-m19.mjs
 *
 * Each case copies the files the M19 rules read into a scratch tree under artifacts/selftest-m19/,
 * applies one violation, and points scripts/gates/m19.mjs at it through NDD_GATE_M19_ROOT. The
 * clean copy must pass; every seeded violation must fail.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './lib/config.mjs';
import { packageChangelog } from '../sync-package-readme.mjs';

const LIB = 'projects/angular-dockable-desktop';
/** Every file scripts/gates/m19.mjs reads or requires. */
const FILES = [
  'package.json', 'README.md', 'CHANGELOG.md', `${LIB}/CHANGELOG.md`, `${LIB}/package.json`, `${LIB}/src/lib/version.ts`,
  'docs/decisions/README.md', 'docs/decisions/0019-popout-windows.md',
  'docs/manual/README.md', 'docs/manual/12-migrating.md', 'docs/manual/13-api-reference.md', 'docs/manual/15-popout-windows.md',
  'docs/PARITY.md', `${LIB}/test/baseline-counts.json`,
  `${LIB}/src/lib/core/pop-out-windows.ts`, `${LIB}/src/lib/core/pop-out-styles.ts`, `${LIB}/src/lib/desktop/pop-out-frame.ts`,
  `${LIB}/src/lib/panel/panel-window.ts`, `${LIB}/src/lib/common/popout-wrap.ts`, `${LIB}/src/styles/parts/26a-popout.css`,
  ...['components/document-aware', 'store/pop-out-store', 'components/pop-out-windows', 'components/pop-out-styles',
    'components/popout-wrapper', 'components/pop-out-chrome', 'components/pop-out-widgets', 'components/pop-out-focus',
    'components/pop-out-from-pop-out'].map(f => `${LIB}/test/${f}.spec.ts`),
  'projects/playground/public/popout.html', 'projects/playground/src/app/pop-panel.ts',
  'projects/playground/src/app/pop-widget.ts', 'projects/playground/src/app/runtime-css.ts',
  'scripts/gates/browser/m19.mjs',
  'projects/demo/src/main.ts', 'projects/demo/src/app/app.ts', 'projects/demo/src/app/panels/cameras-table-toggle.ts',
  'projects/demo/public/popout.html',
];

/**
 * [label, file, edit, expected] — `edit` turns the file's text into the violation (it must change
 * it), and the rule's output must name it with `expected`, so a seed is caught by its own rule.
 * A seed on CHANGELOG.md keeps the package's copy in step, so only that rule can catch it.
 */
const SEEDS = [
  ['the 1.12.0 entry naming the wrong rdd release', 'CHANGELOG.md', s => s.replace('**Parity: react-dockable-desktop 7.12.1**', '**Parity: react-dockable-desktop 7.12.0**'), 'parity line'],
  ['the 1.12.0 entry losing a section', 'CHANGELOG.md', s => s.replace(/(## \[1\.12\.0\][\s\S]*?)### Fixed/, '$1### Repaired'), '"### Fixed"'],
  ["the package's CHANGELOG drifting", `${LIB}/CHANGELOG.md`, s => s + '\nstale\n', 'drifted'],
  ['VERSION not following the package', `${LIB}/src/lib/version.ts`, s => s.replace("'1.12.0'", "'1.11.1'"), 'VERSION does not match'],
  ['M19 left out of gate:release', 'package.json', s => s.replace(' M19"', '"'), 'gate:release'],
  ['ADR 0019 dropped from the index', 'docs/decisions/README.md', s => s.replace('(0019-popout-windows.md)', '(0019-popout.md)'), 'does not list 0019'],
  ['ADR 0019 without the zone.js decision', 'docs/decisions/0019-popout-windows.md', s => s.replaceAll('patchEventTarget', 'patch'), 'zone.js decision'],
  ['chapter 15 dropped from the manual index', 'docs/manual/README.md', s => s.replace('(15-popout-windows.md)', '(15-popout.md)'), 'index does not list chapter 15'],
  ['chapter 15 losing its zone.js section', 'docs/manual/15-popout-windows.md', s => s.replace('### Change detection and zone.js', '### Change detection'), 'Change detection and zone.js'],
  ["chapter 15 losing Playwright's 5 s warning", 'docs/manual/15-popout-windows.md', s => s.replace(/about 5(\s+)seconds/g, 'a few$1seconds'), '5 s user activation'],
  ['chapter 15 not saying the wrapper is read once', 'docs/manual/15-popout-windows.md', s => s.replaceAll('read when each panel is created', 'read once'), 'read once'],
  ['the API reference no longer naming injectPanelWindow', 'docs/manual/13-api-reference.md', s => s.replaceAll('`injectPanelWindow()`', '`injectWindow()`'), 'does not name injectPanelWindow'],
  ['a message key missing from the migration chapter', 'docs/manual/12-migrating.md', s => s.replaceAll('`inOwnWindow`', '`ownWindow`'), 'message key inOwnWindow'],
  ['PARITY losing its not-ported list', 'docs/PARITY.md', s => s.replace('**rdd cases not ported, each with its reason:**', '**Not ported:**'), 'did not port'],
  ['a pop-out spec with no count floor', `${LIB}/test/baseline-counts.json`, s => s.replace(/"pop-out-focus\.spec\.ts": \d+/, '"pop-out-focus.spec.ts": 0'), 'no floor for pop-out-focus'],
  ["the demo's popoutUrl absolute, so --base-href is lost", 'projects/demo/src/app/app.ts', s => s.replace('popoutUrl="popout.html"', 'popoutUrl="/popout.html"'), 'is not relative'],
  ["the demo's Leaflet map without canPopOut", 'projects/demo/src/main.ts', s => s.replace(/(leafletMap:[^\n]*), canPopOut: true/, '$1'), 'Leaflet map type has no canPopOut'],
];

export function m19Seeds() {
  const base = join(ROOT, 'artifacts/selftest-m19');
  rmSync(base, { recursive: true, force: true });
  const results = [];
  const run = (label, shouldPass, dir, expected) => {
    const r = spawnSync('node', [join(ROOT, 'scripts/gates/m19.mjs')], { env: { ...process.env, NDD_GATE_M19_ROOT: dir }, encoding: 'utf8' });
    const passed = r.status === 0;
    const text = (r.stdout + r.stderr).trim();
    const named = shouldPass || text.includes(expected);
    results.push({ rule: 'm19.mjs', label, ok: passed === shouldPass && named, got: passed ? 'pass' : named ? 'fail' : `fail, without "${expected}"`, wanted: shouldPass ? 'pass' : 'fail', out: text.split('\n').slice(0, 3).join(' | ') });
  };
  const copy = n => {
    const dir = join(base, `case-${n}`);
    for (const f of FILES) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      if (existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(dir, f));
    }
    return dir;
  };
  run('clean', true, copy(0));
  SEEDS.forEach(([label, file, edit, expected], i) => {
    const dir = copy(i + 1);
    const before = readFileSync(join(dir, file), 'utf8');
    const after = edit(before);
    if (after === before) {
      results.push({ rule: 'm19.mjs', label, ok: false, got: 'no change', wanted: 'fail', out: `the seed did not change ${file}: its anchor is stale` });
      return;
    }
    writeFileSync(join(dir, file), after);
    if (file === 'CHANGELOG.md') writeFileSync(join(dir, LIB, 'CHANGELOG.md'), packageChangelog(after));
    run(`catches ${label}`, false, dir, expected);
  });
  rmSync(base, { recursive: true, force: true });
  return results;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const results = m19Seeds();
  const bad = results.filter(r => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.rule.padEnd(16)} ${r.label}${r.ok ? (process.argv.includes('-v') && r.wanted === 'fail' ? `  → ${r.out}` : '') : `  (wanted ${r.wanted}, got ${r.got}: ${r.out})`}`);
  console.log(bad.length ? `selftest M19: FAIL — ${bad.length} case(s) did not behave` : `selftest M19: ok — ${results.length} cases, every violation rejected`);
  process.exit(bad.length ? 1 : 0);
}
