/**
 * M8 browser gate — context menus in real Chrome, both schedulers.
 *
 *   tab menu   a real right-click on a tab opens the standard menu at the pointer
 *   clamp      a menu opened at the viewport's corner is pulled back inside it
 *   keyboard   focus moves into the menu; ArrowDown/Enter activate an item with no mouse at all;
 *              Escape returns focus to where it was
 *   D1         the taskbar menu's Maximize, clicked for real, restores and maximises
 *   submenu    opens beside its parent — to the right under LTR, to the left under RTL
 *   dismissal  a real click outside closes the menu
 */
import { runBrowserGate } from '../lib/browser.mjs';

const labels = page => page.evaluate(() => [...document.querySelectorAll('[data-ndd-menu] [data-ndd-menu-item], [data-ndd-menu] [data-ndd-menu-submenu]')]
  .map(e => e.getAttribute('data-ndd-menu-item') ?? e.getAttribute('data-ndd-menu-submenu')));
const menuOpen = page => page.evaluate(() => !!document.querySelector('[data-ndd-menu]'));
/**
 * The element's rect once its entry animation has finished. The menu scales in from 0.97, so a
 * rect read mid-animation is a few px off its resting place; the tolerance stays as it is.
 */
const settledRect = (page, selector) => page.evaluate(async sel => {
  const el = document.querySelector(sel);
  if (!el) return null;
  await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {})));
  return el.getBoundingClientRect().toJSON();
}, selector);

// `--control`: restore rdd/vdd's tooltip entry animation (it starts 10% of the preview's height
// low). The overlap check must reject it.
const control = process.argv.includes('--control');

