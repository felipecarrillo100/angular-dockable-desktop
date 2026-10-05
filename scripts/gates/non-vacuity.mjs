/**
 * Non-vacuity (integrity rule 5): a suite that stays green when the code it tests is broken
 * proves nothing.
 *
 * For each module listed in test/port-map.json → modules (up to the gated milestone, or only
 * `--only <file>`), every exported function's body is replaced by `throw`, the unit suite is
 * re-run, and the run must finish with **failing tests** — a build error does not count, since
 * it would prove nothing about the assertions.
 *
 * The stubbing happens in copies of the workspace under artifacts/nv/, never in the real source
 * tree, so an interrupted sweep cannot leave a stubbed file behind. Several copies run at once
 * (`--workers N`, or NDD_NV_WORKERS; default a third of the cores, at most three), each with its
 * own report, and every module still gets its own full run of the suite: the verdicts are the same
 * as running them one after another. Before any module, each copy runs the unstubbed suite, which
 * must be green. `NDD_NV_REPORT=<file>` writes every
 * module's verdict and failure count as JSON.
 *
 *   node scripts/gates/non-vacuity.mjs [--milestone N [--exact]] [--only src/lib/core/x.ts] [--workers N]
 *
 * Milestone gates pass `--exact`: they sweep the modules *that milestone* touched (plan B1
 * rule 5). The full sweep over every module — no flags — is `npm run gate:sweep`, which M13 and
 * M15 run, so an earlier module whose guarding tests later weaken is still caught.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { MILESTONE, PORT_MAP, ROOT } from './lib/config.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const upTo = Number(arg('--milestone') ?? MILESTONE);
const only = arg('--only');
const map = JSON.parse(readFileSync(PORT_MAP, 'utf8'));
const exact = process.argv.includes('--exact');
const modules = (map.modules ?? []).filter(m => (only ? m.file === only : exact ? m.milestone === upTo : m.milestone <= upTo));
/** The real workspace. The sweep stubs modules only in copies of it, never here. */
const MAIN = ROOT;
/**
 * One `ng test` already runs its spec files on every core, so more workers soon just queue for the
 * CPU: measured on 10 cores, 5 workers ran each module 3.7× slower than 1. A third of the cores, at
 * most three, is where they stopped helping.
 */
const DEFAULT_WORKERS = Math.min(3, Math.max(1, Math.floor(cpus().length / 3)));

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

/** One worker's copy of the workspace: everything `ng test` reads, with node_modules linked, not copied. */
function makeCopy(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of ['angular.json', 'package.json', 'tsconfig.json']) copyFileSync(join(MAIN, f), join(dir, f));
  cpSync(join(MAIN, 'projects/angular-dockable-desktop'), join(dir, 'projects/angular-dockable-desktop'), {
    recursive: true, filter: src => !/[/\\](node_modules|\.angular)([/\\]|$)/.test(src) && !src.endsWith('.nv-orig'),
  });
  // The workspace tsconfig references the other projects' configs, which the test build resolves.
  for (const project of readdirSync(join(MAIN, 'projects'))) {
    if (project === 'angular-dockable-desktop') continue;
    for (const f of readdirSync(join(MAIN, 'projects', project)).filter(n => /^tsconfig.*\.json$/.test(n))) {
      mkdirSync(join(dir, 'projects', project), { recursive: true });
      copyFileSync(join(MAIN, 'projects', project, f), join(dir, 'projects', project, f));
    }
  }
  // Some specs run the repository's own scripts (the stylesheet check runs build-css.mjs).
  cpSync(join(MAIN, 'scripts'), join(dir, 'scripts'), { recursive: true });
  symlinkSync(join(MAIN, 'node_modules'), join(dir, 'node_modules'), 'dir');
  mkdirSync(join(dir, 'artifacts'), { recursive: true });
}

/**
 * The control: the unstubbed suite, in a copy, must be entirely green. A spec that fails only
 * because a copy lacks something the real tree has would turn every module red and hide a module
 * nothing guards — so a copy that is not green stops the sweep instead.
 */
async function controlRun(dir) {
  const report = join(dir, 'artifacts/.nv-control.json');
  rmSync(report, { force: true });
  await suite(dir, report);
  if (!existsSync(report)) return `the unstubbed suite did not run in ${dir}`;
  const r = JSON.parse(readFileSync(report, 'utf8'));
  const names = r.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'failed')
    .map(a => `${a.fullName ?? a.title}: ${(a.failureMessages ?? []).join(' ').replace(/\s+/g, ' ').slice(0, 300)}`));
  return r.numFailedTests === 0 && r.numTotalTests > 0 ? null
    : `the unstubbed suite is not green in ${dir}: ${r.numFailedTests}/${r.numTotalTests} failed — ${names.slice(0, 3).join('; ')}`;
}

