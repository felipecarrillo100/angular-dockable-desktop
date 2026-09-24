/**
 * M10 browser gate — dirty state, the unsaved-changes question, drawers, the modal stack and
 * toasts, in real Chrome, both schedulers. Driven by real keys and clicks.
 *
 *   dirty     typing into a Signal Forms field marks the tab `*` (trackDirty); a real click on the
 *             tab's × opens the question on top of everything, with focus on its confirm button
 *   refusal   Escape and "No" each leave the panel open with its edits; "Yes" closes it
 *   window    the same question from a floating window's ×
 *   drawer    a dirty left drawer asks on Escape too; it sits on the left edge at its width
 *   stack     a modal opened from a modal lands above it: the backdrop and Escape close only the
 *             top one
 *   toasts    render in their corner, pause while hovered, and leave through the real exit
 *             transition rather than the timeout floor
 */
import { runBrowserGate } from '../lib/browser.mjs';

// `--control`: rdd's defect — closing a dirty tab discarded the edits without asking. Modelled
// by making the question answer "yes" before it is ever shown. The gate must reject it.
const control = process.argv.includes('--control');

const center = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const topAt = (page, x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  return el?.closest('[data-ndd-modal]')?.getAttribute('data-ndd-modal') ?? el?.closest('[data-ndd-side-panel]')?.getAttribute('data-ndd-side-panel') ?? el?.tagName ?? null;
}, [x, y]);

