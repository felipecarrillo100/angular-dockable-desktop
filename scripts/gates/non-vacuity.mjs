/**
 * Non-vacuity (integrity rule 5): a suite that stays green when the code it tests is broken
 * proves nothing.
 *
 * For each module listed in test/port-map.json → modules (up to the gated milestone, or only
 * `--only <file>`), every exported function's body is replaced by `throw`, the unit suite is
 * re-run, and the run must finish with **failing tests** — a build error does not count, since
 * it would prove nothing about the assertions. The original is copied aside first and always
 * restored (there is no git to stash with — ADR 0010).
 *
 *   node scripts/gates/non-vacuity.mjs [--milestone N [--exact]] [--only src/lib/core/x.ts]
 *
 * Milestone gates pass `--exact`: they sweep the modules *that milestone* touched (plan B1
 * rule 5). The full sweep over every module — no flags — is `npm run gate:sweep`, which M13 and
 * M15 run, so an earlier module whose guarding tests later weaken is still caught.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, MILESTONE, PORT_MAP, ROOT } from './lib/config.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const upTo = Number(arg('--milestone') ?? MILESTONE);
const only = arg('--only');
const map = JSON.parse(readFileSync(PORT_MAP, 'utf8'));
const exact = process.argv.includes('--exact');
const modules = (map.modules ?? []).filter(m => (only ? m.file === only : exact ? m.milestone === upTo : m.milestone <= upTo));

/** Replace each exported function's (and exported class method's) body with a throw. */
export function stub(src) {
  let out = src, count = 0;
  // `export function name(...)...{` — find the body's opening brace after the signature.
  const re = /export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?\s*\(/g;
  const edits = [];
  // Methods of exported classes (not constructors, not accessors): `  name(…)` / `  async name<T>(…)`
  // at the start of a line inside an `export class` body.
  const classMethods = [];
  for (const c of src.matchAll(/export\s+(?:abstract\s+)?class\s+\w+[^{]*\{/g)) {
    let i = c.index + c[0].length, depth = 1;
    const bodyStart = i;
    while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
    const body = src.slice(bodyStart, i - 1);
    // Brace depth at every offset of the body (strings, templates and comments skipped): a
    // method is declared at depth 0; the same shape deeper is a call on a continuation line.
    const depthAt = new Int32Array(body.length + 1);
    for (let k = 0, d = 0; k < body.length; k++) {
      const ch = body[k];
      if (ch === '/' && body[k + 1] === '/') { while (k < body.length && body[k] !== '\n') depthAt[k++] = d; }
      else if (ch === '/' && body[k + 1] === '*') { const e = body.indexOf('*/', k + 2); while (k < e + 1) depthAt[k++] = d; }
      else if (ch === '\'' || ch === '"' || ch === '`') { const q = ch; depthAt[k++] = d; while (k < body.length && body[k] !== q) { if (body[k] === '\\') depthAt[k++] = d; depthAt[k++] = d; } }
      else if (ch === '{') d++;
      else if (ch === '}') d--;
      depthAt[k] = d;
    }
    for (const m of body.matchAll(/^[ \t]+(?:(?:public|private|protected|static|override|async)\s+)*([A-Za-z_$][\w$]*)\s*(<(?:[^<>\n]|<(?:[^<>\n]|<[^<>\n]*>)*>)*>)?\s*\(/gm)) {
      if (['constructor', 'if', 'for', 'while', 'switch', 'return', 'catch'].includes(m[1])) continue;
      if (depthAt[m.index] !== 0) continue;
      classMethods.push({ index: bodyStart + m.index, text: m[0], name: m[1] });
    }
  }
  const starts = [...[...src.matchAll(re)].map(m => ({ index: m.index, text: m[0], name: m[1] })), ...classMethods];
  for (const m of starts) {
    m[0] = m.text; m[1] = m.name;
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
    // Find the body brace: the first `{` at bracket depth 0 that does not start a type literal.
    // A `{` right after `:`, `|`, `&`, `<`, `,`, `(`, `=` or `=>` opens a type literal
    // (`): { a: T } {`); anything else — `)`, an identifier, `>`, `]`, `}` — opens the body.
    let j = i, depth2 = 0;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '(' || c === '[' || c === '<') depth2++;
      else if (c === ')' || c === ']' || (c === '>' && src[j - 1] !== '=')) depth2--;
      else if (c === '{') {
        const before = src.slice(i, j).replace(/\s+$/, '');
        const typeLiteral = depth2 > 0 || /(?:[:|&<,(=]|=>)$/.test(before);
        if (!typeLiteral) break;
        let dd = 1; j++;
        while (j < src.length && dd) { if (src[j] === '{') dd++; else if (src[j] === '}') dd--; j++; }
        j--;
      }
    }
    let k = j + 1, d = 1;
    while (k < src.length && d) {
      const c = src[k];
      if (c === '\'' || c === '"' || c === '`') { const q = c; k++; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k++; k++; } }
      else if (c === '/' && src[k + 1] === '/') { while (k < src.length && src[k] !== '\n') k++; }
      else if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k + 2) + 1; }
      else if (c === '{') d++; else if (c === '}') d--;
      k++;
    }
    edits.push([j, k, m[1]]);
  }
  // Apply right-to-left so earlier offsets stay valid — edits come from two scans, so sort first.
  edits.sort((x, y) => x[0] - y[0]);
  for (const [a, b, name] of edits.reverse()) {
    out = out.slice(0, a) + `{ throw new Error('non-vacuity stub: ${name}'); }` + out.slice(b);
    count++;
  }
  // `export const name = (…) => …` / `= async (…) =>` / `= <T>(…) =>`: rename the original and
  // export a throwing replacement under the same name. Internal callers then hit the stub too.
  const arrows = [];
  for (const m of out.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>\s*)?\(/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < out.length && depth) { if (out[i] === '(') depth++; else if (out[i] === ')') depth--; i++; }
    if (/^\s*(?::[^=]*?)?=>/.test(out.slice(i, i + 300))) arrows.push(m[1]);
  }
  for (const name of arrows) {
    out = out.replace(new RegExp(`export\\s+const\\s+${name}\\b`), `const __nv_${name}`);
    // Keep the original's declared type (`typeof`), so type guards and signatures still check
    // in the *other* files that import it — only the behaviour is stubbed.
    out += `\nexport const ${name}: typeof __nv_${name} = ((..._a: unknown[]): never => { throw new Error('non-vacuity stub: ${name}'); }) as never;\n`;
    count++;
  }
  // Component templates: most of a component's behaviour is its template and computed fields,
  // which no method stub reaches. Blank every inline template, so the specs must notice that the
  // component renders nothing.
  out = out.replace(/(@Component\(\{[\s\S]*?\btemplate:\s*)`(?:[^`\\]|\\.)*`/g, (_m, head) => {
    count++;
    // With the template gone its imports are unused, which extended diagnostics report as an
    // error — and a build error proves nothing. Empty them too.
    return `${head.replace(/\bimports:\s*\[[^\]]*\]/, 'imports: []')}\`<!-- non-vacuity stub -->\``;
  });
  // Stubbing leaves private helpers and imports unused, which the strict compiler reports as
  // errors — a build failure would prove nothing, so type-checking is off for the stubbed copy.
  if (count) out = `// @ts-nocheck — non-vacuity stub, restored after the run\n${out}`;
  return { out, count };
}

