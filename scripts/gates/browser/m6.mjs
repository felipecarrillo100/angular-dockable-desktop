/**
 * M6 browser gate — every drop target, with real pointer events, both schedulers.
 *
 * A drop target is a *place on screen*; arriving at it means moving a real pointer there, which
 * jsdom cannot do. Each case drags a tab to a target and asserts the resulting layout tree, in
 * both reading directions; then the touch path — a tap must not drag, a real 420 ms press via
 * CDP must arm and then drag. Ported from vdd `scripts/gates/browser/m6.mjs`; the gestures are
 * shared with the differential gate (lib/dock-gestures.mjs).
 */
import { runBrowserGate } from '../lib/browser.mjs';
import { CASES, NDD, dragTabTo, leafOf, reorder, reset, tree } from '../lib/dock-gestures.mjs';

const VIEWPORT = { width: 1200, height: 800 };

await runBrowserGate('M6', { viewport: VIEWPORT }, async (page, { fail, open, shot }) => {
  await open();
  const record = [];
  for (const dir of ['ltr', 'rtl']) {
    for (const c of CASES) {
      const t = await dragTabTo(page, NDD, dir, c.target, { to: c.to });
      if (t.error) { fail(`${dir} ${c.name}: ${t.error}`); continue; }
      record.push({ dir, case: c.name, tree: t.tree, floating: t.floating });
      const leaf = leafOf(t, 'drag');
      const win = t.floating.find(f => f.id === 'drag');
      switch (c.name) {
        case 'centre of R':
          if (leaf !== 'R') fail(`${dir} centre: landed in ${leaf}, expected R`);
          if (t.active !== 'drag') fail(`${dir} centre: active is ${t.active}, expected drag`);
          break;
        case 'bottom of R':
          if (!leaf || leaf === 'R' || leaf === 'L') fail(`${dir} split: expected a new leaf, got ${leaf}`);
          if (!JSON.stringify(t.tree).includes('"branch":"vertical"')) fail(`${dir} split: no vertical branch was created`);
          break;
        case 'edge left': {
          const first = JSON.stringify(t.tree.children?.[0] ?? {});
          const second = JSON.stringify(t.tree.children?.[1] ?? {});
          const side = first.includes('"drag"') ? 'first' : second.includes('"drag"') ? 'second' : 'neither';
          // Physical left is the logical leading edge under LTR and the trailing one under RTL.
          const expected = dir === 'ltr' ? 'first' : 'second';
          if (side !== expected) fail(`${dir} edge: panel is the ${side} child, expected ${expected}`);
          break;
        }
        case 'corner bottom-right':
          if (!win) fail(`${dir} corner: panel did not float`);
          // The anchor is logical: physically bottom-right is bottom-LEFT under RTL.
          else if (win.anchor !== (dir === 'ltr' ? 'bottom-right' : 'bottom-left')) fail(`${dir} corner: anchor is ${win.anchor}`);
          break;
        case 'free float':
          if (!win) fail(`${dir} free: panel did not float`);
          else if (win.anchor !== null) fail(`${dir} free: anchor is ${win.anchor}, expected null`);
          break;
      }
    }
    const r = await reorder(page, NDD, dir);
    if (r.error) fail(`${dir} reorder: ${r.error}`);
    else {
      record.push({ dir, case: 'reorder', ...r });
      if (r.after.indexOf('drag') !== r.after.indexOf('third') + 1) fail(`${dir} reorder: order is ${r.after.join(',')} — "drag" should sit right after "third"`);
      if (r.after.length !== r.before.length) fail(`${dir} reorder: reordering changed the tab count`);
    }
    if (dir === 'ltr') await shot('mouse');
  }
  return { record };
});

// ── touch: a tap must not drag; a long press must arm, then drag ─────────────
await runBrowserGate('M6-touch', { viewport: { width: 900, height: 700 }, contextOptions: { hasTouch: true, isMobile: true } }, async (page, { fail, open, context }) => {
  await open();
  await reset(page, NDD, 'ltr');
  await page.waitForTimeout(250);
  if (!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches))) fail('device emulation did not report a coarse pointer');
  const tab = await page.locator('[data-ndd-tab="drag"]').boundingBox();

  await page.touchscreen.tap(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.waitForTimeout(150);
  if (leafOf(await tree(page, NDD), 'drag') !== 'L') fail('a tap moved the panel');

  const cdp = await context.newCDPSession(page);
  const touchPoint = (x, y) => [{ x, y, radiusX: 10, radiusY: 10, force: 1, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoint(tab.x + tab.width / 2, tab.y + tab.height / 2) });
  await page.waitForTimeout(420); // longer than the 300 ms long press
  if (!(await page.evaluate(() => document.querySelector('.ndd-long-press-active') !== null))) fail('a 420 ms press did not arm the long-press state');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(tab.x + tab.width / 2 + 20, tab.y + tab.height / 2 + 20) });
  await page.waitForTimeout(150);
  const box = await page.locator('[data-ndd-drop-zone="center"][data-ndd-leaf="R"]').first().boundingBox().catch(() => null);
  if (!box) {
    fail('drop zones did not appear during a touch drag');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return {};
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(box.x + box.width / 2, box.y + box.height / 2) });
  await page.waitForTimeout(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(260);
  const landed = leafOf(await tree(page, NDD), 'drag');
  if (landed !== 'R') fail(`long-press drag landed in ${landed}, expected R`);
  return { landed };
});
