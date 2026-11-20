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
import { ApplicationRef, EnvironmentInjector, InjectionToken, Injector, createComponent, inject, signal, untracked } from '@angular/core';
import type { ComponentRef, Signal, Type, WritableSignal } from '@angular/core';
import type { FloatAnchor, Label } from '../core/types';
import type { NddIcon } from '../core/icon';
import type { ContextMenuItem } from '../core/context-menu';
import type { PanelFloatPlacement, Stretch } from '../core/stretch';
import { bucketsFor } from '../core/stretch';
import { ANCHORS } from '../core/panel-overlay';
import type { ToolbarInsets, ToolbarPosition } from '../core/panel-overlay';
import { DOCUMENT } from '@angular/common';
import { WidgetContentCache } from './widget-content';
import { WidgetHosting } from './widget-hosting';
import { Workspace } from '../workspace/workspace';
import { PanelHost } from '../panel/panel-host';
import { PANEL_CONTEXT } from '../panel/panel-ref';
import { WIDGET_HANDLE } from './widget-handle';
import { fromPanelForm, parsePlacement, toPanelForm } from '../core/widget-placement';
import type { OutTarget, PanelBox, PanelForm } from '../core/widget-placement';
import { setPreserveEmbeds } from '../core/dom-move';

/**
 * A managed widget's whole placement (7.11): its corner and stretch, whether it is docked or
 * free, its free position and its own size. Kept by the overlay rather than by the widget's
 * frame, so the frame can be destroyed and created again (a widget moved out of its panel has
 * none) and come back exactly where it was. rdd's and vdd's `ManagedPlacement`. Internal.
 */
export interface ManagedPlacement extends PanelFloatPlacement {
  mode: 'docked' | 'free';
  freePos: { x: number; y: number } | null;
  /** Left untouched while an axis is stretched, so releasing the axis restores it. */
  size: { w: number; h: number };
}

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
  /**
   * Whether the user may dock the widget's panel (drag it into the grid, a group or a tab) once
   * it is out of its panel (7.11). Your own `move()` calls always work. `open()` again on a live
   * id to change it. @default false
   */
  canDock?: boolean;
  /** Whether the user may float the widget's panel once it is out of its panel (7.11). @default false */
  canFloat?: boolean;
  /**
   * The widget's own menu (7.11). In the panel, its title icon becomes a button that opens these
   * items (a menu glyph when there is no icon); out of it, they lead its panel's menus (the tab's,
   * the floating title bar's). Called each time a menu opens, so `w.location` is current.
   */
  titleMenu?: (w: WidgetMenuContext) => ContextMenuItem[];
  /**
   * Open **at** a placement saved earlier with `injectFloatingWidgets().placement(id)` (7.11): where
   * it was in the panel, and whether it was docked, tabbed or floating out of it. Used only on the
   * first open of an id, like `anchor`; a re-open of a live id leaves it where it is.
   *
   * A value this version can't read (another `v`, or broken fields) falls back to the config's own
   * `anchor` / `width` / `height` / `stretch`. A valid one is clamped into the panel as it is now; in
   * a panel that has no size yet (a background tab) a free position waits until it has one. If
   * moving out of the panel is refused (the owner isn't docked), the widget stays in the panel.
   */
  placement?: WidgetPlacement;
  /**
   * Keep embedded documents and media alive when the widget moves (7.11): an `<iframe>` in it
   * doesn't reload when it moves out of its panel, back, or between docked, tabbed and floating.
   * Uses `moveBefore()` where the browser has it (Chrome and Edge 133+, Firefox 144+); in the others
   * an iframe reloads as before. As `preserveEmbeds` on a panel type's `defaultOptions`, which is
   * for the whole panel; this is for the widget alone. @default false
   */
  preserveEmbeds?: boolean;
}

/**
 * Where a managed widget is, as plain JSON (7.11): from `injectFloatingWidgets().placement(id)`,
 * back to `open(id, { placement })`. Opaque: store it as it is (JSON-serialisable) and don't read
 * its fields; they may change between versions, and `v` says which. The same in the React and Vue
 * editions (react-dockable-desktop, vue-dockable-desktop), so a saved value moves between them.
 */
export type WidgetPlacement = { v: 1 } & Record<string, unknown>;

