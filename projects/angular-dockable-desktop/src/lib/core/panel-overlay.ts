/**
 * Geometry and rules for the panel overlay — the toolbars and floating widgets that live
 * *inside* one panel, over its content.
 *
 * Everything here is pure, so the parts that were hardest to get right in rdd — which resize
 * handles a placement offers, and where a docked widget is allowed to grow to — are testable
 * without a DOM. The stretch algebra they build on is in `core/stretch.ts`.
 */
import type { FloatAnchor } from './types';
import type { ResizeDir } from './drag-resize';
import { stretchesBlock, stretchesInline } from './stretch';
import type { Stretch } from './stretch';

/** Which edge of the panel a toolbar attaches to. */
export type ToolbarPosition = 'top' | 'bottom' | 'left' | 'right';
/** Background treatment of a toolbar strip. */
export type ToolbarVariant = 'transparent' | 'frosted' | 'solid';
/** Button treatment, inherited by the toolbar's own buttons. */
export type ButtonVariant = 'ghost' | 'soft' | 'outlined' | 'filled';

/** Smallest a widget may be resized to. */
export const MIN_W = 120;
export const MIN_H = 60;
/** Gutter between a docked widget and the panel's inline edge. */
export const DOCK_INSET = 8;
/** Gap between widgets stacked in the same corner. */
export const DOCK_GAP = 8;
/** Side of the corner drop zones, in pixels. */
export const DROP_ZONE_SIZE = 80;
/** How far the header must move before a click becomes a drag. */
export const DRAG_THRESHOLD = 4;

/**
 * Resize-to-stretch snapping thresholds, asymmetric on purpose.
 *
 * A drag arms within `SNAP_IN` of the full extent but only disarms once it pulls back past the
 * wider `SNAP_OUT`. Without that hysteresis, releasing a stretched axis by dragging a few
 * pixels inward immediately re-arms and snaps straight back on release, which makes the
 * gesture feel broken.
 */
export const SNAP_IN = 16;
export const SNAP_OUT = 40;

/** Space claimed by toolbars. Block values are physical; inline values are logical. */
export interface ToolbarInsets {
  top: number;
  bottom: number;
  /** Inline-start, so `left` under LTR and `right` under RTL. */
  inlineStart: number;
  inlineEnd: number;
}

export const NO_INSETS: ToolbarInsets = { top: 0, bottom: 0, inlineStart: 0, inlineEnd: 0 };

/** The four corners. */
export const ANCHORS: readonly FloatAnchor[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/** Which corner zone a pointer is over, or `null` for the middle. */
export function hoveredZone(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): FloatAnchor | null {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < DROP_ZONE_SIZE && y < DROP_ZONE_SIZE) return 'top-left';
  if (x > rect.width - DROP_ZONE_SIZE && y < DROP_ZONE_SIZE) return 'top-right';
  if (x < DROP_ZONE_SIZE && y > rect.height - DROP_ZONE_SIZE) return 'bottom-left';
  if (x > rect.width - DROP_ZONE_SIZE && y > rect.height - DROP_ZONE_SIZE) return 'bottom-right';
  return null;
}

/** A drop zone is named by its physical corner, so under RTL the inline half mirrors. */
export const flipZoneHorizontal = (zone: FloatAnchor): FloatAnchor =>
  zone.endsWith('-left')
    ? (zone.replace('-left', '-right') as FloatAnchor)
    : (zone.replace('-right', '-left') as FloatAnchor);

/**
 * The band a docked widget may occupy, in **physical** pixels from the container's edges.
 *
 * The block axis keeps clear of top/bottom toolbars only. The inline axis also adds the
 * `DOCK_INSET` gutter, matching how a docked widget is positioned in the first place. rdd
 * fixed docked widgets *positioning* themselves over a toolbar in 5.x and never gave the
 * resize path the same treatment, so a docked widget could still be resized straight over
 * the toolbar on the far side.
 *
 * Inline is converted from logical to physical here because handle directions and measured
 * rects are physical, while a toolbar claims its space logically.
 */
export function dockedBand(
  insets: ToolbarInsets,
  isRtl: boolean,
): { left: number; right: number; top: number; bottom: number } {
  return {
    left: (isRtl ? insets.inlineEnd : insets.inlineStart) + DOCK_INSET,
    right: (isRtl ? insets.inlineStart : insets.inlineEnd) + DOCK_INSET,
    top: insets.top,
    bottom: insets.bottom,
  };
}

