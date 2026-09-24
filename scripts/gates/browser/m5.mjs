/**
 * M5 browser gate — floating windows, with real pointer events, both schedulers.
 *
 *   drag      the title bar moves the window by exactly the pointer delta, and unpins it
 *   D5        each of the 8 resize handles is hit at the window's outer edge (elementFromPoint),
 *             and dragging it moves exactly that edge (or corner) by the pointer delta while
 *             the opposite edges stay put
 *   D9        a maximised window really is squared off: computed border-radius 0, no shadow
 *   focus     the active window has focused chrome, the other does not
 *   survival  the hostile panel inside is created once and keeps its WebGL context throughout
 */
import { runBrowserGate } from '../lib/browser.mjs';

const rect = (page, sel) => page.evaluate(sel => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
}, sel);

// `--control rdd-handles`: inject rdd 6.2.0's handle geometry (-4px insets, clipped by the
// window's overflow). The gate must reject it, or D5 is not being measured.
const control = process.argv.includes('--control');

await runBrowserGate(control ? 'M5-control' : 'M5', {}, async (page, { fail, open, shot }) => {
  await open();
  if (control) {
    await page.addStyleTag({ content: `
      .ndd-resize-n { top: -4px !important; } .ndd-resize-s { bottom: -4px !important; }
      .ndd-resize-e { right: -4px !important; } .ndd-resize-w { left: -4px !important; }
      .ndd-resize-ne { top: -4px !important; right: -4px !important; } .ndd-resize-nw { top: -4px !important; left: -4px !important; }
      .ndd-resize-se { bottom: -4px !important; right: -4px !important; } .ndd-resize-sw { bottom: -4px !important; left: -4px !important; }` });
  }
  await page.evaluate(() => {
    const ws = window.__pg.ws;
    ws.openPanel('w1', 'hostile', { initialTarget: 'floating' });
    ws.updateFloatingPosition('w1', { x: 300, y: 200, width: 420, height: 300, anchor: null });
    ws.openPanel('w2', 'hostile', { initialTarget: 'floating' });
    ws.updateFloatingPosition('w2', { x: 800, y: 420, width: 300, height: 240, anchor: null });
    ws.focusPanel('w1');
  });
  await page.waitForSelector('[data-ndd-window="w1"] [data-panel="w1"]');
  await page.waitForTimeout(300);
  const W = '[data-ndd-window="w1"]';

  // ── focus chrome (D2 on windows) ──
  const focus = await page.evaluate(() => ({
    w1: document.querySelector('[data-ndd-window="w1"]').classList.contains('ndd-window-focused'),
    w2: document.querySelector('[data-ndd-window="w2"]').classList.contains('ndd-window-focused'),
  }));
  if (!focus.w1 || focus.w2) fail(`focus chrome: expected only w1 focused, got ${JSON.stringify(focus)}`);

  // ── title-bar drag ──
  const before = await rect(page, W);
  const bar = await rect(page, `[data-ndd-titlebar="w1"]`);
  const gx = bar.x + 40, gy = bar.y + bar.h / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 50, gy + 30, { steps: 5 });
  await page.mouse.move(gx + 100, gy + 60, { steps: 5 });
  await page.mouse.up();
  const moved = await rect(page, W);
  if (Math.round(moved.x - before.x) !== 100 || Math.round(moved.y - before.y) !== 60)
    fail(`drag: window moved by (${moved.x - before.x}, ${moved.y - before.y}), expected (100, 60)`);
  if (Math.round(moved.w) !== Math.round(before.w)) fail('drag: the window changed size');

  // ── D5: every handle, at the window's outer edge ──
  const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };
  for (const [dir, [sx, sy]] of Object.entries(DIRS)) {
    await page.evaluate(() => window.__pg.ws.updateFloatingPosition('w1', { x: 300, y: 200, width: 420, height: 300 }));
    await page.waitForTimeout(60);
    const win = await rect(page, W);
    // The first pixel inside the window's 1px border, on the side(s) this handle serves: that is
    // x+1 / y+1 on the start sides, but r-2 / b-2 on the end sides (r-1 *is* the border). D5's
    // contract is that the handle's whole nominal area, inside the box, is grabbable.
    // A corner's extreme pixel lies outside the window's rounded corner — not part of the window
    // at all — so a corner handle is probed 4px in on both axes: inside the handle and the shape.
    const corner = sx !== 0 && sy !== 0;
    const inset = corner ? 4 : 0;
    const px = sx > 0 ? win.r - 2 - inset : sx < 0 ? win.x + 1 + inset : win.x + win.w / 2 + 30;
    const py = sy > 0 ? win.b - 2 - inset : sy < 0 ? win.y + 1 + inset : win.y + win.h / 2;
    // D5 proper: the handle's whole nominal box is inside the window (rdd placed handles at -4px,
    // so half of each was outside and clipped away), and every sampled point of it that lies
    // within the window's rounded shape hits the handle.
    const coverage = await page.evaluate(([dir]) => {
      const win = document.querySelector('[data-ndd-window="w1"]');
      const h = win.querySelector(`.ndd-resize-${dir}`);
      const w = win.getBoundingClientRect(), r = h.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(win).borderTopLeftRadius) || 0;
      const inShape = (x, y) => {
        const cx = Math.min(Math.max(x, w.left + radius), w.right - radius);
        const cy = Math.min(Math.max(y, w.top + radius), w.bottom - radius);
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 + 0.01;
      };
      const contained = r.left >= w.left - 0.5 && r.top >= w.top - 0.5 && r.right <= w.right + 0.5 && r.bottom <= w.bottom + 0.5;
      const pts = [[r.left + 1, r.top + 1], [r.right - 1, r.top + 1], [r.left + 1, r.bottom - 1], [r.right - 1, r.bottom - 1], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
      const misses = pts.filter(([x, y]) => inShape(x, y) && document.elementFromPoint(x, y) !== h).map(p => p.map(Math.round).join(','));
      return { contained, misses, box: [r.left, r.top, r.width, r.height].map(Math.round) };
    }, [dir]);
    if (!coverage.contained) fail(`D5 ${dir}: handle box ${coverage.box} extends outside the window, so part of it is clipped away`);
    if (coverage.misses.length) fail(`D5 ${dir}: points of the handle not hittable: ${coverage.misses.join(' ')}`);
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-ndd-handle'), [px, py]);
    if (hit !== `w1:${dir}`) { fail(`D5 ${dir}: the outer edge at (${px}, ${py}) hits "${hit}", not the handle`); continue; }
    const dx = 24 * sx, dy = 18 * sy;
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px + dx / 2, py + dy / 2, { steps: 3 });
    await page.mouse.move(px + dx, py + dy, { steps: 3 });
    await page.mouse.up();
    const after = await rect(page, W);
    const exp = {
      x: win.x + (sx < 0 ? dx : 0), y: win.y + (sy < 0 ? dy : 0),
      r: win.r + (sx > 0 ? dx : 0), b: win.b + (sy > 0 ? dy : 0),
    };
    for (const k of ['x', 'y', 'r', 'b']) {
      if (Math.abs(after[k] - exp[k]) > 1) fail(`D5 ${dir}: edge ${k} is ${after[k]}, expected ${exp[k]} (moved edges by the pointer delta, others fixed)`);
    }
  }

  // ── D9: maximised is squared off ──
  await page.evaluate(() => window.__pg.ws.maximizePanel('w1'));
  await page.waitForTimeout(250);
  const max = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    const cs = getComputedStyle(el);
    const vp = document.querySelector('.ndd-workspace-viewport').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { cls: el.classList.contains('ndd-maximized'), radius: cs.borderTopLeftRadius, shadow: cs.boxShadow,
      fills: Math.abs(r.width - vp.width) < 2 && Math.abs(r.height - vp.height) < 2,
      handles: el.querySelectorAll('[data-ndd-handle]').length };
  }, W);
  if (!max.cls) fail('D9: maximised window lacks ndd-maximized');
  if (max.radius !== '0px') fail(`D9: maximised window keeps border-radius ${max.radius}`);
  if (max.shadow !== 'none') fail(`D9: maximised window keeps box-shadow ${max.shadow}`);
  if (!max.fills) fail('D9: maximised window does not fill the workspace');
  if (max.handles !== 0) fail(`D9: ${max.handles} resize handles while maximised`);
  await shot('maximized');
  await page.evaluate(() => window.__pg.ws.maximizePanel('w1'));

  // ── survival ──
  const alive = await page.evaluate(() => ({
    mounts: window.__mounts?.w1, unmounts: window.__unmounts?.w1 ?? 0,
    gl: window.__gl?.w1?.isContextLost?.(),
  }));
  if (alive.mounts !== 1 || alive.unmounts !== 0) fail(`survival: w1 created ${alive.mounts}x, destroyed ${alive.unmounts}x`);
  if (alive.gl !== false) fail('survival: WebGL context lost');
  return { focus, max, alive };
});
