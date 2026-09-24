/**
 * M15 browser gate — the regressions found while writing the manual, in real Chrome, both
 * schedulers.
 *
 *   N15  a split divider follows the pointer in LTR *and* RTL. vdd moves it away from the pointer
 *        under RTL: the drag delta is physical, the sizes logical, and a row runs right to left.
 *        jsdom computes no direction and lays nothing out, so only a browser can see this.
 *
 * `--control` drags under RTL and asserts the divider moves the *wrong* way — vdd's behaviour —
 * which must fail, proving the measurement can tell the two apart.
 */
import { runBrowserGate } from '../lib/browser.mjs';

const control = process.argv.includes('--control');

await runBrowserGate(control ? 'M15-control' : 'M15', {}, async (page, { fail, open, shot }) => {
  const report = {};
  for (const dir of ['ltr', 'rtl']) {
    await open('layout=two-leaf');
    await page.evaluate(d => {
      window.__pg.ws.openPanel('a', 'editor');
      window.__pg.ws.setDirection(d);
    }, dir);
    await page.waitForTimeout(300);
    const bar = page.locator('.ndd-resizer-bar').first();
    const before = await bar.boundingBox();
    if (!before) { fail(`${dir}: no split divider rendered`); continue; }
    const x = before.x + before.width / 2;
    const y = before.y + before.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await bar.boundingBox();
    const moved = Math.round(after.x - before.x);
    report[dir] = { moved };
    const expected = control && dir === 'rtl' ? -100 : 100;
    if (Math.abs(moved - expected) > 3) fail(`${dir}: dragging the divider 100px right moved it ${moved}px`);
    await shot(`divider-${dir}`);
  }
  return report;
});
