import type { FloatAnchor } from './types';

/**
 * Mirrors a physical workspace corner to its horizontal opposite.
 *
 * Used only to translate a physically-hovered corner (raw pointer/screen
 * position, which CSS cannot reason about) into the logical `FloatAnchor`
 * value stored on a `FloatingWindow` under RTL. Render-time positioning
 * should use CSS logical properties (`insetInlineStart`/`insetInlineEnd`)
 * driven by the element's `dir` attribute instead of calling this.
 */
export function flipZoneHorizontal(zone: FloatAnchor): FloatAnchor {
  if (zone === 'top-left') return 'top-right';
  if (zone === 'top-right') return 'top-left';
  if (zone === 'bottom-left') return 'bottom-right';
  return 'bottom-left';
}

// ── Keeping a floating window reachable ─────────────────────────────────────

/** A floating window's stored box, as numbers. */
export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest a clamp will shrink a window to, so it never becomes ungrabbable. */
export const MIN_CLAMP_W = 200;
export const MIN_CLAMP_H = 150;

/**
 * Where a floating window has to move to stay reachable inside a shrinking workspace.
 *
 * Returns the clamped rect, or the **same object** when nothing needed to change. That
 * identity is the point: the caller reacts to the window list and writes back to it, so
 * writing on "a bound was exceeded" rather than on "a value changed" re-triggers the effect
 * forever. Both clamps have a floor, so in a workspace narrower than that floor the clamped
 * value still fails its own condition — and the rewrite loop that produced was found by
 * M13's browser tour as "Maximum recursive updates exceeded".
 *
 * Size is clamped for every window. Position is clamped only for a free-floating one: an
 * anchored window is placed entirely by its anchor and reading direction, so its stored x/y
 * do not affect where it appears.
 */
export function clampFloatingRect(
  rect: FloatingRect,
  view: { width: number; height: number },
  anchored: boolean,
): FloatingRect {
  let { x, y, width, height } = rect;

  if (width > view.width) width = Math.max(MIN_CLAMP_W, view.width - 20);
  if (height > view.height) height = Math.max(MIN_CLAMP_H, view.height - 40);

  if (!anchored) {
    const maxX = view.width - 100; // keep enough title bar to grab
    const maxY = view.height - 40;
    if (x > maxX) x = Math.max(0, maxX);
    if (y > maxY) y = Math.max(0, maxY);
  }

  const unchanged = x === rect.x && y === rect.y && width === rect.width && height === rect.height;
  return unchanged ? rect : { x, y, width, height };
}
