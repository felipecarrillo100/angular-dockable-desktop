/**
 * Context-menu item shapes.
 *
 * Names and fields are identical to rdd's and vdd's, so menu definitions port across
 * unchanged — a menu is data, and this is the part of the API where another framework's
 * arrays can be reused verbatim. Only `icon` differs, as {@link NddIcon}.
 */
import type { NddIcon } from './icon';
import type { Label } from './types';

/** The optional checkbox column on a simple item. */
export interface ContextMenuCheckbox {
  /** Whether the checkbox column renders at all. @default true */
  active?: boolean;
  /** Whether the item is interactive. Prefer the item's own `disabled`. @default true */
  enabled?: boolean;
  /** Current checked state. */
  value: boolean;
}

/** A normal menu item. */
export interface ContextMenuSimpleItem {
  label: Label;
  icon?: NddIcon;
  /** Tooltip. */
  title?: Label;
  checkbox?: ContextMenuCheckbox;
  action?: () => void;
  /** Test hook, rendered as `data-cy-action`. */
  cyAction?: string;
  disabled?: boolean;
}

/** A divider. */
export interface ContextMenuSeparator {
  separator: true;
}

/** An item that opens a submenu. One level deep, as in rdd. */
export interface ContextMenuSubMenu {
  label: Label;
  title?: Label;
  items?: ContextMenuItem[];
}

export type ContextMenuItem = ContextMenuSimpleItem | ContextMenuSeparator | ContextMenuSubMenu;

/** What to show, and where. */
export interface ShowContextMenuOptions {
  /** Position from an event. Takes precedence over `x`/`y`. */
  event?: MouseEvent | PointerEvent | TouchEvent;
  x?: number;
  y?: number;
  items: ContextMenuItem[];
  /**
   * Where focus goes when the menu opens. `'menu'` (the default) focuses the menu itself, with no
   * item highlighted: ArrowDown then reaches the first item and ArrowUp the last. `'first-item'`
   * focuses the first enabled item, for a menu opened from the keyboard. When this is left out, a
   * keyboard `contextmenu` event (the ContextMenu key or Shift+F10, which report no pointer
   * position) opens on the first item and everything else, including a call with no event, on
   * the menu: the same view every time, whatever the user did before.
   */
  initialFocus?: 'menu' | 'first-item';
}

/** A menu request as the workspace holds it. */
export interface ContextMenuRequest {
  x: number;
  y: number;
  items: ContextMenuItem[];
  initialFocus: 'menu' | 'first-item';
}

/** The menu's initial focus, from what the caller passed (see `ShowContextMenuOptions.initialFocus`). */
export function menuInitialFocus(options: ShowContextMenuOptions): 'menu' | 'first-item' {
  if (options.initialFocus) return options.initialFocus;
  const event = options.event;
  if (!event || 'touches' in event) return 'menu';
  const mouse = event as MouseEvent;
  return mouse.clientX === 0 && mouse.clientY === 0 ? 'first-item' : 'menu';
}

export const isSeparator = (item: ContextMenuItem): item is ContextMenuSeparator =>
  'separator' in item;

export const isSubMenu = (item: ContextMenuItem): item is ContextMenuSubMenu =>
  !isSeparator(item) && 'items' in item;

/** Where a menu should open, from whatever the caller supplied. */
export function menuPosition(options: ShowContextMenuOptions): { x: number; y: number } {
  const event = options.event;
  if (!event) return { x: options.x ?? 0, y: options.y ?? 0 };
  if ('touches' in event && event.touches.length > 0) {
    const touch = event.touches[0]!;
    return { x: touch.clientX, y: touch.clientY };
  }
  const mouse = event as MouseEvent;
  return { x: mouse.clientX, y: mouse.clientY };
}

/** Keep a menu inside the viewport. Pure: the caller measures, this decides. */
export function clampToViewport(
  position: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 8,
): { x: number; y: number } {
  let { x, y } = position;
  if (x + size.width > viewport.width - padding)
    x = Math.max(padding, viewport.width - size.width - padding);
  if (y + size.height > viewport.height - padding)
    y = Math.max(padding, viewport.height - size.height - padding);
  return { x: Math.max(padding, x), y: Math.max(padding, y) };
}
