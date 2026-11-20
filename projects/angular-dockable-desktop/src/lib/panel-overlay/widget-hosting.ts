/**
 * Moving a panel overlay's managed widgets out of their owner panel and back (7.11, widgets out
 * of the panel). Internal; one per `<ndd-panel-overlay>`, owned by its store.
 *
 * A widget out of its panel is shown by a **hosted panel**: a workspace panel of the reserved kind
 * `'ndd:widget'` (`PanelInfo.owner` set), whose content (`NddHostedWidget`) shows the widget's
 * content element. The widget's component stays where the overlay created it, on that element,
 * with the overlay's injectors; only the element moves, so nothing is re-created and the content
 * keeps every injection from its owner panel.
 *
 * This overlay owns its hosted panels: it opens and removes them, closes the widget when the user
 * closes one, and removes them all when it is destroyed (its owner closed). A hosted panel that
 * goes without the overlay asking (only `loadLayout` does that) sends its widget home.
 *
 * rdd's `useWidgetHosting` hook and vdd's composable of the same name, as a class.
 * @internal
 */
import { computed, effect, signal, untracked } from '@angular/core';
import type { Workspace } from '../workspace/workspace';
import type { ContextMenuItem } from '../core/context-menu';
import type { WidgetHandle } from './widget-handle';
import type { PanelDomCache } from '../panel/panel-dom';
import type { HostedPanelPlacement, Label, LayoutNode, PanelInfo } from '../core/types';
import { optionsFor } from '../core/panel-options';
import { findLeafForPanel } from '../core/layout-tree';
import type { ManagedWidget, MoveResult, WidgetLocation, WidgetTarget } from './overlay-store';
import type { OutTarget } from '../core/widget-placement';

/** A widget's own capabilities, as its hosted panel's options (7.11, M4). Both `false` unless set. */
const capabilities = (widget: ManagedWidget): { canFloat: boolean; canDock: boolean } => ({
  canFloat: widget.canFloat ?? false,
  canDock: widget.canDock ?? false,
});

interface Rect { x: number; y: number; width: number; height: number }

/**
 * Which container a widget is in, as a string that changes exactly when its element moves: the
 * location plus, in the grid, the group. `hostedId` is undefined while the widget is in the panel.
 * The location is its first part. Recorded on each hosted entry (`key`): the user's own moves of a
 * hosted panel are a change of it (M5). A docked panel in no group (`'docked|'`) is in transit.
 */
export function containerKey(
  state: { panels: Record<string, PanelInfo>; gridRoot: LayoutNode },
  hostedId: string | undefined,
  ownerId: string,
): string {
  const panel = hostedId ? state.panels[hostedId] : undefined;
  if (!hostedId || !panel) return 'panel';
  if (panel.state === 'floating') return 'floating';
  if (panel.state === 'minimized') return 'minimized';
  const leaf = findLeafForPanel(state.gridRoot, hostedId);
  return `${leaf === findLeafForPanel(state.gridRoot, ownerId) ? 'tabbed' : 'docked'}|${leaf ?? ''}`;
}

const num = (v: number | string | undefined): v is number => typeof v === 'number';

/** What the hosting needs of its overlay's store. */
export interface HostingStore {
  readonly managed: () => ReadonlyMap<string, ManagedWidget>;
  readonly contentOf: (id: string) => HTMLElement | undefined;
  readonly cache: { attach(el: HTMLElement, host: HTMLElement): void; leave(el: HTMLElement, host: Element): void };
  /** The overlay root, where a widget's frame is. */
  readonly container: () => HTMLElement | null;
  /** Show or hide a widget's frame in the panel. */
  readonly setFrameHidden: (id: string, hidden: boolean) => void;
  readonly closeManaged: (id: string) => void;
}

interface Hosted {
  panelId: string;
  /** Unregisters its close handler and its menu. */
  unregister: () => void;
  /** The container it is in, {@link containerKey}, as last seen. */
  key: string;
  /** Where the last `move()` took it (M6): what `placement()` reports for a docked one. */
  target: WidgetTarget;
}

type Kind = 'will' | 'moved';

