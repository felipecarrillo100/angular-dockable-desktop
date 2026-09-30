/**
 * M18 browser gate — the field-report fixes (1.3.0), in real Chrome. The port of
 * react-dockable-desktop 7.4.0's `frost.browser.ts`, `motion.browser.ts` and `direction.browser.ts`,
 * by way of vue-dockable-desktop 1.5.0's M17 browser gate, which it follows check for check.
 *
 *   frost      a `position: fixed; right: 0; bottom: 0` child of every frosted container — the
 *              floating window, the drawer, the overlay widget, the frosted panel toolbar and the
 *              macOS docked panel — lands on the viewport's corner; and each container,
 *              screenshotted over stripes, matches the pre-1.3.0 rendering (the frost moved back
 *              onto the element) within a small tolerance
 *   motion     with prefers-reduced-motion: reduce emulated, no library element transitions or
 *              animates; without it, some do; the page's own transitions are untouched
 *   direction  setDirection('rtl'), with no dir on <html>, mirrors the sidebar rail and the toasts,
 *              and setDirection('ltr') restores them; a page-level dir="rtl" still reaches them
 *
 * The zoneless run covers every check; the zone.js run (the stylesheet does not depend on the
 * scheduler) covers the direction check, which runs through the components.
 */
import { runBrowserGate } from '../lib/browser.mjs';

