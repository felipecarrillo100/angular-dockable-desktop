/**
 * M0 gate — does Angular preserve a panel's live state when the panel moves?
 *
 * Ported from vdd `spike/gate.mjs` and strengthened for the Angular-specific risks. Runs the
 * production build under four configurations — strategy {host, vcr} × scheduler {zoneless,
 * zone.js} — driving panel p1 through every placement plus two host REBUILDs (every host
 * element destroyed and re-created with the panel inside). After EVERY step it asserts:
 *   - the component never re-mounted or unmounted, and exactly one copy of its DOM exists
 *   - the DOM node is the same object
 *   - the WebGL context is not lost
 *   - video playback advanced and never restarted (visible steps)
 *   - scroll offset, focus and caret restored (visible steps, ADR 0014)
 * plus, per configuration:
 *   - a signal written from a timer keeps rendering while the panel is hidden (CD reaches it)
 *   - `setInput` on the ComponentRef renders while the panel is hidden
 *   - the element injector's token reached the panel
 *   - the scheduler really is the one requested
 *   - restoring an inactive panel does not steal focus
 * and characterises (does not assert) the <iframe> reload and a mid-flight CSS animation.
 *
 * Exit code 0 = gate passed. Usage: `npx ng build && node gate.mjs`.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = new URL('./dist/spike/browser/', import.meta.url).pathname;
const OUT = new URL('../artifacts/M0/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(ROOT, 'index.html'))) { console.error('build first: npx ng build'); process.exit(2); }

// ── a static server with Range support (video needs it) ────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end(); return; }
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? +range[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    createReadStream(file).pipe(res);
  }
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const PANEL = 'p1';
const STEPS = ['leafB', 'floating', 'hidden', 'leafA', 'REBUILD', 'leafB', 'floating', 'REBUILD', 'leafA'];
const CONFIGS = [
  { name: 'host/zoneless', q: 'strategy=host', zone: false },
  { name: 'host/zone', q: 'strategy=host&zone', zone: true },
  { name: 'vcr/zoneless', q: 'strategy=vcr', zone: false },
  { name: 'vcr/zone', q: 'strategy=vcr&zone', zone: true },
];

// Negative controls: each MUST fail, or the gate proves nothing (non-vacuity).
const CONTROLS = [
  { name: 'inline', q: 'strategy=inline', zone: false, expect: /re-mounted|unmounted|identity changed/ },
  { name: 'nopreserve', q: 'strategy=host&nopreserve', zone: false, expect: /scrollTop not restored|focus not restored/ },
];
const selftest = process.argv.includes('--selftest');
const results = { configs: {}, characterised: {}, failures: [], consoleNoise: [] };
const fail = (c, m) => results.failures.push(`[${c}] ${m}`);

const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });

const probe = (page, id) => page.evaluate(id => {
  const q = a => document.querySelector(`[data-${a}="${id}"]`);
  const panel = q('panel'), vid = q('video'), sc = q('scroller'), inp = q('input');
  const gl = window.__gl?.[id];
  return {
    copies: document.querySelectorAll(`[data-panel="${id}"]`).length,
    nodeIdMatches: window.__nodeRef ? window.__nodeRef === panel : null,
    mounts: window.__mounts?.[id] ?? 0,
    unmounts: window.__unmounts?.[id] ?? 0,
    glPresent: !!gl, glLost: gl ? gl.isContextLost() : null,
    videoTime: vid?.currentTime ?? null, videoPaused: vid?.paused ?? null,
    scrollTop: sc?.scrollTop ?? null,
    focusedId: document.activeElement?.getAttribute?.('data-input') ?? null,
    caret: inp?.selectionStart ?? null, inputValue: inp?.value ?? null,
    ticks: +(q('ticks')?.textContent ?? -1),
    label: q('label')?.textContent ?? null,
    token: q('token')?.textContent ?? null,
    anim: q('anim') ? getComputedStyle(q('anim')).transform : null,
    iframeLoadedAt: (() => { try { return q('iframe')?.contentWindow?.__loadedAt ?? null; } catch { return 'cross-origin'; } })(),
    connected: !!panel?.isConnected,
    zone: typeof window.Zone !== 'undefined',
  };
}, id);

for (const cfg of selftest ? CONTROLS : CONFIGS) {
  const c = cfg.name;
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/iframe\.html|Failed to load resource/.test(m.text())) { results.consoleNoise.push(`[${c}] ${m.text()}`); return; }
    fail(c, `console: ${m.text()}`);
  });
  page.on('pageerror', e => fail(c, `pageerror: ${e.message}`));

  await page.goto(`${BASE}?${cfg.q}`);
  await page.waitForSelector(`[data-panel="${PANEL}"]`);
  await page.waitForTimeout(700);

  await page.evaluate(id => {
    const q = a => document.querySelector(`[data-${a}="${id}"]`);
    window.__nodeRef = q('panel');
    q('scroller').scrollTop = 220;
    const inp = q('input'); inp.focus(); inp.setSelectionRange(4, 4);
    window.__spike.setActive(id);
  }, PANEL);
  await page.waitForTimeout(150);

  const start = await probe(page, PANEL);
  if (start.zone !== cfg.zone) fail(c, `scheduler: expected zone=${cfg.zone}, page has zone=${start.zone}`);
  if (start.scrollTop !== 220) fail(c, `setup: scrollTop did not take (${start.scrollTop})`);
  if (start.videoPaused) fail(c, 'setup: video not playing');
  if (start.token !== 'token-p1') fail(c, `element injector: token is ${start.token}`);
  if (start.mounts !== 1) fail(c, `setup: mounted ${start.mounts}x`);
  const steps = [{ step: 'start', ...start }];
  let prevTime = start.videoTime;

  for (const to of STEPS) {
    if (to === 'REBUILD') await page.evaluate(() => window.__spike.rebuild());
    else await page.evaluate(([id, t]) => window.__spike.move(id, t), [PANEL, to]);
    await page.waitForTimeout(250);
    const s = await probe(page, PANEL);
    steps.push({ step: to, ...s });

    if (s.mounts !== 1) fail(c, `${to}: component re-mounted (mounts=${s.mounts})`);
    if (s.unmounts !== 0) fail(c, `${to}: component unmounted ${s.unmounts}x`);
    if (s.copies !== 1) fail(c, `${to}: ${s.copies} copies of the panel DOM`);
    if (s.nodeIdMatches !== true) fail(c, `${to}: DOM node identity changed`);
    if (!s.connected) fail(c, `${to}: panel not in the document`);
    if (s.glPresent && s.glLost) fail(c, `${to}: WebGL context lost`);
    if (to !== 'hidden') {
      if (s.videoTime < prevTime) fail(c, `${to}: video restarted (${prevTime} -> ${s.videoTime})`);
      if (s.scrollTop !== 220) fail(c, `${to}: scrollTop not restored (${s.scrollTop})`);
      if (s.focusedId !== PANEL) fail(c, `${to}: focus not restored (${s.focusedId})`);
      if (s.caret !== 4) fail(c, `${to}: caret lost (${s.caret})`);
      if (s.inputValue !== 'hello world') fail(c, `${to}: input value lost`);
    }
    prevTime = Math.max(prevTime, s.videoTime ?? 0);
  }

  // Change detection must reach a panel that sits in the hidden store.
  await page.evaluate(id => window.__spike.move(id, 'hidden'), PANEL);
  await page.waitForTimeout(100);
  const before = await probe(page, PANEL);
  await page.evaluate(id => window.__spike.setLabel(id, 'set-while-hidden'), PANEL);
  await page.waitForTimeout(400);
  const hidden = await probe(page, PANEL);
  if (!(hidden.ticks > before.ticks)) fail(c, `hidden: timer signal did not render (${before.ticks} -> ${hidden.ticks})`);
  if (hidden.label !== 'set-while-hidden') fail(c, `hidden: setInput did not render (label=${hidden.label})`);
  await page.evaluate(id => window.__spike.move(id, 'leafA'), PANEL);
  await page.waitForTimeout(200);
  const back = await probe(page, PANEL);
  if (back.label !== 'set-while-hidden' || back.mounts !== 1) fail(c, 'after hidden setInput: state lost');

  // Restoring an inactive panel must not steal focus (ADR 0014).
  await page.evaluate(() => { window.__spike.setActive('p2'); document.querySelector('[data-input="p2"]').focus(); });
  await page.evaluate(() => window.__spike.move('p1', 'hidden'));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__spike.move('p1', 'leafA'));
  await page.waitForTimeout(250);
  const stolen = await page.evaluate(() => document.activeElement?.getAttribute?.('data-input'));
  if (stolen !== 'p2') fail(c, `restoring an inactive panel stole focus (active input: ${stolen})`);

  const end = steps.at(-1);
  results.configs[c] = {
    passed: !results.failures.some(f => f.startsWith(`[${c}]`)),
    mounts: end.mounts, unmounts: end.unmounts,
    videoAdvanced: +(end.videoTime - start.videoTime).toFixed(2),
    ticksWhileHidden: hidden.ticks - before.ticks,
    steps,
  };
  results.characterised[c] = {
    iframeReloaded: start.iframeLoadedAt !== end.iframeLoadedAt,
    animationStillRunning: steps.some(s => s.anim !== end.anim),
  };
  await page.screenshot({ path: join(OUT, `${c.replace('/', '-')}.png`) });
  await page.context().close();
}

await browser.close();
server.close();

if (selftest) {
  let ok = true;
  for (const c of CONTROLS) {
    const caught = results.failures.filter(f => f.startsWith(`[${c.name}]`) && c.expect.test(f));
    console.log(`  control ${c.name.padEnd(10)} ${caught.length ? `caught (${caught.length} failures, e.g. ${caught[0]})` : 'NOT CAUGHT'}`);
    if (!caught.length) ok = false;
  }
  writeFileSync(join(OUT, 'selftest.json'), JSON.stringify(results, null, 2));
  console.log(ok ? 'M0 SELFTEST: PASS (every control was rejected)' : 'M0 SELFTEST: FAIL');
  process.exit(ok ? 0 : 1);
}
results.passed = results.failures.length === 0;
writeFileSync(join(OUT, 'result.json'), JSON.stringify(results, null, 2));
console.log('M0 gate');
for (const [c, r] of Object.entries(results.configs)) {
  console.log(`  ${c.padEnd(14)} mounts=${r.mounts} unmounts=${r.unmounts} video+${r.videoAdvanced}s ` +
    `ticksWhileHidden=${r.ticksWhileHidden} -> ${r.passed ? 'PASS' : 'FAIL'}`);
}
console.log(`  characterised: ${JSON.stringify(results.characterised)}`);
if (!results.passed) { console.log('FAILURES:'); results.failures.forEach(f => console.log('   ' + f)); }
console.log(results.passed ? 'M0 GATE: PASS' : 'M0 GATE: FAIL');
process.exit(results.passed ? 0 : 1);