/** What a managed widget's `titleMenu` receives (7.11). */
export interface WidgetMenuContext {
  /** The widget's id. */
  id: string;
  /** Where the widget is as the menu opens. */
  location: WidgetLocation;
  /** The widget's `canDock`, `false` when unset. */
  canDock: boolean;
  /** The widget's `canFloat`, `false` when unset. */
  canFloat: boolean;
  /** `injectFloatingWidgets().move()` for this widget. */
  move(to: WidgetTarget): MoveResult;
  /** Closes the widget for real, wherever it is. */
  close(): void;
}

/**
 * Where a managed widget is shown (7.11). `'panel'` is inside its owner panel, as a floating
 * widget; the others are a workspace panel of its own, beside its owner (`'docked'`), a tab in its
 * owner's group (`'tabbed'`), a floating window (`'floating'`), or minimised to the taskbar.
 */
export type WidgetLocation = 'panel' | 'docked' | 'tabbed' | 'floating' | 'minimized';

/**
 * Where to move a managed widget with `injectFloatingWidgets().move()` (7.11). Its owner panel is
 * always the reference: `'docked'` splits the owner's group on that side (`size` is the new
 * panel's share, 0.1–0.9, as in `openPanel`'s `dockTo`), `'tabbed'` adds a tab to the owner's
 * group. `'floating'` opens a floating window at `rect` (workspace pixels), or, without one, where
 * the widget is on screen, at its size. `'panel'` brings it back to where it last was inside the panel.
 */
export type WidgetTarget =
  | { to: 'panel' }
  | { to: 'docked'; position: 'left' | 'right' | 'top' | 'bottom'; size?: number }
  | { to: 'tabbed' }
  | { to: 'floating'; rect?: { x: number; y: number; width: number; height: number } };

/**
 * What `move()` did (7.11). A refusal changes nothing:
 * - `not-open`: no widget with that id is open in this overlay;
 * - `owner-not-docked`: `'docked'` and `'tabbed'` need the owner panel in the grid (a floating or
 *   minimised owner can still move a widget to `'floating'`);
 * - `owner-not-kept-alive`: the owner's panel type has `keepAlive: false`, so its component is
 *   destroyed while hidden and would take the widget with it;
 * - `no-workspace`: the overlay isn't in a workspace panel (outside `<ndd-desktop>`, or in a modal
 *   or side panel), so there is nowhere to move to.
 */
export type MoveResult =
  | { ok: true }
  | { ok: false; reason: 'not-open' | 'owner-not-docked' | 'owner-not-kept-alive' | 'no-workspace' };

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
   * owned here from then on: the widget's frame reads and writes it here (7.11), so it outlives
   * the frame. Records are replaced, never mutated.
   */
  readonly managedPlacements: WritableSignal<Readonly<Record<string, ManagedPlacement>>>;
  /**
   * Each managed widget's content element, `div.ndd-panel-float__content` (7.11). The overlay
   * creates the widget's component on it once; a frame (or, later, a hosted panel) only shows it.
   */
  readonly content: WidgetContentCache;
  /**
   * Open managed widgets whose frame is not rendered (7.11): out of the panel, their content
   * element is shown by a hosted panel, and their placement is kept for the way back.
   */
  readonly framesHidden: WritableSignal<ReadonlySet<string>>;
  /** Moving managed widgets out of the panel and back (7.11). */
  readonly hosting: WidgetHosting;

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
  /** Record what a gesture did to a managed widget's placement: merged into its record. */
  setManagedPlacement(id: string, patch: Partial<ManagedPlacement>): void;
  /** Where a managed widget is, as a saved placement (7.11); `null` when it isn't open. */
  placementOf(id: string): WidgetPlacement | null;
  /**
   * Saved free positions waiting for the panel to have a size (7.11): while above zero, the
   * overlay observes its root and calls {@link applyPending}.
   */
  readonly pendingCount: Signal<number>;
  /** Places the waiting free positions, if the panel has a size now. */
  applyPending(): void;
}

/** @internal */
export const PANEL_OVERLAY = new InjectionToken<PanelOverlayStore>('ndd.PanelOverlay');

/** Which inset field an edge claims. `left`/`right` are logical, matching how a toolbar positions itself. */
const field = (position: ToolbarPosition): keyof ToolbarInsets =>
  position === 'top' ? 'top' : position === 'bottom' ? 'bottom' : position === 'left' ? 'inlineStart' : 'inlineEnd';

const EMPTY_STACKS: OverlayStacks = { 'top-left': [], 'top-right': [], 'bottom-left': [], 'bottom-right': [] };

