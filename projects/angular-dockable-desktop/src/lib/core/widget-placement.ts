/**
 * A managed widget's saved placement (rdd 7.11.0): building it, reading it back, and applying it
 * to a panel of whatever size the panel has now. Pure; the overlay calls these. A verbatim port of
 * rdd's `core/widgetPlacement.ts` (and vdd's), imports aside.
 *
 * The value is opaque to apps (`WidgetPlacement = { v: 1 } & Record<string, unknown>`) and
 * identical in rdd, vdd and ndd, so a saved value moves between the libraries. Inside:
 * - in the panel: `{ v: 1, at: 'panel', anchor, stretch, mode, offset?, width, height }`. A free
 *   position is an offset from the panel corner the widget was nearest, measured from the
 *   inline-start or inline-end edge, so it stays put on a bigger or smaller panel and mirrors in RTL;
 * - out of it: `{ v: 1, at: 'docked' | 'tabbed' | 'floating', home, position?, size?, rect? }`, where
 *   `home` is the panel form, where going back returns it.
 * @internal
 */
import type { FloatAnchor } from './types';
import type { Stretch } from './stretch';
import { ANCHORS, MIN_W, MIN_H } from './panel-overlay';

/** Where a widget sits inside its panel, as the overlay's store holds it. */
export interface PanelPlacementState {
  anchor: FloatAnchor;
  stretch: Stretch | null;
  mode: 'docked' | 'free';
  freePos: { x: number; y: number } | null;
  size: { w: number; h: number };
}

/** The panel form of a saved placement. */
export interface PanelForm {
  v: 1;
  at: 'panel';
  anchor: FloatAnchor;
  stretch: Stretch | null;
  mode: 'docked' | 'free';
  offset?: { corner: FloatAnchor; inline: number; block: number };
  width: number;
  height: number;
}

/** Where outside the panel, as saved. */
export type OutTarget =
  | { at: 'docked'; position: 'left' | 'right' | 'top' | 'bottom'; size?: number }
  | { at: 'tabbed' }
  | { at: 'floating'; rect: { x: number; y: number; width: number; height: number } };

/** The panel's size and direction: what a free position is measured against. */
export interface PanelBox { width: number; height: number; rtl: boolean }

const STRETCHES: readonly (Stretch | null)[] = [null, 'width', 'height', 'both'];
const POSITIONS = ['left', 'right', 'top', 'bottom'] as const;
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** The fields read off a saved value, by name (the library's `noPropertyAccessFromIndexSignature`). */
type Raw = Partial<Record<'v' | 'at' | 'anchor' | 'stretch' | 'mode' | 'offset' | 'width' | 'height' | 'corner' | 'inline' | 'block' | 'home' | 'position' | 'size' | 'rect' | 'x' | 'y', unknown>>;
const isObj = (o: unknown): o is Raw => typeof o === 'object' && o !== null && !Array.isArray(o);
const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), Math.max(lo, hi));
const isAnchor = (a: unknown): a is FloatAnchor => ANCHORS.includes(a as FloatAnchor);

/** The panel form of where a widget is in its panel. A free one needs the panel's box. */
export function toPanelForm(p: PanelPlacementState, box: PanelBox | null): PanelForm {
  const form: PanelForm = { v: 1, at: 'panel', anchor: p.anchor, stretch: p.stretch, mode: p.mode, width: p.size.w, height: p.size.h };
  if (p.mode === 'free' && p.freePos) {
    if (!box || box.width <= 0 || box.height <= 0) {
      // No box to measure against: keep the position as an offset from the top-left start.
      form.offset = { corner: 'top-left', inline: p.freePos.x, block: p.freePos.y };
      return form;
    }
    const { x, y } = p.freePos;
    const leftGap = x;
    const rightGap = box.width - x - p.size.w;
    const startGap = box.rtl ? rightGap : leftGap;
    const endGap = box.rtl ? leftGap : rightGap;
    const topGap = y;
    const bottomGap = box.height - y - p.size.h;
    const block = topGap <= bottomGap ? 'top' : 'bottom';
    const inline = startGap <= endGap ? 'left' : 'right';   // anchors are logical: 'left' is inline-start
    form.offset = {
      corner: `${block}-${inline}` as FloatAnchor,
      inline: Math.max(0, Math.round(inline === 'left' ? startGap : endGap)),
      block: Math.max(0, Math.round(block === 'top' ? topGap : bottomGap)),
    };
  }
  return form;
}

