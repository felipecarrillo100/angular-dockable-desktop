/**
 * The panel host: creates each open panel's component **once**, for as long as it is open, and
 * destroys it only when it closes. The one place a panel is ever created or destroyed (ADR 0002).
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
  computed,
  createComponent,
  effect,
  inject,
  reflectComponentType,
  signal,
  untracked,
} from '@angular/core';
import type { ComponentRef, Signal, Type, WritableSignal } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import type { ContainerType } from '../core/types';
import { PanelDomCache } from './panel-dom';
import { PANEL_CONTEXT } from './panel-ref';
import type { PanelContext } from './panel-ref';
import { NddUnregisteredPanel, NddPanelLoading } from './panel-placeholders';

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

  constructor(doc: Document) {
    this.dom = new PanelDomCache(doc);
    // Reconcile the set of hosted panels with the open panels, and their props with inputs.
    effect(() => {
      const panels = this.workspace.panels();
      untracked(() => this.reconcile(panels));
    });
    // Panel content follows the workspace's reading direction (the mount lives outside it).
    effect(() => {
      const dir = this.workspace.dir();
      this.created(); // re-apply to newly created content
      for (const content of this.dom.allContents()) content.dir = dir;
    });
    inject(DestroyRef).onDestroy(() => this.dispose());
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
    };
    this.hosted.set(id, hosted);
    this.dom.elementFor(id); // exists from open, so a slot can take it before content loads
    this.observeSize(id, hosted);

    const entry = this.workspace.registry.get(component);
    if (!entry) {
      this.mount(id, hosted, NddUnregisteredPanel, { panelKey: component });
      return;
    }
    if (entry.component) {
      this.mount(id, hosted, entry.component);
      return;
    }
    // Lazy: a placeholder now, the real component when its chunk arrives.
    this.mount(id, hosted, NddPanelLoading);
    this.workspace.registry.resolve(component).then(
      type => {
        if (hosted.disposed || this.hosted.get(id) !== hosted) return;
        this.unmount(hosted);
        this.dom.resetContent(id);
        this.mount(id, hosted, type);
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
    const context: PanelContext = { id, containerType, size: hosted.size.asReadonly() };
    const elementInjector = Injector.create({ providers: [{ provide: PANEL_CONTEXT, useValue: context }], parent: this.injector });

    const ref = createComponent(type, {
      environmentInjector: this.environmentInjector,
      elementInjector,
      hostElement: this.dom.contentFor(id),
    });
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

  private applyInputs(id: string, hosted: HostedPanel, ref: ComponentRef<unknown>): void {
    const props = this.workspace.panels()[id]?.props;
    if (props === hosted.applied) return;
    for (const [k, v] of Object.entries(props ?? {})) {
      if (k !== 'panelId' && hosted.inputs.has(k) && hosted.applied?.[k] !== v) ref.setInput(k, v);
    }
    hosted.applied = props;
  }

  private observeSize(id: string, hosted: HostedPanel): void {
    if (typeof ResizeObserver === 'undefined') return;
    hosted.observer = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) {
          const current = hosted.size();
          if (!current || current.width !== width || current.height !== height) hosted.size.set({ width, height });
          this.dom.reportSize(id, { width, height });
        }
      }
    });
    hosted.observer.observe(this.dom.elementFor(id));
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
    this.hosted.delete(id);
    this.dom.release(id);
  }

  private dispose(): void {
    for (const id of [...this.hosted.keys()]) this.destroy(id);
    this.dom.dispose();
  }
}
