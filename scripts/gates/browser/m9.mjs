/**
 * M9 browser gate — the sidebar, secondary sidebar and toolbar in real Chrome, both schedulers.
 * The playground's `?chrome` mode binds every model through a real `[( )]`.
 *
 *   layout    primary on the left edge, secondary on the right, the toolbar and desktop between
 *   open      a real click on a rail tab opens its drawer at the bound width, and writes the
 *             bound signal; a second click closes it
 *   resize    a real drag on the resizer writes the bound width, clamped to [min, max], and the
 *             drawer's rendered width follows it
 *   D12       a very wide panel inside the workspace cannot inflate the content wrapper and
 *             squeeze the drawer: the drawer renders at exactly its width
 *   survival  the panel in the workspace is created once through open, close, resize and hiding
 *             the whole sidebar — the workspace is sidebar content, and never re-created
 *   flyout    a real click on a group opens its flyout outside the strip, on top (hit-testable
 *             where it is drawn), inside the viewport and beside the strip — mirrored under RTL;
 *             a real click on a tool selects it and the button wears its icon
 *   N6        on a right-to-left page the left sidebar renders on the right edge and its resizer
 *             grows it leftwards
 *   N5        the flyout opens beside the strip by the strip's own direction: mirrored in an RTL
 *             app, not mirrored when only the desktop is RTL
 *   collapse  [(visible)] false collapses the toolbar strip to nothing — no 1px border left (N7)
 */
import { runBrowserGate } from '../lib/browser.mjs';

// `--control`: restore rdd's missing rule — the content wrapper with `flex-basis: auto`, so a
// wide panel's max-content width becomes the wrapper's starting size. The D12 check must
// reject it, or it is not measuring anything.
const control = process.argv.includes('--control');

const rect = (page, selector, index = 0) =>
  page.evaluate(([sel, i]) => document.querySelectorAll(sel)[i]?.getBoundingClientRect().toJSON() ?? null, [selector, index]);
/** Wait for transitions and animations on the element to finish, then measure it. */
const settled = (page, selector, index = 0) =>
  page.evaluate(async ([sel, i]) => {
    const el = document.querySelectorAll(sel)[i];
    if (!el) return null;
    await new Promise(r => setTimeout(r, 30));
    await Promise.all(el.getAnimations({ subtree: false }).map(a => a.finished.catch(() => {})));
    return el.getBoundingClientRect().toJSON();
  }, [selector, index]);
const chrome = (page, key) => page.evaluate(k => window.__pg.chrome[k](), key);

