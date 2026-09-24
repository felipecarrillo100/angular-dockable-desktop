/**
 * M7 browser gate — minimise, the taskbar, and the live preview, both schedulers.
 *
 *   live     hovering a taskbar icon (real mouse) shows a preview that contains THE SAME DOM
 *            node as the running panel: its video keeps advancing inside the preview, its WebGL
 *            context is alive, and the thumbnail is really scaled on screen
 *   D11      the thumbnail accepts the click and restores the panel, while the live panel inside
 *            stays inert (the hit-tested element under the thumbnail is not the panel's content)
 *   D3       openPanel on a minimised panel returns it to its own group, as restorePanel does
 *   D4       ...and publishes panel:restored and layout:changed
 *   survival the panel is created once through all of it
 */
import { runBrowserGate } from '../lib/browser.mjs';

// `--control`: model rdd 6.2.0's D11 defect — the preview dead to the pointer except its small
// header row, so a click over the thumbnail passes through the preview entirely. (A rule on the
// frame alone does not reproduce it here: the click would fall through to the preview's own
// container, which restores.) The gate must reject it, or D11 is not being measured.
const control = process.argv.includes('--control');

await runBrowserGate(control ? 'M7-control' : 'M7', {}, async (page, { fail, open, shot }) => {
  await open('layout=two-leaf');
  if (control) await page.addStyleTag({ content: '.ndd-taskbar-item-tooltip { pointer-events: none !important; } .ndd-tooltip-header-row { pointer-events: auto !important; }' });
  await page.evaluate(() => {
    const ws = window.__pg.ws;
    ws.openPanel('keep', 'hostile');
    ws.openPanel('m1', 'hostile');
    ws.dockPanelToGroup('m1', 'R', 'center');
  });
  await page.waitForSelector('[data-panel="m1"]');
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__nodeRef = document.querySelector('[data-panel="m1"]'); });

  // ── minimise into the taskbar ──
  await page.evaluate(() => window.__pg.ws.minimizePanel('m1'));
  await page.waitForTimeout(250);
  const icon = await page.locator('[data-ndd-taskbar-item="m1"]').boundingBox();
  if (!icon) { fail('no taskbar icon for the minimised panel'); return {}; }

  // ── hover with a real mouse: the preview appears and holds the live panel ──
  await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2, { steps: 4 });
  await page.waitForSelector('[data-ndd-preview]', { timeout: 3000 }).catch(() => fail('hovering the icon showed no preview'));
  const t0 = await page.evaluate(() => document.querySelector('[data-video="m1"]').currentTime);
  await page.waitForTimeout(700);
  const live = await page.evaluate(() => {
    const preview = document.querySelector('[data-ndd-preview]');
    const panel = document.querySelector('[data-panel="m1"]');
    const host = document.querySelector('.ndd-taskbar-item-preview-host');
    const r = host?.getBoundingClientRect();
    return {
      same: panel === window.__nodeRef,
      inside: !!preview && preview.contains(panel),
      copies: document.querySelectorAll('[data-panel="m1"]').length,
      video: document.querySelector('[data-video="m1"]').currentTime,
      paused: document.querySelector('[data-video="m1"]').paused,
      gl: window.__gl?.m1?.isContextLost?.(),
      scaledWidth: r?.width ?? 0,
      layoutWidth: host?.offsetWidth ?? 0,
    };
  });
  if (!live.same) fail('preview: the panel DOM node was replaced');
  if (!live.inside) fail('preview: the live panel is not inside the preview');
  if (live.copies !== 1) fail(`preview: ${live.copies} copies of the panel`);
  if (!(live.video > t0) || live.paused) fail(`preview: the video is not playing inside the preview (${t0} -> ${live.video})`);
  if (live.gl !== false) fail('preview: WebGL context lost');
  if (!(live.scaledWidth > 0 && live.scaledWidth < live.layoutWidth)) fail(`preview: thumbnail is not scaled (${live.scaledWidth} on screen vs ${live.layoutWidth} laid out)`);
  await shot('preview');

  // ── D11: the thumbnail restores; its contents are inert ──
  const thumb = await page.locator('.ndd-taskbar-item-preview-frame').boundingBox();
  const cx = thumb.x + thumb.width / 2, cy = thumb.y + thumb.height / 2;
  const underPointer = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return { inPreview: !!el?.closest('[data-ndd-preview]'), inPanel: !!el?.closest('[data-panel]') };
  }, [cx, cy]);
  if (!underPointer.inPreview) fail('D11: the thumbnail is not hit-testable — a click would fall through the preview');
  if (underPointer.inPanel) fail('D11: the live panel inside the preview is interactive (it must be inert)');
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);
  const restored = await page.evaluate(() => ({
    state: window.__pg.ws.state().panels.m1?.state,
    preview: !!document.querySelector('[data-ndd-preview]'),
    slot: document.querySelector('[data-ndd-panel="m1"]')?.parentElement?.getAttribute('data-ndd-slot'),
  }));
  if (restored.state !== 'docked') fail(`D11: clicking the thumbnail did not restore the panel (state ${restored.state})`);
  if (restored.preview) fail('D11: the preview stayed open after restoring');
  if (restored.slot !== 'm1') fail(`restore: the panel is not in its slot (${restored.slot})`);

  // ── D3 + D4: openPanel on a minimised panel ──
  const d = await page.evaluate(() => {
    const ws = window.__pg.ws;
    const leafOf = id => {
      const walk = n => (n.type === 'leaf' ? (n.panels.includes(id) ? n.id : null) : n.children.reduce((a, c) => a ?? walk(c), null));
      return walk(ws.gridRoot());
    };
    const events = [];
    const offs = ['panel:restored', 'layout:changed'].map(e => ws.subscribe(e, () => events.push(e)));
    ws.minimizePanel('m1');
    events.length = 0;
    ws.openPanel('m1', 'hostile');
    offs.forEach(o => o());
    return { leaf: leafOf('m1'), events };
  });
  if (d.leaf !== 'R') fail(`D3: openPanel returned the panel to ${d.leaf}, not its own group R`);
  if (!d.events.includes('panel:restored') || !d.events.includes('layout:changed')) fail(`D4: openPanel on a minimised panel published ${JSON.stringify(d.events)}`);

  const alive = await page.evaluate(() => ({ mounts: window.__mounts?.m1, unmounts: window.__unmounts?.m1 ?? 0 }));
  if (alive.mounts !== 1 || alive.unmounts !== 0) fail(`survival: created ${alive.mounts}x, destroyed ${alive.unmounts}x`);
  return { live, restored, d };
});
