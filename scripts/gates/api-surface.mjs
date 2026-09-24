/**
 * Standing gate — the public API is exactly what api-surface.json documents.
 *
 * Reads the BUILT package, not the source: that is what a consumer imports. Runtime exports
 * come from the FESM bundle's export list, type exports from the bundled .d.ts, so a
 * type-only change cannot slip past. Refuses to measure a build older than the source.
 *
 *   --write   re-seed api-surface.json from the build (an intentional API change)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_SURFACE, DIST, LIB_SRC } from './lib/config.mjs';

const pkgPath = join(DIST, 'package.json');
if (!existsSync(pkgPath)) { console.error(`api-surface: ${pkgPath} missing — build the library first`); process.exit(1); }
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const ESM = join(DIST, pkg.module);
const DTS = join(DIST, pkg.typings);
for (const f of [ESM, DTS]) if (!existsSync(f)) { console.error(`api-surface: ${f} missing`); process.exit(1); }

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const newestSrc = Math.max(...walk(LIB_SRC).map(f => statSync(f).mtimeMs));
if (newestSrc > Math.min(statSync(ESM).mtimeMs, statSync(DTS).mtimeMs)) {
  console.error('api-surface: the build is older than the source — it would measure a surface nobody ships.');
  process.exit(1);
}

const names = list => list.split(',').map(p => p.trim()).filter(Boolean).map(p => p.split(/\s+as\s+/).pop().trim());

// Runtime: every `export { … }` list in the FESM bundle, plus direct `export const/class/function`.
const esm = readFileSync(ESM, 'utf8');
const runtime = new Set();
for (const m of esm.matchAll(/^export\s*\{([^}]*)\}/gm)) names(m[1]).forEach(n => runtime.add(n));
for (const m of esm.matchAll(/^export\s+(?:const|let|var|class|function\*?|async\s+function)\s+([A-Za-z_$][\w$]*)/gm)) runtime.add(m[1]);

// Types: everything the .d.ts exports that is not also a runtime value.
const dts = readFileSync(DTS, 'utf8');
const declared = new Set();
for (const m of dts.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) names(m[1].replace(/\btype\s+/g, '')).forEach(n => declared.add(n));
for (const m of dts.matchAll(/^export\s+(?:declare\s+)?(?:type|interface|const|class|function|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm)) declared.add(m[1]);
const types = [...declared].filter(n => !runtime.has(n)).sort();
const actual = { exports: [...runtime].sort(), types };

if (process.argv.includes('--write') || !existsSync(API_SURFACE)) {
  writeFileSync(API_SURFACE, JSON.stringify(actual, null, 2) + '\n');
  console.log(`api-surface: wrote ${API_SURFACE} — ${actual.exports.length} runtime, ${types.length} type export(s)`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(API_SURFACE, 'utf8'));
const failures = [];
for (const [kind, now, before] of [['runtime', actual.exports, expected.exports ?? []], ['type', types, expected.types ?? []]]) {
  for (const x of now.filter(x => !before.includes(x))) failures.push(`+ ${kind} export "${x}" is not in api-surface.json`);
  for (const x of before.filter(x => !now.includes(x))) failures.push(`- ${kind} export "${x}" is documented but no longer exported`);
}
if (failures.length) {
  console.error('api-surface: FAIL');
  failures.forEach(f => console.error('  ' + f));
  console.error('  If the change is intended: node scripts/gates/api-surface.mjs --write');
  process.exit(1);
}
console.log(`api-surface: ok — ${actual.exports.length} runtime + ${types.length} type export(s) as documented`);