/**
 * Which resize handles a placement offers.
 *
 * **Free-floating:** all eight. Nothing is pinned.
 *
 * **Docked:** only the edges that can actually move. A docked widget pins one edge per axis,
 * so a handle on a pinned side would move the *opposite* edge instead of the one under the
 * cursor — an inert stub with a resize cursor on it. rdd hardcoded the five non-northern
 * directions regardless of anchor, which looked harmless for top anchors but left every
 * bottom-anchored widget with no working vertical resize at all: `n` was not rendered, and
 * `s` was the stub.
 *
 * **Stretched:** a stretched axis has both ends pinned, but both are *releasable* — dragging
 * either moves that edge and pins the opposite one. So it offers handles on both ends, which
 * is also what keeps the fully-stretched state from being a dead end with nothing to grab.
 * The corner belongs only to the all-pinned state; in a stretched state it would mix a
 * resize and a release into one gesture.
 *
 * The block axis is direction-agnostic; the inline axis is not. The pin is a logical property
 * (`inset-inline-end`) while the handle classes are physical (`.ndd-resize-e { right: 0 }`),
 * so which *physical* side is pinned depends on the reading direction.
 */
export function handleDirs(
  mode: 'docked' | 'free',
  anchor: FloatAnchor,
  stretch: Stretch | null,
  isRtl: boolean,
): ResizeDir[] {
  if (mode === 'free') return ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

  const freeBlock: ResizeDir = anchor.startsWith('top-') ? 's' : 'n';
  const pinsPhysicalRight = anchor.endsWith('-right') !== isRtl;
  const freeInline: ResizeDir = pinsPhysicalRight ? 'w' : 'e';

  const inlineStretched = stretchesInline(stretch);
  const blockStretched = stretchesBlock(stretch);

  const dirs: ResizeDir[] = [];
  dirs.push(...(inlineStretched ? (['e', 'w'] as ResizeDir[]) : [freeInline]));
  dirs.push(...(blockStretched ? (['n', 's'] as ResizeDir[]) : [freeBlock]));
  if (!inlineStretched && !blockStretched) dirs.push(`${freeBlock}${freeInline}` as ResizeDir);
  return dirs;
}

/**
 * Where a released axis re-pins.
 *
 * The edge under the pointer becomes the moving one and the opposite end becomes the new pin,
 * so the gesture reads exactly like an ordinary resize. Handle directions are physical and
 * anchors are logical, hence the direction term on the inline half.
 */
export function anchorAfterRelease(
  anchor: FloatAnchor,
  dir: ResizeDir,
  axes: { inline: boolean; block: boolean },
  isRtl: boolean,
): FloatAnchor {
  let next = anchor;
  if (axes.inline) {
    const pinsPhysicalLeft = dir.includes('e');
    next =
      `${next.startsWith('top-') ? 'top' : 'bottom'}-${pinsPhysicalLeft !== isRtl ? 'left' : 'right'}` as FloatAnchor;
  }
  if (axes.block) {
    next =
      `${dir.includes('s') ? 'top' : 'bottom'}-${next.endsWith('-right') ? 'right' : 'left'}` as FloatAnchor;
  }
  return next;
}

/**
 * How far down its edge a docked widget sits, given what it is stacked behind.
 *
 * The largest offset across every bucket the widget occupies, so a strip spanning an edge
 * clears whatever is stacked in *both* of that edge's corners rather than only the one it is
 * anchored to.
 */
export function stackOffset(
  id: string,
  buckets: FloatAnchor[],
  stacks: Record<FloatAnchor, string[]>,
  sizes: Record<string, number>,
  fallbackHeight: number,
): { offset: number; registered: boolean } {
  // A widget in no bucket (block-stretched) is never *in* a stack, so it must not be held
  // invisible by the not-yet-registered guard its caller applies.
  let registered = buckets.length === 0;
  let offset = 0;
  for (const bucket of buckets) {
    const stack = stacks[bucket] ?? [];
    const index = stack.indexOf(id);
    if (index === -1) continue;
    registered = true;
    let own = 0;
    for (let i = 0; i < index; i++) own += (sizes[stack[i]!] ?? fallbackHeight) + DOCK_GAP;
    offset = Math.max(offset, own);
  }
  return { offset, registered };
}
