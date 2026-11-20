/**
 * M11 browser gate — the panel overlay, measured, in real Chrome under both schedulers. A port
 * of vdd's M11 browser gate.
 *
 *   D5        every resize handle's hit area is its full intended size — `elementFromPoint` at
 *             the centre and one pixel inside each edge of the handle's own box hits the handle.
 *             rdd put handles at -4px on a box with `overflow: hidden`, so half of every one was
 *             clipped and a corner drag did nothing at all
 *   corner    a press on the visible (rounded) corner reaches the handle and resizes both edges
 *   stretch   a stretched strip tracks the panel when the panel resizes — two pins, no JavaScript
 *             — and sits inside the toolbar band
 *   stacking  a full-width strip and a corner card on the same edge never overlap; whichever is
 *             stacked second clears the other's full height plus the gap
 *   toolbar   a docked widget resized towards a bottom toolbar stops at it
 *   survival  the overlay panel is created once through all of it
 *   content   (7.11, widgets out of the panel, M2) a widget opened with injectFloatingWidgets()
 *             renders into its own element, `.ndd-panel-float__content`: content laid out with
 *             `height: 100%` fills the frame's body exactly; its state and its very DOM node
 *             survive a drag free and back onto a corner; a pointerdown in the content raises
 *             the widget, also on a canvas that stops the event (a map does)
 *   out       (7.11, M3) move() takes that element into a hosted panel ('ov/wo') docked beside
 *             the owner, tabbed in its group, floating at a rect, back home, floating without a
 *             rect, minimised and restored, and home again: the same element (a JS mark), its
 *             counter, text field, scroll offset and live WebGL context kept, filling whatever
 *             shows it (measured against the hosted panel's box, not the slot). The hosted tab's
 *             × closes the widget; docked and home under RTL; the owner closing removes the
 *             widget and its hosted panel
 *   menu      (7.11, M4 + next.1) with a titleMenu, the frame's title icon is a button: a click
 *             opens the app's items without starting a drag (nor does a drag from it), an item
 *             moves the widget out, and from the keyboard the menu opens on its first item. Out of
 *             the panel, a drag from the hosted tab's icon or the floating title bar's icon moves
 *             nothing, and a click opens the menu (the tab's: the app's items, Minimize, Close, no
 *             Float; the title bar's: the app's items, then Close), whose item brings it home
 *   callbacks (7.11, M5) onWillMove sees the content element at its old size and onMoved at its
 *             new one, once each: a move() out and back, and the user's own float of the panel
 *   placement (7.11, M6) a free position dragged by the header comes back after a close and an
 *             open({ placement }); re-opened while its panel is a background tab (0×0), it is
 *             placed when the panel is shown; out of the panel, closed and re-opened at its
 *             placement, it docks beside its owner again
 *   embeds    (7.11, M7) real iframes counting their loads: one in a preserveEmbeds panel type
 *             loads once through a tab drag to the other group, a dock move, a split beside it,
 *             float, dock, minimise (its taskbar preview shown and dismissed) and restore, and tab
 *             switches, while the control panel without it reloads; a
 *             preserveEmbeds widget's iframe loads once out of its panel, between places, through
 *             the user's own float, minimise, restore and dock of its panel, and back. The Chrome
 *             in the gate has moveBefore() (asserted)
 *
 * `--control-fill`: the content element without its size rule. The fill check must reject it.
 */
import { runBrowserGate } from '../lib/browser.mjs';

// `--control`: rdd's handle geometry — every handle straddling its edge at -4px. The D5 probes
// must reject it.
const control = process.argv.includes('--control');
const RDD_HANDLES = `
  .ndd-resize-n { top: -4px !important; } .ndd-resize-s { bottom: -4px !important; }
  .ndd-resize-e { right: -4px !important; } .ndd-resize-w { left: -4px !important; }
  .ndd-resize-ne, .ndd-resize-nw { top: -4px !important; } .ndd-resize-se, .ndd-resize-sw { bottom: -4px !important; }
  .ndd-resize-ne, .ndd-resize-se { right: -4px !important; } .ndd-resize-nw, .ndd-resize-sw { left: -4px !important; }
`;
const controlFill = process.argv.includes('--control-fill');
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