await runBrowserGate('M18', { readyTimeout: 60000 }, async (page, { fail, open, sched }) => {
  page.setDefaultTimeout(30000);
  const report = {};
  const full = sched.name === 'zoneless';

  const openScene = async (query) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(query);
    await page.evaluate(() => {
      const { ws } = window.__pg;
      ws.openPanel('ov', 'overlay', { title: 'Overlay' });
      ws.openPanel('f1', 'hostile', { title: 'Float' });
      ws.floatPanel('f1', { x: 520, y: 260, width: 360, height: 240 });
    });
    await page.waitForTimeout(500);
  };

  // ── frost ───────────────────────────────────────────────────────────────────

  const FROSTED = [
    { name: 'floating window', query: 'chrome&anim=0', selector: '.ndd-floating-window' },
    { name: 'floating window, macos', query: 'chrome&anim=0&skin=macos', selector: '.ndd-floating-window' },
    { name: 'drawer', query: 'chrome&anim=0', selector: '.ndd-side-panel', drawer: true },
    { name: 'docked panel, macos', query: 'chrome&anim=0&skin=macos', selector: '.ndd-workspace-panel' },
    { name: 'overlay widget', query: 'chrome&anim=0', selector: '.ndd-panel-float' },
    { name: 'frosted panel toolbar', query: 'chrome&anim=0', selector: '.ndd-panel-toolbar[data-variant="frosted"]' },
    { name: 'frosted panel toolbar, light', query: 'chrome&anim=0&cs=light', selector: '.ndd-panel-toolbar[data-variant="frosted"]' },
  ];
  // Stripes behind the frost, and nothing that changes between the two screenshots: the playground's
  // hostile panels play a video, draw to a canvas and count ticks, which would differ however the frost is drawn.
  const STRIPES = '.ndd-workspace, .pg-hostile, pg-overlay-panel { background: repeating-linear-gradient(45deg, #e11 0 6px, #11e 6px 12px, #1b1 12px 18px) !important; }'
    + ' .pg-hostile canvas, .pg-hostile video, .pg-hostile > div:first-child { visibility: hidden !important; }'
    + ' *, *::before, *::after { animation-play-state: paused !important; caret-color: transparent !important; }';

  /** How far a fixed right:0/bottom:0 child of `selector` lands from the viewport's corner. */
  const probe = selector => page.evaluate((sel) => {
    const host = document.querySelector(sel);
    if (!host) return null
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;right:0;bottom:0;width:10px;height:10px';
    host.appendChild(p);
    const r = p.getBoundingClientRect();
    p.remove();
    return [Math.round(innerWidth - r.right), Math.round(innerHeight - r.bottom)];
  }, selector);

  /** Mean absolute channel difference and share of pixels off by more than 24, computed in Chrome. */
  const compare = (a, b) => page.evaluate(async ([x, y]) => {
    const load = src => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src });
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data }
    const [da, db] = [px(await load(x)), px(await load(y))];
    let sum = 0, off = 0
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      sum += d; if (d > 24) off++
    }
    return { mean: sum / (da.length / 4), off: off / (da.length / 4) }
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);

  async function frost() {
    for (const f of FROSTED) {
      await openScene(f.query);
      if (f.drawer) {
        await page.evaluate(() => { const { ws, components } = window.__pg; ws.overlays.openLeftPanel(components.hostile, {}, { title: 'Drawer' }) });
        await page.waitForTimeout(500);
      }
      if (!(await page.locator(f.selector).count())) { fail(`frost ${f.name}: ${f.selector} is not in the scene`); continue }
      const frosted = await page.evaluate(sel => {
        const el = document.querySelector(sel);
        return [getComputedStyle(el).backdropFilter, getComputedStyle(el, '::before').backdropFilter].some(v => v && v !== 'none');
      }, f.selector);
      if (!frosted) fail(`frost ${f.name}: the container is not frosted at all — the check proves nothing`);
      const at = await probe(f.selector);
      report[`frost ${f.name}`] = { at }
      if (!at || at[0] !== 0 || at[1] !== 0) fail(`frost ${f.name}: a fixed child lands ${JSON.stringify(at)} from the viewport's corner, not [0,0]`);

      // Pixels: now, then with the ::before's frost moved back onto the element (the pre-1.5.0 rule).
      await page.addStyleTag({ content: STRIPES });
      await page.mouse.move(1, 1);
      await page.waitForTimeout(300);
      const el = page.locator(f.selector).first();
      // The container's padding box. Where a container clips its overflow (ndd's floating window
      // and docked panel), its ::before cannot reach under the 1px border, so that band shows the
      // page through the translucent border untinted — the one known difference, left out here.
      const box = await el.boundingBox();
      const clip = { x: box.x + 1, y: box.y + 1, width: box.width - 2, height: box.height - 2 };
      const now = await page.screenshot({ clip });
      const moved = await page.evaluate((sel) => {
        const e = document.querySelector(sel);
        const before = getComputedStyle(e, '::before').backdropFilter
        if (!before || before === 'none') return false
        const s = document.createElement('style');
        s.textContent = `${sel}::before { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`;
        document.head.appendChild(s);
        e.style.setProperty('backdrop-filter', before, 'important');
        return true
      }, f.selector);
      await page.waitForTimeout(200);
      if (moved) {
        const d = await compare(now, await page.screenshot({ clip }));
        report[`frost ${f.name}`].pixels = d
        if (d.mean >= 1.5 || d.off >= 0.01) fail(`frost ${f.name}: the rendering changed (mean ${d.mean.toFixed(2)}, ${(d.off * 100).toFixed(2)}% of pixels off by > 24)`);
      }
    }
  }

  // ── motion ──────────────────────────────────────────────────────────────────

  const moving = () => page.evaluate(() => {
    const out = [];
    const dur = v => v.split(',').some(t => parseFloat(t) > 0);
    for (const el of document.querySelectorAll('[class*="ndd-"]')) {
      for (const pseudo of ['', '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo || null);
        if (dur(cs.transitionDuration) || (cs.animationName !== 'none' && dur(cs.animationDuration))) out.push(`${el.className}${pseudo}`);
      }
    }
    return out
  });

  async function motion() {
    await openScene('chrome');
    const before = await moving();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const after = await moving();
    const own = await page.evaluate(() => {
      const d = document.createElement('div'); d.style.transition = 'opacity 0.3s'; document.body.appendChild(d);
      const v = getComputedStyle(d).transitionDuration; d.remove(); return v
    });
    report.motion = { before: before.length, after: after.length, own }
    if (before.length <= 5) fail(`motion: only ${before.length} library elements animate — the check proves nothing`);
    if (after.length) fail(`motion: ${after.length} library element(s) still move under reduced motion, e.g. ${after.slice(0, 3).join(' | ')}`);
    if (own !== '0.3s') fail(`motion: the page's own transition became ${own}`);
  }

  // ── direction ───────────────────────────────────────────────────────────────

  const readDir = () => page.evaluate(() => {
    const layout = document.querySelector('.ndd-sidebar-layout');
    const strip = document.querySelector('.ndd-sidebar-tabs-strip')?.getBoundingClientRect();
    const box = layout?.getBoundingClientRect();
    const toasts = document.querySelector('.ndd-toast-container');
    return {
      sidebar: layout ? getComputedStyle(layout).direction : 'missing',
      railOnRight: strip && box ? strip.left + strip.width / 2 > box.left + box.width / 2 : null,
      toasts: toasts ? getComputedStyle(toasts).direction : 'missing',
    }
  });

  async function direction() {
    await openScene('chrome&anim=0');
    await page.evaluate(() => window.__pg.toast('hello', { duration: 600000 }));
    await page.waitForTimeout(300);
    const ltr = await readDir();
    await page.evaluate(() => window.__pg.ws.setDirection('rtl'));
    await page.waitForTimeout(300);
    const rtl = await readDir();
    await page.evaluate(() => window.__pg.ws.setDirection('ltr'));
    await page.waitForTimeout(300);
    const back = await readDir();
    const htmlDir = await page.evaluate(() => document.documentElement.dir);
    report.direction = { ltr, rtl, back, htmlDir }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (htmlDir !== '') fail(`direction: the page set dir="${htmlDir}" on <html>; the check needs none`);
    if (!same(ltr, { sidebar: 'ltr', railOnRight: false, toasts: 'ltr' })) fail(`direction: LTR start state is ${JSON.stringify(ltr)}`);
    if (!same(rtl, { sidebar: 'rtl', railOnRight: true, toasts: 'rtl' })) fail(`direction: after setDirection('rtl') ${JSON.stringify(rtl)}`);
    if (!same(back, ltr)) fail(`direction: after setDirection('ltr') ${JSON.stringify(back)}`);

    // A page-level dir="rtl" still reaches them while the workspace is LTR.
    await openScene('chrome&anim=0');
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; window.__pg.toast('hello', { duration: 600000 }) });
    await page.waitForTimeout(300);
    const page_ = await readDir();
    report.direction.pageRtl = page_
    if (page_.sidebar !== 'rtl' || page_.toasts !== 'rtl') fail(`direction: with <html dir="rtl"> and an LTR workspace, ${JSON.stringify(page_)}`);
  }

  if (full) {
    await frost();
    await motion();
  }
  await direction();
  return report;
});
