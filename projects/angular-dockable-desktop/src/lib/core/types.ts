/**
 * Domain types.
 *
 * Names and shapes are deliberately identical to react-dockable-desktop's. They are
 * vocabulary, not React artefacts — and the serialisable subset is a compatibility
 * contract: see docs/decisions/0008-layout-json-compatibility.md. Renaming a field here
 * breaks a saved layout.
 */

/** A localisable message descriptor. The whole i18n integration surface is resolving one of these to a string. */
export interface MessageDescriptor {
  /** Translation dictionary key. */
  id: string;
  /** Text used when no formatter is supplied. */
  defaultMessage?: string;
  /** Values interpolated into `{placeholders}` in the message. */
  values?: Record<string, string | number>;
}

/** Resolves a {@link MessageDescriptor} to a flat string. */
export type MessageFormatter = (msg: MessageDescriptor) => string;

/** A label that may be plain text or localisable. */
export type Label = string | MessageDescriptor;

/** Orientation of a split. */
export type SplitOrientation = 'horizontal' | 'vertical';

/** The four sides a panel can be docked relative to another. */
export type SplitDirection = 'left' | 'right' | 'top' | 'bottom';

/** Where a dragged panel may be dropped on a leaf: a side, or its centre (same tab group). */
export type DropPosition = SplitDirection | 'center';

/** The resolved target of a drag-and-dock gesture. */
export interface DropTarget {
  leafId: string;
  position: DropPosition;
}

/** A split node: children laid out along one axis with relative sizes summing to 1. */
export interface LayoutGridNode {
  type: 'branch';
  orientation: SplitOrientation;
  children: LayoutNode[];
  /** Relative sizes, one per child, summing to 1. */
  sizes: number[];
}

/** A tab group: an ordered list of panels with one selected. */
export interface LayoutLeafNode {
  type: 'leaf';
  id: string;
  /** Panel ids, in tab order. */
  panels: string[];
  /** The selected tab, or `null` when the group is empty. */
  activePanelId: string | null;
  /** When `false`, `closeLeafGroup()` will not remove this group. Whether a tab closes is the registry's `canClose`. */
  canClose?: boolean;
  /** When `true`, the group survives in the layout after its last panel closes. */
  keepOnEmpty?: boolean;
}

/** A node of the layout tree. */
export type LayoutNode = LayoutGridNode | LayoutLeafNode;

/**
 * A corner of the workspace a floating window can be pinned to.
 *
 * Logical, not physical: `'top-left'` means the inline-start corner, so a layout saved in
 * one reading direction restores correctly in the other.
 */
export type FloatAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** A floating window's geometry and stacking. Numbers are px; strings are any CSS length. */
export interface FloatingWindow {
  id: string;
  x: number | string;
  y: number | string;
  width: number | string;
  height: number | string;
  /** Stacking order; the highest is frontmost. */
  z: number;
  /** Whether the window currently fills the workspace. */
  maximized?: boolean;
  /** The corner it is pinned to, or `null`/absent when free-floating. */
  anchor?: FloatAnchor | null;
}

/** Severity of the banner in the built-in unsaved-changes dialog. */
export type AlertType = 'info' | 'warning' | 'success' | 'danger';

/** Customises the built-in unsaved-changes dialog for one panel. */
export interface DirtyStateOptions {
  title?: Label;
  message?: Label;
  /** Extra banner text, e.g. which fields are still invalid. */
  alert?: string;
  /** @default 'danger' when raised by a close, 'info' otherwise */
  alertType?: AlertType;
}

/** Where a panel currently lives in the workspace. */
export type PanelState = 'docked' | 'floating' | 'minimized';

/**
 * What kind of container a panel is being rendered inside.
 *
 * The same component can be opened as a docked panel *and* as a modal; this is how it
 * adapts. `'standalone'` means no container at all — rendered on its own, in a test or a
 * storybook.
 */
export type ContainerType =
  'dockable-panel' | 'floating-window' | 'modal' | 'left-panel' | 'right-panel' | 'standalone';

/** Everything the workspace knows about one open panel. */
export interface PanelInfo {
  id: string;
  title: Label;
  /** The registry key this panel was opened from. */
  component: string;
  state: PanelState;
  /** What it was before being minimised, so restoring can put it back. */
  previousState?: 'docked' | 'floating';
  /** The floating rect to restore to. */
  lastFloatingRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    anchor?: FloatAnchor | null;
  };
  /** The leaf to restore into. */
  lastLeafId?: string;
  /** Unsaved changes. */
  dirty?: boolean;
  dirtyOptions?: DirtyStateOptions;
  /** Per-instance data passed to the panel component. Unconstrained by design; whether it
   *  survives `saveLayout()` is a runtime fact — see {@link PanelInfo.serializable}. */
  props?: Record<string, unknown>;
  /** Whether this panel's current `props` can round-trip through JSON. A panel with
   *  `false` still works normally; it is simply excluded from the next saved layout. */
  serializable: boolean;
  /** Dedup key: opening the same `component` with the same key focuses this panel instead
   *  of creating another. */
  dedupeKey?: string;
}

/** The on-disk shape of a saved workspace. Compatible with react-dockable-desktop at `version: 2`. */
export interface SerializedLayout {
  /** Schema version. Absent on layouts saved before it existed (treated as 0). */
  version?: number;
  /** The panel the user was looking at. Omitted when nothing was active, or when the
   *  active panel did not survive this snapshot's serialisability pruning. */
  activePanelId?: string | null;
  gridRoot: LayoutNode;
  floating: FloatingWindow[];
  minimized: { id: string; title: Label; component: string }[];
  panels: Record<string, PanelInfo>;
}