/**
 * Run the full suite in a copy and resolve with its exit — the report is what is read. (Not
 * vitest's `bail`: tried, and a bailed run can report the failure that stopped it as 0 failed.)
 */
const suite = (cwd, report) => new Promise(resolve => {
  const args = ['ng', 'test', 'angular-dockable-desktop', '--reporters=json', `--output-file=${report}`];
  const child = spawn('npx', args,
    { cwd, stdio: 'ignore', env: { ...process.env, CI: '1', NG_CLI_ANALYTICS: 'false' } });
  child.on('exit', resolve);
  child.on('error', () => resolve(-1));
});

/**
 * Stub one module in a worker's copy (`ROOT` here is that copy, never the real tree), run the
 * suite there, and say whether it went red. The copy's file is restored afterwards, so the copy can
 * take the next module.
 */
async function sweepOne(m, ROOT) {
  const file = join(ROOT, 'projects/angular-dockable-desktop', m.file);
  if (!existsSync(file)) return { file: m.file, ok: false, why: 'module missing' };
  const original = readFileSync(file, 'utf8');
  try {
    const { out, count } = stub(original);
    if (count === 0) return { file: m.file, ok: false, why: 'no exported functions to stub' };
    writeFileSync(file, out);
    const report = join(ROOT, 'artifacts/.nv.json');
    // Never reuse a previous module's report: a stale one would lend this module its red.
    rmSync(report, { force: true });
    // One retry when no report appears: that has been seen once as a transient (M5), and a
    // stub that genuinely breaks the build fails both runs, so the verdict cannot soften.
    for (let attempt = 0; attempt < 2 && !existsSync(report); attempt++) {
      rmSync(report, { force: true });
      await suite(ROOT, report);
    }
    if (!existsSync(report)) return { file: m.file, ok: false, why: `stubbed ${count} fn(s) but the suite did not run (build error proves nothing)` };
    const r = JSON.parse(readFileSync(report, 'utf8'));
    return { file: m.file, ok: r.numFailedTests > 0, failed: r.numFailedTests, total: r.numTotalTests, why: `stubbed ${count} fn(s) → ${r.numFailedTests}/${r.numTotalTests} tests failed` };
  } finally {
    writeFileSync(file, original);
  }
}

if (process.argv[1]?.endsWith('non-vacuity.mjs')) {
  const t0 = Date.now();
  const workers = Math.max(1, Math.min(modules.length, Number(arg('--workers') ?? process.env['NDD_NV_WORKERS'] ?? DEFAULT_WORKERS)));
  const base = join(MAIN, 'artifacts/nv');
  const copies = Array.from({ length: workers }, (_, k) => join(base, `w${k}`));
  copies.forEach(makeCopy);
  console.log(`  non-vacuity: ${modules.length} module(s) across ${workers} worker(s)`);

  const results = new Array(modules.length);
  let next = 0;
  try {
    const broken = (await Promise.all(copies.map(controlRun))).filter(Boolean);
    if (broken.length) {
      broken.forEach(b => console.error(`  ${b}`));
      console.log('non-vacuity: FAIL — a copy of the workspace is not green unstubbed, so no verdict would mean anything');
      rmSync(base, { recursive: true, force: true });
      process.exit(1);
    }
    await Promise.all(copies.map(async dir => {
      for (let i = next++; i < modules.length; i = next++) results[i] = await sweepOne(modules[i], dir);
    }));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }

  for (const r of results) console.log(`  ${r.ok ? 'red ' : 'GREEN'}  ${r.file}  ${r.why}`);
  if (process.env['NDD_NV_REPORT']) writeFileSync(process.env['NDD_NV_REPORT'], JSON.stringify(results, null, 2) + '\n');
  const vacuous = results.filter(r => !r.ok);
  console.log(`  (${Math.round((Date.now() - t0) / 1000)}s)`);
  console.log(vacuous.length ? `non-vacuity: FAIL — ${vacuous.length} module(s) not guarded by the suite` : `non-vacuity: ok — ${results.length} module(s), each turns the suite red`);
  process.exit(vacuous.length ? 1 : 0);
}