/**
 * A saved panel form back into store state, for a panel of this box, clamped into it. With no box
 * yet (a hidden panel measures 0×0) a free position can't be placed: `null` for `freePos` with
 * `deferred: true`, and the caller applies it again once the panel has a size.
 */
export function fromPanelForm(form: PanelForm, box: PanelBox | null): { state: PanelPlacementState; deferred: boolean } {
  const hasBox = !!box && box.width > 0 && box.height > 0;
  const w = hasBox ? clamp(form.width, MIN_W, box!.width) : Math.max(MIN_W, form.width);
  const h = hasBox ? clamp(form.height, MIN_H, box!.height) : Math.max(MIN_H, form.height);
  const base: PanelPlacementState = { anchor: form.anchor, stretch: form.stretch, mode: form.mode, freePos: null, size: { w, h } };
  if (form.mode !== 'free') return { state: base, deferred: false };
  // A free widget carries no stretch.
  base.stretch = null;
  if (!hasBox) return { state: { ...base, mode: 'docked' }, deferred: true };
  const o = form.offset ?? { corner: 'top-left' as FloatAnchor, inline: 0, block: 0 };
  const fromStart = o.corner.endsWith('-left');
  const startX = fromStart ? o.inline : box!.width - w - o.inline;       // distance from inline-start
  const x = box!.rtl ? box!.width - w - startX : startX;                 // physical left
  const y = o.corner.startsWith('top-') ? o.block : box!.height - h - o.block;
  return {
    state: { ...base, freePos: { x: Math.round(clamp(x, 0, box!.width - w)), y: Math.round(clamp(y, 0, box!.height - h)) } },
    deferred: false,
  };
}

function parsePanelForm(raw: unknown): PanelForm | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  if (!isAnchor(raw.anchor) || !STRETCHES.includes(raw.stretch as Stretch | null)) return null;
  if (raw.mode !== 'docked' && raw.mode !== 'free') return null;
  if (!isNum(raw.width) || !isNum(raw.height) || raw.width <= 0 || raw.height <= 0) return null;
  const form: PanelForm = { v: 1, at: 'panel', anchor: raw.anchor, stretch: raw.stretch as Stretch | null, mode: raw.mode, width: raw.width, height: raw.height };
  const o = raw.offset;
  if (isObj(o) && isAnchor(o.corner) && isNum(o.inline) && isNum(o.block)) {
    form.offset = { corner: o.corner, inline: Math.max(0, o.inline), block: Math.max(0, o.block) };
  }
  return form;
}

/**
 * Reads a value an app gave back. `home` is the panel form (or `null` when it is unusable: the
 * config's defaults apply); `out` is where to move it after opening, when the value says so and
 * that part is valid. An unknown `v`, or anything that isn't such a value, gives both `null`.
 */
export function parsePlacement(raw: unknown): { home: PanelForm | null; out: OutTarget | null } {
  if (!isObj(raw) || raw.v !== 1) return { home: null, out: null };
  if (raw.at === 'panel' || raw.at === undefined) return { home: parsePanelForm(raw), out: null };
  const home = parsePanelForm(raw.home);
  if (raw.at === 'tabbed') return { home, out: { at: 'tabbed' } };
  if (raw.at === 'docked' && POSITIONS.includes(raw.position as typeof POSITIONS[number])) {
    const size = isNum(raw.size) ? clamp(raw.size, 0.1, 0.9) : undefined;
    return { home, out: { at: 'docked', position: raw.position as typeof POSITIONS[number], ...(size !== undefined ? { size } : {}) } };
  }
  const r = raw.rect;
  if (raw.at === 'floating' && isObj(r) && isNum(r.x) && isNum(r.y) && isNum(r.width) && isNum(r.height) && r.width > 0 && r.height > 0) {
    return { home, out: { at: 'floating', rect: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(MIN_W, r.width), height: Math.max(MIN_H, r.height) } } };
  }
  return { home, out: null };
}