/** A saved out-of-panel target as a move; a floating rect is clamped into the workspace as it is now. */
function targetOf(out: OutTarget, root: HTMLElement | null): WidgetTarget {
  if (out.at === 'tabbed') return { to: 'tabbed' };
  if (out.at === 'docked') return { to: 'docked', position: out.position, ...(out.size !== undefined ? { size: out.size } : {}) };
  const viewport = root?.closest<HTMLElement>('.ndd-workspace-viewport');
  const vw = viewport?.clientWidth ?? 0;
  const vh = viewport?.clientHeight ?? 0;
  const r = out.rect;
  if (vw <= 0 || vh <= 0) return { to: 'floating', rect: r };
  const width = Math.min(r.width, vw);
  const height = Math.min(r.height, vh);
  return { to: 'floating', rect: { x: Math.min(r.x, vw - width), y: Math.min(r.y, vh - height), width, height } };
}

/** Where a managed widget starts: its config's corner, stretch and size, docked. */
const seedPlacement = (widget: ManagedWidget): ManagedPlacement => ({
  anchor: widget.anchor ?? 'top-right',
  stretch: widget.stretch ?? null,
  mode: 'docked',
  freePos: null,
  size: { w: widget.width ?? 320, h: widget.height ?? 240 },
});

/** In an injection context: the overlay's `providers`, whose node injector the content inherits. */
export function createPanelOverlayStore(): PanelOverlayStore {
  const insets = signal<ToolbarInsets>({ top: 0, bottom: 0, inlineStart: 0, inlineEnd: 0 });
  const zOrders = signal<Readonly<Record<string, number>>>({});
  const stacks = signal<OverlayStacks>(EMPTY_STACKS);
  const dockedSizes = signal<Readonly<Record<string, number>>>({});
  const managed = signal<ReadonlyMap<string, ManagedWidget>>(new Map());
  const managedPlacements = signal<Readonly<Record<string, ManagedPlacement>>>({});
  const container = signal<HTMLElement | null>(null);
  /**
   * A widget's component is created by the store, on its own element, and attached to
   * `ApplicationRef` (7.11), as `PanelHost` does for panels: no frame's lifetime reaches it. Its
   * element injector is the overlay's, so `PANEL_CONTEXT`, `PANEL_OVERLAY`, `Workspace` and every
   * provider above the overlay resolve inside the content exactly as before. (Under
   * `*ngComponentOutlet` it was the frame's node; nothing of the frame's is provided.) Each
   * widget's own child of it adds `injectWidget()`'s handle.
   */
  const environmentInjector = inject(EnvironmentInjector);
  const elementInjector = inject(Injector);
  const appRef = inject(ApplicationRef);
  const doc = inject(DOCUMENT);
  const content: WidgetContentCache = new WidgetContentCache(
    () => untracked(container)?.ownerDocument ?? doc,
    (id, type, hostElement): ComponentRef<unknown> => {
      // A child of the overlay's injector per widget, carrying `injectWidget()`'s handle.
      const widgetInjector = Injector.create({
        providers: [{ provide: WIDGET_HANDLE, useValue: hosting.handle(id) }],
        parent: elementInjector,
      });
      const ref = createComponent(type, { environmentInjector, elementInjector: widgetInjector, hostElement });
      appRef.attachView(ref.hostView);
      return ref;
    },
  );
  const topId = signal<string | null>(null);
  const framesHidden = signal<ReadonlySet<string>>(new Set());
  const setFrameHidden = (id: string, hidden: boolean) => {
    const now = untracked(framesHidden);
    if (now.has(id) === hidden) return;
    const next = new Set(now);
    if (hidden) next.add(id);
    else next.delete(id);
    framesHidden.set(next);
  };
  // The workspace, its panel host and the owner panel's id: all absent outside a workspace panel.
  const workspace = inject(Workspace, { optional: true }) as Workspace<never> | null;
  const hosting: WidgetHosting = new WidgetHosting(
    {
      managed: () => managed(),
      contentOf: id => content.get(id),
      cache: content,
      container: () => untracked(container),
      setFrameHidden,
      closeManaged: id => closeManaged(id),
    },
    workspace,
    inject(PanelHost, { optional: true })?.dom ?? null,
    inject(PANEL_CONTEXT, { optional: true })?.id ?? null,
  );
  let zCounter = 100;
  /** Saved free positions waiting for the panel to have a size (7.11), by widget id. */
  const pending = new Map<string, PanelForm>();
  const pendingCount = signal(0);
  /** The panel's size and direction now, or `null` while it has none. */
  const boxNow = (): PanelBox | null => {
    const el = untracked(container);
    return el && el.clientWidth > 0 && el.clientHeight > 0
      ? { width: el.clientWidth, height: el.clientHeight, rtl: workspace ? untracked(workspace.isRtl) : false }
      : null;
  };
  const dropPending = (id: string) => {
    if (pending.delete(id)) pendingCount.set(pending.size);
  };

  function closeManaged(id: string): void {
    if (!untracked(managed).has(id)) return;
    // Out of the panel, its hosted panel goes first.
    hosting.release(id);
    dropPending(id);
    content.release(id);
    setFrameHidden(id, false);
    managed.update(m => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
    managedPlacements.update(p => {
      const { [id]: _gone, ...rest } = p;
      return rest;
    });
  }

  /**
   * The guard is load-bearing: a gesture can land after its widget was closed — a drop resolves
   * on `pointerup`, and nothing stops a close in between — and writing then would put back a
   * placement for a widget that no longer exists.
   */
  function setManagedPlacement(id: string, patch: Partial<ManagedPlacement>): void {
    if (id in untracked(managedPlacements)) managedPlacements.update(p => ({ ...p, [id]: { ...p[id]!, ...patch } }));
  }

  const setInset = (position: ToolbarPosition, size: number) => {
    const key = field(position);
    if (untracked(insets)[key] !== size) insets.update(i => ({ ...i, [key]: size }));
  };

  return {
    container,
    insets,
    topId,
    zOrders,
    stacks,
    dockedSizes,
    draggingId: signal<string | null>(null),
    hovered: signal<FloatAnchor | null>(null),
    managed,
    managedPlacements,
    content,
    framesHidden,
    hosting,

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
      const reopened = untracked(managed).has(id);
      // The content first: a frame rendered for this id finds its element.
      content.render(id, widget.component, widget.inputs);
      // Its element moves with moveBefore(), and so do the containers it moves with (7.11).
      setPreserveEmbeds(content.get(id)!, widget.preserveEmbeds === true);
      if (widget.preserveEmbeds) hosting.preserveOwner();
      managed.update(m => new Map(m).set(id, widget));
      // A re-open of a widget out of the panel: its hosted panel follows the new title and icon.
      hosting.refresh(id, widget);
      // Seeded once per open, then owned here: re-opening a live id updates its content and
      // leaves it where the user dragged it; `closeManaged` drops the record, so close-then-open
      // is the reset. rdd's `defaultAnchor` behaves the same way. A saved placement (7.11) is
      // read here too, only on the first open of an id.
      let saved: ReturnType<typeof parsePlacement> | null = null;
      if (!(id in untracked(managedPlacements))) {
        saved = widget.placement !== undefined ? parsePlacement(widget.placement) : null;
        let seed = seedPlacement(widget);
        if (saved?.home) {
          const { state, deferred } = fromPanelForm(saved.home, boxNow());
          seed = state;
          if (deferred) {
            pending.set(id, saved.home);
            pendingCount.set(pending.size);
          }
        }
        managedPlacements.update(p => ({ ...p, [id]: seed }));
      }
      // Out of the panel, as saved. A refusal leaves it in the panel.
      if (!reopened && saved?.out) hosting.move(id, targetOf(saved.out, untracked(container)));
    },
    closeManaged,
    closeAllManaged: () => {
      if (untracked(managed).size === 0) return;
      // Out of the panel, its hosted panel goes first.
      for (const id of untracked(managed).keys()) {
        hosting.release(id);
        content.release(id);
      }
      framesHidden.set(new Set());
      pending.clear();
      pendingCount.set(0);
      managed.set(new Map());
      managedPlacements.set({});
    },
    managedIds: () => [...managed().keys()],

    setManagedPlacement,

    /**
     * A free position still waiting for a size is returned as it was saved, never re-measured
     * against a 0×0 panel. Out of the panel: where, plus `home`, the panel form.
     */
    placementOf: id => {
      if (!untracked(managed).has(id)) return null;
      const current = untracked(managedPlacements)[id];
      const home = pending.get(id) ?? (current ? toPanelForm(current, boxNow()) : null);
      if (!home) return null;
      const out = hosting.outTarget(id);
      return (out ? { v: 1, home, ...out } : home) as unknown as WidgetPlacement;
    },
    pendingCount: pendingCount.asReadonly(),
    applyPending: () => {
      const box = boxNow();
      if (!box || pending.size === 0) return;
      for (const [id, form] of pending) setManagedPlacement(id, fromPanelForm(form, box).state);
      pending.clear();
      pendingCount.set(0);
    },
  };
}