export class WidgetHosting {
  /** Widget id → its hosted panel, while it is out of the panel. */
  private readonly hosted = new Map<string, Hosted>();
  /** The same, widget id → hosted panel id, as a signal: `injectWidget().panelId` and `location()`. */
  private readonly hostedIds = signal<Readonly<Record<string, string>>>({});
  /** Each widget's `onWillMove` / `onMoved` callbacks (M5). */
  private readonly listeners = new Map<string, { will: Set<() => void>; moved: Set<() => void> }>();
  /** Widgets the user is moving in this tick: one `onWillMove` per tick (M5). */
  private readonly moving = new Set<string>();
  private readonly unlisten: () => void;
  /** The owner's id when it is a workspace panel, else `null`: `injectWidget().ownerPanelId`. */
  private readonly ownerPanelId: string | null;
  /**
   * The owner panel's id when the overlay is in a workspace panel. A modal or side panel provides
   * a panel context too, but its id is not in the layout, so `move()` refuses there as it does
   * outside any panel. Read when needed: the owner can't change for the overlay's life.
   */
  private readonly ownerId: string | null;

  constructor(
    private readonly store: HostingStore,
    private readonly ws: Workspace<never> | null,
    private readonly dom: PanelDomCache | null,
    contextId: string | null,
  ) {
    this.ownerId = contextId;
    this.ownerPanelId = ws && contextId && untracked(ws.state).panels[contextId] ? contextId : null;
    // A hosted panel that left the workspace without this overlay asking (only loadLayout does:
    // a layout never holds one) sends its widget back into the panel. A close runs the close
    // handler synchronously, inside the workspace, so that case is already gone from `hosted`.
    // An effect is enough here: the element was already put aside by the drop handler.
    if (ws) {
      effect(() => {
        const panels = ws.panels();
        untracked(() => {
          for (const [id, entry] of [...this.hosted]) {
            if (entry.panelId in panels) continue;
            // onWillMove ran in the drop handler, before the load: this is its onMoved.
            this.home(id, false);
            this.settled(id);
          }
        });
      });
    }
    // The user moving a hosted panel (a drag to another group, floating, docking, minimising,
    // restoring): heard synchronously, inside the workspace's own state write, before anything
    // renders, so the element hasn't moved yet. An effect would run after the DOM moved.
    this.unlisten = ws ? ws.onStateChange(() => this.sync()) : () => undefined;
  }

  /**
   * Called on every workspace state write. The overlay's own moves fire their callbacks in
   * `move()` itself: during one, the entry is out of `hosted`, and its key is the new
   * container's by the time it is back, so nothing is seen twice.
   *
   * One action may write several times. A docked panel in no group is such a step (a close, a
   * float or a minimise takes it out of the tree before changing the rest; a dock sets the state
   * before inserting it): in transit, not a container, so it is skipped, and a close then finds
   * the panel gone. Otherwise the first change fires onWillMove and the rest of that tick is the
   * same move; onMoved follows once, after the tick, even if the steps cancelled out.
   * vdd's sync watcher.
   */
  private sync(): void {
    const { ws, ownerId } = this;
    if (!ws || !ownerId) return;
    const state = untracked(ws.state);
    for (const [id, entry] of this.hosted) {
      if (!(entry.panelId in state.panels)) continue; // gone: a close, or a layout load
      const key = containerKey(state, entry.panelId, ownerId);
      if (key === entry.key || key.endsWith('|')) continue;
      entry.key = key;
      if (this.moving.has(id)) continue;
      this.moving.add(id);
      this.fire(id, 'will');
      queueMicrotask(() => {
        this.moving.delete(id);
        if (this.hosted.has(id)) this.settled(id);
      });
    }
  }

  /** Where a widget is shown, or `null` when it is not open. Reactive. */
  location(id: string): WidgetLocation | null {
    if (!this.store.managed().has(id)) return null;
    const panelId = this.hostedIds()[id];
    if (!panelId || !this.ws || !this.ownerId) return 'panel';
    return containerKey(this.ws.state(), panelId, this.ownerId).split('|')[0] as WidgetLocation;
  }

