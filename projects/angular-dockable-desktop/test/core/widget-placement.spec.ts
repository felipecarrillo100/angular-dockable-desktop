/**
 * A managed widget's saved placement (rdd 7.11.0, M6): the pure part in core/widget-placement.ts.
 * Ported verbatim from vdd `test/core/widgetPlacement.test.ts` (itself rdd's
 * `WidgetPlacement.test.ts`): names and values kept, since the JSON is the same in all three.
 *
 * WP1: a docked widget round-trips: anchor, stretch, size
 * WP2: a free position is an offset from the nearest corner, so it keeps its gap on a bigger panel
 * WP3: ...and is measured from inline-start, so it mirrors in RTL
 * WP4: restoring into a smaller panel clamps the size and the position
 * WP5: with no panel size yet, a free position is deferred (docked meanwhile)
 * WP6: reading a value back: an unknown v or broken fields fall back; out-of-panel parts validated
 */
import { describe, it, expect } from 'vitest';
import { toPanelForm, fromPanelForm, parsePlacement } from '../../src/lib/core/widget-placement';
import type { PanelPlacementState } from '../../src/lib/core/widget-placement';

const box = (width: number, height: number, rtl = false) => ({ width, height, rtl });
const free = (x: number, y: number, w = 200, h = 100): PanelPlacementState => ({
  anchor: 'top-left',
  stretch: null,
  mode: 'free',
  freePos: { x, y },
  size: { w, h },
});

describe('WP1: docked', () => {
  it('round-trips anchor, stretch and size', () => {
    const p: PanelPlacementState = {
      anchor: 'bottom-right',
      stretch: 'width',
      mode: 'docked',
      freePos: null,
      size: { w: 240, h: 160 },
    };
    const form = toPanelForm(p, box(800, 600));
    expect(form).toEqual({
      v: 1,
      at: 'panel',
      anchor: 'bottom-right',
      stretch: 'width',
      mode: 'docked',
      width: 240,
      height: 160,
    });
    expect(fromPanelForm(form, box(800, 600))).toEqual({ state: p, deferred: false });
  });
});

describe('WP2: a free position keeps its gap to the nearest corner', () => {
  it('near the bottom right, 16px in, stays so on a bigger panel', () => {
    // 800x600 panel, a 200x100 widget whose right edge is 16px from the right, bottom edge 24px up.
    const form = toPanelForm(free(800 - 200 - 16, 600 - 100 - 24), box(800, 600));
    expect(form.offset).toEqual({ corner: 'bottom-right', inline: 16, block: 24 });
    const { state } = fromPanelForm(form, box(1200, 900));
    expect(state.freePos).toEqual({ x: 1200 - 200 - 16, y: 900 - 100 - 24 });
    expect(state.mode).toBe('free');
  });

  it('near the top left keeps its plain offsets', () => {
    const form = toPanelForm(free(30, 40), box(800, 600));
    expect(form.offset).toEqual({ corner: 'top-left', inline: 30, block: 40 });
    expect(fromPanelForm(form, box(1000, 700)).state.freePos).toEqual({ x: 30, y: 40 });
  });
});

describe('WP3: RTL', () => {
  it('measures inline from inline-start, so an LTR placement mirrors', () => {
    // LTR: 30px from the left (inline-start).
    const form = toPanelForm(free(30, 40), box(800, 600));
    // Restored in RTL: 30px from the right (inline-start there).
    expect(fromPanelForm(form, box(800, 600, true)).state.freePos).toEqual({
      x: 800 - 200 - 30,
      y: 40,
    });
    // And measured in RTL: 30px from the right is inline-start, corner '-left' (logical).
    expect(toPanelForm(free(800 - 200 - 30, 40), box(800, 600, true)).offset).toEqual({
      corner: 'top-left',
      inline: 30,
      block: 40,
    });
  });
});

