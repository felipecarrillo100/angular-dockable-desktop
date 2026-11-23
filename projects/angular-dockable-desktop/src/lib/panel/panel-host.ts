/**
 * The panel host: creates each open panel's component **once**, for as long as it is open, and
 * destroys it only when it closes. The one place a panel is ever created or destroyed (ADR 0002).
 * The one exception is a kind with `keepAlive: false` (1.7.0, ADR 0018): its component exists only
 * while the panel is on screen; the host, the content element, the size and the context stay.
 *
 * Each component is created on its library-owned `.ndd-panel-content` element and attached to
 * `ApplicationRef` — never to a `ViewContainerRef` inside a leaf — so no layout component's
 * lifetime can reach it. Slots (`[nddPanelSlot]`) move the element; this class never does.
 *
 * Panel data reaches the component as its own inputs: every key of `PanelInfo.props` that the
 * component declares as an input (by public or alias name) is applied with `setInput`, and so
 * is `panelId`. Keys it does not declare are skipped, so a layout saved by another version, or
 * by rdd/vdd with different props, never throws NG0303.
 */
import {
  ApplicationRef,
  DestroyRef,
  EnvironmentInjector,
  Injector,
  afterNextRender,
  computed,
  createComponent,
  effect,
  inject,
  reflectComponentType,
  signal,
  untracked,
} from '@angular/core';
import type { ComponentRef, EffectRef, Signal, Type, WritableSignal } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import type { WorkspaceState } from '../workspace/workspace';
import type { ContainerType, LayoutNode } from '../core/types';
import { PanelDomCache } from './panel-dom';
import { PANEL_CONTEXT } from './panel-ref';
import type { PanelContext } from './panel-ref';
import { NddUnregisteredPanel, NddPanelLoading } from './panel-placeholders';
import { NddHostedWidget } from './hosted-widget';
import { findLeaf, findLeafForPanel } from '../core/layout-tree';
import { optionsFor } from '../core/panel-options';
import { resizeObserverFor } from '../core/dom-context';
import { mountPopoutWrapper } from '../common/popout-wrap';
import type { MountedPopoutWrapper } from '../common/popout-wrap';
import { mainWindow } from './panel-window';
import type { PanelWindow } from './panel-window';
import type { PopOutEntry } from '../core/pop-out-windows';

/**
 * What `<ndd-desktop>` tells its panel host about pop-out windows (1.12.0): whether the workspace
 * has them, the open windows, and the app's `popoutWrapper`.
 */
export interface PanelHostPopOut {
  readonly enabled: boolean;
  readonly entries: Signal<readonly PopOutEntry[]>;
  /**
   * The app's wrapper while the workspace has pop-outs (null otherwise), read when a panel is
   * created: it is around the panel's content for its whole life.
   */
  wrapper(): Type<unknown> | null;
}

interface HostedPanel {
  ref: ComponentRef<unknown> | null;
  component: string;
  /** Inputs the created component declares, by template name. */
  inputs: Set<string>;
  size: WritableSignal<{ width: number; height: number } | null>;
  observer: ResizeObserver | null;
  /** Last props applied, to set only what changed. */
  applied: Record<string, unknown> | undefined;
  disposed: boolean;
  /** The resolved component, once known: what a `keepAlive: false` panel is re-created from. */
  type: Type<unknown> | null;
  /** The window the panel is in (1.12.0): `injectPanelWindow()`'s, and the wrapper's inputs. */
  window: Signal<PanelWindow>;
  /** The app's popoutWrapper around the content (1.12.0), for the panel's whole life, and what keeps its inputs. */
  wrapper: { mounted: MountedPopoutWrapper; follow: EffectRef } | null;
}

