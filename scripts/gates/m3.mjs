/**
 * M3 — the workspace store.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT, VITEST_JSON } from './lib/config.mjs';

const failures = [];
const WS = join(LIB, 'src/lib/workspace/workspace.ts');
const src = readFileSync(WS, 'utf8');

/** The body of a class method, found by brace matching from its signature. */
function methodBody(name) {
  const m = new RegExp(`^  (?:async )?${name}\\s*(?:<[^\\n]*?>)?\\(`, 'm').exec(src);
  if (!m) return null;
  let i = src.indexOf('{', src.indexOf(')', m.index));
  // skip a return-type object literal: the body brace is the one after `): T {` at depth 0
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}

// 1. One resolution point: every placement action resolves activePanelId (vdd D2). Actions
//    that delegate (openPanel → restore/dock/focus; maximize → restore/float) count through
//    the action they delegate to.
const PLACEMENT = ['openPanel', 'closePanel', 'minimizePanel', 'restorePanel', 'floatPanel', 'dockPanel',
  'dockPanelToGroup', 'dockPanelToWorkspaceEdge', 'movePanelOrder', 'maximizePanel', 'focusPanel', 'closeLeafGroup'];
for (const name of PLACEMENT) {
  const body = methodBody(name);
  if (!body) { failures.push(`workspace.ts: placement action ${name}() not found`); continue; }
  if (!/this\.resolveActive\(/.test(body)) failures.push(`${name}() does not end in this.resolveActive() — every placement action must (vdd D2)`);
}

// 2. …and activePanelId is written nowhere else, except the documented exceptions. A write is
//    an `activePanelId` key at the top level of a `this.set({ … })` patch — a leaf node's own
//    `activePanelId` nested inside a tree value is a different field.
const classStart = src.indexOf('export class Workspace');
const methodAt = index => [...src.slice(classStart, index).matchAll(/^ {2}(?:private |async )*(\w+)\s*(?:<[^\n]*?>)?\(/gm)].pop()?.[1];
const writers = [];
for (const m of src.matchAll(/this\.set\(\{/g)) {
  let i = m.index + m[0].length, depth = 1, key = '';
  const keys = [];
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (depth === 1) {
      if (/[\w$]/.test(c)) key += c;
      else if (c === ':' && key) { keys.push(key); key = ''; }
      else if (!/\s/.test(c)) key = '';
    }
  }
  if (keys.includes('activePanelId')) writers.push(methodAt(m.index));
}
if (writers.length === 0) failures.push('found no activePanelId writes at all — the check is not reading the source');
const ALLOWED = new Set(['resolveActive', 'focusPanel', 'loadLayout']);
for (const w of writers) if (!ALLOWED.has(w)) failures.push(`activePanelId is written in ${w}() — only resolveActive() may decide it (vdd D2)`);

// 3. Every read inside an action is untracked: the only direct `this._state()` read outside
//    the computed views is the untracked getter.
const directReads = [...src.matchAll(/this\._state\(\)/g)].length;
const inComputed = [...src.matchAll(/computed\(\(\) => this\._state\(\)/g)].length + (src.match(/activeContributionSignal\(this\.contributions, \(\) => this\._state\(\)/) ? 1 : 0);
if (directReads !== inComputed) failures.push(`${directReads - inComputed} tracked this._state() read(s) outside computed views — actions must read through the untracked getter`);
if (!/private get s\(\): WorkspaceState \{\s*return untracked\(this\._state\);/.test(src)) failures.push('the untracked state getter is missing or changed');

// 4. No module-level mutable state in the store (two workspaces must be independent).
for (const f of ['src/lib/workspace/workspace.ts', 'src/lib/workspace/provide.ts', 'src/lib/core/registry.ts', 'src/lib/core/overlays.ts', 'src/lib/core/contributions.ts', 'src/lib/core/toolbar-state.ts']) {
  const code = readFileSync(join(LIB, f), 'utf8');
  const top = code.split('\n').filter(l => /^(let|var) /.test(l));
  if (top.length) failures.push(`${f}: module-level mutable state: ${top.join(' | ')}`);
}

// 5. Specification tests that carry this milestone's promises must have run and passed.
const report = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : { testResults: [] };
const passed = new Set(report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'passed').map(a => a.title)));
const MUST = [
  'openPanel works with no app created and nothing mounted',
  'two workspaces are fully independent',
  'an action called inside an effect() does not make the effect depend on the store',
  'two component subtrees can each provide their own, independent workspace',
];
for (const t of MUST) if (!passed.has(t)) failures.push(`required test did not pass: "${t}"`);
const fixtures = report.testResults.find(f => f.name.endsWith('round-trip.spec.ts'));
const trips = (fixtures?.assertionResults ?? []).filter(a => /survives load → save/.test(a.title) && a.status === 'passed');
if (trips.length < 10) failures.push(`expected all 10 rdd fixtures to round-trip, ${trips.length} did`);

// 6. Non-vacuity for the modules M3 touched (the full sweep is npm run gate:sweep).
const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '3', '--exact'], { stdio: 'inherit' });
if (nv.status !== 0) failures.push('non-vacuity sweep failed');

if (failures.length) { console.error('M3: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M3: ok');
