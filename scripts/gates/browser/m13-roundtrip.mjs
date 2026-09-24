/**
 * M13 round-trip gate — layouts move between vdd and ndd, both ways, byte-identically.
 *
 * The saved format is shared across the family (ADR 0008). Every layout in the corpus — the ten
 * rdd 6.2.0 fixtures, plus every layout M6's differential gate produced from real gestures in
 * both libraries — is loaded into vdd's playground and into ndd's, and re-saved:
 *
 *   same input   vdd.save(x) and ndd.save(x) are the same string
 *   vdd → ndd    ndd re-saves vdd's output unchanged
 *   ndd → vdd    vdd re-saves ndd's output unchanged
 *   stable       a second ndd round trip changes nothing
 *
 * `--control`: corrupt ndd's output (a reordered key) before comparing — the byte check must fail.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, ROOT } from '../lib/config.mjs';
import { serve } from '../lib/serve.mjs';

const control = process.argv.includes('--control');
const OUT = join(ROOT, control ? 'artifacts/M13-roundtrip-control' : 'artifacts/M13-roundtrip');
mkdirSync(OUT, { recursive: true });
const VDD_BUILD = join(ROOT, 'artifacts/vdd-playground');
if (!existsSync(join(VDD_BUILD, 'index.html'))) { console.error('m13-roundtrip: vdd playground not built (the M6 rules build it)'); process.exit(2); }

// ── the corpus ──
const corpus = [];
const FIXTURES = join(LIB, 'test/fixtures/rdd-6.2.0');
for (const f of readdirSync(FIXTURES).filter(f => f.endsWith('.json')).sort()) corpus.push({ name: `rdd:${f}`, json: readFileSync(join(FIXTURES, f), 'utf8') });
const diff = join(ROOT, 'artifacts/M6-diff/diff.json');
if (existsSync(diff)) {
  for (const row of JSON.parse(readFileSync(diff, 'utf8')).rows ?? []) {
    for (const side of ['ndd', 'vdd']) if (row[side]) corpus.push({ name: `m6:${row.case}:${row.dir}:${side}`, json: row[side] });
  }
}

const servers = { ndd: await serve(join(ROOT, 'dist/playground/browser')), vdd: await serve(VDD_BUILD) };
const browser = await chromium.launch({ channel: 'chrome' });
const failures = [];

async function openApp(name, wsExpr) {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  page.on('pageerror', e => failures.push(`[${name}] page error: ${e.message}`));
  await page.goto(servers[name].url);
  await page.waitForFunction(ws => !!(0, eval)(ws), wsExpr, { timeout: 15000 });
  return json => page.evaluate(([ws, j]) => { const w = (0, eval)(ws); w.loadLayout(j); return w.saveLayout(); }, [wsExpr, json]);
}

const viaVdd = await openApp('vdd', 'window.__vdd');
const viaNdd = await openApp('ndd', 'window.__pg.ws');
const rows = [];
for (const { name, json } of corpus) {
  const v = await viaVdd(json);
  let n = await viaNdd(json);
  if (control) n = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(n)).reverse()));
  const vToN = await viaNdd(v);
  const nToV = await viaVdd(n);
  const again = await viaNdd(n);
  const row = { name, same: v === n, vddToNdd: vToN === v, nddToVdd: nToV === n, stable: again === n };
  rows.push(row);
  for (const [k, ok] of Object.entries(row)) if (k !== 'name' && !ok) failures.push(`${name}: ${k} failed`);
}
await browser.close();
for (const s of Object.values(servers)) s.close?.();

const passed = failures.length === 0 && corpus.length >= 10;
if (corpus.length < 10) failures.push(`the corpus has only ${corpus.length} layouts`);
writeFileSync(join(OUT, 'roundtrip.json'), JSON.stringify({ passed, failures, rows }, null, 2) + '\n');
console.log(`m13-roundtrip: ${corpus.length} layouts${control ? ' (control)' : ''}`);
if (!passed) { failures.slice(0, 20).forEach(f => console.log('  ' + f)); console.log('m13-roundtrip: FAIL'); process.exit(1); }
console.log('m13-roundtrip: ok — identical saves, both directions, stable');
