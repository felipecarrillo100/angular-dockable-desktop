/**
 * M12 browser gate — contributions, locale and direction, in real Chrome, both schedulers.
 *
 *   contrib   the shell toolbar (?chrome) shows the ACTIVE panel's contributed control, follows a
 *             real tab click to the other panel, and drops it when that panel is minimised (D2)
 *   locale    switching the formatter's signal relabels the library's chrome with no reload
 *   rtl       setDirection('rtl') mirrors the tab strip structurally
 */
import { runBrowserGate } from '../lib/browser.mjs';

await runBrowserGate('M12', {}, async (page, { fail, open, shot }) => {
  await open('chrome');
  await page.evaluate(() => {
    window.__pg.ws.openPanel('a', 'contributor');
    window.__pg.ws.openPanel('b', 'contributor');
  });
  await page.waitForSelector('[data-contrib="b"]');
  await page.waitForTimeout(200);
  const shown = () => page.evaluate(() => [...document.querySelectorAll('[data-ndd-toolbar-item^="c-"]')].map(e => e.getAttribute('data-ndd-toolbar-item')));

  // ── contributions follow the active panel ──
  if (JSON.stringify(await shown()) !== '["c-b"]') fail(`with b active the shell shows ${JSON.stringify(await shown())}`);
  await page.locator('[data-ndd-tab="a"]').click();
  await page.waitForTimeout(200);
  if (JSON.stringify(await shown()) !== '["c-a"]') fail(`after a real click on tab a the shell shows ${JSON.stringify(await shown())}`);
  // The contributed toggle works through the shell and reaches its own panel.
  await page.locator('[data-ndd-toolbar-item="c-a"]').click();
  await page.waitForTimeout(150);
  if (!(await page.locator('[data-contrib="a"]').innerText()).includes('on=true')) fail('the contributed toggle did not reach its panel');
  await page.evaluate(() => window.__pg.ws.minimizePanel('a'));
  await page.waitForTimeout(250);
  if (JSON.stringify(await shown()) !== '["c-b"]') fail(`a minimised panel's control is still surfaced: ${JSON.stringify(await shown())}`);
  await shot('contrib');

  // ── locale switch, live ──
  const label = () => page.evaluate(() => document.querySelector('[data-ndd-close="b"]')?.getAttribute('title'));
  if ((await label()) !== 'Close Tab') fail(`english label is ${await label()}`);
  await page.evaluate(() => window.__pg.locale.set('es'));
  await page.waitForTimeout(150);
  if ((await label()) !== 'Cerrar pestaña') fail(`after switching locale the label is ${await label()}`);
  await page.evaluate(() => window.__pg.locale.set('en'));

  // ── RTL mirrors the tab strip ──
  await page.evaluate(() => { window.__pg.ws.restorePanel('a'); window.__pg.ws.setDirection('rtl'); });
  await page.waitForTimeout(250);
  // Structural mirroring: in the leaf's own tab order, the first tab sits right of the second.
  const order = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[data-ndd-tab]')];
    const [first, second] = tabs.map(t => t.getBoundingClientRect().left);
    return { dir: document.querySelector('.ndd-workspace')?.getAttribute('dir'), ids: tabs.map(t => t.getAttribute('data-ndd-tab')), first, second };
  });
  if (order.dir !== 'rtl') fail(`the desktop dir is ${order.dir}`);
  if (order.ids.length !== 2 || !(order.first > order.second)) fail(`under RTL the first tab (${order.ids[0]}) is not right of the second: ${JSON.stringify(order)}`);
});
