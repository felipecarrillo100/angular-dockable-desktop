/**
 * The stretch algebra for docked inner widgets.
 *
 * A docked widget normally pins one end of each axis and carries an explicit size. A
 * *stretched* axis pins **both** ends and carries no size at all, so the widget tracks its
 * panel as the panel resizes — with no ResizeObserver and no JavaScript, because CSS
 * already does exactly this. "Full width" is not a width; it is a second pin.
 *
 * Pure functions over two values, so the nine placements (three inline states × three
 * block states, minus the impossible) are testable without a DOM.
 */
import type { FloatAnchor } from './types';

/** Which axes span the panel instead of carrying a size. */
export type Stretch = 'width' | 'height' | 'both';

/** Where a docked widget sits: its corner, plus which axes span. Reported as one unit
 *  because a single gesture can change both, and reporting separately would surface a
 *  state that is never valid. */
export interface PanelFloatPlacement {
  anchor: FloatAnchor;
  stretch: Stretch | null;
}

export const stretchesInline = (s: Stretch | null): boolean => s === 'width' || s === 'both';
export const stretchesBlock = (s: Stretch | null): boolean => s === 'height' || s === 'both';

/** Add one axis, keeping whatever was already stretched. */
export const addAxis = (s: Stretch | null, axis: 'inline' | 'block'): Stretch =>
  axis === 'inline'
    ? stretchesBlock(s)
      ? 'both'
      : 'width'
    : stretchesInline(s)
      ? 'both'
      : 'height';

/** Drop one axis, keeping the other. */
export const releaseAxis = (s: Stretch | null, axis: 'inline' | 'block'): Stretch | null =>
  axis === 'inline'
    ? s === 'both'
      ? 'height'
      : stretchesInline(s)
        ? null
        : s
    : s === 'both'
      ? 'width'
      : stretchesBlock(s)
        ? null
        : s;

export const ANCHORS: readonly FloatAnchor[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/**
 * Which stacking buckets a placement occupies.
 *
 * The four corner buckets are a proxy for *"do these overlap on the inline axis?"* — two
 * widgets in one corner overlap and stack; opposite corners sit side by side and do not. A
 * full-width strip overlaps everything on its edge, so it belongs to **both** buckets of
 * that edge and pushes whatever is stacked in either.
 *
 * A block-stretched widget spans the very axis stacking uses to separate siblings, so it
 * cannot participate at all and occupies no bucket — z-order decides any overlap.
 *
 * Computing true inline overlap was considered and rejected: widths change continuously
 * during a resize drag, so widgets would reshuffle mid-gesture.
 */
export const bucketsFor = (anchor: FloatAnchor, stretch: Stretch | null): FloatAnchor[] => {
  if (stretchesBlock(stretch)) return [];
  if (stretchesInline(stretch)) {
    return anchor.startsWith('top-') ? ['top-left', 'top-right'] : ['bottom-left', 'bottom-right'];
  }
  return [anchor];
};

/** Replace the inline half of a corner, leaving the block half alone. */
export const withInlineHalf = (a: FloatAnchor, half: 'left' | 'right'): FloatAnchor =>
  `${a.startsWith('top-') ? 'top' : 'bottom'}-${half}` as FloatAnchor;

/** Replace the block half of a corner, leaving the inline half alone. */
export const withBlockHalf = (a: FloatAnchor, half: 'top' | 'bottom'): FloatAnchor =>
  `${half}-${a.endsWith('-right') ? 'right' : 'left'}` as FloatAnchor;