  /**
   * The widget's `titleMenu` items for where it is now; empty without one (M4). Reactive: a
   * re-open with a new `titleMenu` changes them, so a menu button appears at once.
   */
  menuItems(id: string): ContextMenuItem[] {
    const widget = this.store.managed().get(id);
    if (!widget?.titleMenu) return [];
    return widget.titleMenu({
      id,
      location: this.location(id) ?? 'panel',
      ...capabilities(widget),
      move: to => this.move(id, to),
      close: () => this.store.closeManaged(id),
    });
  }

  /** `injectWidget()`'s handle for a widget's content (M5), before the injecting context's scoping. */
  handle(id: string): WidgetHandle {
    return {
      id,
      ownerPanelId: this.ownerPanelId,
      // A widget in its panel has no entry, so no location check is needed.
      panelId: computed(() => this.hostedIds()[id] ?? null),
      location: computed(() => this.location(id) ?? 'panel'),
      onWillMove: cb => this.listen(id, 'will', cb),
      onMoved: cb => this.listen(id, 'moved', cb),
    };
  }

  move(id: string, to: WidgetTarget): MoveResult {
    const widget = untracked(this.store.managed).get(id);
    const el = this.store.contentOf(id);
    if (!widget || !el) return { ok: false, reason: 'not-open' };
    const current = this.hosted.get(id);
    if (to.to === 'panel') {
      // Already in the panel: a no-op, which moves nothing and so calls nothing.
      if (!current) return { ok: true };
      this.fire(id, 'will');
      this.home(id, true);
      this.settled(id);
      return { ok: true };
    }
    const { ws, dom, ownerId } = this;
    const state = ws ? untracked(ws.state) : null;
    const owner = state && ownerId ? state.panels[ownerId] : undefined;
    // An overlay in a modal, a side panel or outside any workspace has no workspace panel to move beside.
    if (!ws || !state || !dom || !ownerId || !owner || owner.owner) return { ok: false, reason: 'no-workspace' };
    if (optionsFor(ws.registry, owner)?.keepAlive === false) return { ok: false, reason: 'owner-not-kept-alive' };
    if (to.to !== 'floating' && owner.state !== 'docked') return { ok: false, reason: 'owner-not-docked' };

    const at: HostedPanelPlacement =
      to.to === 'floating'
        ? { kind: 'float', rect: to.rect ?? this.frameRect(id, widget) }
        : to.to === 'tabbed'
          ? { kind: 'dock', dockTo: { panel: ownerId, position: 'center' } }
          : { kind: 'dock', dockTo: { panel: ownerId, position: to.position, ...(to.size !== undefined ? { size: to.size } : {}) } };
    // Already out: the hosted panel is replaced rather than moved, so every target takes one path.
    // The new panel keeps the title the old one had, which the app may have set with
    // updatePanelTitle (rdd 7.11.0).
    const title: Label = (current && state.panels[current.panelId]?.title) ?? widget.title;
    // Synchronously, before anything below touches the DOM: the element hasn't moved yet.
    this.fire(id, 'will');
    if (current) this.detach(id, true);
    const panelId = `${ownerId}/${id}`;
    // Registered first, so the hosted panel's content finds it as soon as it exists.
    dom.setHostedContent(panelId, { el, cache: this.store.cache });
    if (!ws.openHostedPanel(panelId, { panelId: ownerId, widgetId: id, options: capabilities(widget) }, title, at)) {
      // Only possible for an owner that left the grid in between: report it as such.
      dom.setHostedContent(panelId, null);
      if (current) {
        // It was out, and has gone home: that is the move onWillMove announced.
        this.store.setFrameHidden(id, false);
        this.settled(id);
      }
      return { ok: false, reason: 'owner-not-docked' };
    }
    if (widget.icon !== undefined) ws.setPanelIcon(panelId, widget.icon);
    // An in-page close of the hosted panel (×, the menu's Close, closePanel) closes the widget;
    // going back is move({ to: 'panel' }). A layout load about to drop it: put the element aside
    // now, synchronously, before the grid's DOM changes; the effect above then sends it home.
    const unregisterClose = ws.registerHostedCloseHandler(
      panelId,
      () => {
        this.detach(id, false);
        this.store.closeManaged(id);
      },
      () => {
        this.fire(id, 'will');
        this.park(id);
      },
    );
    // The app's titleMenu items lead the hosted panel's own menus (M4). The getter reads the
    // widget's config each time, so a re-open with a new titleMenu applies at once.
    const unregisterMenu = ws.registerPanelMenu(panelId, () => this.menuItems(id));
    const unregister = () => {
      unregisterClose();
      unregisterMenu();
    };
    // Its hosted panel's element moves the content wherever the user takes it: it keeps embeds too.
    if (widget.preserveEmbeds) dom.preserveEmbeds(panelId);
    const target: WidgetTarget = to.to === 'floating' ? { to: 'floating', rect: at.kind === 'float' ? at.rect : undefined } : to;
    this.hosted.set(id, { panelId, unregister, key: containerKey(untracked(ws.state), panelId, ownerId), target });
    this.hostedIds.update(h => ({ ...h, [id]: panelId }));
    this.store.setFrameHidden(id, true);
    // Every move settles here, including a replace that lands in the same container (floating to
    // floating, a tab to a tab in the same group), whose key doesn't change (rdd 7.11.0).
    this.settled(id);
    return { ok: true };
  }

