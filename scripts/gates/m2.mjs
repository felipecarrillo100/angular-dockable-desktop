/**
 * M2 — pure core + stylesheet + fixtures.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LIB, ROOT, STYLES } from './lib/config.mjs';
import { declaredProperties, keyframeNames, selectorClasses } from './lib/css.mjs';

const failures = [];
const VDD = join(ROOT, '../vue-dockable-desktop');
const CORE = join(LIB, 'src/lib/core');

// 1. The framework-free core is framework-free.
const PURE = ['anchor-geometry', 'drag-resize', 'layout-tree', 'stretch', 'serialize', 'event-bus', 'messages', 'panel-overlay', 'serializable', 'types'];
for (const m of PURE) {
  const f = join(CORE, `${m}.ts`);
  if (!existsSync(f)) { failures.push(`core module missing: ${m}.ts`); continue; }
  const src = readFileSync(f, 'utf8');
  for (const imp of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (!imp[1].startsWith('./')) failures.push(`core/${m}.ts imports "${imp[1]}" — the core must stay framework-free`);
  }
}

// 2. The stylesheet port is complete: everything vdd ships has its ndd- counterpart.
const vddCss = existsSync(join(VDD, 'src/index.css')) ? readFileSync(join(VDD, 'src/index.css'), 'utf8') : null;
const css = readFileSync(STYLES, 'utf8');
if (!vddCss) failures.push('vue-dockable-desktop/src/index.css not found — cannot check completeness');
else {
  const rename = x => x.replace(/^vdd-/, 'ndd-').replace(/^--vdd-/, '--ndd-');
  const pairs = [['class', selectorClasses], ['custom property', declaredProperties], ['@keyframes', keyframeNames]];
  for (const [kind, fn] of pairs) {
    const ours = fn(css);
    let n = 0;
    for (const x of fn(vddCss)) { n++; if (!ours.has(rename(x))) failures.push(`stylesheet: vdd ${kind} "${x}" has no ndd counterpart "${rename(x)}"`); }
    if (n === 0) failures.push(`stylesheet: found no vdd ${kind}s — the completeness check is not reading the file`);
  }
}

// 3. No Vue remnants anywhere in the library source.
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of walk(join(LIB, 'src'))) {
  const src = readFileSync(f, 'utf8');
  const hit = src.match(/\bvdd-[a-z]|'vdd\.|<Vdd|\bVdd[A-Z]\w*|Teleport|defineModel|\bnextTick\b|from 'vue'/);
  if (hit) failures.push(`${relative(ROOT, f)}: Vue remnant "${hit[0]}"`);
}

// 4. Fixtures are byte-identical to vdd's (they were produced by rdd 6.2.0 itself).
const FIX = join(LIB, 'test/fixtures/rdd-6.2.0');
const VFIX = join(VDD, 'test/fixtures/rdd-6.2.0');
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const vfiles = existsSync(VFIX) ? readdirSync(VFIX).filter(f => f.endsWith('.json')) : [];
if (vfiles.length < 10) failures.push(`expected vdd's 10 rdd fixtures, found ${vfiles.length}`);
for (const f of vfiles) {
  if (!existsSync(join(FIX, f))) failures.push(`fixture missing: ${f}`);
  else if (sha(join(FIX, f)) !== sha(join(VFIX, f))) failures.push(`fixture differs from vdd's: ${f}`);
}

// 5. Message ids are the library's own (they are keys in consumers' translation dictionaries).
const messages = readFileSync(join(CORE, 'messages.ts'), 'utf8');
const ids = [...messages.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
if (ids.length < 20) failures.push(`expected the full default message table, found ${ids.length} ids`);
for (const id of ids) if (!id.startsWith('ndd.')) failures.push(`message id "${id}" is not ndd.-prefixed`);

// 6. Strictness was not loosened to make ported code compile.
const ts = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8');
for (const flag of ['"strict": true', '"noPropertyAccessFromIndexSignature": true', '"strictTemplates": true', '"noUnusedLocals": true']) {
  if (!ts.includes(flag)) failures.push(`tsconfig.json no longer has ${flag}`);
}

// 7. Non-vacuity: every M2 module turns the suite red when broken.
const nv = spawnSync('node', [join(ROOT, 'scripts/gates/non-vacuity.mjs'), '--milestone', '2'], { stdio: 'inherit' });
if (nv.status !== 0) failures.push('non-vacuity sweep failed');

if (failures.length) { console.error('M2: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log('M2: ok');
