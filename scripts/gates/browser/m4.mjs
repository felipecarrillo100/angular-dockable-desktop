/**
 * M4 browser gate — zero unmount through the real library, in real Chrome, both schedulers.
 *
 * The playground hosts the M0 test panel (WebGL, playing video, scrolled list, focused input,
 * a clicked counter, a timer) inside `<ndd-desktop>`. Panel h1 is driven through
 *   tab switch away and back → split into the other group → a REAL pointer drag on the split
 *   divider → re-dock into the first group → minimise → restore
 * and after every step the gate asserts: created once, never destroyed, exactly one copy of its
 * DOM, the same node, WebGL alive, video advancing, and (while visible) scroll offset, focus,
 * caret and component state intact.
 */
import { runBrowserGate } from '../lib/browser.mjs';

const probe = (page, id) => page.evaluate(id => {
  const q = a => document.querySelector(`[data-${a}="${id}"]`);
  const panel = q('panel'), sc = q('scroller'), inp = q('input'), vid = q('video');
  const gl = window.__gl?.[id];
  const mount = document.querySelector(`[data-ndd-panel="${id}"]`);
  return {
    copies: document.querySelectorAll(`[data-panel="${id}"]`).length,
    same: window.__nodeRef?.[id] ? window.__nodeRef[id] === panel : null,
    mounts: window.__mounts?.[id] ?? 0,
    unmounts: window.__unmounts?.[id] ?? 0,
    glLost: gl ? gl.isContextLost() : 'no-gl',
    video: vid?.currentTime ?? null,
    scrollTop: sc?.scrollTop ?? null,
    focused: document.activeElement?.getAttribute?.('data-input') ?? null,
    caret: inp?.selectionStart ?? null,
    count: q('count')?.textContent ?? null,
    host: mount?.parentElement?.getAttribute('data-ndd-slot') ?? mount?.parentElement?.className ?? null,
    visible: !!panel && panel.getClientRects().length > 0,
  };
}, id);

await runBrowserGate('M4', {}, async (page, { fail, open, shot }) => {
  await open('layout=two-leaf');
  await page.evaluate(() => {
    const ws = window.__pg.ws;
    ws.openPanel('h1', 'hostile');
    ws.openPanel('h2', 'hostile');
    ws.dockPanelToGroup('h2', 'R', 'center');
    ws.focusPanel('h1');
  });
  await page.waitForSelector('[data-panel="h1"]');
  await page.waitForTimeout(600); // let the video start

  // State that must survive: a scroll offset, a focused input with a caret, three clicks.
  await page.evaluate(() => {
    const q = a => document.querySelector(`[data-${a}="h1"]`);
    window.__nodeRef = { h1: q('panel') };
    q('scroller').scrollTop = 220;
    const inp = q('input');
    inp.focus();
    inp.setSelectionRange(4, 4);
  });
  // force: the running tick counter shifts the button every 50 ms, so it is never "stable".
  for (let i = 0; i < 3; i++) await page.click('[data-inc="h1"]', { force: true });
  await page.evaluate(() => {
    const inp = document.querySelector('[data-input="h1"]');
    inp.focus();
    inp.setSelectionRange(4, 4);
  });
  await page.waitForTimeout(100);

  const start = await probe(page, 'h1');
  if (start.count !== '3') fail(`setup: counter did not take (${start.count})`);
  if (start.scrollTop !== 220) fail(`setup: scrollTop did not take (${start.scrollTop})`);
  if (start.glLost !== false) fail(`setup: no live WebGL context (${start.glLost})`);
  if (start.focused !== 'h1') fail(`setup: input not focused (${start.focused})`);
  let prevVideo = start.video;
  const steps = [{ step: 'start', ...start }];

  const check = async (step, { visible = true } = {}) => {
    await page.waitForTimeout(250);
    const s = await probe(page, 'h1');
    steps.push({ step, ...s });
    if (s.mounts !== 1) fail(`${step}: created ${s.mounts}x`);
    if (s.unmounts !== 0) fail(`${step}: destroyed ${s.unmounts}x`);
    if (s.copies !== 1) fail(`${step}: ${s.copies} copies of the panel DOM`);
    if (s.same !== true) fail(`${step}: DOM node identity changed`);
    if (s.glLost !== false) fail(`${step}: WebGL context lost`);
    if (s.count !== '3') fail(`${step}: component state lost (count=${s.count})`);
    if (visible) {
      if (!s.visible) fail(`${step}: panel not visible (host ${s.host})`);
      if (s.video < prevVideo) fail(`${step}: video restarted (${prevVideo} -> ${s.video})`);
      if (s.scrollTop !== 220) fail(`${step}: scrollTop not restored (${s.scrollTop})`);
      if (s.focused !== 'h1') fail(`${step}: focus not restored (${s.focused})`);
      if (s.caret !== 4) fail(`${step}: caret lost (${s.caret})`);
    }
    prevVideo = Math.max(prevVideo, s.video ?? 0);
    return s;
  };

  // 1. Tab switch: h2 into h1's group, select it, then select h1 again.
  await page.evaluate(() => {
    const ws = window.__pg.ws;
    ws.dockPanelToGroup('h2', 'L', 'center');
    ws.focusPanel('h2');
  });
  const away = await check('tab away', { visible: false });
  if (away.host === 'h1') fail('tab away: h1 still has a slot while a sibling is selected');
  await page.click('[data-ndd-tab="h1"]', { force: true });
  await check('tab back');

  // 2. Split: h1 into the bottom half of the other group.
  await page.evaluate(() => window.__pg.ws.dockPanelToGroup('h1', 'R', 'bottom'));
  await check('split');

  // 3. Split resize with real pointer events on a divider.
  const before = await page.evaluate(() => JSON.stringify(window.__pg.ws.gridRoot()));
  const divider = await page.$('[data-ndd-divider="0"]');
  if (!divider) fail('split resize: no top-level divider');
  else {
    const box = await divider.boundingBox();
    // A quarter of the way down, not the middle: after the split, the nested divider crosses this
    // one at exactly half height, and at a junction the nested divider's hit area wins.
    const x = box.x + box.width / 2, y = box.y + box.height / 4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y, { steps: 6 });
    await page.mouse.move(x - 120, y, { steps: 6 });
    await page.mouse.up();
    const after = await page.evaluate(() => JSON.stringify(window.__pg.ws.gridRoot()));
    if (after === before) fail('split resize: dragging the divider did not change the split sizes');
    const sizes = await page.evaluate(() => window.__pg.ws.gridRoot().sizes);
    if (!(sizes?.[0] < 0.5)) fail(`split resize: expected the left group to shrink, sizes=${JSON.stringify(sizes)}`);
    await page.evaluate(() => {
      const inp = document.querySelector('[data-input="h1"]');
      inp.focus();
      inp.setSelectionRange(4, 4);
    });
    await check('split resize');
  }

  // 4. Re-dock into the first group.
  await page.evaluate(() => window.__pg.ws.dockPanelToGroup('h1', 'L', 'center'));
  await check('re-dock');

  // 5. Minimise and restore.
  await page.evaluate(() => window.__pg.ws.minimizePanel('h1'));
  const min = await check('minimise', { visible: false });
  if (!/ndd-panel-store/.test(String(min.host))) fail(`minimise: panel not parked in the store (host ${min.host})`);
  await page.evaluate(() => window.__pg.ws.restorePanel('h1'));
  await check('restore');

  await shot('final');
  return { steps };
});
