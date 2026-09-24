/**
 * M13 browser gate — accessibility, keyboard, change-detection cost, and the live class sweep,
 * in real Chrome under both schedulers.
 *
 *   axe       axe-core (WCAG 2.0/2.1 A and AA) reports no violation in the library's chrome, across
 *             a desktop with a split and tabs, a floating window, the taskbar, the sidebar and
 *             toolbar, an open context menu, a modal with the confirm dialog, a drawer and a toast.
 *             The playground's own panel content is excluded — it is the consumer's, not ours.
 *   keyboard  Tab reaches the selected workspace tab and a sidebar rail button; Enter on a rail
 *             button opens its drawer; Delete on the focused tab closes it (N4)
 *   ticks     change detection runs only when something changed: 0 ticks idle, ≤ 2 for 40 moves
 *             over an idle tab bar or a panel body, and about one per move while dragging a window
 *   classes   every class rendered anywhere in the tour has a rule, is a declared consumer hook,
 *             or takes a caller's value — the half of the class↔rule sweep a static scan can miss
 *
 * `--control`: inject an unlabelled `aria-label` on a generic element and a document-level
 * listener that ticks on every pointer move. Both must be caught.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, STYLES } from '../lib/config.mjs';
import { selectorClasses } from '../lib/css.mjs';
import { CONSUMER_HOOKS, OPEN_ENDED_PREFIXES } from '../lib/emitted.mjs';
import { runBrowserGate } from '../lib/browser.mjs';

const control = process.argv.includes('--control');
const AXE = join(ROOT, 'node_modules/axe-core/axe.min.js');
const styled = selectorClasses(readFileSync(STYLES, 'utf8'));
/** Consumer content in the playground: not the library's to answer for. */
const EXCLUDE = [['[data-panel]'], ['[data-contrib]'], ['[data-editor]'], ['.pg-tab'], ['[data-overlay-body]']];