if (process.argv[1]?.endsWith('non-vacuity.mjs')) {
  const results = [];
  for (const m of modules) {
    const file = join(LIB, m.file);
    const backup = `${file}.nv-orig`;
    if (!existsSync(file)) { results.push({ file: m.file, ok: false, why: 'module missing' }); continue; }
    copyFileSync(file, backup);
    try {
      const { out, count } = stub(readFileSync(file, 'utf8'));
      if (count === 0) { results.push({ file: m.file, ok: false, why: 'no exported functions to stub' }); continue; }
      writeFileSync(file, out);
      const report = join(ROOT, 'artifacts/.nv.json');
      // Never reuse a previous module's report: a stale one would lend this module its red.
      rmSync(report, { force: true });
      // One retry when no report appears: that has been seen once as a transient (M5), and a
      // stub that genuinely breaks the build fails both runs, so the verdict cannot soften.
      for (let attempt = 0; attempt < 2 && !existsSync(report); attempt++) {
        rmSync(report, { force: true });
        spawnSync('npx', ['ng', 'test', 'angular-dockable-desktop', '--reporters=json', `--output-file=${report}`], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: '1' } });
      }
      if (!existsSync(report)) { results.push({ file: m.file, ok: false, why: `stubbed ${count} fn(s) but the suite did not run (build error proves nothing)` }); continue; }
      const r = JSON.parse(readFileSync(report, 'utf8'));
      results.push({ file: m.file, ok: r.numFailedTests > 0, why: `stubbed ${count} fn(s) → ${r.numFailedTests}/${r.numTotalTests} tests failed` });
    } finally {
      copyFileSync(backup, file);
      rmSync(backup);
    }
  }
  for (const r of results) console.log(`  ${r.ok ? 'red ' : 'GREEN'}  ${r.file}  ${r.why}`);
  const vacuous = results.filter(r => !r.ok);
  console.log(vacuous.length ? `non-vacuity: FAIL — ${vacuous.length} module(s) not guarded by the suite` : `non-vacuity: ok — ${results.length} module(s), each turns the suite red`);
  process.exit(vacuous.length ? 1 : 0);
}
