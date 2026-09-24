/**
 * Toolbar item shapes.
 *
 * Kept as data, with rdd's and vdd's field names, so another framework's `items` array
 * transfers verbatim — a toolbar is configuration, not markup. Only `icon` differs, as
 * {@link NddIcon}.
 */
import type { NddIcon } from './icon';

/** A one-shot button. */
export interface ToolbarActionItem {
  type: 'action';
  id: string;
  label: string;
  icon: NddIcon;
  onClick: () => void;
  disabled?: boolean;
}

/** One of a set, of which exactly one is active. */
export interface ToolbarRadioItem {
  type: 'radio';
  id: string;
  /** Items sharing a group are mutually exclusive. */
  group: string;
  label: string;
  icon: NddIcon;
  shortcut?: string;
  onActivate?: (id: string) => void;
  disabled?: boolean;
}

/**
 * An independent on/off modifier — snap-to-grid, say.
 *
 * Uncontrolled by default, with the state on the workspace keyed by `id`. Supply `active` and
 * the caller becomes the source of truth.
 */
export interface ToolbarToggleItem {
  type: 'toggle';
  id: string;
  label: string;
  icon: NddIcon;
  shortcut?: string;
  /** Controlled state. Supplying it — **including as `false`** — makes the caller the owner. */
  active?: boolean;
  onToggle?: (active: boolean) => void;
  disabled?: boolean;
}

/** One entry inside a group's flyout. */
export interface ToolbarGroupSubItem {
  id: string;
  label: string;
  icon: NddIcon;
  shortcut?: string;
  disabled?: boolean;
  onActivate?: (id: string) => void;
}

export type ToolbarGroupEntry = ToolbarGroupSubItem | { type: 'separator' };

/** A collapsed family of tools: one button that opens a flyout, radio semantics inside. */
export interface ToolbarGroupItem {
  type: 'group';
  /** Both the button id and the radio group key. */
  id: string;
  /** Tooltip when nothing is selected. */
  label: string;
  /** Icon when nothing is selected. */
  defaultIcon: NddIcon;
  items: ToolbarGroupEntry[];
  disabled?: boolean;
  /** Controlled active sub-item. Supplying it — **including as `null`** — makes the caller the owner. */
  activeItemId?: string | null;
  onActiveItemChange?: (id: string) => void;
}

export interface ToolbarSeparator {
  type: 'separator';
}

export type ToolbarItem =
  | ToolbarActionItem
  | ToolbarRadioItem
  | ToolbarToggleItem
  | ToolbarGroupItem
  | ToolbarSeparator;

export const isSubItem = (entry: ToolbarGroupEntry): entry is ToolbarGroupSubItem =>
  !('type' in entry);

/**
 * Where a group's flyout opens: away from the strip, mirrored for reading direction.
 * Pure, so the placement is testable without layout.
 */
export function flyoutPlacement(
  rect: { left: number; right: number; top: number; bottom: number },
  position: 'left' | 'right' | 'top' | 'bottom',
  viewport: { width: number; height: number },
  isRtl = false,
  gap = 8,
): Record<string, number> {
  switch (position) {
    case 'left':
      // Under RTL a flex row reverses, so a 'left' strip sits on the right and opens leftwards.
      return isRtl
        ? { right: viewport.width - rect.left + gap, top: rect.top }
        : { left: rect.right + gap, top: rect.top };
    case 'right':
      return isRtl
        ? { left: rect.right + gap, top: rect.top }
        : { right: viewport.width - rect.left + gap, top: rect.top };
    case 'top':
      return isRtl
        ? { top: rect.bottom + gap, right: viewport.width - rect.right }
        : { top: rect.bottom + gap, left: rect.left };
    default:
      return isRtl
        ? { bottom: viewport.height - rect.top + gap, right: viewport.width - rect.right }
        : { bottom: viewport.height - rect.top + gap, left: rect.left };
  }
}