await runBrowserGate(control ? 'M10-control' : 'M10', {}, async (page, { fail, open, shot }) => {
  await open();
  if (control) await page.evaluate(() => { window.__pg.ws.overlays.confirmDiscard = () => Promise.resolve(true); });
  await page.evaluate(() => window.__pg.ws.openPanel('ed', 'editor', { title: 'Editor' }));
  await page.waitForSelector('[data-editor-input="ed"]');

  // ── dirty through a real Signal Forms field ──
  await page.locator('[data-editor-input="ed"]').click();
  await page.keyboard.type('Ada');
  await page.waitForTimeout(100);
  const tabText = await page.locator('[data-ndd-tab="ed"]').innerText();
  if (!tabText.includes('*')) fail(`typing into the field did not mark the tab dirty (${JSON.stringify(tabText)})`);

  // ── the question, from the tab's × ──
  const ask = async (label, via) => {
    await via();
    const shown = await page.waitForSelector('[data-ndd-modal] [data-ndd-confirm-ok]', { timeout: 2000 }).then(() => true).catch(() => false);
    if (!shown) { fail(`${label}: closing a dirty panel did not ask`); return false; }
    await page.waitForTimeout(80);
    const focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-ndd-confirm-ok') ?? false);
    if (!focused) fail(`${label}: focus is not on the question's confirm button`);
    const box = await page.locator('[data-ndd-modal] .ndd-modal-window').boundingBox();
    const top = await topAt(page, center(box).x, center(box).y);
    if (!top?.startsWith('ndd-modal')) fail(`${label}: the question is not on top (hit ${top})`);
    return true;
  };
  const stillOpen = () => page.evaluate(() => window.__pg.ws.isOpen('ed'));
  const noModal = () => page.evaluate(() => window.__pg.ws.overlays.state().modals.length === 0);

  if (await ask('tab ×', () => page.locator('[data-ndd-close="ed"]').click())) {
    await shot('question');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    if (!(await stillOpen()) || !(await noModal())) fail('Escape on the question did not refuse the close');
    if ((await page.locator('[data-editor-input="ed"]').inputValue()) !== 'Ada') fail('the edits did not survive a refusal');
  }
  if (await ask('tab × again', () => page.locator('[data-ndd-close="ed"]').click())) {
    await page.locator('[data-ndd-confirm-cancel]').click();
    await page.waitForTimeout(150);
    if (!(await stillOpen()) || !(await noModal())) fail('"No" did not keep the panel open');
  }

  // ── the same question from a floating window's × ──
  await page.evaluate(() => window.__pg.ws.floatPanel('ed', { x: 200, y: 120, width: 420, height: 260 }));
  await page.waitForTimeout(250);
  const windowClose = page.locator('[data-ndd-close-window="ed"]');
  if (await windowClose.count()) {
    if (await ask('window ×', () => windowClose.click())) {
      await page.locator('[data-ndd-confirm-ok]').click();
      await page.waitForTimeout(200);
      if (await stillOpen()) fail('"Yes" did not close the panel');
    }
  } else fail('no close button on the floating window');

  // ── a dirty drawer asks on Escape ──
  const drawerId = await page.evaluate(() => window.__pg.ws.overlays.openLeftPanel(window.__pg.components.editor, {}, { title: 'Drawer' }));
  await page.waitForSelector('[data-ndd-side-panel="left"] input');
  const drawer = await page.locator('[data-ndd-side-panel="left"]').boundingBox();
  if (!drawer || drawer.x > 1 || Math.abs(drawer.width - 400) > 1) fail(`the left drawer is not at the left edge, 400px wide: ${JSON.stringify(drawer)}`);
  await page.locator('[data-ndd-side-panel="left"] input').click();
  await page.keyboard.type('x');
  await page.waitForTimeout(80);
  const drawerTitle = await page.locator('[data-ndd-side-panel="left"] .ndd-side-panel-title').innerText();
  if (drawerTitle !== 'Drawer *') fail(`the dirty drawer's title is ${JSON.stringify(drawerTitle)}, not "Drawer *"`);
  if (await ask('drawer Escape', () => page.keyboard.press('Escape'))) {
    await page.locator('[data-ndd-confirm-ok]').click();
    await page.waitForTimeout(200);
    const left = await page.evaluate(() => window.__pg.ws.overlays.state().leftPanel?.id ?? null);
    if (left === drawerId) fail('"Yes" did not close the drawer');
  }

  // ── the modal stack ──
  const ids = await page.evaluate(() => {
    const { modals, components } = window.__pg;
    return [modals.open(components.hostile, {}, { title: 'First', size: 'large' }).id, modals.open(components.hostile, {}, { title: 'Second', size: 'small' }).id];
  });
  await page.waitForTimeout(250);
  const second = await page.locator(`[data-ndd-modal="${ids[1]}"] .ndd-modal-window`).boundingBox();
  const hitSecond = await topAt(page, center(second).x, center(second).y);
  if (hitSecond !== ids[1]) fail(`the second modal is not above the first (hit ${hitSecond})`);
  await page.mouse.click(8, 8); // the backdrop, outside both windows
  await page.waitForTimeout(150);
  let stack = await page.evaluate(() => window.__pg.ws.overlays.state().modals.map(m => m.id));
  if (JSON.stringify(stack) !== JSON.stringify([ids[0]])) fail(`a backdrop click left ${JSON.stringify(stack)}, expected only the first`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  stack = await page.evaluate(() => window.__pg.ws.overlays.state().modals.length);
  if (stack !== 0) fail('Escape did not close the last modal');

  // ── toasts ──
  const vp = page.viewportSize();
  await page.evaluate(() => window.__pg.toast.success('Saved', { id: 'saved', duration: 600 }));
  await page.waitForSelector('[data-ndd-toast="saved"]');
  await page.waitForTimeout(350);
  const card = await page.locator('[data-ndd-toast="saved"]').boundingBox();
  if (!card || card.x + card.width < vp.width - 60 || card.y + card.height < vp.height - 120) fail(`the toast is not in the bottom-right corner: ${JSON.stringify(card)}`);
  await page.mouse.move(center(card).x, center(card).y);
  await page.waitForTimeout(900);
  if (!(await page.locator('[data-ndd-toast="saved"]').count())) fail('hovering did not hold the toast');
  // Record whether the card's own exit transition ran, as opposed to the timeout floor.
  await page.evaluate(() => {
    window.__toastExit = null;
    document.addEventListener('transitionend', e => {
      if (e.propertyName === 'max-height' && e.target.closest?.('[data-ndd-toast="saved"]')) window.__toastExit ??= 'transition';
    }, true);
  });
  await page.mouse.move(10, vp.height / 2);
  await page.waitForFunction(() => !document.querySelector('[data-ndd-toast="saved"]'), null, { timeout: 3000 }).catch(() => fail('the toast never left'));
  if ((await page.evaluate(() => window.__toastExit)) !== 'transition') fail('the toast was removed without its exit transition running (the timeout floor removed it)');
  await shot('end');
});