await runBrowserGate(control ? 'M11-control' : controlFill ? 'M11-control-fill' : 'M11', { viewport: { width: 1280, height: 860 } }, async (page, { fail, open, shot }) => {
  await open('layout=two-leaf');
  if (control) await page.addStyleTag({ content: RDD_HANDLES });
  if (controlFill) await page.addStyleTag({ content: '.ndd-panel-float__content { width: auto !important; height: auto !important; }' });
  await page.evaluate(() => {
    window.__pg.ws.openPanel('ov', 'overlay');
    window.__pg.ws.dockPanelToGroup('ov', 'L', 'center');
  });
  await page.waitForSelector('[data-ndd-panel-overlay]');
  await page.waitForFunction(() => !!window.__overlay, null, { timeout: 5000 });
  await page.waitForTimeout(400);

  const record = [];
  const box = sel => page.locator(sel).first().boundingBox();
  const boxOr = async (sel, step) => {
    const b = await box(sel);
    if (!b) fail(`${step}: "${sel}" has no box — it is absent or not laid out`);
    return b;
  };
  const place = async (which, placement) => {
    await page.evaluate(([w, p]) => window.__overlay.place(w, p), [which, placement]);
    await page.waitForTimeout(250);
  };

  // ── D5: every handle is hittable across its whole nominal area ──
  await place('free', { anchor: 'bottom-right', stretch: null });
  const header = await boxOr('[data-ndd-widget="free"] [data-ndd-widget-header]', 'setup');
  if (!header) return {};
  // Undock the `free` widget so all eight handles are present.
  await page.mouse.move(header.x + 60, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + 60 - 180, header.y + header.height / 2 - 140, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const hitReport = [];
  for (const dir of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const b = await box(`[data-ndd-widget="free"] .ndd-resize-${dir}`);
    if (!b) { fail(`D5: handle ${dir} is not rendered on a free-floating widget`); continue; }
    const probes = {
      centre: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      left: { x: b.x + 1, y: b.y + b.height / 2 },
      right: { x: b.x + b.width - 1, y: b.y + b.height / 2 },
      top: { x: b.x + b.width / 2, y: b.y + 1 },
      bottom: { x: b.x + b.width / 2, y: b.y + b.height - 1 },
    };
    const hits = await page.evaluate(([points, d]) => {
      const out = {};
      for (const [name, p] of Object.entries(points)) {
        const el = document.elementFromPoint(p.x, p.y);
        out[name] = el?.classList?.contains(`ndd-resize-${d}`) ? 'handle' : (el?.className || el?.tagName || 'none');
      }
      return out;
    }, [probes, dir]);
    hitReport.push({ dir, size: `${Math.round(b.width)}x${Math.round(b.height)}`, ...hits });
    for (const [name, got] of Object.entries(hits)) if (got !== 'handle') fail(`D5: handle ${dir}: probe at its ${name} hit "${got}", not the handle`);
    if (b.width < 6 || b.height < 6) fail(`D5: handle ${dir} is only ${Math.round(b.width)}x${Math.round(b.height)}`);
  }
  record.push({ step: 'D5 hit areas', handles: hitReport });

  // ── D5, continued: the visible corner is hittable, and dragging it resizes ──
  // The extreme diagonal pixel of a rounded corner is outside the painted shape, so the probe
  // sits 3px in on each axis — on the painted arc, inside the handle's inscribed quarter-disc.
  const corner = await boxOr('[data-ndd-widget="free"] .ndd-resize-se', 'corner');
  const before = await boxOr('[data-ndd-widget="free"]', 'corner');
  if (corner && before) {
    const p = { x: corner.x + corner.width - 3, y: corner.y + corner.height - 3 };
    const hit = await page.evaluate(q => {
      const el = document.elementFromPoint(q.x, q.y);
      return el?.classList?.contains('ndd-resize-se') ? 'handle' : (el?.className || el?.tagName || 'none');
    }, p);
    if (hit !== 'handle') fail(`corner: the visible corner hit "${hit}", not the corner handle`);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 60, p.y + 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await boxOr('[data-ndd-widget="free"]', 'corner');
    record.push({ step: 'D5 visible corner', hit, from: `${Math.round(before.width)}x${Math.round(before.height)}`, to: `${Math.round(after.width)}x${Math.round(after.height)}` });
    if (!near(after.width, before.width + 60, 4)) fail(`corner: drag changed width by ${Math.round(after.width - before.width)}, expected 60`);
    if (!near(after.height, before.height + 40, 4)) fail(`corner: drag changed height by ${Math.round(after.height - before.height)}, expected 40`);
  }

  // ── a stretched axis tracks the panel, with no JavaScript ──
  await page.evaluate(() => {
    window.__pg.ws.openPanel('other', 'hostile');
    window.__pg.ws.dockPanelToGroup('other', 'R', 'center');
  });
  await page.waitForTimeout(400);
  const overlayBefore = await boxOr('[data-ndd-panel-overlay]', 'stretch');
  const stripBefore = await boxOr('[data-ndd-widget="strip"]', 'stretch');
  const divider = await box('.ndd-resizer-bar');
  if (divider) {
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x + divider.width / 2 - 160, divider.y + divider.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  } else fail('stretch: no grid divider to resize the panel with');
  const overlayAfter = await boxOr('[data-ndd-panel-overlay]', 'stretch');
  const stripAfter = await boxOr('[data-ndd-widget="strip"]', 'stretch');
  if (overlayBefore && overlayAfter && stripBefore && stripAfter) {
    // Measured rather than assumed, so a change to the playground's toolbars cannot make it lie.
    const inlineInset = (await box('[data-ndd-panel-overlay] .ndd-panel-toolbar--left'))?.width ?? 0;
    const inlineInsetEnd = (await box('[data-ndd-panel-overlay] .ndd-panel-toolbar--right'))?.width ?? 0;
    const expectedStrip = overlayAfter.width - inlineInset - inlineInsetEnd - 16;
    const overlayDelta = overlayAfter.width - overlayBefore.width;
    const stripDelta = stripAfter.width - stripBefore.width;
    record.push({ step: 'stretch tracks', overlayDelta: Math.round(overlayDelta), stripDelta: Math.round(stripDelta), expectedStrip: Math.round(expectedStrip), strip: Math.round(stripAfter.width) });
    if (!near(overlayAfter.width, overlayBefore.width - 160, 20)) fail(`stretch: the overlay panel did not narrow (${Math.round(overlayBefore.width)} -> ${Math.round(overlayAfter.width)})`);
    if (!near(stripDelta, overlayDelta, 4)) fail(`stretch: the panel changed by ${Math.round(overlayDelta)}px and the strip by ${Math.round(stripDelta)}px — it stopped tracking`);
    if (!near(stripAfter.width, expectedStrip, 4)) fail(`stretch: the strip is ${Math.round(stripAfter.width)} wide; inside the toolbar band it should be ${Math.round(expectedStrip)}`);
  }

  // ── a strip clears the taller of its edge's two corners ──
  await place('card', { anchor: 'bottom-right', stretch: null });
  const overlayNow = await boxOr('[data-ndd-panel-overlay]', 'stacking');
  const cardNow = await boxOr('[data-ndd-widget="card"]', 'stacking');
  const stripNow = await boxOr('[data-ndd-widget="strip"]', 'stacking');
  if (overlayNow && cardNow && stripNow) {
    const gapOf = b => overlayNow.y + overlayNow.height - (b.y + b.height);
    const overlapping = stripNow.y < cardNow.y + cardNow.height && cardNow.y < stripNow.y + stripNow.height;
    if (overlapping) fail(`stacking: the strip (${Math.round(stripNow.y)}–${Math.round(stripNow.y + stripNow.height)}) overlaps the corner card (${Math.round(cardNow.y)}–${Math.round(cardNow.y + cardNow.height)})`);
    const [lower, upper] = gapOf(stripNow) < gapOf(cardNow)
      ? [{ name: 'strip', ...stripNow, gap: gapOf(stripNow) }, { name: 'card', ...cardNow, gap: gapOf(cardNow) }]
      : [{ name: 'card', ...cardNow, gap: gapOf(cardNow) }, { name: 'strip', ...stripNow, gap: gapOf(stripNow) }];
    record.push({ step: 'strip clears both corners', lower: lower.name, upperGap: Math.round(upper.gap), lowerGap: Math.round(lower.gap), lowerHeight: Math.round(lower.height) });
    if (!near(upper.gap, lower.gap + lower.height + 8, 3)) fail(`stacking: ${upper.name} sits ${Math.round(upper.gap)}px up but should clear ${lower.name} (${Math.round(lower.gap)} + ${Math.round(lower.height)} + 8)`);
  }

  // ── a docked widget stops at a toolbar, not at the panel edge ──
  await place('card', { anchor: 'top-left', stretch: null });
  await place('strip', { anchor: 'bottom-left', stretch: null });
  const bottomToolbar = await boxOr('[data-ndd-panel-toolbar="bottom"]', 'toolbar');
  const cardTop = await boxOr('[data-ndd-widget="card"]', 'toolbar');
  const sHandle = await boxOr('[data-ndd-widget="card"] .ndd-resize-s', 'toolbar');
  if (bottomToolbar && cardTop && sHandle && overlayNow) {
    await page.mouse.move(sHandle.x + sHandle.width / 2, sHandle.y + sHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(sHandle.x + sHandle.width / 2, overlayNow.y + overlayNow.height + 300, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const grown = await box('[data-ndd-widget="card"]');
    const overlap = grown.y + grown.height - bottomToolbar.y;
    record.push({ step: 'resize stops at the toolbar', overlap: Math.round(overlap), grewFrom: Math.round(cardTop.height), grewTo: Math.round(grown.height) });
    if (overlap > 2) fail(`toolbar: the widget was resized ${Math.round(overlap)}px over the bottom toolbar`);
    if (grown.height <= cardTop.height) fail('toolbar: the widget did not grow at all, so the clamp was not what stopped it');
  }

  // ── 7.11 M2: a managed widget's content lives in its own element ──
  await page.evaluate(() => window.__overlayWidgets.openFill());
  await page.waitForSelector('[data-ndd-widget="wo"] #wo-fill');
  await page.waitForTimeout(250);
  const fill = () => page.evaluate(() => {
    const body = document.querySelector('[data-ndd-widget="wo"] .ndd-panel-float__body');
    const f = document.querySelector('#wo-fill');
    return body && f ? { body: `${body.clientWidth}x${body.clientHeight}`, content: `${f.offsetWidth}x${f.offsetHeight}`, bw: body.clientWidth, bh: body.clientHeight, fw: f.offsetWidth, fh: f.offsetHeight } : null;
  });
  const filled = await fill();
  if (!filled) fail('content: the managed widget has no body or no #wo-fill');
  else {
    record.push({ step: 'content fills the body', body: filled.body, content: filled.content });
    if (!near(filled.fw, filled.bw, 1) || !near(filled.fh, filled.bh, 1)) fail(`content: height: 100% content is ${filled.content} in a ${filled.body} body — it does not fill it`);
  }

  // State and node through a drag free and back onto a corner.
  await page.evaluate(() => { document.querySelector('#wo-fill').__pgMark = 'm2'; });
  await page.click('#wo-count');
  await page.click('#wo-count');
  await page.fill('#wo-text', 'kept');
  const woHeader = await boxOr('[data-ndd-widget="wo"] [data-ndd-widget-header]', 'content');
  const overlayEnd = await boxOr('[data-ndd-panel-overlay]', 'content');
  if (woHeader && overlayEnd) {
    const hx = woHeader.x + 40;
    const hy = woHeader.y + woHeader.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx - 60, hy + 110, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const freed = await page.evaluate(() => document.querySelector('[data-ndd-widget="wo"]')?.style.left ?? '');
    if (!freed) fail('content: the drag did not free the widget (no left position written)');
    const moved = await boxOr('[data-ndd-widget="wo"] [data-ndd-widget-header]', 'content');
    if (moved) {
      await page.mouse.move(moved.x + 40, moved.y + moved.height / 2);
      await page.mouse.down();
      await page.mouse.move(overlayEnd.x + overlayEnd.width - 20, overlayEnd.y + 20, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(250);
    }
    const after = await page.evaluate(() => {
      const w = document.querySelector('[data-ndd-widget="wo"]');
      const f = document.querySelector('#wo-fill');
      return {
        docked: !!w && w.style.left === '' && w.style.insetInlineEnd !== '',
        inFrame: !!w && !!f && w.contains(f),
        mark: f?.__pgMark ?? null,
        count: document.querySelector('#wo-count')?.textContent?.trim() ?? null,
        text: document.querySelector('#wo-text')?.value ?? null,
      };
    });
    record.push({ step: 'content through free and back', ...after });
    if (!after.docked) fail('content: the drag back onto the top-right corner did not dock the widget');
    if (!after.inFrame) fail('content: the content is no longer inside its frame');
    if (after.mark !== 'm2') fail('content: the content DOM node was replaced by the drag');
    if (after.count !== '2') fail(`content: the counter reads ${after.count} after the drag, not 2`);
    if (after.text !== 'kept') fail(`content: the text field reads "${after.text}" after the drag, not "kept"`);
    const refilled = await fill();
    if (refilled && (!near(refilled.fw, refilled.bw, 1) || !near(refilled.fh, refilled.bh, 1))) fail(`content: after the drag the content is ${refilled.content} in a ${refilled.body} body`);
  }

  // A pointerdown in the content raises the widget, also where the content stops the event.
  const active = () => page.evaluate(() => {
    const z = id => Number(document.querySelector(`[data-ndd-widget="${id}"]`)?.style.zIndex || 0);
    return { wo: document.querySelector('[data-ndd-widget="wo"]')?.classList.contains('ndd-panel-float--active') ?? false, woZ: z('wo'), cardZ: z('card') };
  });
  const pressAt = async (sel, step) => {
    const b = await boxOr(sel, step);
    if (!b) return false;
    const p = { x: b.x + Math.min(10, b.width / 2), y: b.y + b.height / 2 };
    const hit = await page.evaluate(([q, s]) => document.elementFromPoint(q.x, q.y)?.closest(s) !== null, [p, sel]);
    if (!hit) { fail(`${step}: "${sel}" is covered at the press point`); return false; }
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(150);
    return true;
  };
  for (const [target, step] of [['#wo-canvas', 'raise (canvas that stops the event)'], ['#wo-fill', 'raise (plain content)']]) {
    if (!(await pressAt('[data-ndd-widget="card"] [data-ndd-widget-header]', step))) continue;
    const lowered = await active();
    if (lowered.wo) { fail(`${step}: pressing the card did not lower the widget`); continue; }
    if (target === '#wo-fill') {
      // Below the controls, clear of the frame's resize handles: the fill itself.
      const b = await boxOr('#wo-fill', step);
      if (!b) continue;
      const p = { x: b.x + b.width / 2, y: b.y + b.height - 24 };
      const hit = await page.evaluate(q => document.elementFromPoint(q.x, q.y)?.id ?? 'none', p);
      if (hit !== 'wo-fill') { fail(`${step}: the press point hits "${hit}", not #wo-fill`); continue; }
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(150);
    } else if (!(await pressAt(target, step))) continue;
    const raised = await active();
    record.push({ step, ...raised });
    if (!raised.wo || raised.woZ <= raised.cardZ) fail(`${step}: a press in the content did not bring the widget to the front (z ${raised.woZ} vs card ${raised.cardZ})`);
  }

  // ── 7.11 M3: a managed widget out of its panel and back ──
  const W = 'ov/wo';
  const moveWo = async to => {
    const r = await page.evaluate(t => window.__overlayWidgets.move('wo', t), to);
    await page.waitForTimeout(300);
    return r;
  };
  const woSnapshot = () => page.evaluate(id => {
    const el = document.querySelector('.ndd-panel-float__content');
    const parent = el?.parentElement;
    const hostedBox = [...document.querySelectorAll('[data-ndd-panel]')].find(e => e.getAttribute('data-ndd-panel') === id);
    const hosted = !!parent?.classList.contains('ndd-hosted-widget');
    const box = hosted ? hostedBox : parent;
    const canvas = document.querySelector('#wo-gl');
    const gl = canvas?.__gl;
    return {
      location: window.__overlayWidgets.location('wo'),
      same: el?.__m3mark === 'original',
      count: document.querySelector('#wo-count')?.textContent?.trim() ?? null,
      text: document.querySelector('#wo-text')?.value ?? null,
      scroll: document.querySelector('#wo-scroll')?.scrollTop ?? null,
      glAlive: !!gl && canvas.getContext('webgl') === gl && !gl.isContextLost() && canvas.__glLost === 0,
      slot: hosted ? 'hosted' : parent?.classList.contains('ndd-panel-float__body') ? 'frame' : (parent?.className ?? null),
      inHostedPanel: !!el && !!hostedBox && hostedBox.contains(el),
      frame: !!document.querySelector('[data-ndd-widget="wo"]'),
      fills: !!el && !!box && el.offsetWidth > 0 && el.offsetHeight > 0 && el.offsetWidth === box.clientWidth && el.offsetHeight === box.clientHeight,
      size: el ? [el.offsetWidth, el.offsetHeight] : null,
      box: box ? [box.clientWidth, box.clientHeight] : null,
    };
  }, W);
  const prepareWo = async (withMenu = false) => {
    await page.evaluate(() => window.__overlayWidgets.close('wo'));
    await page.waitForTimeout(150);
    await page.evaluate(m => window.__overlayWidgets.openFill(m), withMenu);
    await page.waitForSelector('[data-ndd-widget="wo"] #wo-gl');
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      document.querySelector('.ndd-panel-float__content').__m3mark = 'original';
      document.querySelector('#wo-scroll').scrollTop = 30;
    });
    await page.click('#wo-count');
    await page.fill('#wo-text', 'typed');
    await page.waitForTimeout(100);
  };
  const woKept = { same: true, count: '1', text: 'typed', scroll: 30, glAlive: true, fills: true };
  const expectWo = (step, got, want) => {
    record.push({ step, ...got });
    for (const [k, v] of Object.entries(want)) {
      if (got[k] !== v) fail(`${step}: ${k} is ${JSON.stringify(got[k])}, expected ${JSON.stringify(v)} — ${JSON.stringify(got)}`);
    }
  };

  await prepareWo();
  if (!(await page.evaluate(() => !!document.querySelector('#wo-gl')?.__gl))) fail('out: no WebGL context could be created, so its survival is not tested');
  const journey = [
    [{ to: 'docked', position: 'bottom', size: 0.4 }, 'docked', 'hosted'],
    [{ to: 'tabbed' }, 'tabbed', 'hosted'],
    [{ to: 'floating', rect: { x: 80, y: 80, width: 320, height: 240 } }, 'floating', 'hosted'],
    [{ to: 'panel' }, 'panel', 'frame'],
    [{ to: 'floating' }, 'floating', 'hosted'],
  ];
  for (const [to, where, slot] of journey) {
    const r = await moveWo(to);
    if (!r?.ok) fail(`out: move(${JSON.stringify(to)}) was refused: ${JSON.stringify(r)}`);
    expectWo(`out: ${JSON.stringify(to)}`, await woSnapshot(), { ...woKept, location: where, slot, frame: slot === 'frame', inHostedPanel: slot === 'hosted' });
  }
  // Floating without a rect from the panel opens where the frame was, at its size.
  const floated = await page.evaluate(id => window.__pg.ws.state().floating.find(w => w.id === id) ?? null, W);
  record.push({ step: 'out: floating without a rect', floated });
  if (!floated || floated.x === 0 || floated.y === 0) fail(`out: floating without a rect opened at ${JSON.stringify(floated)}, not where the frame was`);
  // Minimised and restored by the workspace, then home.
  await page.evaluate(id => window.__pg.ws.minimizePanel(id), W);
  await page.waitForTimeout(300);
  expectWo('out: minimised', await woSnapshot(), { location: 'minimized', same: true, glAlive: true });
  await page.evaluate(id => window.__pg.ws.restorePanel(id), W);
  await page.waitForTimeout(300);
  expectWo('out: restored', await woSnapshot(), { ...woKept, location: 'floating', slot: 'hosted' });
  await moveWo({ to: 'panel' });
  expectWo('out: home again', await woSnapshot(), { ...woKept, location: 'panel', slot: 'frame', frame: true });

  // The × on its tab closes the widget.
  await moveWo({ to: 'tabbed' });
  await page.click(`[data-ndd-tab="${W}"] .ndd-close-tab-x`);
  await page.waitForTimeout(300);
  const afterX = await page.evaluate(id => ({
    open: window.__overlayWidgets.openIds().includes('wo'),
    content: !!document.querySelector('.ndd-panel-float__content'),
    panel: id in window.__pg.ws.state().panels,
  }), W);
  record.push({ step: 'out: the tab × closes it', ...afterX });
  if (afterX.open || afterX.content || afterX.panel) fail(`out: the tab's × did not close the widget: ${JSON.stringify(afterX)}`);

  // The same under RTL.
  await page.evaluate(() => window.__pg.ws.setDirection('rtl'));
  await page.waitForTimeout(200);
  await prepareWo();
  await moveWo({ to: 'docked', position: 'bottom' });
  expectWo('out (RTL): docked', await woSnapshot(), { ...woKept, location: 'docked', slot: 'hosted' });
  await moveWo({ to: 'panel' });
  expectWo('out (RTL): home', await woSnapshot(), { ...woKept, location: 'panel', slot: 'frame', frame: true });
  await page.evaluate(() => window.__pg.ws.setDirection('ltr'));
  await page.waitForTimeout(200);

  // ── 7.11 M4 + next.1: the widget's titleMenu, in the panel and out of it ──
  const menuLabels = () => page.evaluate(() => {
    const m = document.querySelector('[data-ndd-menu]');
    return m ? [...m.children].map(c => (c.tagName === 'HR' ? '---' : c.querySelector('.ndd-context-menu__label')?.textContent?.trim() ?? '?')) : null;
  });
  const closeMenu = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  };
  /** Press on `sel` and drag 140px away, in steps, then release there. */
  const dragFrom = async sel => {
    const b = await boxOr(sel, `drag from ${sel}`);
    if (!b) return;
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 14, y + i * 10);
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const where = () => page.evaluate(id => {
    const s = window.__pg.ws.state();
    return JSON.stringify({ grid: s.gridRoot, floating: s.floating.map(w => [w.id, w.x, w.y, w.width, w.height]), state: s.panels[id]?.state ?? null });
  }, W);
  const MENU_BTN = '[data-ndd-widget="wo"] button.ndd-panel-float__menu';
  await prepareWo(true);
  // In the panel: a drag from the button moves nothing; a click opens the app's items, in place.
  const frameAt = await boxOr('[data-ndd-widget="wo"]', 'menu: the frame');
  await dragFrom(MENU_BTN);
  await closeMenu();
  const frameAfterDrag = await boxOr('[data-ndd-widget="wo"]', 'menu: the frame after a drag from its button');
  record.push({ step: 'menu: drag from the title button', frameAt, frameAfterDrag });
  if (frameAt && frameAfterDrag && (!near(frameAt.x, frameAfterDrag.x) || !near(frameAt.y, frameAfterDrag.y))) fail(`menu: a drag from the title-menu button moved the widget: ${JSON.stringify([frameAt, frameAfterDrag])}`);
  await page.click(MENU_BTN);
  await page.waitForTimeout(250);
  const inPanel = { labels: await menuLabels(), frame: await box('[data-ndd-widget="wo"]') };
  record.push({ step: 'menu: click the title button', ...inPanel });
  if (JSON.stringify(inPanel.labels) !== JSON.stringify(['Dock below', 'Open as a tab'])) fail(`menu: the title button opened ${JSON.stringify(inPanel.labels)}, not the app's items`);
  if (frameAt && inPanel.frame && (!near(frameAt.x, inPanel.frame.x) || !near(frameAt.y, inPanel.frame.y))) fail('menu: a click on the title button moved the widget');
  if (inPanel.labels) {
    await page.click('[data-ndd-menu-item="Dock below"]');
    await page.waitForTimeout(400);
    expectWo('menu: the item docks it', await woSnapshot(), { ...woKept, location: 'docked', slot: 'hosted' });
  }
  // From the keyboard: the menu opens on its first item.
  await moveWo({ to: 'panel' });
  await page.focus(MENU_BTN);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-ndd-menu-item') ?? document.activeElement?.className ?? null);
  record.push({ step: 'menu: Enter on the title button', focused, labels: await menuLabels() });
  if (focused !== 'Dock below') fail(`menu: Enter on the title button focused ${JSON.stringify(focused)}, not the first item`);
  await closeMenu();

  // Out of the panel, a tab: a drag from its icon moves nothing; a click opens its menu.
  const TAB_ICON = `[data-ndd-tab="${W}"] .ndd-workspace-tab-icon--menu`;
  await moveWo({ to: 'tabbed' });
  const tabBefore = await where();
  await dragFrom(TAB_ICON);
  await closeMenu();
  if ((await where()) !== tabBefore) fail('menu: a drag from the hosted tab\'s icon moved the panel');
  await page.click(TAB_ICON);
  await page.waitForTimeout(250);
  const tabMenu = await menuLabels();
  record.push({ step: 'menu: the hosted tab icon', labels: tabMenu });
  if (JSON.stringify(tabMenu) !== JSON.stringify(['Back into the panel', '---', 'Minimize Panel', '---', 'Close Tab'])) fail(`menu: the hosted tab's icon opened ${JSON.stringify(tabMenu)}`);
  await closeMenu();

  // Floating: the title bar's icon, likewise; its item brings the widget home.
  const WIN_ICON = `[data-ndd-window="${W}"] .ndd-window-title-icon--menu`;
  await moveWo({ to: 'floating', rect: { x: 120, y: 90, width: 300, height: 220 } });
  const winBefore = await where();
  await dragFrom(WIN_ICON);
  await closeMenu();
  if ((await where()) !== winBefore) fail('menu: a drag from the floating title bar\'s icon moved the window');
  await page.click(WIN_ICON);
  await page.waitForTimeout(250);
  const winMenu = await menuLabels();
  record.push({ step: 'menu: the floating title icon', labels: winMenu });
  if (JSON.stringify(winMenu) !== JSON.stringify(['Back into the panel', '---', 'Close Panel'])) fail(`menu: the floating title bar's icon opened ${JSON.stringify(winMenu)}`);
  if (winMenu) {
    await page.click('[data-ndd-menu-item="Back into the panel"]');
    await page.waitForTimeout(400);
    expectWo('menu: back into the panel', await woSnapshot(), { ...woKept, location: 'panel', slot: 'frame', frame: true });
  }

  // ── 7.11 M5: onWillMove sees the old size, onMoved the new one ──
  const contentSize = () => page.evaluate(() => {
    const el = document.querySelector('.ndd-panel-float__content');
    return el ? [el.offsetWidth, el.offsetHeight] : null;
  });
  const expectMoves = async (step, act) => {
    const before = await contentSize();
    await page.evaluate(() => { window.__woMoves.length = 0; });
    await act();
    await page.waitForTimeout(400);
    const after = await contentSize();
    const got = await page.evaluate(() => (window.__woMoves ?? []).map(m => ({ ...m })));
    record.push({ step, before, after, got });
    const sized = (m, s) => !!m && !!s && m.w === s[0] && m.h === s[1];
    if (got.length !== 2 || got[0].kind !== 'will' || got[1].kind !== 'moved') fail(`${step}: expected one will then one moved, got ${JSON.stringify(got)}`);
    else {
      if (!sized(got[0], before)) fail(`${step}: onWillMove saw ${got[0].w}×${got[0].h}, not the old size ${before}`);
      if (!sized(got[1], after)) fail(`${step}: onMoved saw ${got[1].w}×${got[1].h}, not the new size ${after}`);
    }
    if (before && after && before[0] === after[0] && before[1] === after[1]) fail(`${step}: the size did not change (${before}), so the check proves nothing`);
  };
  await expectMoves('callbacks: move() docked', () => moveWo({ to: 'docked', position: 'bottom', size: 0.5 }));
  await expectMoves('callbacks: move() home', () => moveWo({ to: 'panel' }));
  await moveWo({ to: 'tabbed' });
  await expectMoves('callbacks: the user floats it', () => page.evaluate(id => window.__pg.ws.floatPanel(id, { x: 60, y: 60, width: 260, height: 150 }), W));
  await moveWo({ to: 'panel' });

  // ── 7.11 M6: a managed widget's saved placement ──
  const placementOf = () => page.evaluate(() => window.__overlayWidgets.placement('wo'));
  const reopenAt = async saved => {
    await page.evaluate(() => window.__overlayWidgets.close('wo'));
    await page.waitForTimeout(150);
    await page.evaluate(p => window.__overlayWidgets.openFillAt(p), saved);
    await page.waitForTimeout(400);
  };
  /** The frame's box, relative to its overlay; `null` when there is none, `shown: false` while hidden. */
  const frameRel = () => page.evaluate(() => {
    const f = document.querySelector('[data-ndd-widget="wo"]');
    const o = f?.closest('[data-ndd-panel-overlay]');
    if (!f || !o) return null;
    const a = f.getBoundingClientRect(), b = o.getBoundingClientRect();
    return { x: Math.round(a.x - b.x), y: Math.round(a.y - b.y), w: Math.round(a.width), h: Math.round(a.height), shown: a.width > 0 && b.width > 0 };
  });
  const sameBox = (a, b) => !!a && !!b && near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
  await prepareWo();
  // Dragged free by the header's middle (its start may be a title-menu button, which never drags).
  const pHeader = await boxOr('[data-ndd-widget="wo"] [data-ndd-widget-header]', 'placement');
  if (pHeader) {
    const px = pHeader.x + pHeader.width / 2, py = pHeader.y + pHeader.height / 2;
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px - 130, py + 90, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  const draggedTo = await frameRel();
  const savedFree = await placementOf();
  record.push({ step: 'placement: dragged free', draggedTo, savedFree });
  if (savedFree?.mode !== 'free') fail(`placement: the drag did not free the widget, placement() is ${JSON.stringify(savedFree)}`);
  await reopenAt(savedFree);
  const reopened = await frameRel();
  record.push({ step: 'placement: closed and re-opened at it', reopened });
  if (!sameBox(draggedTo, reopened)) fail(`placement: a dragged free position did not come back: ${JSON.stringify(draggedTo)} → ${JSON.stringify(reopened)}`);
  // Re-opened while its panel is a background tab (0×0): placed once it is shown.
  await page.evaluate(() => {
    window.__pg.ws.openPanel('cover', 'editor');
    window.__pg.ws.dockPanelToGroup('cover', 'L', 'center');
  });
  await page.waitForTimeout(250);
  await reopenAt(savedFree);
  const whileHidden = await placementOf();
  if (JSON.stringify(whileHidden) !== JSON.stringify(savedFree)) fail(`placement: hidden, placement() is ${JSON.stringify(whileHidden)}, not the saved ${JSON.stringify(savedFree)}`);
  await page.evaluate(() => window.__pg.ws.focusPanel('ov'));
  await page.waitForTimeout(400);
  const whenShown = await frameRel();
  record.push({ step: 'placement: re-opened in a background tab, then shown', whileHidden, whenShown });
  if (!whenShown?.shown || !sameBox(draggedTo, whenShown)) fail(`placement: re-opened in a background tab, it showed at ${JSON.stringify(whenShown)}, not ${JSON.stringify(draggedTo)}`);
  await page.evaluate(() => window.__pg.ws.closePanel('cover'));
  await page.waitForTimeout(250);
  // Out of the panel: closed and re-opened at its placement, it docks again.
  await moveWo({ to: 'docked', position: 'bottom', size: 0.4 });
  const savedOut = await placementOf();
  await reopenAt(savedOut);
  const redocked = await page.evaluate(id => {
    const s = window.__pg.ws.state();
    const leafOf = (n, pid) => (n.type === 'leaf' ? (n.panels.includes(pid) ? n.id : null) : n.children.reduce((f, c) => f ?? leafOf(c, pid), null));
    return { location: window.__overlayWidgets.location('wo'), state: s.panels[id]?.state ?? null, own: leafOf(s.gridRoot, id), owner: leafOf(s.gridRoot, 'ov'), shown: !!document.querySelector(`[data-ndd-panel="${id}"] .ndd-panel-float__content #wo-fill`) };
  }, W);
  record.push({ step: 'placement: out of the panel, closed and re-opened at it', savedOut, redocked });
  if (savedOut?.at !== 'docked' || savedOut?.position !== 'bottom') fail(`placement: out of the panel, placement() is ${JSON.stringify(savedOut)}`);
  if (redocked.location !== 'docked' || redocked.state !== 'docked' || !redocked.own || redocked.own === redocked.owner || !redocked.shown) fail(`placement: re-opened at a docked placement, it is ${JSON.stringify(redocked)}`);
  await moveWo({ to: 'panel' });

  // ── 7.11 M7: preserveEmbeds — an iframe that keeps its document ──
  const hasMoveBefore = await page.evaluate(() => typeof Element.prototype.moveBefore === 'function');
  record.push({ step: 'embeds: moveBefore in this Chrome', hasMoveBefore });
  if (!hasMoveBefore) fail('embeds: this Chrome has no Element.prototype.moveBefore, so the checks below prove nothing');
  const loads = () => page.evaluate(() => ({ ...(window.__embedLoads ?? {}) }));
  await page.evaluate(() => {
    const { ws } = window.__pg;
    ws.openPanel('ek', 'embedKept', { inputs: { name: 'kept' } });
    ws.dockPanelToGroup('ek', 'R', 'center');
    ws.openPanel('eb', 'embedBare', { inputs: { name: 'bare' } });
    ws.dockPanelToGroup('eb', 'R', 'center');
  });
  await page.waitForFunction(() => (window.__embedLoads?.kept ?? 0) >= 1 && (window.__embedLoads?.bare ?? 0) >= 1, null, { timeout: 5000 });
  await page.waitForTimeout(300);
  /** Each step on both panels; the kept one must load once, the bare one (the control) reloads. */
  const embedSteps = [
    ['a drag of its tab to the other group', async id => {
      await page.evaluate(i => window.__pg.ws.focusPanel(i), id);
      await page.waitForTimeout(200);
      const tab = await boxOr(`[data-ndd-tab="${id}"]`, `embeds: ${id}'s tab`);
      const target = await boxOr('.ndd-workspace-panel[data-ndd-leaf="L"]', 'embeds: group L');
      if (!tab || !target) return;
      await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
      await page.mouse.down();
      await page.mouse.move(tab.x + tab.width / 2 + 30, tab.y + tab.height / 2 + 30, { steps: 4 });
      await page.waitForTimeout(120);
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
      await page.waitForTimeout(140);
      await page.mouse.up();
      await page.waitForTimeout(300);
      const leaf = await page.evaluate(i => {
        const leafOf = (n, pid) => (n.type === 'leaf' ? (n.panels.includes(pid) ? n.id : null) : n.children.reduce((f, c) => f ?? leafOf(c, pid), null));
        return leafOf(window.__pg.ws.state().gridRoot, i);
      }, id);
      if (leaf !== 'L') fail(`embeds: the drag of ${id}'s tab left it in ${leaf}, not group L`);
    }],
    ['docked back with dockPanelToGroup', id => page.evaluate(i => window.__pg.ws.dockPanelToGroup(i, 'R', 'center'), id)],
    ['a split beside it', id => page.evaluate(i => {
      window.__pg.ws.openPanel(`${i}-side`, 'editor', { dockTo: { panel: i, position: 'bottom' } });
    }, id)],
    ['floated', id => page.evaluate(i => window.__pg.ws.floatPanel(i, { x: 200, y: 120, width: 320, height: 220 }), id)],
    ['docked', id => page.evaluate(i => window.__pg.ws.dockPanel(i, 'R'), id)],
    ['minimised, and its taskbar preview shown and dismissed', async id => {
      await page.evaluate(i => window.__pg.ws.minimizePanel(i), id);
      await page.waitForTimeout(300);
      const item = await boxOr(`[data-ndd-taskbar-item="${id}"]`, `embeds: ${id}'s taskbar item`);
      if (!item) return;
      await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2, { steps: 3 });
      await page.waitForTimeout(300);
      const previewed = await page.evaluate(n => !!document.querySelector(`[data-ndd-preview] iframe[data-embed="${n}"]`), id === 'ek' ? 'kept' : 'bare');
      if (!previewed) fail(`embeds: hovering ${id}'s taskbar item did not preview the panel itself`);
      await page.mouse.move(item.x + item.width / 2, item.y - 300, { steps: 3 });
      await page.waitForTimeout(400);
    }],
    ['restored', id => page.evaluate(i => window.__pg.ws.restorePanel(i), id)],
    ['the side panel closed', id => page.evaluate(i => window.__pg.ws.closePanel(`${i}-side`), id)],
  ];
  for (const [name, act] of embedSteps) {
    for (const id of ['ek', 'eb']) {
      await act(id);
      await page.waitForTimeout(350);
    }
    // The kept one's tab selected (a tab switch is a move too), then both measured.
    await page.evaluate(() => window.__pg.ws.state().panels.ek?.state !== 'minimized' && window.__pg.ws.focusPanel('ek'));
    await page.waitForTimeout(250);
    const now = await loads();
    const shown = await page.evaluate(() => ['kept', 'bare'].map(n => {
      const f = document.querySelector(`iframe[data-embed="${n}"]`);
      return !!f && f.getBoundingClientRect().width > 0;
    }));
    record.push({ step: `embeds: ${name}`, loads: now, shown });
    if (now.kept !== 1) fail(`embeds: ${name}: the preserveEmbeds panel's iframe has loaded ${now.kept} times, not once`);
    if (!shown[0] && !name.startsWith('minimised')) fail(`embeds: ${name}: the preserveEmbeds panel's iframe is not on screen`);
  }
  const bareLoads = (await loads()).bare ?? 0;
  if (bareLoads < 2) fail(`embeds: the control panel (no preserveEmbeds) loaded ${bareLoads} times: its moves did not reload it, so the check proves nothing`);
  await page.evaluate(() => {
    window.__pg.ws.closePanel('ek');
    window.__pg.ws.closePanel('eb');
  });
  await page.waitForTimeout(250);
  // A widget with preserveEmbeds: out of the panel, between places, the user's moves, and back.
  await page.evaluate(() => window.__overlayWidgets.openEmbed());
  await page.waitForFunction(() => (window.__embedLoads?.widget ?? 0) >= 1, null, { timeout: 5000 });
  await page.waitForTimeout(250);
  const E = 'ov/emb';
  const widgetSteps = [
    ['docked', () => page.evaluate(() => window.__overlayWidgets.move('emb', { to: 'docked', position: 'bottom', size: 0.4 }))],
    ['floating', () => page.evaluate(() => window.__overlayWidgets.move('emb', { to: 'floating', rect: { x: 220, y: 140, width: 300, height: 200 } }))],
    ['tabbed', () => page.evaluate(() => window.__overlayWidgets.move('emb', { to: 'tabbed' }))],
    ['docked right', () => page.evaluate(() => window.__overlayWidgets.move('emb', { to: 'docked', position: 'right' }))],
    ['the user floats its panel', () => page.evaluate(id => window.__pg.ws.floatPanel(id, { x: 160, y: 100, width: 300, height: 200 }), E)],
    ['the user minimises it', () => page.evaluate(id => window.__pg.ws.minimizePanel(id), E)],
    ['the user restores it', () => page.evaluate(id => window.__pg.ws.restorePanel(id), E)],
    ['the user docks it', () => page.evaluate(id => window.__pg.ws.dockPanel(id, 'R'), E)],
    ['back into the panel', () => page.evaluate(() => window.__overlayWidgets.move('emb', { to: 'panel' }))],
  ];
  for (const [name, act] of widgetSteps) {
    await act();
    await page.waitForTimeout(400);
    const now = await loads();
    const where = await page.evaluate(() => window.__overlayWidgets.location('emb'));
    record.push({ step: `embeds (widget): ${name}`, loads: now.widget, where });
    if (now.widget !== 1) fail(`embeds (widget): ${name}: its iframe has loaded ${now.widget} times, not once`);
  }
  const embHome = await page.evaluate(() => !!document.querySelector('[data-ndd-widget="emb"] .ndd-panel-float__body iframe[data-embed="widget"]'));
  if (!embHome) fail('embeds (widget): back into the panel, its iframe is not in its frame');
  await page.evaluate(() => window.__overlayWidgets.close('emb'));
  await page.waitForTimeout(200);

  const survival = await page.evaluate(() => ({ mounts: window.__mounts?.other ?? 0 }));
  await shot('overlay');

  // Last: the owner closing takes the widget and its hosted panel with it.
  await moveWo({ to: 'docked', position: 'right' });
  await page.evaluate(() => window.__pg.ws.closePanel('ov'));
  await page.waitForTimeout(300);
  const ownerGone = await page.evaluate(id => ({
    panel: id in window.__pg.ws.state().panels,
    content: !!document.querySelector('.ndd-panel-float__content'),
    store: !!document.querySelector('.ndd-widget-store'),
  }), W);
  record.push({ step: 'out: the owner closes', ...ownerGone });
  if (ownerGone.panel || ownerGone.content || ownerGone.store) fail(`out: closing the owner left ${JSON.stringify(ownerGone)}`);
  return { record, survival };
});
