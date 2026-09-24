/**
 * M13 coexistence gate — the library's chrome is unchanged by the styling frameworks consumers
 * actually load (D6: the library styles only its own `ndd-` DOM and depends on nobody's reset).
 *
 * The playground (`?chrome`: sidebar, toolbar, desktop) is put in a fixed state — a split with
 * tabs, a floating window, a minimised panel, the context menu, a modal, a toast — and a set of
 * computed properties is recorded for every piece of chrome. Then the page is reloaded with each
 * framework's stylesheet added *after* the library's (the worst order), the same state rebuilt,
 * and every property must be identical:
 *
 *   Bootstrap 5        a full reset plus element styles for button, h4, p, label, input…
 *   Tailwind preflight `*, ::before, ::after { margin: 0; padding: 0; border: 0 solid; box-sizing }`
 *   Angular Material   a prebuilt theme (typography and colour tokens)
 *
 * `--control`: add a leaking rule of our own (`button { padding: 11px }`), which must be caught.
 */
import { join } from 'node:path';
import { ROOT } from '../lib/config.mjs';
import { runBrowserGate } from '../lib/browser.mjs';

const control = process.argv.includes('--control');
const FRAMEWORKS = {
  bootstrap: join(ROOT, 'node_modules/bootstrap/dist/css/bootstrap.min.css'),
  tailwind: join(ROOT, 'node_modules/tailwindcss/preflight.css'),
  material: join(ROOT, 'node_modules/@angular/material/prebuilt-themes/azure-blue.css'),
};
const PROPS = ['box-sizing', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom',
  'border-top-width', 'border-bottom-width', 'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'display', 'text-transform', 'letter-spacing'];
const CHROME = [
  '.ndd-sidebar-tab-btn', '.ndd-sidebar-content-drawer', '.ndd-sidebar-drawer-header', '.ndd-toolbar-strip', '.ndd-toolbar-btn',
  '.ndd-workspace-tab-bar', '.ndd-workspace-tab', '.ndd-close-tab-x', '.ndd-panel-body',
  '.ndd-floating-window', '.ndd-floating-window-titlebar', '.ndd-floating-window-title', '.ndd-custom-tab-btn',
  '.ndd-taskbar-footer-container', '.ndd-taskbar-glassmorphic-item',
  '.ndd-context-menu', '.ndd-context-menu__item', '.ndd-context-menu__label',
  '.ndd-modal-window', '.ndd-modal-header', '.ndd-modal-title', '.ndd-modal-close-button', '.ndd-confirmation-message', '.ndd-btn',
  '.ndd-toast', '.ndd-toast__body', '.ndd-toast__close',
];

/** Containers of consumer content: their box is chrome, their typography is the content's. */
const CONTENT = new Set(['.ndd-sidebar-content-drawer', '.ndd-panel-body']);
const TYPE = new Set(['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'text-transform', 'letter-spacing']);

const measure = page => page.evaluate(([selectors, props]) => {
  const out = {};
  for (const sel of selectors) {
    // The last match: for the modal classes that is the library's own confirm dialog, whose
    // content is chrome, rather than the modal holding a consumer panel.
    const all = document.querySelectorAll(sel);
    const el = all[all.length - 1];
    if (!el) { out[sel] = null; continue; }
    const cs = getComputedStyle(el);
    out[sel] = Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)]));
  }
  return out;
}, [CHROME, PROPS]);

/** The same state every time: split + tabs, a floating window, a minimised panel, menu, modal, toast. */
async function buildState(page) {
  await page.evaluate(() => {
    const { ws, toast, components } = window.__pg;
    ws.openPanel('a', 'hostile');
    ws.openPanel('b', 'hostile');
    ws.dockPanelToGroup('b', ws.state().gridRoot.id, 'right');
    ws.openPanel('c', 'hostile', { initialTarget: 'floating' });
    ws.openPanel('m', 'hostile');
    ws.minimizePanel('m');
    window.__pg.chrome.primaryTab.set('files');
    toast.info('Coexistence', { id: 'coexist', duration: 0 });
    ws.overlays.openModal(components.hostile, {}, { title: 'Modal', size: 'medium' });
    ws.overlays.confirmDiscard({ title: 'X' });
    ws.showContextMenu({ x: 300, y: 300, items: [{ label: 'One' }, { label: 'Two' }] });
  });
  await page.waitForTimeout(700);
  await page.evaluate(async () => Promise.all(document.getAnimations().map(a => a.finish?.())));
}

await runBrowserGate(control ? 'M13-coexist-control' : 'M13-coexist', {}, async (page, { fail, open, shot }) => {
  await open('chrome');
  await buildState(page);
  const baseline = await measure(page);
  for (const [sel, v] of Object.entries(baseline)) if (!v) fail(`baseline: nothing matches ${sel} — the state is not being built`);
  await shot('baseline');

  for (const [name, path] of Object.entries(FRAMEWORKS)) {
    await open('chrome');
    await page.addStyleTag({ path });
    if (control) await page.addStyleTag({ content: 'button { padding: 11px !important; }' });
    await buildState(page);
    const with_ = await measure(page);
    const diffs = [];
    for (const sel of CHROME) {
      const a = baseline[sel];
      const b = with_[sel];
      if (!a || !b) continue;
      for (const p of PROPS) if (!(CONTENT.has(sel) && TYPE.has(p)) && a[p] !== b[p]) diffs.push(`${sel} ${p}: ${a[p]} → ${b[p]}`);
    }
    await shot(name);
    if (diffs.length) fail(`${name} changes the chrome (${diffs.length}):\n      ${diffs.join('\n      ')}`);
  }
});
