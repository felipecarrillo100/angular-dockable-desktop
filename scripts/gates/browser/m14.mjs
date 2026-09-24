/**
 * M14 browser gate — the demo, walked through end to end, under both schedulers.
 *
 * Ported from vdd's M14 walkthrough, step for step: open every panel type, drive widgets from
 * data by real gestures, dock, float, anchor, maximise, minimise, restore, raise the chrome,
 * close a dirty panel, switch locale and direction, paint every skin in both schemes, measure
 * the rail, save, reload, restore, load rdd's layout — and assert that nothing ever reached the
 * console.
 *
 * "No console errors throughout" is the part that earns its keep. The demo is the only place
 * the library meets Monaco, Leaflet, a markdown pipeline, six locales and every one of its own
 * components at once, and an integration failure shows up as a console error in an application
 * long before it shows up in a unit test. The harness arms the listener before navigation, so
 * an error during the reload fails too.
 */
import { runBrowserGate } from '../lib/browser.mjs';

/** Errors the demo's own third-party dependencies raise, which are not the library's. */
const IGNORE = [
  /Failed to load resource/, // a map tile that 404s, or a rate-limited or offline tile source
  /favicon/i,
  /ResizeObserver loop/, // benign, and browser-specific
];

await runBrowserGate('M14', { app: 'demo', viewport: { width: 1500, height: 950 }, handle: '__demo', readyTimeout: 60000, ignoreConsole: IGNORE }, async (page, { fail: rawFail, open, shot }) => {
  let step = 'startup';
  const fail = msg => rawFail(`[${step}] ${msg}`);
  const record = [];
  /**
   * `page.evaluate` has no timeout of its own, so a page stuck in a loop hung this gate with no
   * output at all — which is how the first run met the PanelRef effect loop. A stuck page is now
   * a named failure.
   */
  const drive = (fn, ...args) => Promise.race([
    page.evaluate(fn, ...args),
    new Promise((_, reject) => setTimeout(() => reject(new Error('the page stopped responding for 20s (a render or effect loop?)')), 20000)),
  ]);

  // An unexpected navigation is itself a failure: a <button> without type="button" in a form
  // submits and reloads, and the symptom is "Execution context was destroyed" in whatever ran
  // next. Recording navigations names the step instead.
  let expectNavigation = true;
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && !expectNavigation) fail('the page navigated unexpectedly (a form submitting?)');
  });

  const state = async () => {
    try {
      return await drive(() => {
        const ws = window.__demo?.workspace;
        if (!ws) return { unavailable: true };
        const s = ws.state();
        return {
          open: Object.keys(s.panels).sort(),
          active: s.activePanelId,
          floating: s.floating.map(w => w.id).sort(),
          minimized: s.minimized.map(m => m.id).sort(),
        };
      });
    } catch (error) {
      return { unreadable: error.message.split('\n')[0] };
    }
  };

  async function walk(name, fn, settle = 350) {
    step = name;
    try {
      await fn();
      await page.waitForTimeout(settle);
    } catch (error) {
      fail(error.message.split('\n')[0]);
    }
    record.push({ step: name, ...(await state()) });
  }

  await open();
  expectNavigation = false;
  // Monaco and Leaflet both finish asynchronously; the initial layout settles after them.
  await page.waitForTimeout(3500);

  // ── widgets opened from data keep a placement gesture ─────────────────────
  // vdd 1.0.0's defect (R1), driven as a user drives it: a real pointer drag of a widget opened
  // through injectFloatingWidgets() onto a real drop zone, and then another widget opening.
  const mapMarkers = page.locator('[data-ndd-slot="mainMap"] .leaflet-interactive');
  await walk('open two camera widgets from data', async () => {
    await drive(() => window.__demo.workspace.focusPanel('mainMap'));
    await page.waitForTimeout(400);
    await mapMarkers.nth(0).click({ timeout: 4000 }); // cam-north, seeded top-right
    await mapMarkers.nth(1).click({ timeout: 4000 }); // cam-east, seeded top-left
  }, 500);

  const cams = () => drive(() => [...document.querySelectorAll('[data-ndd-widget]')].map(el => el.getAttribute('data-ndd-widget')).filter(id => id.startsWith('cam-')));
  {
    const open2 = await cams();
    record.push({ step: 'camera widgets', open: open2 });
    if (open2.length < 2) fail(`expected two camera widgets, found ${open2.join(', ') || 'none'}`);
    const feeds = await drive(() => document.querySelector('[data-demo-feeds]')?.textContent?.trim());
    if (feeds !== '2/4 feeds') fail(`the status strip reads "${feeds}", not "2/4 feeds"`);
  }

  const insetsOf = id => drive(widgetId => {
    const el = document.querySelector(`[data-ndd-widget="${widgetId}"]`);
    if (!el) return { missing: true };
    return { start: el.style.insetInlineStart, end: el.style.insetInlineEnd, top: el.style.top, bottom: el.style.bottom };
  }, id);

  {
    const seeded = await insetsOf('cam-north');
    record.push({ step: 'cam-north seeded', ...seeded });
    if (seeded.end === '') fail(`cam-north should start at its seeded top-right corner, got ${JSON.stringify(seeded)}`);
  }

  await walk('drag a camera widget to the opposite corner', async () => {
    const header = await page.locator('[data-ndd-widget="cam-north"] [data-ndd-widget-header]').boundingBox();
    const root = await page.locator('[data-ndd-slot="mainMap"] [data-ndd-panel-overlay]').boundingBox();
    if (!header || !root) throw new Error('the widget header or the overlay root has no box');
    await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(root.x + 20, root.y + root.height - 20, { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
  }, 500);

  const dropped = await insetsOf('cam-north');
  record.push({ step: 'cam-north after drop', ...dropped });
  step = 'widget re-anchor';
  if (dropped.start === '' || dropped.end !== '') fail(`a dropped managed widget did not take the bottom-left corner: ${JSON.stringify(dropped)}`);
  if (dropped.bottom === '' || dropped.top !== '') fail(`a dropped managed widget kept its block edge: ${JSON.stringify(dropped)}`);

  await walk('open a third camera widget', async () => {
    await mapMarkers.nth(2).click({ timeout: 4000 });
  }, 500);
  {
    const after = await insetsOf('cam-north');
    record.push({ step: 'cam-north after another opens', ...after });
    if (after.start !== dropped.start || after.end !== dropped.end || after.bottom !== dropped.bottom) {
      fail(`another widget opening moved cam-north: ${JSON.stringify(dropped)} -> ${JSON.stringify(after)}`);
    }
  }
  await shot('01b-widget-reanchor');

  // Closing from the widget's own × runs the demo's write-back: the panel's camera list follows.
  await walk('close the camera widgets again', async () => {
    for (const id of ['cam-north', 'cam-east', 'cam-south']) {
      const close = page.locator(`[data-ndd-widget="${id}"] [data-ndd-widget-close]`);
      if (await close.count()) await close.first().click({ timeout: 4000 });
    }
  }, 400);
  {
    const left = await cams();
    if (left.length !== 0) fail(`${left.join(', ')} survived a close`);
    const feeds = await drive(() => document.querySelector('[data-demo-feeds]')?.textContent?.trim());
    if (feeds !== '0/4 feeds') fail(`after closing every widget the status strip reads "${feeds}" — the write-back did not reach the panel`);
  }

  // ── every panel type ──────────────────────────────────────────────────────
  const KINDS = await drive(() => window.__demo.workspace.registry.keys());
  record.push({ step: 'registry', kinds: KINDS });
  if (KINDS.length < 16) fail(`only ${KINDS.length} panel kinds registered, expected every demo panel`);

  await walk('open every panel kind', async () => {
    await drive(kinds => { for (const kind of kinds) window.__demo.workspace.openPanel(kind, kind); }, KINDS);
  }, 2500);
  {
    step = 'open every panel kind';
    const now = await state();
    for (const kind of KINDS) if (!now.open.includes(kind)) fail(`"${kind}" did not open`);
    const rendered = await drive(() => ({
      monaco: document.querySelectorAll('.monaco-editor').length,
      leaflet: document.querySelectorAll('.leaflet-container').length,
      markdown: document.querySelectorAll('[data-demo-md-preview] h1').length,
      katex: document.querySelectorAll('[data-demo-md-preview] .katex').length,
      highlighted: document.querySelectorAll('[data-demo-md-preview] .hljs').length,
      overlay: document.querySelectorAll('[data-ndd-panel-overlay]').length,
    }));
    record.push({ step: 'content rendered', ...rendered });
    if (rendered.monaco < 2) fail(`${rendered.monaco} Monaco editors rendered; the code and markdown panels each have one`);
    if (rendered.leaflet < 2) fail(`${rendered.leaflet} Leaflet maps rendered; expected the main map and the Leaflet panel`);
    if (rendered.markdown < 1) fail('the markdown preview rendered no heading');
    if (rendered.katex < 1) fail('the markdown preview rendered no KaTeX maths — the sanitiser, or the pipeline, dropped it');
    if (rendered.highlighted < 1) fail('the markdown preview rendered no highlighted code');
    if (rendered.overlay < 1) fail('no panel overlay rendered');
  }
  await shot('01-every-panel');

  // ── contributions follow the active panel ─────────────────────────────────
  await walk('the markdown panel contributes to the shell', async () => {
    await drive(() => window.__demo.workspace.focusPanel('markdownEditor'));
  }, 400);
  {
    const chrome = await drive(() => ({
      toolbar: [...document.querySelectorAll('[data-ndd-toolbar-item^="md-"]')].map(e => e.getAttribute('data-ndd-toolbar-item')),
      sidebar: [...document.querySelectorAll('[data-ndd-sidebar-tab]')].map(e => e.getAttribute('data-ndd-sidebar-tab')),
    }));
    record.push({ step: 'markdown contributions', ...chrome });
    if (chrome.toolbar.length !== 6) fail(`the shell toolbar shows ${chrome.toolbar.length} markdown actions, not 6`);
    if (!chrome.sidebar.includes('md-toc')) fail(`the sidebar has no contributed table of contents: ${chrome.sidebar}`);
  }
  await walk('focusing another panel withdraws them', async () => {
    await drive(() => window.__demo.workspace.focusPanel('control'));
  }, 400);
  {
    const left = await drive(() => document.querySelectorAll('[data-ndd-toolbar-item^="md-"]').length);
    if (left !== 0) fail(`${left} markdown actions are still in the shell toolbar with another panel active`);
  }

  // ── dock, split, float, anchor, maximise ──────────────────────────────────
  await walk('split the grid', async () => {
    await drive(() => {
      const ws = window.__demo.workspace;
      const root = ws.state().gridRoot;
      if (root.type === 'leaf') ws.dockPanelToGroup('table', root.id, 'right');
      ws.dockPanelToWorkspaceEdge('timeControl', 'bottom');
    });
  });
  await walk('float a panel', async () => {
    await drive(() => window.__demo.workspace.floatPanel('terminal', { x: 120, y: 120, width: 460, height: 300 }));
  });
  if (!(await state()).floating?.includes('terminal')) fail('terminal is not floating');
  await walk('anchor it to a corner', async () => {
    await drive(() => window.__demo.workspace.updateFloatingPosition('terminal', { anchor: 'bottom-right' }));
  });
  await walk('maximise and restore it', async () => {
    await drive(() => window.__demo.workspace.maximizePanel('terminal'));
    await page.waitForTimeout(250);
    await drive(() => window.__demo.workspace.maximizePanel('terminal'));
  });
  await shot('02-floating');

  // ── minimise and restore ──────────────────────────────────────────────────
  await walk('minimise three panels', async () => {
    await drive(() => { for (const id of ['preview', 'help', 'table']) window.__demo.workspace.minimizePanel(id); });
  });
  {
    const now = await state();
    for (const id of ['preview', 'help', 'table']) if (!now.minimized.includes(id)) fail(`${id} is not minimised`);
  }
  await walk('hover a taskbar icon for its live preview', async () => {
    const icon = page.locator('[data-ndd-taskbar-item="preview"]');
    if (!(await icon.count())) throw new Error('no taskbar item for the minimised preview panel');
    await icon.hover();
    await page.waitForTimeout(500);
    const preview = await drive(() => {
      const host = document.querySelector('.ndd-taskbar-item-preview-host');
      return { present: !!host, live: !!host?.querySelector('[data-demo-preview-seconds]') };
    });
    record.push({ step: 'preview', ...preview });
    // The thumbnail is the panel's own DOM, moved — not a screenshot.
    if (!preview.live) fail(`the taskbar preview does not host the live panel: ${JSON.stringify(preview)}`);
    await page.mouse.move(700, 400);
  });
  await walk('restore them', async () => {
    await drive(() => { for (const id of ['preview', 'help', 'table']) window.__demo.workspace.restorePanel(id); });
  });
  {
    const now = await state();
    if (now.minimized.length !== 0) fail(`${now.minimized.length} panel(s) still minimised`);
    if (now.active !== 'table') fail(`active is "${now.active}" after restoring table last`);
  }

  // ── the chrome ────────────────────────────────────────────────────────────
  await walk('open a drawer, a toast and a modal', async () => {
    await drive(() => window.__demo.workspace.focusPanel('control'));
    await page.waitForTimeout(250);
    await page.locator('[data-demo-cc-tab="overlays"]').first().click({ timeout: 4000 });
    await page.waitForTimeout(200);
    await page.locator('[data-demo-left-drawer]').first().click({ timeout: 4000 });
    await page.locator('[data-demo-toast]').first().click({ timeout: 4000 });
    // The modal goes last: its curtain covers the panel that opened it.
    await page.locator('[data-demo-modal]').first().click({ timeout: 4000 });
  });
  {
    const chrome = await drive(() => ({
      drawer: !!document.querySelector('[data-ndd-side-panel="left"]'),
      modal: document.querySelectorAll('.ndd-modal-overlay').length,
      toast: document.querySelectorAll('[data-ndd-toast]').length,
    }));
    record.push({ step: 'chrome', ...chrome });
    if (!chrome.drawer) fail('the left drawer did not open');
    if (chrome.modal < 1) fail('no modal opened');
    if (chrome.toast < 1) fail('no toast appeared');
  }

  // Text inside the library's own containers must be readable on the library's own background:
  // measured against each element's nearest opaque background, at WCAG AA's 4.5:1.
  {
    step = 'contrast inside library containers';
    const worst = await drive(() => {
      const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const lum = rgb => { const [r, g, b] = rgb.match(/[\d.]+/g).map(Number); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bgOf = el => {
        for (let e = el; e; e = e.parentElement) {
          const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g);
          if (m && (m[3] === undefined || Number(m[3]) > 0.5)) return getComputedStyle(e).backgroundColor;
        }
        return 'rgb(255, 255, 255)';
      };
      const out = [];
      for (const host of document.querySelectorAll('.ndd-side-panel, .ndd-modal-window')) {
        let low = null;
        for (const el of host.querySelectorAll('*')) {
          const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
          if (text.length < 3) continue;
          const cs = getComputedStyle(el);
          const r = ratio(cs.color, bgOf(el));
          if (!low || r < low.r) low = { r, color: cs.color, bg: bgOf(el), text: text.slice(0, 24) };
        }
        out.push({ container: host.className.toString().split(' ')[0], ...(low ?? { r: null }) });
      }
      return out;
    });
    record.push({ step, worst });
    if (worst.length < 2) fail(`measured ${worst.length} containers; expected the drawer and the modal`);
    for (const c of worst) if (c.r !== null && c.r < 4.5) fail(`${c.container}: "${c.text}" is ${c.r.toFixed(2)}:1 (${c.color} on ${c.bg})`);
  }
  await shot('03-chrome');

  await walk('dismiss them with Escape', async () => {
    await page.keyboard.press('Escape'); // the modal
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape'); // then the drawer
  });
  {
    const chrome = await drive(() => ({ drawer: !!document.querySelector('[data-ndd-side-panel="left"]'), modal: document.querySelectorAll('.ndd-modal-overlay').length }));
    if (chrome.modal !== 0) fail('Escape did not close the modal');
    if (chrome.drawer) fail('the second Escape did not close the drawer');
  }

  // ── dirty state, end to end ───────────────────────────────────────────────
  await walk('a dirty panel asks before closing', async () => {
    await drive(() => window.__demo.workspace.focusPanel('dirtyForm'));
    await page.waitForTimeout(250);
    await page.locator('[data-demo-dirty]').first().click({ timeout: 4000 });
    await page.waitForTimeout(200);
    // `void`: the promise settles only when the question is answered, and the gate answers it.
    await drive(() => { void window.__demo.workspace.requestClosePanel('dirtyForm'); });
  });
  {
    const asked = await drive(() => ({ modal: document.querySelectorAll('.ndd-modal-overlay').length, stillOpen: 'dirtyForm' in window.__demo.workspace.state().panels }));
    record.push({ step: 'dirty close', ...asked });
    if (asked.modal !== 1) fail('closing a dirty panel did not ask');
    if (!asked.stillOpen) fail('the panel closed before the question was answered');
  }
  await walk('answering "Cancel" keeps it open', async () => {
    await page.locator('[data-ndd-confirm-cancel]').first().click({ timeout: 4000 });
  });
  if (!(await drive(() => 'dirtyForm' in window.__demo.workspace.state().panels))) fail('the panel closed even though the question was refused');

  // ── locale and direction ──────────────────────────────────────────────────
  await walk('switch to Arabic, which is read right-to-left', async () => {
    await page.selectOption('[data-demo-locale]', 'ar');
  });
  {
    const rtl = await drive(() => ({ dir: window.__demo.workspace.dir(), tooltip: document.querySelector('[data-ndd-close]')?.getAttribute('title') ?? '' }));
    record.push({ step: 'rtl', ...rtl });
    if (rtl.dir !== 'rtl') fail(`direction is "${rtl.dir}" after choosing Arabic`);
    if (!/إغلاق/.test(rtl.tooltip)) fail(`a tab's close tooltip is "${rtl.tooltip}", not the Arabic string`);
  }
  await shot('04-rtl');
  await walk('back to English', async () => {
    await page.selectOption('[data-demo-locale]', 'en');
  });
  if ((await drive(() => window.__demo.workspace.dir())) !== 'ltr') fail('choosing English did not restore LTR');

  // ── every skin, in both colour schemes ────────────────────────────────────
  // What the feature promises, measured: each skin looks different from the default, and every
  // skin's surfaces change between dark and light.
  const SKINS = ['vscode', 'macos', 'chrome', 'slate', 'nord', 'obsidian', 'tokyo', 'mono'];
  const SURFACES = {
    panel: ['.ndd-workspace-panel', 'backgroundColor'],
    tabBar: ['.ndd-workspace-tab-bar', 'backgroundColor'],
    activeTab: ['.ndd-workspace-tab.ndd-active', 'backgroundColor'],
    activeTabText: ['.ndd-workspace-tab.ndd-active', 'color'],
  };
  const surfaces = () => drive(spec => {
    const out = {};
    for (const [name, [sel, prop]] of Object.entries(spec)) {
      const el = document.querySelector(sel);
      out[name] = el ? getComputedStyle(el)[prop] : null;
    }
    return out;
  }, SURFACES);
  const setScheme = async want => {
    const now = await drive(() => (document.documentElement.getAttribute('data-color-scheme') === 'light' ? 'light' : 'dark'));
    if (now !== want) {
      await page.locator('[data-demo-theme]').first().click({ timeout: 4000 });
      await page.waitForTimeout(350);
    }
  };

  const painted = {};
  for (const skin of SKINS) {
    step = `skin ${skin}`;
    let dark, light;
    try {
      await page.selectOption('[data-demo-skin]', skin, { timeout: 4000 });
      await setScheme('dark');
      await page.waitForTimeout(250);
      dark = await surfaces();
      await setScheme('light');
      await page.waitForTimeout(250);
      light = await surfaces();
    } catch (error) {
      fail(error.message.split('\n')[0]);
      continue;
    }
    painted[skin] = { dark, light };
    record.push({ step, dark, light });
    for (const name of Object.keys(SURFACES)) {
      if (dark[name] === null) { fail(`${name} is not rendered, so nothing was measured`); continue; }
      if (dark[name] === light[name]) fail(`${name} is ${dark[name]} in both schemes — the skin's own tokens are shadowing the light ones`);
    }
    await setScheme('dark');
  }
  step = 'skins';
  for (const skin of SKINS.filter(s => s !== 'vscode')) {
    if (Object.keys(SURFACES).every(n => painted[skin]?.dark[n] === painted.vscode?.dark[n])) fail(`"${skin}" paints identically to vscode — its rules are not matching`);
  }

  // ── the chrome *outside* the workspace follows the scheme too ─────────────
  await page.selectOption('[data-demo-skin]', 'vscode');
  await walk('open a sidebar tab, for the drawer', async () => {
    await page.locator('.ndd-sidebar-tab-btn:not(.ndd-sidebar-header-action-btn)').first().click({ timeout: 4000 });
  }, 600);
  {
    const active = await drive(() => document.querySelectorAll('.ndd-sidebar-tab-btn.ndd-active').length);
    if (active !== 1) fail(`${active} rail buttons are active after clicking a tab, expected 1`);
  }
  const OUTSIDE = {
    sidebarRail: '.ndd-sidebar-tabs-strip',
    sidebarDrawer: '.ndd-sidebar-content-drawer',
    drawerHeader: '.ndd-sidebar-drawer-header',
    toolbar: '.ndd-toolbar-strip',
  };
  const outside = () => drive(spec => {
    const out = {};
    for (const [name, sel] of Object.entries(spec)) {
      const el = document.querySelector(sel);
      out[name] = el ? { bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color } : null;
    }
    return out;
  }, OUTSIDE);
  {
    step = 'chrome outside the workspace';
    await setScheme('dark');
    await page.waitForTimeout(300);
    const dark = await outside();
    await setScheme('light');
    await page.waitForTimeout(300);
    const light = await outside();
    record.push({ step, dark, light });
    const transparent = value => /rgba\([^)]*,\s*0\s*\)/.test(value);
    const OPAQUE = ['sidebarRail', 'sidebarDrawer', 'toolbar'];
    for (const name of Object.keys(OUTSIDE)) {
      if (!dark[name]) { fail(`${name} (${OUTSIDE[name]}) is not rendered, so nothing was measured`); continue; }
      if (OPAQUE.includes(name)) {
        for (const [scheme, seen] of [['dark', dark[name]], ['light', light[name]]]) if (transparent(seen.bg)) fail(`${name} has no background in ${scheme} mode (${seen.bg})`);
      }
      if (dark[name].bg === light[name].bg && dark[name].color === light[name].color) fail(`${name} is unchanged between schemes (bg ${dark[name].bg}, color ${dark[name].color})`);
    }
    await setScheme('dark');
  }

  // ── the rail's geometry ───────────────────────────────────────────────────
  // The rail fills its column, and a lone active tab (the secondary rail has exactly one) keeps
  // the size of an inactive one.
  {
    step = 'rail geometry';
    await page.locator('.ndd-sidebar-tabs-strip.ndd-right .ndd-sidebar-tab-btn').first().click({ timeout: 4000 }).catch(error => fail(error.message.split('\n')[0]));
    await page.waitForTimeout(500);
    const geometry = await drive(() => [...document.querySelectorAll('.ndd-sidebar-strip-outer')].map(outer => {
      const strip = outer.querySelector('.ndd-sidebar-tabs-strip');
      const list = strip?.querySelector('.ndd-sidebar-tabs-list');
      const active = list?.querySelector('.ndd-sidebar-tab-btn.ndd-active');
      const inactive = list?.querySelector('.ndd-sidebar-tab-btn:not(.ndd-active)');
      const w = el => (el ? Math.round(el.getBoundingClientRect().width) : null);
      const h = el => (el ? Math.round(el.getBoundingClientRect().height) : null);
      return {
        side: strip?.classList.contains('ndd-right') ? 'right' : 'left',
        columnHeight: h(outer), stripHeight: h(strip),
        tabs: list ? list.querySelectorAll('.ndd-sidebar-tab-btn').length : 0,
        activeWidth: w(active), inactiveWidth: w(inactive),
      };
    }));
    record.push({ step, rails: geometry });
    if (geometry.length !== 2) fail(`measured ${geometry.length} rails; the demo has two`);
    if (!geometry.some(r => r.side === 'right' && r.activeWidth !== null)) fail('the secondary rail has no active tab to measure');
    for (const rail of geometry) {
      if (rail.stripHeight === null) { fail(`the ${rail.side} rail has no strip to measure`); continue; }
      if (Math.abs(rail.columnHeight - rail.stripHeight) > 1) fail(`the ${rail.side} rail is ${rail.stripHeight}px tall in a ${rail.columnHeight}px column`);
      if (rail.activeWidth !== null && rail.activeWidth < 44) fail(`the ${rail.side} rail's active tab is ${rail.activeWidth}px wide with ${rail.tabs} tab(s)`);
      if (rail.activeWidth !== null && rail.inactiveWidth !== null && Math.abs(rail.activeWidth - rail.inactiveWidth) > 1) fail(`the ${rail.side} rail's active tab is ${rail.activeWidth}px and an inactive one ${rail.inactiveWidth}px`);
    }
    // Close both drawers again: an open drawer covers part of the workspace.
    await page.locator('.ndd-sidebar-tabs-strip.ndd-right .ndd-sidebar-tab-btn').first().click({ timeout: 4000 }).catch(() => undefined);
    await drive(() => window.__demo.shell.openTab.set(null));
    await page.waitForTimeout(400);
  }

  await setScheme('light');
  if ((await drive(() => document.documentElement.getAttribute('data-color-scheme'))) !== 'light') fail('data-color-scheme is not "light" after toggling');
  await shot('05-light');
  await walk('back to dark', async () => setScheme('dark'));

  // ── save, reload, restore ─────────────────────────────────────────────────
  await walk('type into the notes panel', async () => {
    await drive(() => window.__demo.workspace.focusPanel('dirtyEditor'));
    await page.waitForTimeout(250);
    await page.locator('[data-demo-editor]').first().fill('# Notes\n\nwritten by the M14 walkthrough\n');
  });
  await walk('save the layout', async () => {
    await drive(() => window.__demo.workspace.focusPanel('control'));
    await page.waitForTimeout(250);
    await page.locator('[data-demo-cc-tab="layout"]').first().click({ timeout: 4000 });
    await page.waitForTimeout(200);
    await page.locator('[data-demo-save-layout]').first().click({ timeout: 4000 });
  });
  const saved = await drive(() => localStorage.getItem('ndd-demo-layout'));
  if (!saved) fail('nothing was written to localStorage');
  // A restore reproduces the *saved payload*, not an earlier snapshot.
  const before = JSON.parse(saved ?? '{}');
  const expected = { open: Object.keys(before.panels ?? {}).sort(), active: before.activePanelId ?? null, floating: (before.floating ?? []).map(w => w.id).sort() };
  record.push({ step: 'saved', bytes: saved?.length ?? 0, ...expected });

  step = 'reload';
  expectNavigation = true;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__demo?.ready === true, null, { timeout: 60000 });
  expectNavigation = false;
  await page.waitForTimeout(3500);
  record.push({ step: 'after reload', ...(await state()) });

  await walk('restore the saved layout', async () => {
    await page.locator('[data-demo-cc-tab="layout"]').first().click({ timeout: 4000 });
    await page.waitForTimeout(200);
    await page.locator('[data-demo-restore-layout]').first().click({ timeout: 4000 });
  }, 2500);
  {
    step = 'restore';
    const after = await state();
    record.push({ step: 'restored', ...after });
    const missing = expected.open.filter(id => !after.open.includes(id));
    if (missing.length) fail(`these panels did not come back: ${missing.join(', ')}`);
    if (after.floating.join() !== expected.floating.join()) fail(`the layout recorded floating [${expected.floating}] and restored [${after.floating}]`);
    if (after.active !== expected.active) fail(`the layout recorded active "${expected.active}" and restored "${after.active}"`);

    const visible = await drive(() => {
      const s = window.__demo.workspace.state();
      const id = s.activePanelId;
      if (!id) return { ok: false, why: 'no active panel' };
      const panel = s.panels[id];
      if (!panel) return { ok: false, why: 'active panel is not open' };
      if (panel.state === 'minimized') return { ok: false, why: 'active panel is minimised' };
      const find = node => (node.type === 'leaf' ? (node.panels.includes(id) ? node : null) : node.children.map(find).find(Boolean) ?? null);
      if (panel.state === 'docked') {
        const leaf = find(s.gridRoot);
        if (!leaf) return { ok: false, why: 'active panel is in no leaf' };
        if (leaf.activePanelId !== id) return { ok: false, why: 'active panel is a background tab' };
      }
      return { ok: true, id, state: panel.state };
    });
    record.push({ step: 'active is visible', ...visible });
    if (!visible.ok) fail(`activePanelId names something the user cannot see: ${visible.why}`);

    // The panel that contributed its own state saved it, and got it back.
    const notesSaved = before.panels?.dirtyEditor?.props?.content;
    if (typeof notesSaved !== 'string' || !notesSaved.includes('M14 walkthrough')) fail(`the notes panel did not contribute its content to the saved layout: ${JSON.stringify(before.panels?.dirtyEditor?.props)}`);
    await drive(() => window.__demo.workspace.focusPanel('dirtyEditor'));
    await page.waitForTimeout(300);
    const notesNow = await drive(() => document.querySelector('[data-demo-editor]')?.value ?? null);
    if (!notesNow?.includes('M14 walkthrough')) fail(`after reload and restore the notes panel shows ${JSON.stringify(notesNow)}`);
  }
  await shot('06-restored');

  // ── the layout the *other* libraries wrote ────────────────────────────────
  await walk('load a layout saved by react-dockable-desktop', async () => {
    const rdd = JSON.stringify({
      version: 2,
      gridRoot: {
        type: 'branch', orientation: 'horizontal', sizes: [0.6, 0.4],
        children: [
          { type: 'leaf', id: 'rdd-left', panels: ['editor', 'terminal'], activePanelId: 'terminal' },
          { type: 'leaf', id: 'rdd-right', panels: ['help'], activePanelId: 'help' },
        ],
      },
      floating: [],
      minimized: [],
      activePanelId: 'terminal',
      panels: {
        editor: { id: 'editor', title: 'Code Editor', component: 'editor', state: 'docked', serializable: true },
        terminal: { id: 'terminal', title: 'Terminal', component: 'terminal', state: 'docked', serializable: true },
        help: { id: 'help', title: 'Help', component: 'help', state: 'docked', serializable: true },
      },
    });
    await drive(json => window.__demo.workspace.loadLayout(json), rdd);
  }, 1200);
  {
    step = 'rdd layout';
    const after = await state();
    record.push({ step: 'rdd layout', ...after });
    if (after.open.join() !== 'editor,help,terminal') fail(`open panels are [${after.open}], expected the three the layout names`);
    if (after.active !== 'terminal') fail(`active is "${after.active}", not the layout's own`);
  }
  await shot('07-rdd-layout');

  // ── the panels that were moved through all of that are still alive ────────
  {
    step = 'survival';
    const alive = await drive(() => ({
      monaco: document.querySelectorAll('.monaco-editor').length,
      terminalLines: document.querySelector('[data-demo-terminal] pre')?.textContent?.split('\n').length ?? 0,
    }));
    record.push({ step, ...alive });
    if (alive.monaco < 1) fail('no Monaco editor survived the walkthrough');
    // The terminal appends a line every 1.2s; a re-created panel would show only its first three.
    if (alive.terminalLines <= 3) fail(`the terminal shows ${alive.terminalLines} lines — it was re-created rather than moved`);
  }

  return { record };
});
