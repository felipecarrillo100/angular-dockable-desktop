/**
 * M6 differential gate — the reference implementation is the oracle.
 *
 * The same scripted gestures (lib/dock-gestures.mjs) are driven against vdd's playground and
 * ndd's, in the same viewport, and the two libraries' `saveLayout()` output must be **equal**
 * after one normalisation: generated leaf ids (`group-split-<time>-<rand>`) are renamed by order
 * of appearance. Because the format is shared (ADR 0008), this turns "behaves like vdd" from a
 * claim into a diff, and tests the implementations against each other rather than each against
 * itself.
 *
 * vdd's playground is built from the (read-only) vue-dockable-desktop checkout into
 * artifacts/vdd-playground by the M6 rules before this runs.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ROOT } from '../lib/config.mjs';
import { serve } from '../lib/serve.mjs';
import { CASES, NDD, VDD, dragTabTo, normalizeLayout, reorder, saveLayout } from '../lib/dock-gestures.mjs';

const OUT = join(ROOT, process.argv.includes('--control') ? 'artifacts/M6-diff-control' : 'artifacts/M6-diff');
mkdirSync(OUT, { recursive: true });
const VDD_BUILD = join(ROOT, 'artifacts/vdd-playground');
if (!existsSync(join(VDD_BUILD, 'index.html'))) { console.error('m6-diff: vdd playground not built'); process.exit(2); }

// `--control`: plant a direction-mirroring bug on the ndd side. The diff must then fail.
const control = process.argv.includes('--control');
const ndd = control ? { ...NDD, flipDir: true } : NDD;

const servers = { ndd: await serve(join(ROOT, 'dist/playground/browser')), vdd: await serve(VDD_BUILD) };
const browser = await chromium.launch({ channel: 'chrome' });
const failures = [];
const rows = [];

async function openApp(a) {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  page.on('pageerror', e => failures.push(`[${a.name}] page error: ${e.message}`));
  await page.goto(servers[a.name].url);
  await page.waitForFunction(ws => !!(0, eval)(ws), a.ws, { timeout: 15000 });
  return page;
}

const diff = (a, b, path = '') => {
  if (isDeepStrictEqual(a, b)) return [];
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return [`${path || '<root>'}: vdd=${JSON.stringify(a)} ndd=${JSON.stringify(b)}`];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap(k => diff(a[k], b[k], `${path}.${k}`));
};

try {
  const pages = { vdd: await openApp(VDD), ndd: await openApp(ndd) };
  for (const dir of ['ltr', 'rtl']) {
    for (const c of [...CASES, { name: 'reorder' }]) {
      const out = {};
      const raw = {};
      for (const a of [VDD, ndd]) {
        const page = pages[a.name];
        const r = c.name === 'reorder' ? await reorder(page, a, dir) : await dragTabTo(page, a, dir, c.target, { to: c.to });
        if (r.error) failures.push(`[${a.name}] ${dir} ${c.name}: ${r.error}`);
        raw[a.name] = await saveLayout(page, a);
        out[a.name] = normalizeLayout(raw[a.name]);
      }
      const d = diff(out.vdd, out.ndd);
      // The raw saves are kept too: M13's round-trip gate loads each into the *other* library.
      rows.push({ dir, case: c.name, equal: d.length === 0, differences: d, ndd: raw.ndd, vdd: raw.vdd });
      if (d.length) failures.push(`${dir} ${c.name}: saveLayout() differs from vdd's — ${d.slice(0, 4).join('; ')}`);
    }
  }
} finally {
  await browser.close();
  await servers.ndd.close();
  await servers.vdd.close();
}

writeFileSync(join(OUT, 'diff.json'), JSON.stringify({ passed: failures.length === 0, failures, rows }, null, 2));
for (const r of rows) console.log(`  ${r.equal ? 'equal' : 'DIFF '}  ${r.dir} ${r.case}`);
if (failures.length) { console.error('M6 differential: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log(`M6 differential: ok — ${rows.length} gesture sequences produce identical layouts in vdd and ndd`);
