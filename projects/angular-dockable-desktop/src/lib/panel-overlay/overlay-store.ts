/**
 * The state one `<ndd-panel-overlay>` shares with its toolbars and widgets.
 *
 * rdd split this across **three** React contexts — `PanelToolbarCtx`, `PanelManagerCtx` and
 * `PanelOverlayCtx` — not because they were three concerns but to stop a toolbar re-rendering
 * every time a widget gained focus: a context value is one object, so any change re-renders
 * every consumer. Signals are tracked one by one, so a toolbar that reads only the insets is
 * untouched when `topId` changes. One store; the isolation is a property of the reactivity.
 * Ported from vdd `src/core/overlayState.ts`. Records are replaced, never mutated.
 * @internal
 */
import { InjectionToken, signal, untracked } from '@angular/core';
import type { Type, WritableSignal } from '@angular/core';
import type { FloatAnchor, Label } from '../core/types';
import type { NddIcon } from '../core/icon';
import type { PanelFloatPlacement, Stretch } from '../core/stretch';
import { bucketsFor } from '../core/stretch';
import { ANCHORS } from '../core/panel-overlay';
import type { ToolbarInsets, ToolbarPosition } from '../core/panel-overlay';

/** A widget opened through `injectFloatingWidgets()` rather than placed in a template. */
export interface ManagedWidget {
  /**
   * The header text: plain, or a localisable descriptor. A descriptor matters most here, because
   * this object is *stored*: a resolved string is frozen in the language current at `open()`,
   * while a descriptor is resolved on every render and follows a locale change.
   */
  title: Label;
  icon?: NddIcon;
  /** Rendered as the widget's content. */
  component: Type<unknown>;
  /** Inputs for `component`. */
  inputs?: Record<string, unknown>;
  /**
   * The corner to dock to **on first open** — a seed, not live state. Owned by the overlay
   * afterwards, so a gesture is not undone when the caller's own state re-renders, and `open()`
   * on a live id refreshes its content without moving it. `close()` then `open()` re-seeds.
   * @default 'top-right'
   */
  anchor?: FloatAnchor;
  /** Initial width in pixels. @default 320 */
  width?: number;
  /** Initial height in pixels. @default 240 */
  height?: number;
  /** Which axes span the panel **on first open**. A seed, as `anchor`. */
  stretch?: Stretch | null;
}

export type OverlayStacks = Readonly<Record<FloatAnchor, string[]>>;

export interface PanelOverlayStore {
  /** The overlay root element, for measuring drop zones. */
  readonly container: WritableSignal<HTMLElement | null>;
  /** Space each toolbar edge claims. */
  readonly insets: WritableSignal<ToolbarInsets>;
  /** The widget on top, or `null`. */
  readonly topId: WritableSignal<string | null>;
  readonly zOrders: WritableSignal<Readonly<Record<string, number>>>;
  /** Which widgets are stacked in each corner bucket. */
  readonly stacks: WritableSignal<OverlayStacks>;
  /** Each docked widget's block size, so its stack peers can offset past it. */
  readonly dockedSizes: WritableSignal<Readonly<Record<string, number>>>;
  /** The widget being dragged, or `null`. */
  readonly draggingId: WritableSignal<string | null>;
  /** The corner the drag is currently over, or `null`. */
  readonly hovered: WritableSignal<FloatAnchor | null>;
  /** Widgets opened through `injectFloatingWidgets()`, in the order they were opened. */
  readonly managed: WritableSignal<ReadonlyMap<string, ManagedWidget>>;
  /**
   * Live placement of each managed widget, seeded by {@link PanelOverlayStore.openManaged} and
   * owned here from then on — here rather than inside the widget, because the overlay binds a
   * managed widget's `placement` model, and a bound model's source has to be the live value.
   */
  readonly managedPlacements: WritableSignal<Readonly<Record<string, PanelFloatPlacement>>>;

  registerToolbar(position: ToolbarPosition, size: number): void;
  unregisterToolbar(position: ToolbarPosition): void;
  focus(id: string): void;
  dock(id: string, anchor: FloatAnchor, stretch: Stretch | null): void;
  undock(id: string): void;
  reportSize(id: string, size: number): void;
  openManaged(id: string, widget: ManagedWidget): void;
  closeManaged(id: string): void;
  closeAllManaged(): void;
  managedIds(): string[];
  /** Record what a gesture did to a managed widget's placement. */
  setManagedPlacement(id: string, placement: PanelFloatPlacement): void;
}

/** @internal */
export const PANEL_OVERLAY = new InjectionToken<PanelOverlayStore>('ndd.PanelOverlay');