describe('WP4: a smaller panel', () => {
  it('clamps the size, then the position, into it', () => {
    const form = toPanelForm(free(500, 400, 300, 150), box(1000, 800));
    const { state } = fromPanelForm(form, box(250, 120));
    expect(state.size).toEqual({ w: 250, h: 120 });
    expect(state.freePos).toEqual({ x: 0, y: 0 });
  });

  it('never below the minimum size', () => {
    const { state } = fromPanelForm(
      {
        v: 1,
        at: 'panel',
        anchor: 'top-left',
        stretch: null,
        mode: 'docked',
        width: 10,
        height: 5,
      },
      box(800, 600),
    );
    expect(state.size).toEqual({ w: 120, h: 60 });
  });
});

describe('WP5: no panel size yet', () => {
  it('defers a free position and shows it docked meanwhile; a docked one needs no size', () => {
    const form = toPanelForm(free(30, 40), box(800, 600));
    expect(fromPanelForm(form, null)).toMatchObject({
      deferred: true,
      state: { mode: 'docked', freePos: null },
    });
    expect(fromPanelForm(form, box(0, 0)).deferred).toBe(true);
    expect(fromPanelForm({ ...form, mode: 'docked' }, null).deferred).toBe(false);
  });

  it('saving with no size keeps the position as a top-left offset', () => {
    expect(toPanelForm(free(30, 40), null).offset).toEqual({
      corner: 'top-left',
      inline: 30,
      block: 40,
    });
  });
});

describe('WP6: reading a value back', () => {
  const home = {
    v: 1,
    at: 'panel',
    anchor: 'top-right',
    stretch: null,
    mode: 'docked',
    width: 200,
    height: 100,
  };

  it('an unknown version, or not a value at all, gives nothing', () => {
    expect(parsePlacement({ ...home, v: 2 })).toEqual({ home: null, out: null });
    expect(parsePlacement({ v: 2, at: 'tabbed', home })).toEqual({ home: null, out: null });
    expect(parsePlacement(null)).toEqual({ home: null, out: null });
    expect(parsePlacement('x')).toEqual({ home: null, out: null });
  });

  it('broken fields drop the panel form; unknown fields are ignored', () => {
    expect(parsePlacement({ ...home, anchor: 'middle' }).home).toBeNull();
    expect(parsePlacement({ ...home, width: -1 }).home).toBeNull();
    expect(parsePlacement({ ...home, mode: 'loose' }).home).toBeNull();
    expect(parsePlacement({ ...home, stretch: 'diagonal' }).home).toBeNull();
    expect(parsePlacement({ ...home, extra: 1 }).home).toEqual(home);
    expect(parsePlacement({ ...home, offset: { corner: 'x', inline: 1, block: 1 } }).home).toEqual(
      home,
    );
  });

  it('out of the panel: docked, tabbed and floating, each validated', () => {
    expect(parsePlacement({ v: 1, at: 'docked', home, position: 'bottom', size: 2 })).toEqual({
      home,
      out: { at: 'docked', position: 'bottom', size: 0.9 },
    });
    expect(parsePlacement({ v: 1, at: 'docked', home, position: 'middle' }).out).toBeNull();
    expect(parsePlacement({ v: 1, at: 'tabbed', home })).toEqual({ home, out: { at: 'tabbed' } });
    expect(
      parsePlacement({ v: 1, at: 'floating', home, rect: { x: 5, y: 6, width: 300, height: 200 } })
        .out,
    ).toEqual({ at: 'floating', rect: { x: 5, y: 6, width: 300, height: 200 } });
    expect(
      parsePlacement({ v: 1, at: 'floating', home, rect: { x: 5, y: 6, width: 0, height: 200 } })
        .out,
    ).toBeNull();
    // A broken home still moves out; going back then uses the config's defaults.
    expect(parsePlacement({ v: 1, at: 'tabbed', home: { v: 1 } })).toEqual({
      home: null,
      out: { at: 'tabbed' },
    });
  });
});