await runBrowserGate(control ? 'M13-control' : 'M13', {}, async (page, { fail, open, shot }) => {
  const seen = new Set();
  const collect = async () => {
    for (const c of await page.evaluate(() => [...new Set([...document.querySelectorAll('[class]')].flatMap(e => [...e.classList]))])) seen.add(c);
  };
  const axe = async (label) => {
    await page.addScriptTag({ path: AXE });
    const violations = await page.evaluate(async exclude => {
      const r = await window.axe.run({ exclude }, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
      return r.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
    }, EXCLUDE);
    for (const v of violations) fail(`axe [${label}]: ${v}`);
  };

  // ── the tour ──
  await open('chrome');
  if (control) {
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.className = 'ndd-workspace-panel';
      d.setAttribute('aria-label', 'unlabelled generic');
      document.querySelector('.ndd-workspace')?.appendChild(d);
      document.addEventListener('pointermove', () => window.__pg.appRef.tick());
    });
  }
  await page.evaluate(() => {
    const { ws } = window.__pg;
    ws.openPanel('a', 'contributor');
    ws.openPanel('b', 'contributor');
    ws.dockPanelToGroup('b', ws.state().gridRoot.id, 'right');
    ws.openPanel('a2', 'contributor');
    ws.openPanel('f', 'contributor', { initialTarget: 'floating' });
    ws.openPanel('m', 'contributor');
    ws.minimizePanel('m');
  });
  await page.waitForTimeout(500);
  await collect();
  await axe('desktop');
  await shot('desktop');

  // ── ticks (quiet panels only: no timers of their own) ──
  const counting = async fn => {
    await page.evaluate(() => {
      const r = window.__pg.appRef;
      if (!window.__counted) {
        window.__counted = true;
        for (const k of ['tick', '_tick']) {
          const t = r[k]?.bind(r);
          if (t) r[k] = (...a) => { window.__ticks++; return t(...a); };
        }
      }
      window.__ticks = 0;
    });
    await fn();
    await page.waitForTimeout(250);
    return page.evaluate(() => window.__ticks);
  };
  const idle = await counting(() => page.waitForTimeout(1000));
  if (idle !== 0) fail(`ticks: ${idle} change-detection passes in 1s with nothing happening`);
  const tab = await page.locator('[data-ndd-tab="a2"]').boundingBox();
  const overTabs = await counting(async () => { for (let i = 0; i < 40; i++) await page.mouse.move(tab.x + 4 + i, tab.y + tab.height / 2); });
  if (overTabs > 2) fail(`ticks: 40 moves over an idle tab bar cost ${overTabs} passes`);
  const body = await page.locator('[data-contrib="b"]').boundingBox();
  const overBody = await counting(async () => { for (let i = 0; i < 40; i++) await page.mouse.move(body.x + 10 + i * 3, body.y + 20); });
  if (overBody > 2) fail(`ticks: 40 moves over a panel body cost ${overBody} passes`);
  const bar = await page.locator('[data-ndd-window="f"] .ndd-floating-window-titlebar').boundingBox();
  const dragging = await counting(async () => {
    await page.mouse.move(bar.x + 60, bar.y + 10);
    await page.mouse.down();
    for (let i = 0; i < 40; i++) await page.mouse.move(bar.x + 60 + i * 4, bar.y + 10 + i);
    await page.mouse.up();
  });
  if (dragging > 40 + 8) fail(`ticks: a 40-move window drag cost ${dragging} passes (about one per move is the render)`);
  if (dragging < 20) fail(`ticks: a 40-move window drag cost only ${dragging} passes — the counter is not seeing renders`);

  // ── keyboard ──
  const reach = async (selector, max = 60) => {
    await page.evaluate(() => { document.activeElement?.blur(); document.body.focus(); });
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(sel => document.activeElement?.matches(sel) ?? false, selector)) return true;
    }
    return false;
  };
  if (!(await reach('[data-ndd-tab="a2"]'))) fail('keyboard: Tab never reaches the selected workspace tab');
  else {
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    if (await page.evaluate(() => window.__pg.ws.isOpen('a2'))) fail('keyboard: Delete on the focused tab did not close it');
  }
  if (!(await reach('[data-ndd-sidebar-tab="files"]'))) fail('keyboard: Tab never reaches a sidebar rail button');
  else {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    if ((await page.evaluate(() => window.__pg.chrome.primaryTab())) !== 'files') fail('keyboard: Enter on a rail button did not open its drawer');
  }
  await collect();
  await axe('sidebar open');

  // ── overlays: context menu, modal + confirm, drawer, toast, flyout ──
  await page.evaluate(() => {
    const { ws, toast, components } = window.__pg;
    toast.success('Saved', { id: 't-ok', duration: 0 });
    toast.error('Failed', { id: 't-err', duration: 0 });
    ws.showContextMenu({ x: 320, y: 320, items: [{ label: 'One' }, { separator: true }, { label: 'More', items: [{ label: 'Nested' }] }, { label: 'Check', checkbox: { value: true } }] });
  });
  await page.waitForTimeout(300);
  await collect();
  await axe('context menu + toasts');
  await page.evaluate(() => window.__pg.ws.closeContextMenu());
  await page.evaluate(async () => {
    const { ws, components } = window.__pg;
    await ws.overlays.openLeftPanel(components.editor, {}, { title: 'Drawer' });
    ws.overlays.openModal(components.editor, {}, { title: 'Modal', size: 'medium' });
    ws.overlays.confirmDiscard({ title: 'the draft', dirtyOptions: { alert: 'Name is required', alertType: 'warning' } });
  });
  await page.waitForTimeout(400);
  await collect();
  await axe('modal + confirm + drawer');
  await shot('overlays');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.locator('[data-ndd-toolbar-item="shapes"]').click();
  await page.waitForTimeout(250);
  await collect();
  await axe('toolbar flyout');

  // ── live class sweep ──
  const openEnded = c => OPEN_ENDED_PREFIXES.some(p => c.startsWith(p));
  const unstyled = [...seen].filter(c => c.startsWith('ndd-') && !styled.has(c) && !CONSUMER_HOOKS.has(c) && !openEnded(c));
  for (const c of unstyled) fail(`classes: .${c} is rendered but no rule and no hook declares it`);
  return { rendered: seen.size, ticks: { idle, overTabs, overBody, dragging } };
});