/** Which inset field an edge claims. `left`/`right` are logical, matching how a toolbar positions itself. */
const field = (position: ToolbarPosition): keyof ToolbarInsets =>
  position === 'top' ? 'top' : position === 'bottom' ? 'bottom' : position === 'left' ? 'inlineStart' : 'inlineEnd';

const EMPTY_STACKS: OverlayStacks = { 'top-left': [], 'top-right': [], 'bottom-left': [], 'bottom-right': [] };

export function createPanelOverlayStore(): PanelOverlayStore {
  const insets = signal<ToolbarInsets>({ top: 0, bottom: 0, inlineStart: 0, inlineEnd: 0 });
  const zOrders = signal<Readonly<Record<string, number>>>({});
  const stacks = signal<OverlayStacks>(EMPTY_STACKS);
  const dockedSizes = signal<Readonly<Record<string, number>>>({});
  const managed = signal<ReadonlyMap<string, ManagedWidget>>(new Map());
  const managedPlacements = signal<Readonly<Record<string, PanelFloatPlacement>>>({});
  const topId = signal<string | null>(null);
  let zCounter = 100;

  const setInset = (position: ToolbarPosition, size: number) => {
    const key = field(position);
    if (untracked(insets)[key] !== size) insets.update(i => ({ ...i, [key]: size }));
  };

  return {
    container: signal<HTMLElement | null>(null),
    insets,
    topId,
    zOrders,
    stacks,
    dockedSizes,
    draggingId: signal<string | null>(null),
    hovered: signal<FloatAnchor | null>(null),
    managed,
    managedPlacements,

    registerToolbar: (position, size) => setInset(position, size),
    unregisterToolbar: position => setInset(position, 0),

    focus: id => {
      zCounter += 1;
      zOrders.update(z => ({ ...z, [id]: zCounter }));
      topId.set(id);
    },

    /**
     * Put a widget in the buckets its placement occupies, removing it from the others. Bucket
     * membership depends on the *whole* placement — a full-width strip belongs to both buckets
     * of its edge — so this runs whenever either half changes.
     */
    dock: (id, anchor, stretch) => {
      const buckets = bucketsFor(anchor, stretch);
      const current = untracked(stacks);
      let changed = false;
      const next: Record<FloatAnchor, string[]> = { ...current };
      for (const a of ANCHORS) {
        const without = current[a].filter(x => x !== id);
        const list = buckets.includes(a) ? [...without, id] : without;
        // Replacing an identical list churns every reader of `stacks`, so keep it when nothing moved.
        if (list.length !== current[a].length || list.some((x, i) => x !== current[a][i])) {
          next[a] = list;
          changed = true;
        }
      }
      if (changed) stacks.set(next);
    },

    undock: id => {
      const current = untracked(stacks);
      if (!ANCHORS.some(a => current[a].includes(id))) return;
      const next: Record<FloatAnchor, string[]> = { ...current };
      for (const a of ANCHORS) next[a] = current[a].filter(x => x !== id);
      stacks.set(next);
    },

    reportSize: (id, size) => {
      if (untracked(dockedSizes)[id] !== size) dockedSizes.update(d => ({ ...d, [id]: size }));
    },

    openManaged: (id, widget) => {
      managed.update(m => new Map(m).set(id, widget));
      // Seeded once per open, then owned here: re-opening a live id updates its content and
      // leaves it where the user dragged it; `closeManaged` drops the record, so close-then-open
      // is the reset. rdd's `defaultAnchor` behaves the same way.
      if (!(id in untracked(managedPlacements))) {
        managedPlacements.update(p => ({ ...p, [id]: { anchor: widget.anchor ?? 'top-right', stretch: widget.stretch ?? null } }));
      }
    },
    closeManaged: id => {
      if (!untracked(managed).has(id)) return;
      managed.update(m => {
        const next = new Map(m);
        next.delete(id);
        return next;
      });
      managedPlacements.update(p => {
        const { [id]: _gone, ...rest } = p;
        return rest;
      });
    },
    closeAllManaged: () => {
      if (untracked(managed).size === 0) return;
      managed.set(new Map());
      managedPlacements.set({});
    },
    managedIds: () => [...managed().keys()],

    /**
     * The guard is load-bearing: a gesture can land after its widget was closed — a drop resolves
     * on `pointerup`, and nothing stops a close in between — and writing then would put back a
     * placement for a widget that no longer exists.
     */
    setManagedPlacement: (id, placement) => {
      if (id in untracked(managedPlacements)) managedPlacements.update(p => ({ ...p, [id]: placement }));
    },
  };
}
