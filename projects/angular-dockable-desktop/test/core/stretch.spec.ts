/**
 * Ported verbatim from vue-dockable-desktop `test/core/stretch.test.ts` — framework-free logic, so only
 * the import paths changed. Test names and IDs are preserved (ADR 0009).
 */
/**
 * The stretch algebra for docked inner widgets.
 *
 * New in vdd: rdd had these as module-private helpers in PanelOverlay.tsx, exercised only
 * through rendered components. Pure here, so the nine placements are checkable directly.
 */
import { describe, it, expect } from 'vitest';
import {
  ANCHORS,
  addAxis,
  bucketsFor,
  releaseAxis,
  stretchesBlock,
  stretchesInline,
  withBlockHalf,
  withInlineHalf,
} from '../../src/lib/core/stretch';
import type { Stretch } from '../../src/lib/core/stretch';

const ALL: (Stretch | null)[] = [null, 'width', 'height', 'both'];

describe('axis predicates', () => {
  it('report which axes span', () => {
    expect(ALL.map(stretchesInline)).toEqual([false, true, false, true]);
    expect(ALL.map(stretchesBlock)).toEqual([false, false, true, true]);
  });
});

describe('addAxis', () => {
  it('adds an axis while keeping whatever was already stretched', () => {
    expect(addAxis(null, 'inline')).toBe('width');
    expect(addAxis(null, 'block')).toBe('height');
    expect(addAxis('height', 'inline')).toBe('both');
    expect(addAxis('width', 'block')).toBe('both');
  });

  it('is idempotent on an axis already stretched', () => {
    expect(addAxis('width', 'inline')).toBe('width');
    expect(addAxis('height', 'block')).toBe('height');
    expect(addAxis('both', 'inline')).toBe('both');
    expect(addAxis('both', 'block')).toBe('both');
  });
});

describe('releaseAxis', () => {
  it('drops one axis and keeps the other', () => {
    expect(releaseAxis('both', 'inline')).toBe('height');
    expect(releaseAxis('both', 'block')).toBe('width');
    expect(releaseAxis('width', 'inline')).toBeNull();
    expect(releaseAxis('height', 'block')).toBeNull();
  });

  it('leaves an axis that was not stretched untouched', () => {
    expect(releaseAxis('height', 'inline')).toBe('height');
    expect(releaseAxis('width', 'block')).toBe('width');
    expect(releaseAxis(null, 'inline')).toBeNull();
    expect(releaseAxis(null, 'block')).toBeNull();
  });

  it('round-trips with addAxis for every state and axis', () => {
    for (const s of ALL) {
      for (const axis of ['inline', 'block'] as const) {
        // adding then releasing returns to a state with that axis unstretched
        const added = addAxis(s, axis);
        const released = releaseAxis(added, axis);
        expect(axis === 'inline' ? stretchesInline(released) : stretchesBlock(released)).toBe(
          false,
        );
        // and the other axis is preserved exactly
        const other = axis === 'inline' ? stretchesBlock : stretchesInline;
        expect(other(released)).toBe(other(s));
      }
    }
  });
});

describe('bucketsFor', () => {
  it('gives an unstretched widget its own corner', () => {
    for (const a of ANCHORS) expect(bucketsFor(a, null)).toEqual([a]);
  });

  it("gives a full-width strip BOTH buckets of its edge, so it clears either corner's stack", () => {
    expect(bucketsFor('top-left', 'width')).toEqual(['top-left', 'top-right']);
    expect(bucketsFor('top-right', 'width')).toEqual(['top-left', 'top-right']);
    expect(bucketsFor('bottom-left', 'width')).toEqual(['bottom-left', 'bottom-right']);
    expect(bucketsFor('bottom-right', 'width')).toEqual(['bottom-left', 'bottom-right']);
  });

  it('gives a block-stretched widget no bucket at all, since it cannot stack', () => {
    // It spans the very axis stacking uses to separate siblings, so z-order decides overlap.
    for (const a of ANCHORS) {
      expect(bucketsFor(a, 'height')).toEqual([]);
      expect(bucketsFor(a, 'both')).toEqual([]);
    }
  });
});

describe('anchor half replacement', () => {
  it('replaces the inline half, keeping the block half', () => {
    expect(withInlineHalf('top-left', 'right')).toBe('top-right');
    expect(withInlineHalf('bottom-right', 'left')).toBe('bottom-left');
    expect(withInlineHalf('top-right', 'right')).toBe('top-right');
  });

  it('replaces the block half, keeping the inline half', () => {
    expect(withBlockHalf('top-left', 'bottom')).toBe('bottom-left');
    expect(withBlockHalf('bottom-right', 'top')).toBe('top-right');
    expect(withBlockHalf('top-right', 'top')).toBe('top-right');
  });

  it('composes to reach every corner from any corner', () => {
    for (const from of ANCHORS) {
      for (const to of ANCHORS) {
        const block = to.startsWith('top-') ? 'top' : 'bottom';
        const inline = to.endsWith('-right') ? 'right' : 'left';
        expect(withInlineHalf(withBlockHalf(from, block), inline)).toBe(to);
      }
    }
  });
});