  /** A re-open of a live id: the hosted panel follows the widget's title and icon. */
  refresh(id: string, widget: ManagedWidget): void {
    const entry = this.hosted.get(id);
    if (!entry || !this.ws) return;
    this.ws.updatePanelTitle(entry.panelId, widget.title);
    this.ws.setPanelIcon(entry.panelId, widget.icon ?? null);
    this.ws.setHostedOptions(entry.panelId, capabilities(widget));
  }

  /**
   * Where a widget out of its panel is, as a saved placement's target (M6); `null` in the panel.
   * Floating: the window's current rect. Tabbed: `tabbed`. Docked: the side and size of the last
   * `move()` (a user's drag elsewhere in the grid keeps them). Minimised: where it was before, from
   * what the workspace recorded as it minimised it (`previousState`, `lastFloatingRect`,
   * `lastLeafId`). vdd's `outTarget`.
   */
  outTarget(id: string): OutTarget | null {
    const entry = this.hosted.get(id);
    const { ws, ownerId } = this;
    const state = ws ? untracked(ws.state) : null;
    const panel = entry && state ? state.panels[entry.panelId] : undefined;
    if (!entry || !panel || !state || !ownerId) return null;
    const n = (v: number | string) => (typeof v === 'number' ? v : parseFloat(v) || 0);
    const where = containerKey(state, entry.panelId, ownerId).split('|')[0];
    const t = entry.target;
    const docked = (): OutTarget =>
      t.to === 'docked'
        ? { at: 'docked', position: t.position, ...(t.size !== undefined ? { size: t.size } : {}) }
        : { at: 'docked', position: 'bottom' };
    if (where === 'floating') {
      const win = state.floating.find(w => w.id === entry.panelId);
      if (win) return { at: 'floating', rect: { x: n(win.x), y: n(win.y), width: n(win.width), height: n(win.height) } };
    }
    if (where === 'tabbed') return { at: 'tabbed' };
    if (where === 'docked') return docked();
    // Minimised: where it was before.
    const r = panel.lastFloatingRect;
    if (panel.previousState === 'floating' && r) return { at: 'floating', rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    if (panel.previousState === 'docked' && panel.lastLeafId) {
      return panel.lastLeafId === findLeafForPanel(state.gridRoot, ownerId) ? { at: 'tabbed' } : docked();
    }
    if (t.to === 'floating' && t.rect) return { at: 'floating', rect: t.rect };
    return t.to === 'docked' ? docked() : { at: 'tabbed' };
  }

  /** Marks the owner panel's element to move with moveBefore() (`preserveEmbeds`, M7). */
  preserveOwner(): void {
    if (this.dom && this.ownerPanelId) this.dom.preserveEmbeds(this.ownerPanelId);
  }

  /** The widget is closing: its hosted panel goes, without the close handler, and its callbacks. */
  release(id: string): void {
    this.detach(id, true);
    this.listeners.delete(id);
  }

  /** The overlay is going (its owner closed): its widgets' panels go with it. */
  dispose(): void {
    this.unlisten();
    for (const id of [...this.hosted.keys()]) this.detach(id, true);
    this.listeners.clear();
  }

  private listen(id: string, kind: Kind, cb: () => void): () => void {
    let entry = this.listeners.get(id);
    if (!entry) {
      entry = { will: new Set(), moved: new Set() };
      this.listeners.set(id, entry);
    }
    const set = entry[kind];
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  private fire(id: string, kind: Kind): void {
    const set = this.listeners.get(id)?.[kind];
    if (set) for (const cb of [...set]) cb();
  }

  /**
   * `onMoved`, once: on the element's first size in its new container (a ResizeObserver), else
   * after two frames (minimised, or no ResizeObserver). Called right after the move; the
   * observer reports after the render that put the element in place.
   */
  private settled(id: string): void {
    const el = this.store.contentOf(id);
    if (!el) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer?.disconnect();
      // Still the same widget: a close in between calls nothing.
      if (this.store.contentOf(id) === el) this.fire(id, 'moved');
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(entries => {
            if (entries.some(e => e.contentRect.width > 0 && e.contentRect.height > 0)) finish();
          });
    observer?.observe(el);
    const frame = typeof requestAnimationFrame === 'undefined' ? (cb: () => void) => setTimeout(cb, 16) : requestAnimationFrame;
    frame(() => frame(finish));
  }

  /** Back into the panel, where it was: its frame is shown again. */
  private home(id: string, remove: boolean): void {
    if (!this.hosted.has(id)) return;
    this.detach(id, remove);
    this.store.setFrameHidden(id, false);
  }

  /**
   * Forgets a widget's hosted panel and removes it from the workspace unless it is already gone.
   * The element is put aside first, so no grid change Angular makes can take it out of the
   * document (a destroyed leaf's DOM goes before its slots' destroy hooks run, ADR 0002).
   */
  private detach(id: string, remove: boolean): void {
    const entry = this.hosted.get(id);
    if (!entry) return;
    this.hosted.delete(id);
    this.hostedIds.update(({ [id]: _gone, ...rest }) => rest);
    entry.unregister();
    this.park(id);
    if (remove) this.ws?.removeHostedPanel(entry.panelId);
    this.dom?.setHostedContent(entry.panelId, null);
  }

  /** Puts the widget's element in its overlay's hidden store, if a hosted panel is showing it. */
  private park(id: string): void {
    const el = this.store.contentOf(id);
    const parent = el?.parentElement;
    if (el && parent?.classList.contains('ndd-hosted-widget')) this.store.cache.leave(el, parent);
  }

  /**
   * Where the widget is on screen, in workspace pixels: where `'floating'` opens by default. Out
   * of the panel, its own panel (a floating one stays where it is); in it, its frame.
   */
  private frameRect(id: string, widget: ManagedWidget): Rect {
    const hostedId = this.hosted.get(id)?.panelId;
    if (hostedId && this.ws) {
      const win = untracked(this.ws.floating).find(w => w.id === hostedId);
      if (win && num(win.x) && num(win.y) && num(win.width) && num(win.height)) {
        return { x: win.x, y: win.y, width: win.width, height: win.height };
      }
    }
    const root = this.store.container();
    const frame = hostedId
      ? this.dom?.has(hostedId)
        ? this.dom.elementFor(hostedId)
        : undefined
      : root
        ? [...root.querySelectorAll<HTMLElement>('[data-ndd-widget]')].find(el => el.getAttribute('data-ndd-widget') === id)
        : undefined;
    const viewport = (frame ?? root)?.closest('.ndd-workspace-viewport');
    const f = frame?.getBoundingClientRect();
    const v = viewport?.getBoundingClientRect();
    return {
      x: f && v ? Math.round(f.left - v.left) : 0,
      y: f && v ? Math.round(f.top - v.top) : 0,
      width: f && f.width > 0 ? Math.round(f.width) : (widget.width ?? 320),
      height: f && f.height > 0 ? Math.round(f.height) : (widget.height ?? 240),
    };
  }
}