await runBrowserGate(control ? 'M8-control' : 'M8', {}, async (page, { fail, open, shot }) => {
  await open('layout=two-leaf');
  if (control) await page.addStyleTag({ content: '@keyframes ndd-tooltip-fade-in { from { opacity: 0; transform: translateX(-50%) translateY(-90%); } to { opacity: 1; transform: translateX(-50%) translateY(-100%); } }' });
  await page.evaluate(() => {
    const ws = window.__pg.ws;
    ws.openPanel('a', 'hostile');
    ws.openPanel('b', 'hostile');
    ws.dockPanelToGroup('b', 'R', 'center');
  });
  await page.waitForSelector('[data-ndd-tab="a"]');

  // ── a real right-click on a tab ──
  const tab = await page.locator('[data-ndd-tab="a"]').boundingBox();
  await page.mouse.click(tab.x + tab.width / 2, tab.y + tab.height / 2, { button: 'right' });
  await page.waitForSelector('[data-ndd-menu]', { timeout: 2000 }).catch(() => fail('right-click on a tab opened no menu'));
  const tabMenu = await labels(page);
  if (JSON.stringify(tabMenu) !== JSON.stringify(['Float Window', 'Minimize Panel', 'Close Tab'])) fail(`tab menu: ${JSON.stringify(tabMenu)}`);
  const at = await settledRect(page, '[data-ndd-menu]');
  if (Math.abs(at.left - (tab.x + tab.width / 2)) > 2) fail(`the menu did not open at the pointer (left ${at.left})`);
  await shot('tab-menu');

  // ── dismissal by a real outside click ──
  await page.mouse.click(600, 500);
  await page.waitForTimeout(150);
  if (await menuOpen(page)) fail('a click outside did not close the menu');

  // ── clamp at the viewport corner ──
  const vp = page.viewportSize();
  await page.evaluate(([x, y]) => window.__pg.ws.showContextMenu({ x, y, items: [{ label: 'Wide item that needs room' }, { label: 'Two' }, { label: 'Three' }] }), [vp.width - 5, vp.height - 5]);
  await page.waitForTimeout(200);
  const clamped = await settledRect(page, '[data-ndd-menu]');
  if (clamped.right > vp.width || clamped.bottom > vp.height) fail(`menu overflows the viewport: ${JSON.stringify(clamped)}`);

  // ── keyboard only ──
  await page.evaluate(() => window.__pg.ws.closeContextMenu());
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'pg-return-focus';
    b.textContent = 'before';
    document.body.appendChild(b);
    b.focus();
    window.__ran = [];
    window.__pg.ws.showContextMenu({ x: 200, y: 200, items: [{ label: 'First', action: () => window.__ran.push('first') }, { label: 'Second', action: () => window.__ran.push('second') }] });
  });
  await page.waitForTimeout(200);
  const firstFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-ndd-menu-item'));
  if (firstFocus !== 'First') fail(`focus did not move into the menu (${firstFocus})`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const ran = await page.evaluate(() => window.__ran);
  if (JSON.stringify(ran) !== '["second"]') fail(`keyboard: ArrowDown + Enter ran ${JSON.stringify(ran)}, expected ["second"]`);
  if (await menuOpen(page)) fail('keyboard: the menu stayed open after activating an item');
  const back = await page.evaluate(() => document.activeElement?.id);
  if (back !== 'pg-return-focus') fail(`keyboard: focus did not return to where it was (${back})`);
  await page.evaluate(() => {
    document.getElementById('pg-return-focus').focus();
    window.__pg.ws.showContextMenu({ x: 200, y: 200, items: [{ label: 'Only' }] });
  });
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await menuOpen(page)) fail('keyboard: Escape did not close the menu');
  if ((await page.evaluate(() => document.activeElement?.id)) !== 'pg-return-focus') fail('keyboard: Escape did not return focus');

  // ── a hover preview never covers its own icon, even while it animates in ──
  await page.evaluate(() => window.__pg.ws.minimizePanel('b'));
  await page.waitForTimeout(200);
  const iconB = await page.locator('[data-ndd-taskbar-item="b"]').boundingBox();
  await page.mouse.move(iconB.x + iconB.width / 2, iconB.y + iconB.height / 2, { steps: 2 });
  let worst = -Infinity;
  for (let i = 0; i < 12; i++) {
    const bottom = await page.evaluate(() => document.querySelector('[data-ndd-preview]')?.getBoundingClientRect().bottom ?? null);
    if (bottom !== null) worst = Math.max(worst, bottom);
    await page.waitForTimeout(15);
  }
  if (worst > iconB.y) fail(`the preview overlaps its icon while animating in (bottom ${worst} > icon top ${iconB.y})`);
  await page.mouse.move(640, 300);
  await page.evaluate(() => window.__pg.ws.restorePanel('b'));
  await page.waitForTimeout(250);

  // ── D1 through real clicks ──
  await page.evaluate(() => window.__pg.ws.minimizePanel('a'));
  await page.waitForTimeout(200);
  await page.locator('[data-ndd-taskbar-item="a"]').click({ button: 'right', force: true });
  await page.waitForSelector('[data-ndd-menu-item="Maximize Panel"]', { timeout: 2000 }).catch(() => fail('D1: the taskbar menu offers no Maximize'));
  await page.locator('[data-ndd-menu-item="Maximize Panel"]').click();
  await page.waitForTimeout(250);
  const d1 = await page.evaluate(() => {
    const s = window.__pg.ws.state();
    return { state: s.panels.a?.state, maximized: s.floating.find(w => w.id === 'a')?.maximized, minimized: s.minimized.length };
  });
  if (d1.state !== 'floating' || d1.maximized !== true || d1.minimized !== 0) fail(`D1: Maximize from the taskbar gave ${JSON.stringify(d1)}`);

  // ── submenu side, LTR then RTL ──
  for (const dir of ['ltr', 'rtl']) {
    await page.evaluate(d => {
      window.__pg.ws.setDirection(d);
      window.__pg.ws.showContextMenu({ x: 400, y: 200, items: [{ label: 'More', items: [{ label: 'Nested' }] }] });
    }, dir);
    await page.waitForTimeout(150);
    const parent = await page.locator('[data-ndd-menu-submenu="More"]').boundingBox();
    await page.mouse.move(parent.x + parent.width / 2, parent.y + parent.height / 2, { steps: 3 });
    await page.waitForSelector('[data-ndd-submenu]', { timeout: 2000 }).catch(() => fail(`${dir}: the submenu did not open`));
    const sides = {
      menu: await settledRect(page, '[data-ndd-menu]'),
      sub: await settledRect(page, '[data-ndd-submenu]') ?? undefined,
    };
    if (sides.sub) {
      // Placed against the parent *item*, which sits inside the menu's padding — so a few px of
      // overlap with the menu box is expected (vdd's geometry). What matters is the side.
      const ok = dir === 'ltr' ? sides.sub.left >= sides.menu.right - 8 : sides.sub.right <= sides.menu.left + 8;
      if (!ok) fail(`${dir}: the submenu opened on the wrong side (${JSON.stringify(sides)})`);
    }
    await page.evaluate(() => window.__pg.ws.closeContextMenu());
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.__pg.ws.setDirection('ltr'));
  return { tabMenu, d1 };
});
