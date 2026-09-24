/**
 * Ported verbatim from vue-dockable-desktop `test/core/anchorGeometry.test.ts` — framework-free logic, so only
 * the import paths changed. Test names and IDs are preserved (ADR 0009).
 */
/** Ported from react-dockable-desktop `anchorGeometry.test.ts` (5 tests), names preserved. */
import { describe, it, expect } from 'vitest';
import {
  MIN_CLAMP_H,
  MIN_CLAMP_W,
  clampFloatingRect,
  flipZoneHorizontal,
} from '../../src/lib/core/anchor-geometry';
import { ANCHORS } from '../../src/lib/core/stretch';

describe('flipZoneHorizontal', () => {
  it('flips top-left to top-right', () => expect(flipZoneHorizontal('top-left')).toBe('top-right'));
  it('flips top-right to top-left', () => expect(flipZoneHorizontal('top-right')).toBe('top-left'));
  it('flips bottom-left to bottom-right', () =>
    expect(flipZoneHorizontal('bottom-left')).toBe('bottom-right'));
  it('flips bottom-right to bottom-left', () =>
    expect(flipZoneHorizontal('bottom-right')).toBe('bottom-left'));

  it('is its own inverse for every corner', () => {
    for (const a of ANCHORS) expect(flipZoneHorizontal(flipZoneHorizontal(a))).toBe(a);
  });
});

// ─── clampFloatingRect ───────────────────────────────────────────────────────

describe('clampFloatingRect', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it('returns the same object when nothing needs to change', () => {
    // Identity, not equality: the caller watches the window list deeply and writes back to
    // it, so a write that changes nothing re-triggers the watcher forever. Returning the
    // input is how the caller can tell there is nothing to write.
    const input = rect(10, 10, 400, 300);
    expect(clampFloatingRect(input, { width: 1200, height: 800 }, false)).toBe(input);
  });

  it('shrinks a window larger than the workspace', () => {
    const out = clampFloatingRect(rect(0, 0, 4000, 4000), { width: 1000, height: 600 }, false);
    expect(out.width).toBe(980); // width - 20
    expect(out.height).toBe(560); // height - 40
  });

  it('pulls a free-floating window back far enough to grab its title bar', () => {
    const out = clampFloatingRect(rect(5000, 5000, 300, 200), { width: 1000, height: 600 }, false);
    expect(out.x).toBe(900); // width - 100
    expect(out.y).toBe(560); // height - 40
  });

  it("leaves an anchored window's position alone, but still clamps its size", () => {
    // An anchored window is placed entirely by its anchor and reading direction, so its
    // stored x/y do not affect where it appears.
    const out = clampFloatingRect(rect(5000, 5000, 4000, 4000), { width: 1000, height: 600 }, true);
    expect(out.x).toBe(5000);
    expect(out.y).toBe(5000);
    expect(out.width).toBe(980);
    expect(out.height).toBe(560);
  });

  it('settles in a workspace smaller than the clamp floors', () => {
    // The pathological case, and the bug: both clamps have a floor (200x150), so in a tiny
    // workspace the clamped value still fails its own condition. Applying the clamp twice
    // must reach a fixed point, or the caller's watcher rewrites the same value forever —
    // which is what M13's browser tour surfaced as "Maximum recursive updates exceeded".
    const view = { width: 120, height: 90 };
    const once = clampFloatingRect(rect(900, 900, 4000, 4000), view, false);
    const twice = clampFloatingRect(once, view, false);
    expect(twice).toBe(once); // a fixed point, by identity
    expect(once.width).toBe(MIN_CLAMP_W); // the floor, even though it exceeds the view
    expect(once.height).toBe(MIN_CLAMP_H);
    expect(once.x).toBe(20); // maxX = 120 - 100
    expect(once.y).toBe(50); // maxY = 90 - 40
  });

  it('pins to zero when the workspace is narrower than the title-bar allowance', () => {
    // maxX goes negative below 100px wide, and `Math.max(0, …)` is what stops the window
    // being pushed off the near edge instead of the far one.
    const out = clampFloatingRect(rect(900, 900, 300, 200), { width: 40, height: 30 }, false);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(clampFloatingRect(out, { width: 40, height: 30 }, false)).toBe(out);
  });

  it('reaches a fixed point for every combination of over-large box and tiny workspace', () => {
    // Exhaustive rather than illustrative: the loop only appeared for particular ratios, so
    // "it settles" has to hold across the range, not at one sample.
    for (const w of [40, 90, 120, 199, 200, 201, 500]) {
      for (const h of [30, 60, 90, 149, 150, 151, 400]) {
        for (const anchored of [false, true]) {
          const view = { width: w, height: h };
          const first = clampFloatingRect(rect(9000, 9000, 9000, 9000), view, anchored);
          expect(clampFloatingRect(first, view, anchored), `${w}x${h} anchored=${anchored}`).toBe(
            first,
          );
        }
      }
    }
  });
});
