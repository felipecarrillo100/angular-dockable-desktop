/**
 * M19 browser gate — pop-out windows (1.12.0), in real Chrome: a panel moves into a real child
 * window and back. The port of react-dockable-desktop 7.12.1's `popout.browser.ts`, by way of
 * vue-dockable-desktop 1.14.0's M18 browser gate; this is the stage P2 part (panels), which later
 * stages extend. Every case runs zoneless and with `?zone`, as the harness does.
 *
 * The panel's element is marked with a JS property, so "the same element" means the very node; the
 * WebGL context stands in for a map's. Playground `?po=1`: panel `pp` (canPopOut) a tab in p1's
 * group, and the bar's #po-btn calls workspace.popOutPanel('pp') inside a real click.
 *
 *   out and back     docked → popped out → "Return to desktop": the same node, counter, scroll and
 *                    WebGL context; a click works in the child; back in its group
 *   closed           floating → popped out → the user closes the child: back floating, the same node
 *   popoutUrl        `?pourl=1`: the app's page opens, and the panel moves in once it has loaded
 *   neighbours       two neighbours out at once, back in both orders: the grid is the original
 *   blocked          a blocked pop-up: the menu item shows a toast and the panel stays
 *   from a pop-out   (rdd 7.12.1) a button inside pp's window pops pq out: after 5.5 s without
 *                    touching the page (Playwright's own activation), the new window's opener is pp's
 *   events           the four events in order, with the element's document and size at each, blank
 *                    and with popoutUrl
 *   styles           (P3, rdd S3) under the nord skin, dark and light: the frame stays hidden until the
 *                    copied stylesheets are ready, then the frame's and a panel element's computed
 *                    background, colour, --ndd-accent-color and font equal the page workspace's,
 *                    through a scheme switch (on <html>) and a skin switch (`__pg.skin` → tokyo, the
 *                    frame's data-ndd-skin checked); a <style> added to the page later applies there
 *   wrapper          (P4, rdd S4 + next.1) `?rc=1`: a runtime CSS-in-JS stand-in (one cache per
 *                    document, rules added with insertRule, so the head copy carries its <style>
 *                    empty) and the app's popoutWrapper: the frame's icon, a menu item's icon opened
 *                    in the pop-out and a toast's icon raised from a click there (it shows there, not
 *                    in the page) are 16 x 16 and red in the window; the panel's content is styled
 *                    there and after the return; nothing is re-created; each window's rules are in
 *                    its own <style>, through insertRule only
 *   title icon       (rdd 7.12.2) `?poico=1`: an icon that takes its size from its box stays in the
 *                    frame's 14 x 14 box, the header is one line and the panel gets the rest of the
 *                    window, and the icon fills the box (an svg is drawn at 14 x 14, as in a tab);
 *                    `?wo=1&poico=1` the same in a floating window's title; `?wo=1&rc=1`: a 16 x 16
 *                    component icon keeps its size, unsqueezed, in the 14 x 14 box of a floating
 *                    window's title and a widget's frame (ndd's divergence from rdd's scale-to-fit)
 *   return button    (P4) the frame's button looks like a floating window's title-bar button (default
 *                    skin and nord, dark and light); its label is the tooltip and the name; an icon,
 *                    no text; data-ndd-popout-kind="panel" on the frame
 *   zone             (the P2b spike) a plain field written in the popped-out panel renders: from a
 *                    template listener under both schedulers, and, in `?zone`, from a listener the
 *                    panel adds on its own document (the pop-out's), which runs in the Angular zone
 *                    only because the window is given zone.js's EventTarget patch
 *
 *   widget           (P5, rdd S5) `?wo=1`: the managed widget `wo` (in the overlay panel `ov`) into its
 *                    own window from a click in the page, and back, by closing the window and by its
 *                    "Back into the panel" button: the same node, count, input and WebGL context; one
 *                    onWillMove / onMoved pair each way, onMoved at the window's size and then at the
 *                    panel's; data-ndd-popout-kind="widget"
 *   widget menu      (P5, rdd S7) the frame's title icon opens the widget's titleMenu in the window, by
 *                    Enter and by a click, and the menu stays open; its item puts the widget back
 *   widget from owner (P5, rdd 7.12.1) `?opo=1`: the owner panel in its own window, a click there pops
 *                    the widget out: after 5.5 s without touching the page, the new window's opener is
 *                    the owner's window, and it opens on that window's screen, over the widget's frame
 *
 *   focus across     (P6, rdd S6) a click and a focus inside pp's window activate pp, and its frame carries
 *                    data-ndd-focused; Escape both ways (a menu in the window stays through the page's
 *                    Escape and closes on its own, and the reverse); the taskbar's entry for pp (label,
 *                    the marker in its corner), whose click calls the window's focus() once and
 *                    activates pp; gone on return
 *   focusPanelWindow (P6) the window's and the page's focus() counts, the active panel, focusPanel on
 *                    the popped-out panel, an unknown id; with rdd's recipe that stubs the pop-out's
 *                    document.hasFocus, a toast raised from the page lands in the page; without it, in
 *                    the pop-out
 *
 *   M19_CASES=events,zone node scripts/gates/browser/m19.mjs    only those cases (while working)
 */
import { runBrowserGate } from '../lib/browser.mjs';

const only = process.env.M19_CASES?.split(',');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wait = ms => new Promise(r => setTimeout(r, ms));
const has = (got, want) => Object.entries(want).every(([k, v]) => got?.[k] === v);