/** @internal — one per `<ndd-desktop>`, provided in its `providers`. */
export class PanelHost {
  readonly dom: PanelDomCache;
  private readonly workspace = inject(Workspace) as Workspace<never>;
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);
  private readonly hosted = new Map<string, HostedPanel>();
  /** Bumped when a panel's component is created, so previews and tests can observe it. */
  readonly created = signal(0);
  /** A park of the preserving panels is queued for this task (`preserveEmbeds`). */
  private parkQueued = false;
  /** Preserving panels parked before a render, to put back in their slots after it. */
  private readonly parked = new Set<string>();
  /**
   * Pop-out windows (1.12.0), set by `<ndd-desktop>` before its first render; null for a host with
   * no desktop (no window but the main one, no wrapper).
   */
  popOut: PanelHostPopOut | null = null;

  constructor(doc: Document) {
    this.dom = new PanelDomCache(doc);
    // Reconcile the set of hosted panels with the open panels, and their props with inputs.
    effect(() => {
      const panels = this.workspace.panels();
      untracked(() => this.reconcile(panels));
    });
    // keepAlive: false (1.7.0): a panel's component exists only while the panel is on screen.
    effect(() => {
      this.workspace.panels();
      this.workspace.gridRoot();
      untracked(() => this.applyVisibility());
    });
    // Panel content follows the workspace's reading direction (the mount lives outside it).
    effect(() => {
      const dir = this.workspace.dir();
      this.created(); // re-apply to newly created content
      for (const content of this.dom.allContents()) content.dir = dir;
    });
    // preserveEmbeds (rdd 7.11.0): park the panels that keep their embeds before a render can
    // destroy their slots. See `beforeLayoutRender`.
    const unlisten = this.workspace.onStateChange((next, previous) => this.beforeLayoutRender(next, previous));
    inject(DestroyRef).onDestroy(() => {
      unlisten();
      this.dispose();
    });
  }

  /**
   * `preserveEmbeds`, the Angular part (rdd 7.11.0). Angular removes a destroyed view's DOM before
   * any destroy hook runs (ADR 0002): a slot (`[nddPanelSlot]`) in a leaf, a window or the grid
   * around them that a render destroys takes the panel's element out of the document with it, and
   * an iframe in it reloads. rdd parks in a layout cleanup and vdd in `onBeforeUnmount`, both of
   * which run before the node goes; Angular has no such hook. So the owner of every such
   * destruction, the workspace's state, is watched instead: a write that can re-create slots (the
   * grid's structure, the floating windows, the taskbar) queues a
   * park of every preserving panel, which runs in a microtask, after the action's synchronous
   * writes (so a widget's `onWillMove` still sees its element in place) and before any change
   * detection (zone.js runs it once the microtask queue is empty, the zoneless scheduler on a
   * timer or a frame). Parked, connected, in the store, with `moveBefore()`; after the render each
   * goes back to the newest slot alive for it, again with `moveBefore()`, before the browser
   * paints. A panel whose slot survived goes back where it was; one with a new slot moves there;
   * a minimised one stays parked. Only a synchronous `ApplicationRef.tick()` in the same task as
   * the action would render before the park.
   */
  private beforeLayoutRender(next: Readonly<WorkspaceState>, previous: Readonly<WorkspaceState>): void {
    if (this.parkQueued) return;
    if (this.dom.preservingIds().length === 0 || !mayRecreateSlots(next, previous)) return;
    this.parkQueued = true;
    queueMicrotask(() => {
      this.parkQueued = false;
      this.parkPreserving();
    });
  }

  private parkPreserving(): void {
    for (const id of this.dom.preservingIds()) {
      // One already parked (minimised, or taken out of a preview) is put in its slot all the same.
      if (!this.dom.isParked(id)) this.dom.moveTo(id, null, { preserveScroll: this.preservesScroll(id) });
      this.parked.add(id);
    }
    if (this.parked.size === 0) return;
    afterNextRender({ write: () => this.reclaim() }, { injector: this.injector });
    // A fallback, should no render follow: two frames, by when any render has happened.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => this.reclaim()));
  }

  /** Puts each parked preserving panel back in the newest slot alive for it. */
  private reclaim(): void {
    if (this.parked.size === 0) return;
    const active = untracked(this.workspace.activePanelId);
    for (const id of [...this.parked]) {
      this.parked.delete(id);
      // Gone, or a slot has taken it already.
      if (!this.dom.has(id) || !this.dom.isParked(id)) continue;
      const slot = this.dom.liveSlot(id);
      if (slot) this.dom.moveTo(id, slot, { refocus: active === id, preserveScroll: this.preservesScroll(id) });
    }
  }

  private preservesScroll(id: string): boolean {
    return optionsFor(this.workspace.registry, untracked(this.workspace.state).panels[id])?.preserveScroll !== false;
  }

  /** The component instance for a panel, once created. For tests and diagnostics. */
  instance(id: string): unknown {
    return this.hosted.get(id)?.ref?.instance ?? null;
  }

  private reconcile(panels: ReturnType<Workspace['panels']>): void {
    for (const [id, hosted] of this.hosted) {
      if (!panels[id] || panels[id]!.component !== hosted.component) this.destroy(id);
    }
    for (const [id, info] of Object.entries(panels)) {
      const hosted = this.hosted.get(id);
      if (!hosted) this.create(id, info.component);
      else if (hosted.ref) this.applyInputs(id, hosted, hosted.ref);
    }
  }

  private create(id: string, component: string): void {
    const hosted: HostedPanel = {
      ref: null,
      component,
      inputs: new Set(),
      size: signal(null),
      observer: null,
      applied: undefined,
      disposed: false,
      type: null,
      window: this.windowOf(id),
      wrapper: null,
    };
    this.hosted.set(id, hosted);
    this.dom.elementFor(id); // exists from open, so a slot can take it before content loads
    // The app's popoutWrapper (1.12.0), around the content for the panel's whole life while the
    // workspace has pop-outs, so nothing is re-created when the panel moves to a window and back.
    const wrapper = this.popOut ? untracked(() => this.popOut!.wrapper()) : null;
    if (wrapper) this.wrap(id, hosted, wrapper);
    // Marked from the start, so its first move into a slot already keeps its embeds (7.11).
    if (optionsFor(this.workspace.registry, untracked(this.workspace.panels)[id])?.preserveEmbeds === true) this.dom.preserveEmbeds(id);
    this.observeSize(id, hosted);

    // A hosted panel (7.11) shows a managed widget's content element, which its overlay created
    // and owns: no registration to look up, nothing "unregistered" to report.
    if (this.workspace.panels()[id]?.owner) {
      hosted.type = NddHostedWidget;
      this.mount(id, hosted, NddHostedWidget, { dom: this.dom });
      return;
    }
    const entry = this.workspace.registry.get(component);
    if (!entry) {
      this.mount(id, hosted, NddUnregisteredPanel, { panelKey: component });
      return;
    }
    if (entry.component) {
      hosted.type = entry.component;
      if (this.shouldBeMounted(id)) this.mount(id, hosted, entry.component);
      return;
    }
    // Lazy: a placeholder now, the real component when its chunk arrives.
    this.mount(id, hosted, NddPanelLoading);
    this.workspace.registry.resolve(component).then(
      type => {
        if (hosted.disposed || this.hosted.get(id) !== hosted) return;
        hosted.type = type;
        this.unmount(hosted);
        this.dom.resetContent(id);
        if (this.shouldBeMounted(id)) this.mount(id, hosted, type);
      },
      error => console.error(`[angular-dockable-desktop] Could not load panel "${component}":`, error),
    );
  }

  private mount(id: string, hosted: HostedPanel, type: Type<unknown>, extra?: Record<string, unknown>): void {
    const containerType: Signal<ContainerType> = computed(() => {
      const panel = this.workspace.panels()[id];
      if (!panel) return 'dockable-panel';
      // A minimised panel reports what it *was*: minimising does not change its container.
      const effective = panel.state === 'minimized' ? (panel.previousState ?? 'docked') : panel.state;
      return effective === 'floating' ? 'floating-window' : 'dockable-panel';
    });
    const context: PanelContext = { id, containerType, size: hosted.size.asReadonly(), window: hosted.window };
    // Inside the wrapper's injector when there is one: what it provides reaches the panel (1.12.0).
    const parent = hosted.wrapper?.mounted.injector ?? this.injector;
    const elementInjector = Injector.create({ providers: [{ provide: PANEL_CONTEXT, useValue: context }], parent });

    const content = this.dom.contentFor(id);
    const ref = createComponent(type, {
      environmentInjector: this.environmentInjector,
      elementInjector,
      hostElement: content,
    });
    // After the component exists: Angular writes its static `host: { class }` as the class
    // attribute, replacing what the element had (1.11.1). The library's class and the kind's
    // (1.7.0) are added back beside the component's, on every mount, since a reset element starts bare.
    const kindClass = optionsFor(this.workspace.registry, this.workspace.panels()[id])?.className;
    content.classList.add('ndd-panel-content', ...(kindClass ?? '').split(/\s+/).filter(Boolean));
    hosted.inputs = new Set((reflectComponentType(type)?.inputs ?? []).map(i => i.templateName));
    hosted.applied = undefined;
    for (const [k, v] of Object.entries(extra ?? {})) if (hosted.inputs.has(k) && k !== 'panelId') ref.setInput(k, v);
    this.applyInputs(id, hosted, ref);
    // The injected id goes last and is never taken from the caller, so a panel can trust it.
    if (hosted.inputs.has('panelId')) ref.setInput('panelId', id);
    this.appRef.attachView(ref.hostView);
    hosted.ref = ref;
    this.created.update(n => n + 1);
  }

  /** Whether a panel's component should exist now: always, unless its kind has `keepAlive: false`. */
  private shouldBeMounted(id: string): boolean {
    const panel = this.workspace.panels()[id];
    if (!panel) return false;
    if (optionsFor(this.workspace.registry, panel)?.keepAlive !== false) return true;
    if (panel.state === 'floating') return true;
    if (panel.state !== 'docked') return false;
    const root = this.workspace.gridRoot();
    const leafId = findLeafForPanel(root, id);
    return leafId !== null && findLeaf(root, leafId)?.activePanelId === id;
  }

  /** Destroy hidden `keepAlive: false` components, and create the ones shown again. */
  private applyVisibility(): void {
    for (const [id, hosted] of this.hosted) {
      if (!hosted.type || hosted.disposed) continue;
      const wanted = this.shouldBeMounted(id);
      if (!wanted && hosted.ref) {
        this.unmount(hosted);
        this.dom.resetContent(id);
      } else if (wanted && !hosted.ref) {
        this.mount(id, hosted, hosted.type);
      }
    }
  }

  private applyInputs(id: string, hosted: HostedPanel, ref: ComponentRef<unknown>): void {
    const props = this.workspace.panels()[id]?.props;
    if (props === hosted.applied) return;
    for (const [k, v] of Object.entries(props ?? {})) {
      if (k !== 'panelId' && hosted.inputs.has(k) && hosted.applied?.[k] !== v) ref.setInput(k, v);
    }
    hosted.applied = props;
  }

  /**
   * The window panel `id` is in (1.12.0, rdd's `usePanelWindowOf`): its pop-out's once that
   * window's page is ready, the main one otherwise. From the same store the pop-out's frame renders
   * from (the registry's entries), so the render that shows the panel's slot in the pop-out already
   * gives the pop-out's document.
   */
  private windowOf(id: string): Signal<PanelWindow> {
    return computed(() => {
      const popOut = this.popOut;
      const doc = popOut?.enabled ? (popOut.entries().find(e => e.id === id)?.doc ?? null) : null;
      return doc?.defaultView ? { window: doc.defaultView, document: doc } : mainWindow();
    });
  }

  /**
   * Creates the app's `popoutWrapper` around a panel's content element (1.12.0), in its mount
   * element, and keeps its `window` and `document` inputs on the panel's window. Set before any
   * render that shows the panel elsewhere: the effect runs with the desktop's view, which is
   * checked before the wrapper's, so the wrapper renders with the new document in the same render.
   */
  private wrap(id: string, hosted: HostedPanel, type: Type<unknown>): void {
    const content = this.dom.contentFor(id);
    const at = untracked(hosted.window);
    const mounted = mountPopoutWrapper(type, {
      content: [content],
      win: at.window,
      doc: at.document,
      parent: this.injector,
      environment: this.environmentInjector,
      appRef: this.appRef,
    });
    this.dom.elementFor(id).appendChild(mounted.host);
    this.dom.setContentParent(id, content.parentElement ?? mounted.host);
    const follow = effect(
      () => {
        const now = hosted.window();
        untracked(() => mounted.setWindow(now.window, now.document));
      },
      { injector: this.injector },
    );
    hosted.wrapper = { mounted, follow };
  }

  /**
   * Rebuilds a panel's size observer from the window its element is in now (1.12.0): it moved into
   * a pop-out window or back, and an observer only works from the element's own window.
   */
  reobserve(id: string): void {
    const hosted = this.hosted.get(id);
    if (!hosted || hosted.disposed) return;
    hosted.observer?.disconnect();
    this.observeSize(id, hosted);
  }

  private observeSize(id: string, hosted: HostedPanel): void {
    // From the element's own window (1.12.0).
    const el = this.dom.elementFor(id);
    hosted.observer = resizeObserverFor(el, entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) {
          const current = hosted.size();
          if (!current || current.width !== width || current.height !== height) hosted.size.set({ width, height });
          this.dom.reportSize(id, { width, height });
        }
      }
    });
    hosted.observer?.observe(el);
  }

  private unmount(hosted: HostedPanel): void {
    if (!hosted.ref) return;
    this.appRef.detachView(hosted.ref.hostView);
    hosted.ref.destroy();
    hosted.ref = null;
  }

  private destroy(id: string): void {
    const hosted = this.hosted.get(id);
    if (!hosted) return;
    hosted.disposed = true;
    hosted.observer?.disconnect();
    this.unmount(hosted);
    if (hosted.wrapper) {
      hosted.wrapper.follow.destroy();
      hosted.wrapper.mounted.destroy();
      hosted.wrapper = null;
    }
    this.hosted.delete(id);
    this.dom.release(id);
  }

  private dispose(): void {
    for (const id of [...this.hosted.keys()]) this.destroy(id);
    this.dom.dispose();
  }
}

/**
 * The parts of the state a slot's existence depends on, without what only restyles one (split
 * sizes, a window's position): the grid's shape, each group's panels and selection.
 */
function shapeOf(node: LayoutNode): string {
  if (node.type === 'leaf') return `L${node.id}:${node.activePanelId ?? ''}:${node.panels.join(',')}`;
  return `B${node.orientation}(${node.children.map(shapeOf).join('|')})`;
}

/**
 * Whether a state write can destroy a slot: the grid changed shape (a group's panels or selection
 * included), or a window or a taskbar entry (its preview) came, went or moved in its list. Every
 * change of where a panel is changes one of these. A split resize or a window drag can't destroy
 * a slot, and parks nothing.
 */
function mayRecreateSlots(next: Readonly<WorkspaceState>, previous: Readonly<WorkspaceState>): boolean {
  const ids = (list: readonly { id: string }[]) => list.map(x => x.id).join('|');
  if (next.gridRoot !== previous.gridRoot && shapeOf(next.gridRoot) !== shapeOf(previous.gridRoot)) return true;
  if (next.floating !== previous.floating && ids(next.floating) !== ids(previous.floating)) return true;
  return next.minimized !== previous.minimized && ids(next.minimized) !== ids(previous.minimized);
}
