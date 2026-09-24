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
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

await runBrowserGate(control ? 'M11-control' : 'M11', { viewport: { width: 1280, height: 860 } }, async (page, { fail, open, shot }) => {
  await open('layout=two-leaf');
  if (control) await page.addStyleTag({ content: RDD_HANDLES });
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

  const survival = await page.evaluate(() => ({ mounts: window.__mounts?.other ?? 0 }));
  await shot('overlay');
  return { record, survival };
});
