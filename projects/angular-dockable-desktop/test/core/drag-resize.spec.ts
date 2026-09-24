/**
 * Ported verbatim from vue-dockable-desktop `test/core/dragResize.test.ts` — framework-free logic, so only
 * the import paths changed. Test names and IDs are preserved (ADR 0009).
 */
/**
 * Ported from react-dockable-desktop `dragResize.test.ts` (10 tests), names preserved.
 *
 * Locks in that the shared resize maths reproduces both call sites' original, independently
 * derived behaviour: a workspace floating window (minW/minH only — may grow unbounded and be
 * dragged off-screen) and a docked inner widget (all four constraints, stays in its panel).
 */
import { describe, it, expect } from 'vitest';
import { computeResizedRect } from '../../src/lib/core/drag-resize';

const START = { x: 100, y: 50, w: 300, h: 200 };

describe('DR1-DR4: floating-window constraints (minW/minH only)', () => {
  const constraints = { minW: 200, minH: 150 };

  it('DR1: "e" grows unbounded and floors at minW when shrinking', () => {
    expect(computeResizedRect('e', 500, 0, START, constraints)).toEqual({
      x: 100,
      y: 50,
      w: 800,
      h: 200,
    });
    expect(computeResizedRect('e', -1000, 0, START, constraints)).toEqual({
      x: 100,
      y: 50,
      w: 200,
      h: 200,
    });
  });

  it('DR2: "w" has no position floor — x can go negative', () => {
    const result = computeResizedRect('w', -150, 0, START, constraints);
    expect(result.w).toBe(450);
    expect(result.x).toBe(-50);
  });

  it('DR3: "w" floors width at minW when shrinking past it', () => {
    const result = computeResizedRect('w', 1000, 0, START, constraints);
    expect(result.w).toBe(200);
    expect(result.x).toBe(200);
  });

  it('DR4: "s"/"n" mirror "e"/"w" on the y axis, unbounded', () => {
    expect(computeResizedRect('s', 0, 500, START, constraints)).toEqual({
      x: 100,
      y: 50,
      w: 300,
      h: 700,
    });
    const north = computeResizedRect('n', 0, -80, START, constraints);
    expect(north.h).toBe(280);
    expect(north.y).toBe(-30);
  });
});

describe('DR5-DR8: docked-widget constraints (all four supplied)', () => {
  const constraints = { minW: 50, minH: 40, maxW: 500 - 100, maxH: 400 - 50, minX: 0, minY: 0 };

  it('DR5: "e" clamps at the container edge', () => {
    expect(computeResizedRect('e', 1000, 0, START, constraints).w).toBe(400);
  });

  it('DR6: "e" still floors at minW when shrinking', () => {
    expect(computeResizedRect('e', -1000, 0, START, constraints).w).toBe(50);
  });

  it('DR7: "w" clamps x at 0 (minX) instead of going negative', () => {
    const result = computeResizedRect('w', -150, 0, START, constraints);
    expect(result.x).toBe(0);
    expect(result.w).toBe(400);
  });

  it('DR8: "n" clamps y at 0 (minY) the same way', () => {
    const result = computeResizedRect('n', 0, -80, START, constraints);
    expect(result.y).toBe(0);
    expect(result.h).toBe(250);
  });
});

describe('DR9: corner directions combine both axes independently', () => {
  it('"se" resizes width and height together, each with its own axis math', () => {
    expect(computeResizedRect('se', 50, 30, START, { minW: 50, minH: 40 })).toEqual({
      x: 100,
      y: 50,
      w: 350,
      h: 230,
    });
  });

  it('"nw" resizes position and size on both axes together', () => {
    const result = computeResizedRect('nw', -20, -10, START, {
      minW: 50,
      minH: 40,
      minX: 0,
      minY: 0,
    });
    expect(result).toEqual({ x: 80, y: 40, w: 320, h: 210 });
  });
});