await runBrowserGate(control ? 'M9-control' : 'M9', {}, async (page, { fail, open, shot }) => {
  await open('chrome');
  if (control) await page.addStyleTag({ content: '.ndd-sidebar-main { flex-basis: auto !important; }' });
  await page.evaluate(() => window.__pg.ws.openPanel('p', 'hostile'));
  await page.waitForSelector('[data-panel="p"]');
  await page.evaluate(() => { window.__nodeRef = document.querySelector('[data-panel="p"]'); });

  // ── layout ──
  const vp = page.viewportSize();
  const sides = await page.evaluate(() => [...document.querySelectorAll('[data-ndd-sidebar]')].map(e => e.getAttribute('data-ndd-sidebar')));
  if (JSON.stringify(sides) !== '["left","right"]') fail(`sidebar sides: ${JSON.stringify(sides)}`);
  const primaryStrip = await rect(page, '.ndd-sidebar-strip-outer', 0);
  const secondaryStrip = await rect(page, '.ndd-sidebar-strip-outer', 1);
  if (!primaryStrip || primaryStrip.left > 1) fail(`the primary strip is not on the left edge: ${JSON.stringify(primaryStrip)}`);
  if (!secondaryStrip || Math.abs(secondaryStrip.right - vp.width) > 1) fail(`the secondary strip is not on the right edge: ${JSON.stringify(secondaryStrip)}`);
  if (primaryStrip && primaryStrip.height < vp.height - 1) fail(`the strip does not fill the column (height ${primaryStrip.height})`);

  // ── open by a real click ──
  await page.locator('[data-ndd-sidebar-tab="files"]').click();
  await page.waitForTimeout(350);
  if ((await chrome(page, 'primaryTab')) !== 'files') fail('a real click on a rail tab did not write [(activeTabId)]');
  const drawer = await settled(page, '.ndd-sidebar-content-drawer', 0);
  if (!drawer || Math.abs(drawer.width - 280) > 1) fail(`the open drawer is not 280px wide (${drawer?.width})`);
  if (!(await page.locator('[data-pg-tab="files"]').isVisible())) fail('the nddSidebarTab template did not render in the drawer');
  await shot('open');

  // ── resize by a real drag, clamped ──
  const bar = await rect(page, '[data-ndd-sidebar-resizer]', 0);
  if (!bar) fail('no resizer while the drawer is open');
  else {
    await page.mouse.move(bar.left + 0.5, bar.top + 200);
    await page.mouse.down();
    await page.mouse.move(bar.left + 60, bar.top + 200, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const w = await chrome(page, 'primaryWidth');
    if (Math.abs(w - 340) > 1) fail(`a 60px drag gave width ${w}, expected 340`);
    const after = await settled(page, '.ndd-sidebar-content-drawer', 0);
    if (Math.abs(after.width - w) > 1) fail(`the drawer renders ${after.width}px for width ${w}`);
    const again = await rect(page, '[data-ndd-sidebar-resizer]', 0);
    await page.mouse.move(again.left + 0.5, again.top + 200);
    await page.mouse.down();
    await page.mouse.move(again.left + 600, again.top + 200, { steps: 6 });
    await page.mouse.up();
    if ((await chrome(page, 'primaryWidth')) !== 480) fail(`a drag past maxWidth gave ${await chrome(page, 'primaryWidth')}, expected 480`);
    await page.evaluate(() => window.__pg.chrome.primaryWidth.set(300));
    await page.waitForTimeout(350);
  }

  // ── D12: a wide panel cannot squeeze the drawer ──
  await page.evaluate(() => {
    const wide = document.createElement('div');
    wide.id = 'pg-wide';
    wide.style.cssText = 'width: 3000px; height: 4px; background: #f0f;';
    document.querySelector('[data-panel="p"]').appendChild(wide);
  });
  await page.evaluate(() => { window.__pg.chrome.primaryTab.set(null); });
  await page.waitForTimeout(350);
  await page.evaluate(() => { window.__pg.chrome.primaryTab.set('files'); });
  await page.waitForTimeout(400);
  const squeezed = await settled(page, '.ndd-sidebar-content-drawer', 0);
  if (!squeezed || Math.abs(squeezed.width - 300) > 1) fail(`D12: with a 3000px-wide panel the drawer renders ${squeezed?.width}px, not its 300px`);
  const main = await rect(page, '.ndd-sidebar-main', 0);
  if (main && main.right > vp.width + 1) fail(`D12: the content wrapper overflows the viewport (right ${main.right})`);
  await page.evaluate(() => document.getElementById('pg-wide')?.remove());

  // ── close by a second real click; hide the whole sidebar and bring it back ──
  await page.locator('[data-ndd-sidebar-tab="files"]').click();
  await page.waitForTimeout(350);
  if ((await chrome(page, 'primaryTab')) !== null) fail('a second click did not close the drawer');
  await page.evaluate(() => window.__pg.chrome.primaryVisible.set(false));
  await page.waitForTimeout(350);
  const hidden = await settled(page, '.ndd-sidebar-strip-outer', 0);
  if (hidden.width > 0.5) fail(`[(visible)] false left the strip ${hidden.width}px wide`);
  await page.evaluate(() => window.__pg.chrome.primaryVisible.set(true));
  await page.waitForTimeout(350);

  // ── survival ──
  const survival = await page.evaluate(() => ({
    same: document.querySelector('[data-panel="p"]') === window.__nodeRef,
    mounts: window.__mounts?.p ?? 0,
    unmounts: window.__unmounts?.p ?? 0,
  }));
  if (!survival.same || survival.mounts !== 1 || survival.unmounts !== 0) fail(`the workspace panel did not survive the sidebar: ${JSON.stringify(survival)}`);

  // ── N6: on a right-to-left page the left sidebar sits on the right edge, and grows leftwards ──
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; window.__pg.ws.setDirection('rtl'); window.__pg.chrome.primaryTab.set('files'); });
  await page.waitForTimeout(400);
  const rtlDrawer = await settled(page, '.ndd-sidebar-content-drawer', 0);
  if (!rtlDrawer || Math.abs(rtlDrawer.right - vp.width) > 57) fail(`rtl: the left sidebar's drawer is not beside the right edge ${JSON.stringify(rtlDrawer)}`);
  const rtlBar = await rect(page, '[data-ndd-sidebar-resizer]', 0);
  const before = await chrome(page, 'primaryWidth');
  await page.mouse.move(rtlBar.left + 0.5, rtlBar.top + 200);
  await page.mouse.down();
  await page.mouse.move(rtlBar.left - 40, rtlBar.top + 200, { steps: 6 });
  await page.mouse.up();
  const grown = await chrome(page, 'primaryWidth');
  if (Math.abs(grown - (before + 40)) > 1) fail(`rtl: dragging the resizer 40px away from the edge gave width ${grown}, expected ${before + 40}`);
  await page.evaluate(() => { window.__pg.chrome.primaryTab.set(null); window.__pg.chrome.primaryWidth.set(300); });
  await page.waitForTimeout(350);

  // ── toolbar flyout: LTR; a mirrored RTL app; and an RTL workspace in an unmirrored page (N5) ──
  for (const { name, pageDir, wsDir, beside } of [
    { name: 'ltr', pageDir: 'ltr', wsDir: 'ltr', beside: 'after' },
    { name: 'rtl', pageDir: 'rtl', wsDir: 'rtl', beside: 'before' },
    { name: 'rtl-desktop-only', pageDir: 'ltr', wsDir: 'rtl', beside: 'after' },
  ]) {
    await page.evaluate(([p, w]) => { document.documentElement.dir = p; window.__pg.ws.setDirection(w); }, [pageDir, wsDir]);
    await page.waitForTimeout(300);
    const strip = await rect(page, '.ndd-toolbar-strip');
    await page.locator('[data-ndd-toolbar-item="shapes"]').click();
    await page.waitForSelector('[data-ndd-flyout="shapes"]', { timeout: 2000 }).catch(() => fail(`${name}: the group opened no flyout`));
    const fly = await settled(page, '[data-ndd-flyout="shapes"]');
    if (!fly || !strip) continue;
    const inStrip = await page.evaluate(() => !!document.querySelector('[data-ndd-flyout]')?.closest('.ndd-toolbar-strip'));
    if (inStrip) fail(`${name}: the flyout is inside the strip, where overflow: hidden clips it`);
    if (fly.left < 0 || fly.top < 0 || fly.right > vp.width || fly.bottom > vp.height) fail(`${name}: the flyout leaves the viewport ${JSON.stringify(fly)}`);
    if (beside === 'after' && fly.left < strip.right) fail(`${name}: the flyout (left ${fly.left}) is not beside the strip (right ${strip.right})`);
    if (beside === 'before' && fly.right > strip.left) fail(`${name}: the flyout (right ${fly.right}) is not beside the strip (left ${strip.left})`);
    const hit = await page.evaluate(() => {
      const item = document.querySelector('[data-ndd-flyout-item="ellipse"]');
      const r = item.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-ndd-flyout-item]')?.getAttribute('data-ndd-flyout-item') ?? null;
    });
    if (hit !== 'ellipse') fail(`${name}: the flyout is covered where it is drawn (hit ${hit})`);
    await shot(`flyout-${name}`);
    await page.locator('[data-ndd-flyout-item="ellipse"]').click();
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({
      open: !!document.querySelector('[data-ndd-flyout]'),
      label: document.querySelector('[data-ndd-toolbar-item="shapes"]').getAttribute('aria-label'),
      icon: !!document.querySelector('[data-ndd-toolbar-item="shapes"] .pg-icon-ellipse'),
      active: window.__pg.ws.toolbar.activeInGroup('shapes'),
    }));
    if (state.open || state.label !== 'Ellipse' || !state.icon || state.active !== 'ellipse') fail(`${name}: selecting a tool gave ${JSON.stringify(state)}`);
    await page.evaluate(() => window.__pg.ws.toolbar.setActiveInGroup('shapes', null));
  }
  await page.evaluate(() => { document.documentElement.dir = 'ltr'; window.__pg.ws.setDirection('ltr'); });

  // ── collapse the toolbar through [(visible)] ──
  await page.evaluate(() => window.__pg.chrome.toolbarVisible.set(false));
  await page.waitForTimeout(400);
  const collapsed = await settled(page, '.ndd-toolbar-strip');
  if (!collapsed || collapsed.width > 0) fail(`[(visible)] false left the toolbar ${collapsed?.width}px wide`);

  return { survival };
});