await runBrowserGate('M19', { viewport: { width: 1400, height: 900 }, readyTimeout: 60000 }, async (page, { fail, open, sched, context }) => {
  page.setDefaultTimeout(15000);
  const report = {};
  /** Errors in the pop-outs (the harness watches the page's own). */
  const popupErrors = [];
  context.on('page', p => {
    p.on('pageerror', e => popupErrors.push(`pop-out: ${e.message}`));
    p.on('console', m => {
      if (m.type() === 'error') popupErrors.push(`pop-out console: ${m.text()}`);
    });
  });
  const check = (step, cond, msg) => {
    if (!cond) fail(`${step}: ${msg}`);
  };
  const noPopupErrors = step => {
    check(step, popupErrors.length === 0, `errors: ${popupErrors.splice(0).join('; ')}`);
  };

  /** The playground with `query`, once its pop-out panel is shown. */
  const openApp = async query => {
    await open(query);
    // In the document, not necessarily shown: with `po2=1` the newer tab pq is the selected one.
    await page.waitForSelector('[data-ndd-panel="pp"] #po-fill', { state: 'attached' });
    await wait(300);
  };
  const state = path => page.evaluate(p => p.split('.').reduce((o, k) => o?.[k], window.__pg.ws.state()), path);
  /** Closes every pop-out still open, so the next case starts clean. */
  const closePopups = async () => {
    for (const p of context.pages()) if (p !== page && !p.isClosed()) await p.close();
  };

  /** Clicks #po-btn (a user gesture) and returns the window that opened. */
  const popOutByClick = async () => {
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#po-btn')]);
    await popup.waitForLoadState();
    await popup.waitForSelector('[data-ndd-panel="pp"] #po-fill');
    // Zoneless, Angular renders on its scheduler's next frame or timer, not inside the event.
    await wait(300);
    return popup;
  };

  /** What must survive, read in the document the panel is in now (the opener's globals hold the GL context). */
  const snapshot = p =>
    p.evaluate(() => {
      const el = document.querySelector('[data-ndd-panel="pp"]');
      const main = window.opener ?? window;
      return {
        here: !!el,
        same: el?.__mark === 'original',
        count: document.getElementById('po-count')?.textContent,
        scroll: document.getElementById('po-sc')?.scrollTop,
        glAlive: !!main.__poGl && !main.__poGl.isContextLost() && main.__poLost === 0,
        mounts: main.__poMounts,
        inFrame: !!el?.closest('.ndd-popout-frame'),
        // The panel fills its slot: in the window, without the stylesheet, too.
        fills: (document.getElementById('po-fill')?.offsetHeight ?? 0) > 150,
      };
    });
  const kept = { here: true, same: true, count: '2', scroll: 300, glAlive: true, mounts: 1, fills: true };

  const prepare = async () => {
    await page.evaluate(() => {
      document.querySelector('[data-ndd-panel="pp"]').__mark = 'original';
    });
    await page.click('#po-inc');
    await page.click('#po-inc');
    await page.evaluate(() => {
      document.getElementById('po-sc').scrollTop = 300;
    });
    await wait(200);
  };

  /** The grid's shape: panels per group and sizes (rounded), without the generated group ids. */
  const gridShape = () =>
    page.evaluate(() => {
      const shape = n =>
        n.type === 'leaf'
          ? n.panels.filter(Boolean)
          : { o: n.orientation, sizes: n.sizes.map(x => Math.round(x * 1000) / 1000), c: n.children.map(shape) };
      return shape(JSON.parse(JSON.stringify(window.__pg.ws.state().gridRoot)));
    });
  const leafOf = id => page.evaluate(i => document.querySelector(`[data-ndd-tab="${i}"]`)?.getAttribute('data-ndd-tab-leaf') ?? null, id);

  async function outAndBack() {
    const step = 'out and back';
    await openApp('po=1');
    const group = await leafOf('pp');
    check(step, group !== null, 'pp has no tab in a group');
    await prepare();
    const popup = await popOutByClick();
    const result = await page.evaluate(() => window.__pg.popOutResult());
    check(step, same(result, { ok: true }), `popOutPanel returned ${JSON.stringify(result)}`);
    const out = await snapshot(popup);
    report[`${step}: out`] = out;
    check(step, has(out, { ...kept, inFrame: true }), `in the window: ${JSON.stringify(out)}`);
    check(step, (await popup.title()) === 'Pop', `the window's title is "${await popup.title()}"`);
    check(step, (await page.$('[data-ndd-panel="pp"]')) === null, "the panel's element is still in the main page");
    check(step, (await page.$('[data-ndd-window="pp"]')) === null, 'the page still draws a floating window for it');
    check(step, (await state('panels.pp.poppedOut')) === true, 'the store does not say poppedOut');
    // It works in the child: a click there updates the panel.
    await popup.click('#po-inc');
    await wait(200);
    check(step, (await popup.textContent('#po-count')) === '3', 'a click in the window does not reach the panel');
    await Promise.all([popup.waitForEvent('close'), popup.click('.ndd-popout-frame__return')]);
    await wait(300);
    const backHome = await snapshot(page);
    report[`${step}: back`] = backHome;
    check(step, has(backHome, { ...kept, count: '3', inFrame: false }), `back on the page: ${JSON.stringify(backHome)}`);
    check(step, (await state('panels.pp.state')) === 'docked', 'not docked after its return');
    check(step, (await leafOf('pp')) === group, 'not back in its own group');
    noPopupErrors(step);
  }

  async function closedByUser() {
    const step = 'closed';
    await openApp('po=1');
    await page.evaluate(() => window.__pg.ws.floatPanel('pp'));
    await wait(300);
    await prepare();
    const popup = await popOutByClick();
    check(step, has(await snapshot(popup), { ...kept, inFrame: true }), 'the panel is not in the window, as it was');
    await popup.close();
    await page.waitForSelector('[data-ndd-window="pp"]');
    await wait(300);
    const backHome = await snapshot(page);
    report[step] = backHome;
    check(step, has(backHome, { ...kept, inFrame: false }), `back on the page: ${JSON.stringify(backHome)}`);
    check(step, (await state('panels.pp.state')) === 'floating', 'not floating after the window closed');
    check(step, (await state('panels.pp.poppedOut')) === undefined, 'still flagged poppedOut');
    noPopupErrors(step);
  }

  async function withPopoutUrl() {
    const step = 'popoutUrl';
    await openApp('po=1&pourl=1');
    await prepare();
    const popup = await popOutByClick();
    check(step, new URL(popup.url()).pathname === '/popout.html', `the window shows ${popup.url()}`);
    check(step, has(await snapshot(popup), { ...kept, inFrame: true }), 'the panel is not in the window, as it was');
    await Promise.all([popup.waitForEvent('close'), popup.click('.ndd-popout-frame__return')]);
    await wait(300);
    check(step, has(await snapshot(page), { ...kept, inFrame: false }), 'not back on the page as it was');
    noPopupErrors(step);
  }

  async function neighbours() {
    for (const order of [['pp', 'pq'], ['pq', 'pp']]) {
      const step = `neighbours ${order.join(' then ')}`;
      await openApp('po=1&po2=1');
      // [p1 | [pp / pq]]: pp and pq the two sides of one split, at the workspace's edge.
      await page.evaluate(() => window.__pg.ws.dockPanelToWorkspaceEdge('pp', 'right'));
      await wait(300);
      const ppLeaf = await leafOf('pp');
      await page.evaluate(l => window.__pg.ws.dockPanelToGroup('pq', l, 'bottom'), ppLeaf);
      await wait(300);
      const before = await gridShape();
      report[`${step}: before`] = before;
      const right = before?.c?.[1];
      check(step, right?.o === 'vertical' && same(right.c, [['pp'], ['pq']]), `pp and pq are not one split at the edge: ${JSON.stringify(before)}`);

      const [first] = await Promise.all([page.waitForEvent('popup'), page.click('#po-btn')]);
      const [second] = await Promise.all([page.waitForEvent('popup'), page.click('#po-btn-q')]);
      await first.waitForSelector('[data-ndd-panel="pp"]');
      await second.waitForSelector('[data-ndd-panel="pq"]');
      const windows = { pp: first, pq: second };
      for (const id of order) {
        await Promise.all([windows[id].waitForEvent('close'), windows[id].click('.ndd-popout-frame__return')]);
        await wait(300);
        check(step, (await state(`panels.${id}.state`)) === 'docked', `${id} is not docked after its return`);
      }
      const after = await gridShape();
      report[`${step}: after`] = after;
      check(step, same(after, before), `the grid is not the original: ${JSON.stringify(after)}`);
      noPopupErrors(step);
    }
  }

  async function blocked() {
    const step = 'blocked';
    await openApp('po=1');
    await page.evaluate(() => {
      window.open = () => null;
    });
    await page.click('[data-ndd-tab="pp"]', { button: 'right' });
    await page.click('[data-ndd-menu-item="Open in new window"]');
    await page.waitForSelector('.ndd-toast--warning');
    check(step, (await page.textContent('.ndd-toast--warning')).includes('blocked'), 'the toast does not say the pop-up was blocked');
    check(step, (await state('panels.pp.state')) === 'docked', 'the panel moved');
    check(step, (await state('panels.pp.poppedOut')) === undefined, 'the panel is flagged poppedOut');
  }

  /**
   * Playwright runs page.evaluate (and its waits) as a user gesture, so the main page holds a
   * transient activation for a while after any call into it (5 s in Chrome): wait that out, without
   * touching the main page, so the click inside the pop-out is the only activation, as for a user.
   */
  async function fromPopOut() {
    const step = 'from a pop-out';
    await openApp('po=1&po2=1');
    const pp = await popOutByClick();
    await pp.waitForSelector('#po-pop-q');
    await wait(5500);
    const [pq] = await Promise.all([context.waitForEvent('page'), pp.click('#po-pop-q')]);
    await pq.waitForLoadState();
    await pq.waitForSelector('[data-ndd-panel="pq"]');
    const result = await page.evaluate(() => window.__poqResult);
    check(step, same(result, { ok: true }), `popOutPanel('pq') from pp's window returned ${JSON.stringify(result)}`);
    const opener = await pq.evaluate(() => window.opener?.name ?? null);
    report[step] = { result, opener };
    check(step, /^ndd-popout-pp-/.test(opener ?? ''), `pq's window was opened by "${opener}", not pp's window`);
    check(step, (await state('panels.pq.poppedOut')) === true, 'pq is not poppedOut');
    check(step, (await page.$('[data-ndd-panel="pq"]')) === null, "pq's element is still in the main page");
    noPopupErrors(step);
  }

  /** Records, at each of the four events, the panel element's document and size (in `window.__poSeen`). */
  const recordEvents = () =>
    page.evaluate(() => {
      window.__poSeen = [];
      const el = document.querySelector('[data-ndd-panel="pp"]');
      for (const type of ['panel:popping-out', 'panel:popped-out', 'panel:returning', 'panel:returned']) {
        window.__pg.ws.subscribe(type, () => {
          window.__poSeen.push({ type, where: el.ownerDocument === document ? 'page' : 'window', w: el.offsetWidth, h: el.offsetHeight });
        });
      }
      return { w: el.offsetWidth, h: el.offsetHeight };
    });
  const seenEvents = () => page.evaluate(() => window.__poSeen);
  /** The size of the pop-out's slot, which the panel fills. */
  const slotSize = p =>
    p.evaluate(() => {
      const slot = document.querySelector('.ndd-popout-frame__body');
      return { w: slot.offsetWidth, h: slot.offsetHeight };
    });

  async function events() {
    for (const [name, query] of [['a blank window', 'po=1'], ['popoutUrl', 'po=1&pourl=1']]) {
      const step = `events, ${name}`;
      await openApp(query);
      const inPage = await recordEvents();
      check(step, inPage.w > 100 && inPage.h > 100, `the panel is ${inPage.w} x ${inPage.h} in the page`);
      const popup = await popOutByClick();
      await page.waitForFunction(() => window.__poSeen.length >= 2);
      await wait(300);
      const inWindow = await slotSize(popup);
      check(step, inWindow.w > 100, `the window's slot is ${inWindow.w} wide`);
      const out = await seenEvents();
      report[`${step}: out`] = out;
      check(
        step,
        same(out, [
          { type: 'panel:popping-out', where: 'page', ...inPage },
          { type: 'panel:popped-out', where: 'window', ...inWindow },
        ]),
        `on the way out: ${JSON.stringify(out)} (page ${JSON.stringify(inPage)}, window ${JSON.stringify(inWindow)})`,
      );
      await Promise.all([popup.waitForEvent('close'), popup.click('.ndd-popout-frame__return')]);
      await page.waitForFunction(() => window.__poSeen.length >= 4);
      const home = (await seenEvents()).slice(2);
      report[`${step}: back`] = home;
      check(
        step,
        same(home, [
          { type: 'panel:returning', where: 'window', ...inWindow },
          { type: 'panel:returned', where: 'page', ...inPage },
        ]),
        `on the way back: ${JSON.stringify(home)}`,
      );
      noPopupErrors(step);
    }
  }

  // P3 (rdd S3): styles in the pop-out. The window gets the page's stylesheets, <html>'s attributes
  // and the workspace's scheme and skin, so what is drawn there looks as it does in the page.

  /** Waits until the window's frame is shown: it stays hidden until the copied stylesheets are ready. */
  const frameShown = p =>
    p.waitForFunction(() => {
      const f = document.querySelector('.ndd-popout-frame');
      return !!f && getComputedStyle(f).visibility === 'visible';
    });

  /** Computed colours of the workspace (the frame's counterpart) and a panel element, in `p`. */
  const colours = (p, frameSelector) =>
    p.evaluate(sel => {
      const frame = document.querySelector(sel);
      const panel = document.getElementById('po-fill') ?? document.querySelector('.ndd-panel-content');
      const f = getComputedStyle(frame);
      return {
        background: f.backgroundColor,
        color: f.color,
        accent: f.getPropertyValue('--ndd-accent-color').trim(),
        font: f.fontFamily,
        panelColor: panel ? getComputedStyle(panel).color : null,
        marker: panel ? getComputedStyle(panel).outlineColor : null,
      };
    }, frameSelector);

  async function styles() {
    for (const scheme of ['dark', 'light']) {
      const step = `styles, ${scheme}`;
      await openApp(`po=1&skin=nord${scheme === 'light' ? '&cs=light' : ''}`);
      // The panel is a tab behind p1: shown, so its element is the one compared on both sides.
      await page.click('[data-ndd-tab="pp"]');
      await wait(300);
      const popup = await popOutByClick();
      await frameShown(popup);
      const compare = async label => {
        await wait(300);
        const main = await colours(page, '.ndd-workspace:not(.ndd-popout-frame)');
        const out = await colours(popup, '.ndd-popout-frame');
        report[`${step}: ${label}`] = { main, out };
        for (const k of ['background', 'color', 'accent', 'font']) {
          check(step, out[k] === main[k], `${label}: the frame's ${k} is ${out[k]}, the page's ${main[k]}`);
        }
        // A panel element inherits the workspace's colour.
        check(step, out.panelColor === main.color, `${label}: the panel's colour is ${out.panelColor}, the page's ${main.color}`);
        return { main, out };
      };
      const first = await compare('at first');
      check(step, !!first.main.accent, 'the page has no --ndd-accent-color: nothing was compared');

      // A scheme switch, as the app does it: on <html>.
      await page.evaluate(s => document.documentElement.setAttribute('data-color-scheme', s), scheme === 'dark' ? 'light' : 'dark');
      const switched = await compare('after a scheme switch');
      check(step, switched.main.background !== first.main.background, `the scheme switch changed nothing (${switched.main.background})`);

      // A skin switch.
      await page.evaluate(() => window.__pg.skin.set('tokyo'));
      const reskinned = await compare('after a skin switch');
      check(step, !same(reskinned.main, switched.main), 'the skin switch changed nothing');
      const skinOut = await popup.getAttribute('.ndd-popout-frame', 'data-ndd-skin');
      check(step, skinOut === 'tokyo', `the frame's skin is ${skinOut}`);

      // A sheet added to the page after the pop-out applies there too.
      await page.evaluate(() => {
        const s = document.createElement('style');
        s.textContent = '#po-fill { outline: 1px solid rgb(1, 2, 3); }';
        document.head.appendChild(s);
      });
      await wait(200);
      const marker = (await colours(popup, '.ndd-popout-frame')).marker;
      check(step, marker === 'rgb(1, 2, 3)', `a sheet added later does not apply in the window: ${marker}`);
      noPopupErrors(step);
      await closePopups();
    }
  }

  // P4 (rdd S4 + next.1): the app's popoutWrapper around the content, the frame, a menu and toasts in
  // a pop-out. The playground's runtime CSS-in-JS stand-in (runtime-css.ts) inserts its rules into
  // the document its cache is given, with insertRule: without the wrapper they never reach the window.

  /** Size and colour of the stand-in's icon at `sel` in `p`, or null when it isn't there. */
  const rcLook = (p, sel) =>
    p.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(el).backgroundColor };
    }, sel);
  const RC_LOOK = { w: 16, h: 16, bg: 'rgb(200, 30, 40)' };
  /** The 14 x 14 title-icon box (a frame's, a floating window's) of the icon at `sel` in `p`. */
  const iconBox = (p, sel) =>
    p.evaluate(s => {
      const r = document.querySelector(s)?.closest('.ndd-popout-frame__icon, .ndd-panel-float__icon')?.getBoundingClientRect();
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
    }, sel);
  /** The panel content's styled element. */
  const rcContent = p =>
    p.evaluate(() => {
      const el = document.getElementById('po-rc');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { color: s.color, letterSpacing: s.letterSpacing, border: s.borderBottomColor };
    });
  const RC_CONTENT = { color: 'rgb(10, 20, 30)', letterSpacing: '3px', border: 'rgb(40, 50, 60)' };
  /** Whether a document's stand-in <style> holds its rules only through insertRule (the production path). */
  const insertedOnly = p =>
    p.evaluate(() =>
      Array.from(document.querySelectorAll('style[data-rc]')).some(s => (s.textContent ?? '') === '' && (s.sheet?.cssRules.length ?? 0) > 0),
    );

  async function wrapper() {
    const step = 'wrapper';
    await openApp('po=1&rc=1');
    // pp is a tab behind p1: shown, so its content is laid out and measured.
    await page.click('[data-ndd-tab="pp"]');
    await wait(300);
    // In the page: the content, the tab's icon and a menu item's icon.
    check(step, same(await rcContent(page), RC_CONTENT), `the content in the page: ${JSON.stringify(await rcContent(page))}`);
    check(step, await insertedOnly(page), "the page's rules are not inserted with insertRule only");
    const tabIcon = await rcLook(page, '[data-ndd-tab="pp"] [data-rc-icon="frame"]');
    check(step, same(tabIcon, RC_LOOK), `the tab's icon: ${JSON.stringify(tabIcon)}`);
    await page.click('#po-menu');
    await page.waitForSelector('.ndd-context-menu');
    check(step, same(await rcLook(page, '.ndd-context-menu [data-rc-icon="menu"]'), RC_LOOK), "a menu item's icon in the page");
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ndd-context-menu', { state: 'detached' });
    const mounts = await page.evaluate(() => window.__poMounts);

    const popup = await popOutByClick();
    popup.setDefaultTimeout(5000);
    await frameShown(popup);
    const out = {};
    out.frame = await rcLook(popup, '.ndd-popout-frame__icon [data-rc-icon="frame"]');
    check(step, same(out.frame, RC_LOOK), `the frame's icon in the window: ${JSON.stringify(out.frame)}`);
    out.content = await rcContent(popup);
    check(step, same(out.content, RC_CONTENT), `the content in the window: ${JSON.stringify(out.content)}`);
    check(step, await insertedOnly(popup), "the window's rules are not inserted into its own <style> with insertRule");

    // A menu opened from inside the window: there, its item's icon styled, and it can be clicked.
    await popup.click('#po-menu');
    await popup.waitForSelector('.ndd-context-menu');
    check(step, (await page.$('.ndd-context-menu')) === null, 'the menu opened in the page');
    out.menu = await rcLook(popup, '.ndd-context-menu [data-rc-icon="menu"]');
    check(step, same(out.menu, RC_LOOK), `a menu item's icon in the window: ${JSON.stringify(out.menu)}`);
    await popup.click('.ndd-context-menu__item:has-text("Rc item")');
    await popup.waitForSelector('.ndd-context-menu', { state: 'detached' });

    // A toast raised by a click in the window shows in the window, its icon styled; not in the page.
    await popup.click('#po-toast');
    await popup.waitForSelector('.ndd-toast:has-text("from pp")');
    check(step, (await page.$('.ndd-toast:has-text("from pp")')) === null, 'the toast shows in the page too');
    out.toast = await rcLook(popup, '.ndd-toast [data-rc-icon="toast"]');
    check(step, same(out.toast, RC_LOOK), `a toast's icon in the window: ${JSON.stringify(out.toast)}`);
    report[step] = out;

    // Its window closing takes the toast away; the content is back, styled, never re-created.
    await Promise.all([popup.waitForEvent('close'), popup.click('.ndd-popout-frame__return')]);
    await wait(300);
    check(step, (await page.$('.ndd-toast:has-text("from pp")')) === null, "the window's toast came to the page");
    check(step, same(await rcContent(page), RC_CONTENT), `the content after the return: ${JSON.stringify(await rcContent(page))}`);
    check(step, (await page.evaluate(() => window.__poMounts)) === mounts, 'the panel was re-created');
    noPopupErrors(step);
  }

  // rdd 7.12.2: the frame's title icon is sized as a floating window's (14 x 14), and an icon bigger
  // than a title-icon box is scaled to fit it. An icon that takes its size from its box (MapEvolution's
  // mat-icon, width/height auto) grew to 300 px and pushed the panel out of the window.

  /** The frame's icon box, the icon inside it, the header's height and the slot's, in `p`. */
  const frameIconLayout = p =>
    p.evaluate(() => {
      const box = s => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        icon: box('.ndd-popout-frame__icon'),
        inner: box('.ndd-popout-frame__icon [data-po-icon]'),
        header: box('.ndd-popout-frame__header').h,
        body: box('.ndd-popout-frame__body').h,
        window: window.innerHeight,
      };
    });

  async function titleIcon() {
    const step = 'title icon';
    await openApp('po=1&poico=1');
    {
      const popup = await popOutByClick();
      await frameShown(popup);
      const l = await frameIconLayout(popup);
      report[`${step}: unsized`] = l;
      check(step, same(l.icon, { w: 14, h: 14 }), `the frame's icon box: ${JSON.stringify(l.icon)}`);
      check(step, l.header < 40, `the header is ${l.header} px tall`);
      check(step, l.body >= l.window - l.header - 1, `the slot is ${l.body} px of ${l.window} (header ${l.header})`);
      check(step, same(l.inner, { w: 14, h: 14 }), `the icon is ${JSON.stringify(l.inner)}, not its box's 14 x 14`);
      await closePopups();
    }
    await openApp('po=1&wo=1&poico=1');
    await page.waitForSelector('[data-ndd-widget="wo"] #wo-fill');
    await wait(300);
    const unsizedFloat = await page.evaluate(() => {
      const r = document.querySelector('.ndd-panel-float__icon [data-po-icon]')?.getBoundingClientRect();
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
    });
    report[`${step}: unsized, floating`] = unsizedFloat;
    check(step, same(unsizedFloat, { w: 14, h: 14 }), `the unsized icon in a floating window's title: ${JSON.stringify(unsizedFloat)}`);
    await openApp('po=1&wo=1&rc=1');
    await page.waitForSelector('[data-ndd-widget="wo"] #wo-fill');
    await wait(300);
    // A component icon whose own element is 16 x 16 keeps that size, centred and not squeezed, in the
    // 14 x 14 box: ndd's <ndd-icon> and the component's host sit between the box and the element, so
    // rdd's scale-to-fit cap can't reach it (ADR 0019, PARITY §4.5). An svg is drawn at 14 x 14.
    const floatSel = '.ndd-panel-float__icon [data-rc-icon="wo"]';
    const inFloat = { icon: await rcLook(page, floatSel), box: await iconBox(page, floatSel) };
    report[`${step}: floating`] = inFloat;
    check(step, same(inFloat, { icon: RC_LOOK, box: { w: 14, h: 14 } }), `the widget's icon in its floating window's title: ${JSON.stringify(inFloat)}`);
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#wo-po-btn')]);
    await popup.waitForSelector('#wo-fill');
    await frameShown(popup);
    await wait(300);
    const frameSel = '.ndd-popout-frame__icon--menu [data-rc-icon="wo"]';
    const inFrame = { icon: await rcLook(popup, frameSel), box: await iconBox(popup, frameSel), header: await popup.evaluate(() => Math.round(document.querySelector('.ndd-popout-frame__header').getBoundingClientRect().height)) };
    report[`${step}: widget frame`] = inFrame;
    check(step, same(inFrame.icon, RC_LOOK) && same(inFrame.box, { w: 14, h: 14 }) && inFrame.header < 40, `the widget's icon in its window's frame: ${JSON.stringify(inFrame)}`);
    noPopupErrors(step);
  }

  /** The look of a button in `p`. */
  const buttonLook = (p, sel) =>
    p.evaluate(s => {
      const el = document.querySelector(s);
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), bg: c.backgroundColor, border: c.borderTopColor, color: c.color, radius: c.borderTopLeftRadius };
    }, sel);

  async function returnButton() {
    for (const [skin, scheme] of [['', 'dark'], ['', 'light'], ['nord', 'dark'], ['nord', 'light']]) {
      const step = `return button, ${skin || 'default skin'}, ${scheme}`;
      await openApp(`po=1${scheme === 'light' ? '&cs=light' : ''}${skin ? `&skin=${skin}` : ''}`);
      await page.evaluate(() => window.__pg.ws.openPanel('p4', 'hostile', { title: 'Four', initialTarget: 'floating' }));
      await page.waitForSelector('[data-ndd-window="p4"] .ndd-btn-minimize-tab');
      await wait(300);
      const inPage = await buttonLook(page, '[data-ndd-window="p4"] .ndd-btn-minimize-tab');
      const popup = await popOutByClick();
      await frameShown(popup);
      await wait(300);
      const back = '.ndd-popout-frame__return';
      const look = await buttonLook(popup, back);
      report[step] = { inPage, look };
      check(step, same(look, inPage), `the button is ${JSON.stringify(look)}, a floating window's ${JSON.stringify(inPage)}`);
      check(step, (await popup.getAttribute(back, 'title')) === 'Return to desktop', 'its title is not the label');
      check(step, (await popup.getAttribute(back, 'aria-label')) === 'Return to desktop', 'its aria-label is not the label');
      check(step, ((await popup.textContent(back)) ?? '').trim() === '', 'it has visible text');
      check(step, (await popup.$(`${back} svg`)) !== null, 'it has no icon');
      check(step, (await popup.getAttribute('.ndd-popout-frame', 'data-ndd-popout-kind')) === 'panel', 'no data-ndd-popout-kind="panel" on the frame');
      noPopupErrors(step);
      await closePopups();
    }
  }

  async function zone() {
    const step = 'zone';
    await openApp('po=1');
    const popup = await popOutByClick();
    await popup.click('#po-plain');
    await wait(200);
    check(step, (await popup.textContent('#po-plain-out')) === '1', `a plain field written from a template listener shows ${await popup.textContent('#po-plain-out')}`);
    // A listener the panel adds on its own document, now the pop-out's; its clicks write a plain field.
    await popup.click('#po-arm');
    await popup.click('#po-doc');
    // Read at once: in `?zone` the zone runs change detection at the end of the click's own task, as
    // it does in the page, so the field shows before anything else happens. (Without the window's
    // patch the listener runs outside the zone, and the field shows only once some later render
    // comes along, tens of milliseconds on.)
    const docPlain = await popup.evaluate(() => document.getElementById('po-doc-out').textContent);
    report[step] = { docPlain };
    // Zoneless, a plain field written outside a template renders on the next render only, as in the page.
    if (sched.zone) check(step, docPlain === '1', `in ?zone, a plain field written by a listener on the pop-out's document shows ${docPlain} right after the click`);
    noPopupErrors(step);
  }

  // ── P5: managed widgets in their own window ──────────────────────────────────────────────────
  /** What must survive in the widget, read in the document it is in now. */
  const woSnapshot = p =>
    p.evaluate(() => {
      const fill = document.getElementById('wo-fill');
      const canvas = document.getElementById('wo-gl');
      return {
        here: !!fill,
        same: fill?.__mark === 'original',
        count: document.getElementById('wo-count')?.textContent?.trim() ?? null,
        input: document.getElementById('wo-text')?.value ?? null,
        glAlive: !!canvas?.__gl && !canvas.__gl.isContextLost() && canvas.__glLost === 0,
        inPanelFrame: !!document.querySelector('[data-ndd-widget="wo"] #wo-fill'),
      };
    });
  const woKept = { here: true, same: true, count: '1', input: 'typed', glAlive: true };
  /** Marks the widget's node, counts once and types into it. */
  const prepareWidget = async () => {
    await page.waitForSelector('[data-ndd-widget="wo"] #wo-fill');
    await wait(300);
    await page.evaluate(() => {
      document.getElementById('wo-fill').__mark = 'original';
    });
    await page.click('#wo-count');
    await page.fill('#wo-text', 'typed');
    await wait(300);
  };
  /** The widget's onWillMove / onMoved calls since the last take: `will` / `moved WxH` (its content's size). */
  const takeWoCalls = () =>
    page.evaluate(() => {
      const calls = window.__wo.calls.splice(0);
      return calls;
    });
  const woContentSize = p =>
    p.evaluate(() => {
      const el = document.getElementById('wo-fill')?.closest('.ndd-panel-float__content');
      return el ? `${el.offsetWidth}x${el.offsetHeight}` : null;
    });
  const woLocation = () => page.evaluate(() => window.__wo.api.location('wo'));

  async function widget() {
    const step = 'widget';
    await openApp('po=1&wo=1');
    await prepareWidget();
    const inPanel = await woSnapshot(page);
    check(step, has(inPanel, { ...woKept, inPanelFrame: true }), `in the panel: ${JSON.stringify(inPanel)}`);
    const panelSize = await woContentSize(page);
    await takeWoCalls();
    for (const way of ['closed', 'back button']) {
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#wo-po-btn')]);
      await popup.waitForLoadState();
      await popup.waitForSelector('#wo-fill');
      await frameShown(popup);
      await wait(400);
      const result = await page.evaluate(() => window.__woPopResult);
      check(step, same(result, { ok: true }), `${way}: popOut returned ${JSON.stringify(result)}`);
      const out = await woSnapshot(popup);
      const outSize = await woContentSize(popup);
      report[`${step} ${way}: out`] = { out, outSize, panelSize };
      check(step, has(out, { ...woKept, inPanelFrame: false }), `${way}: in the window: ${JSON.stringify(out)}`);
      check(step, (await page.$('#wo-fill')) === null, `${way}: the widget's node is still in the page`);
      check(step, (await popup.getAttribute('.ndd-popout-frame', 'data-ndd-popout-kind')) === 'widget', `${way}: no data-ndd-popout-kind="widget"`);
      check(step, (await popup.getAttribute('.ndd-popout-frame__return', 'aria-label')) === 'Back into the panel', `${way}: the return button is not "Back into the panel"`);
      check(step, (await woLocation()) === 'floating', `${way}: location is not 'floating'`);
      let calls = await takeWoCalls();
      check(step, same(calls, ['will', `moved ${outSize}`]), `${way}: out: calls ${JSON.stringify(calls)}, the window's size ${outSize}`);
      check(step, outSize !== panelSize, `${way}: the same size in the window as in the panel (${outSize})`);
      if (way === 'closed') await popup.close();
      else await Promise.all([popup.waitForEvent('close'), popup.click('.ndd-popout-frame__return')]);
      await page.waitForSelector('[data-ndd-widget="wo"] #wo-fill');
      await wait(400);
      const back = await woSnapshot(page);
      report[`${step} ${way}: back`] = back;
      check(step, has(back, { ...woKept, inPanelFrame: true }), `${way}: back in the panel: ${JSON.stringify(back)}`);
      check(step, (await woContentSize(page)) === panelSize, `${way}: back at ${await woContentSize(page)}, not ${panelSize}`);
      calls = await takeWoCalls();
      check(step, same(calls, ['will', `moved ${panelSize}`]), `${way}: back: calls ${JSON.stringify(calls)}`);
    }
    noPopupErrors(step);
  }

  async function widgetMenu() {
    const step = 'widget menu';
    await openApp('po=1&wo=1');
    await page.waitForSelector('[data-ndd-widget="wo"] #wo-fill');
    await wait(300);
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#wo-po-btn')]);
    await popup.waitForSelector('#wo-fill');
    await frameShown(popup);
    await wait(300);
    const icon = '.ndd-popout-frame__icon--menu';
    check(step, (await popup.$(icon)) !== null, "the frame's title icon is not a menu button");
    // Enter on the focused icon: the menu opens there and is still open a moment later.
    await popup.focus(icon);
    await popup.keyboard.press('Enter');
    await popup.waitForSelector('[data-ndd-menu]', { timeout: 3000 }).catch(() => {});
    await wait(300);
    check(step, (await popup.$('[data-ndd-menu]')) !== null, 'Enter: no menu open in the window');
    if (await popup.$('[data-ndd-menu]')) {
      await popup.keyboard.press('Escape');
      await popup.waitForSelector('[data-ndd-menu]', { state: 'detached', timeout: 3000 }).catch(() => fail(`${step}: Escape did not close the menu`));
    }
    // A click: the same, in the window only, and its item runs.
    await popup.click(icon);
    await wait(300);
    check(step, (await popup.$('[data-ndd-menu]')) !== null, 'click: no menu open in the window (closed by its own click?)');
    check(step, (await page.$('[data-ndd-menu]')) === null, 'click: a menu opened in the page');
    if (await popup.$('[data-ndd-menu]')) {
      await Promise.all([popup.waitForEvent('close'), popup.click('[data-ndd-menu-item="Back into the panel"]')]);
      await page.waitForSelector('[data-ndd-widget="wo"] #wo-fill');
      check(step, (await woLocation()) === 'panel', 'not back in the panel');
    }
    noPopupErrors(step);
  }

  async function widgetFromOwner() {
    const step = 'widget from owner';
    await openApp('po=1&wo=1&opo=1');
    await prepareWidget();
    // The owner panel into its window, from the page's own button.
    const [owner] = await Promise.all([page.waitForEvent('popup'), page.click('#ov-po-btn')]);
    await owner.waitForLoadState();
    await owner.waitForSelector('[data-ndd-widget="wo"] #wo-fill');
    await frameShown(owner);
    await wait(300);
    // Where the widget's frame is in the owner's window, and that window's screen origin.
    const at = await owner.evaluate(() => {
      const r = document.querySelector('[data-ndd-widget="wo"]').getBoundingClientRect();
      return { left: r.left, top: r.top, screenX, screenY, chrome: Math.max(0, outerHeight - innerHeight) };
    });
    // Playwright's own calls into the page activate it for about 5 s: none until the click.
    await wait(5500);
    const [win] = await Promise.all([context.waitForEvent('page'), owner.click('#wo-po-in')]);
    await win.waitForLoadState();
    await win.waitForSelector('#wo-fill');
    await frameShown(win);
    await wait(300);
    const result = await page.evaluate(() => window.__woPopResult);
    check(step, same(result, { ok: true }), `popOut from the owner's window returned ${JSON.stringify(result)}`);
    const opener = await win.evaluate(() => window.opener?.name ?? null);
    const origin = await win.evaluate(() => ({ screenX, screenY }));
    const main = await page.evaluate(() => ({ screenX, screenY }));
    const marked = await woSnapshot(win);
    report[step] = { result, opener, at, origin, main, marked };
    check(step, /^ndd-popout-ov-/.test(opener ?? ''), `the widget's window was opened by "${opener}", not the owner's window`);
    check(step, has(marked, woKept), `in its window: ${JSON.stringify(marked)}`);
    check(step, (await owner.$('#wo-fill')) === null && (await page.$('#wo-fill')) === null, "the widget's node is still in the owner's window or the page");
    check(step, (await state('panels.ov.poppedOut')) === true, 'the owner is not poppedOut');
    // On the owner's window's screen, over the widget's frame there (rdd 7.12.1's `view`).
    const wantX = Math.round(at.screenX + at.left);
    const wantY = Math.round(at.screenY + at.chrome + at.top);
    check(
      step,
      Math.abs(origin.screenX - wantX) <= 2 && Math.abs(origin.screenY - wantY) <= 2,
      `the window is at ${origin.screenX},${origin.screenY}, not ${wantX},${wantY} (the owner's window at ${at.screenX},${at.screenY}; the page at ${main.screenX},${main.screenY})`,
    );
    // Closing it: back into its panel, inside the owner's window.
    await win.close();
    await owner.waitForSelector('[data-ndd-widget="wo"] #wo-fill');
    await wait(300);
    const home = await woSnapshot(owner);
    check(step, has(home, { ...woKept, inPanelFrame: true }), `back in its panel in the owner's window: ${JSON.stringify(home)}`);
    check(step, (await page.$('#wo-fill')) === null, "the widget came back into the page, not the owner's window");
    noPopupErrors(step);
  }

  // ── P6: focus across windows ──
  /** Counts `p`'s window.focus() calls from now on (the real one still runs). */
  const countFocus = p =>
    p.evaluate(() => {
      window.__focusCalls = 0;
      const original = window.focus.bind(window);
      window.focus = () => {
        window.__focusCalls += 1;
        original();
      };
    });
  const focusCalls = p => p.evaluate(() => window.__focusCalls);
  const activeId = () => state('activePanelId');
  /** Selects p1's tab in the page, so another panel than pp is the active one. */
  const activateP1 = async () => {
    await page.click('[data-ndd-tab="p1"]');
    await wait(300);
  };
  /** Opens a one-item menu from `p`'s document, through the page's workspace. */
  const menuFrom = (p, label) =>
    p.evaluate(l => {
      const ws = (window.opener ?? window).__pg.ws;
      ws.showContextMenu({ event: { target: document.body, clientX: 20, clientY: 20 }, items: [{ label: l, action: () => {} }] });
    }, label);

  async function focusAcross() {
    const step = 'focus across';
    await openApp('po=1');
    const popup = await popOutByClick();
    await frameShown(popup);
    await wait(300);
    const focused = () => popup.getAttribute('.ndd-popout-frame', 'data-ndd-focused');

    // A click inside the pop-out, on something that takes no focus: the pointerdown activates pp.
    await activateP1();
    check(step, (await activeId()) === 'p1', `p1 is not active after a click on its tab (${await activeId()})`);
    check(step, (await focused()) === null, 'the frame says focused while p1 is active');
    await popup.click('#po-count');
    await wait(300);
    check(step, (await activeId()) === 'pp', `a click in the pop-out did not activate pp (${await activeId()})`);
    check(step, (await focused()) === '', 'the frame does not carry data-ndd-focused');
    // Focus moving in, with no pointer: activates it too.
    await activateP1();
    check(step, (await focused()) === null, 'the frame still says focused after p1 was activated');
    await popup.focus('#po-inc');
    await wait(300);
    check(step, (await activeId()) === 'pp', `a focus in the pop-out did not activate pp (${await activeId()})`);

    // Escape, both ways: a menu in the pop-out stays through the page's Escape and closes on its own.
    await menuFrom(popup, 'In the window');
    await popup.waitForSelector('.ndd-context-menu');
    check(step, (await page.$('.ndd-context-menu')) === null, "the pop-out's menu also shows in the page");
    await page.keyboard.press('Escape');
    await wait(300);
    check(step, (await popup.$('.ndd-context-menu')) !== null, "an Escape in the page closed the pop-out's menu");
    await popup.keyboard.press('Escape');
    await popup
      .waitForSelector('.ndd-context-menu', { state: 'detached', timeout: 3000 })
      .catch(() => fail(`${step}: an Escape in the pop-out did not close its menu`));
    // ...and a menu in the page stays through the pop-out's Escape and closes on the page's.
    await menuFrom(page, 'In the page');
    await page.waitForSelector('.ndd-context-menu');
    check(step, (await popup.$('.ndd-context-menu')) === null, "the page's menu also shows in the pop-out");
    await popup.keyboard.press('Escape');
    await wait(300);
    check(step, (await page.$('.ndd-context-menu')) !== null, "an Escape in the pop-out closed the page's menu");
    await page.keyboard.press('Escape');
    await page
      .waitForSelector('.ndd-context-menu', { state: 'detached', timeout: 3000 })
      .catch(() => fail(`${step}: an Escape in the page did not close its menu`));

    // The taskbar lists pp with its marker while it is out; a click brings its window forward.
    const entry = '[data-ndd-taskbar-popout="pp"]';
    const look = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      const marker = el?.querySelector('.ndd-taskbar-item-popout-marker');
      const r = el?.getBoundingClientRect();
      const m = marker?.getBoundingClientRect();
      return (
        el && {
          tag: el.tagName,
          label: el.getAttribute('aria-label'),
          marker: !!marker,
          markerPosition: marker ? getComputedStyle(marker).position : null,
          itemPosition: getComputedStyle(el).position,
          // The marker sits inside the entry, in its upper half.
          inside: !!m && m.width > 0 && m.left >= r.left && m.right <= r.right + 0.5 && m.top >= r.top && m.bottom <= r.top + r.height / 2 + 1,
          w: Math.round(r.width),
        }
      );
    }, entry);
    report[`${step}: taskbar entry`] = look;
    check(step, look !== null, 'no taskbar entry for pp');
    check(step, look?.tag === 'BUTTON', `the entry is a ${look?.tag}, not a button`);
    check(step, look?.label === 'Pop: in its own window', `the entry's label is ${JSON.stringify(look?.label)}`);
    check(
      step,
      look?.marker && look.markerPosition === 'absolute' && look.itemPosition === 'relative' && look.inside,
      `the marker is not placed in the entry's corner: ${JSON.stringify(look)}`,
    );
    await activateP1();
    await countFocus(popup);
    await page.evaluate(sel => document.querySelector(sel).click(), entry);
    await wait(300);
    check(step, (await focusCalls(popup)) === 1, `the entry's click called the window's focus() ${await focusCalls(popup)} times`);
    check(step, (await activeId()) === 'pp', `the entry's click did not activate pp (${await activeId()})`);

    await Promise.all([popup.waitForEvent('close'), popup.click('.ndd-popout-frame__return')]);
    await wait(300);
    check(step, (await page.$(entry)) === null, 'the taskbar entry stays after the return');
    noPopupErrors(step);
  }

  /**
   * workspace.focusPanelWindow, with rdd's recipe: Playwright reports document.hasFocus() true in
   * every page, so the page that should not have focus (the pop-out, once the main window comes
   * forward) says so with a stub. A toast raised from the page shows in the window that has focus.
   */
  async function focusWindow() {
    const step = 'focusPanelWindow';
    await openApp('po=1');
    const popup = await popOutByClick();
    await frameShown(popup);
    await wait(300);
    await activateP1();
    await countFocus(page);
    await countFocus(popup);

    // pp's window comes forward: its focus() once, the page's never; pp is the active panel.
    const toPp = await page.evaluate(() => window.__pg.ws.focusPanelWindow('pp'));
    await wait(300);
    const out = { result: toPp, child: await focusCalls(popup), main: await focusCalls(page), active: await activeId() };
    report[`${step}: pp`] = out;
    check(step, same(out, { result: { ok: true }, child: 1, main: 0, active: 'pp' }), `focusPanelWindow('pp'): ${JSON.stringify(out)}`);
    // (Both pages say hasFocus() here, and a pop-out that has focus comes first: no stub needed.)
    await page.evaluate(() => window.__pg.toast('to the window in front', { duration: 0 }));
    await popup
      .waitForSelector('.ndd-toast:has-text("to the window in front")', { timeout: 3000 })
      .catch(() => fail(`${step}: with both pages focused, the toast is not in the pop-out`));
    check(step, (await page.$('.ndd-toast:has-text("to the window in front")')) === null, 'the toast shows in the page too');

    // The main window comes forward for p1, which is in the page; the pop-out now says it lost focus.
    await popup.evaluate(() => {
      document.hasFocus = () => false;
    });
    const toP1 = await page.evaluate(() => window.__pg.ws.focusPanelWindow('p1'));
    await wait(300);
    const home = { result: toP1, child: await focusCalls(popup), main: await focusCalls(page), active: await activeId() };
    report[`${step}: p1`] = home;
    check(step, same(home, { result: { ok: true }, child: 1, main: 1, active: 'p1' }), `focusPanelWindow('p1'): ${JSON.stringify(home)}`);
    await page.evaluate(() => window.__pg.toast('to the page', { duration: 0 }));
    await page
      .waitForSelector('.ndd-toast:has-text("to the page")', { timeout: 3000 })
      .catch(() => fail(`${step}: with the pop-out stubbed unfocused, the toast is not in the page`));
    check(step, (await popup.$('.ndd-toast:has-text("to the page")')) === null, 'the toast shows in the pop-out too');

    // focusPanel on a popped-out panel brings its window forward too; an unknown id is not ok.
    await page.evaluate(() => window.__pg.ws.focusPanel('pp'));
    await wait(300);
    check(step, (await focusCalls(popup)) === 2, `focusPanel('pp') called the window's focus() ${(await focusCalls(popup)) - 1} times`);
    const unknown = await page.evaluate(() => window.__pg.ws.focusPanelWindow('nope'));
    check(step, same(unknown, { ok: false }), `focusPanelWindow('nope') returned ${JSON.stringify(unknown)}`);
    noPopupErrors(step);
  }

  const cases = { outAndBack, closedByUser, withPopoutUrl, neighbours, blocked, fromPopOut, events, styles, wrapper, titleIcon, returnButton, zone, widget, widgetMenu, widgetFromOwner, focusAcross, focusWindow };
  for (const [name, run] of Object.entries(cases)) {
    if (only && !only.includes(name)) continue;
    try {
      await run();
    } catch (e) {
      fail(`${name}: crashed: ${String(e.message).split('\n')[0]}`);
    }
    await closePopups();
  }
  return report;
});
