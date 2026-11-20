/**
 * `<ndd-panel-overlay>` and `<ndd-panel-toolbar>`: toolbars on a panel's edges and floating
 * widgets over its content, plus `injectFloatingWidgets()`.
 *
 * Wrap a panel's content in `<ndd-panel-overlay>` to enable toolbars, widgets and
 * `injectFloatingWidgets()`. It is scoped to the panel: each has its own toolbars, its own
 * widget stacks and its own z-order — nothing here is global. Ported from vdd
 * `VddPanelOverlay.vue`, `VddPanelToolbar.vue` and `usePanelOverlay.ts`.
 */
import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, effect, inject, input, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import { ANCHORS } from '../core/panel-overlay';
import type { ButtonVariant, ToolbarPosition, ToolbarVariant } from '../core/panel-overlay';
import { NddFloatingWidget } from './floating-widget';
import { PANEL_OVERLAY, createPanelOverlayStore } from './overlay-store';
import { Workspace } from '../workspace/workspace';
import { openMenu } from '../desktop/menus';
import type { ManagedWidget, MoveResult, PanelOverlayStore, WidgetLocation, WidgetPlacement, WidgetTarget } from './overlay-store';

@Component({
  selector: 'ndd-panel-overlay',
  imports: [NddFloatingWidget],
  providers: [{ provide: PANEL_OVERLAY, useFactory: createPanelOverlayStore }],
  host: {
    class: 'ndd-panel-overlay-root',
    '[class.ndd-dragging-active]': 'dragging()',
    'data-ndd-panel-overlay': '',
  },
  template: `
    <ng-content />
    @if (dragging()) {
      @for (zone of anchors; track zone) {
        <div
          class="ndd-panel-float-dropzone"
          [class]="'ndd-panel-float-dropzone--' + zone"
          [class.ndd-panel-float-dropzone--hovered]="store.hovered() === zone"
          [attr.data-ndd-dropzone]="zone"
          aria-hidden="true"
        ></div>
      }
    }
    <!--
      A managed widget's frame. Its content is not a child here: the store created the widget's
      component once, on the widget's own element (\`div.ndd-panel-float__content\`), and the frame's
      body only shows that element (7.11). Its placement is the store's record, which the frame
      reads and writes itself, so the frame can be destroyed and created again (\`framesHidden\`)
      with the content's state and DOM untouched, and come back where it was. vdd 1.0.0 bound a
      fresh placement literal here, which reset the widget on every render (PARITY R1).
    -->
    @for (item of frames(); track item.id) {
      <ndd-floating-widget
        [widgetId]="item.id"
        [title]="item.widget.title"
        [icon]="item.widget.icon"
        [open]="true"
        [width]="item.widget.width ?? 320"
        [height]="item.widget.height ?? 240"
        [contentEl]="item.el"
        [hasTitleMenu]="!!item.widget.titleMenu"
        (titleMenuOpen)="openTitleMenu(item.id, $event)"
        (openChange)="!$event && store.closeManaged(item.id)"
      />
    }
  `,
})
export class NddPanelOverlay {
  protected readonly store = inject(PANEL_OVERLAY);
  protected readonly anchors = ANCHORS;
  /** Drop zones are only shown while something is being dragged. */
  protected readonly dragging = computed(() => this.store.draggingId() !== null);
  private readonly root = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /**
   * The frames of the widgets opened through `injectFloatingWidgets()`, rather than placed in a
   * template: every open one but those in `framesHidden`.
   */
  protected readonly frames = computed(() => {
    const hidden = this.store.framesHidden();
    const elements = this.store.content.elements();
    return [...this.store.managed()]
      .filter(([id]) => !hidden.has(id))
      // Present for every open id: `openManaged` creates it first.
      .map(([id, widget]) => ({ id, widget, el: elements.get(id)! }));
  });

  private readonly workspace = inject(Workspace, { optional: true }) as Workspace<never> | null;

  /**
   * A managed widget's `titleMenu`, from its title icon in the panel (7.11). A click from the
   * keyboard opens on the first item, as every menu button does.
   */
  protected openTitleMenu(id: string, event: MouseEvent): void {
    if (this.workspace) openMenu(this.workspace, event, this.store.hosting.menuItems(id));
  }

  constructor() {
    this.store.container.set(this.root);
    /**
     * A frame about to go away while its widget stays open gives its content element back to the
     * hidden store **first**. Angular removes a destroyed view's DOM before any destroy hook runs
     * (ADR 0002), so a frame that let go in its own `ngOnDestroy` would take the element out of
     * the document with it, and an embedded map or video would lose its state. This is a view
     * effect, created here, so it runs before this component's template is checked: before the
     * `@for` above removes the frame. Only an element still inside this overlay is taken, so one
     * another slot has already claimed (a hosted panel's, later) stays where it is.
     */
    effect(() => {
      const hidden = this.store.framesHidden();
      untracked(() => {
        for (const id of hidden) {
          const el = this.store.content.get(id);
          if (el?.parentElement && this.root.contains(el)) this.store.content.leave(el, el.parentElement);
        }
      });
    });
    /**
     * Restored free positions wait for the panel to have a size (7.11): a panel in a background
     * tab, or not laid out yet, measures 0×0. Observed only while one is waiting.
     */
    effect(onCleanup => {
      if (this.store.pendingCount() === 0) return;
      untracked(() => this.store.applyPending());
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => this.store.applyPending());
      ro.observe(this.root);
      onCleanup(() => ro.disconnect());
    });
    // The owner closed (or this overlay is otherwise going): its widgets' hosted panels go first,
    // then each widget's component. Angular has already removed the overlay's own DOM.
    inject(DestroyRef).onDestroy(() => {
      this.store.hosting.dispose();
      this.store.content.dispose();
    });
  }
}

/**
 * A toolbar strip on one edge of a panel's overlay. It claims space on that edge, and docked
 * widgets keep clear of it — both where they sit and how far they may be resized. Left and
 * right strips inset themselves past any top and bottom strips, so the corners are never
 * contested.
 */
@Component({
  selector: 'ndd-panel-toolbar',
  host: {
    class: 'ndd-panel-toolbar',
    '[class.ndd-panel-toolbar--top]': "position() === 'top'",
    '[class.ndd-panel-toolbar--bottom]': "position() === 'bottom'",
    '[class.ndd-panel-toolbar--left]': "position() === 'left'",
    '[class.ndd-panel-toolbar--right]': "position() === 'right'",
    '[attr.data-variant]': 'variant()',
    '[attr.data-btn-variant]': 'buttonVariant()',
    '[attr.data-ndd-panel-toolbar]': 'position()',
    '[style]': 'placement()',
    role: 'toolbar',
    '[attr.aria-orientation]': "isBlockEdge() ? 'horizontal' : 'vertical'",
  },
  template: `<ng-content />`,
})
export class NddPanelToolbar {
  readonly position = input.required<ToolbarPosition>();
  readonly variant = input<ToolbarVariant>('transparent');
  /** Inherited by this toolbar's buttons unless they override it. */
  readonly buttonVariant = input<ButtonVariant>('ghost');
  /** Button size in pixels (sets `--ndd-panel-toolbar-btn-size`). The icon inside follows `--ndd-panel-toolbar-icon-size`. Left to the stylesheet when unset. */
  readonly buttonSize = input<number | undefined>(undefined);

  private readonly store = injectPanelOverlay();
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly isBlockEdge = computed(() => this.position() === 'top' || this.position() === 'bottom');

  /**
   * Only position is inline, because only position depends on the other toolbars' measured
   * sizes. Padding, gap, backdrop and thickness are in the stylesheet (D12).
   */
  protected readonly placement = computed(() => {
    const insets = this.store.insets();
    const size = this.buttonSize();
    const sizeVar: Record<string, string> = size != null ? { '--ndd-panel-toolbar-btn-size': `${size}px` } : {};
    switch (this.position()) {
      case 'top':
        return { top: '0px', left: '0px', right: '0px', ...sizeVar };
      case 'bottom':
        return { bottom: '0px', left: '0px', right: '0px', ...sizeVar };
      case 'left':
        return { 'inset-inline-start': '0px', top: `${insets.top}px`, bottom: `${insets.bottom}px`, ...sizeVar };
      default:
        return { 'inset-inline-end': '0px', top: `${insets.top}px`, bottom: `${insets.bottom}px`, ...sizeVar };
    }
  });

  constructor() {
    /**
     * Re-measured, not measured once. During a layout restore the panel's DOM is not settled when
     * the toolbar first renders, so rdd baked in a wrong size — usually 0 — and every docked
     * widget sat at the toolbar's own edge, covering it. This also follows later changes:
     * buttons wrapping, a `buttonSize` change, content appearing.
     */
    afterRenderEffect(onCleanup => {
      const position = this.position();
      const block = this.isBlockEdge();
      const measure = () => this.store.registerToolbar(position, block ? this.el.offsetHeight : this.el.offsetWidth);
      measure();
      let observer: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(this.el);
      }
      onCleanup(() => {
        observer?.disconnect();
        this.store.unregisterToolbar(position);
      });
    });
    inject(DestroyRef).onDestroy(() => this.store.unregisterToolbar(this.position()));
  }
}

/**
 * The overlay a widget or toolbar is inside.
 * @throws outside an `<ndd-panel-overlay>`.
 * @internal — applications use {@link injectFloatingWidgets}.
 */
export function injectPanelOverlay(): PanelOverlayStore {
  const store = inject(PANEL_OVERLAY, { optional: true });
  if (!store) {
    throw new Error(
      '[angular-dockable-desktop] This must be used inside an <ndd-panel-overlay>. ' +
        'Wrap your panel content in one to enable toolbars and floating widgets.',
    );
  }
  return store;
}

/** What {@link injectFloatingWidgets} returns. */
export interface FloatingWidgetsApi {
  /** Ids of the open managed widgets, in the order they were opened. */
  readonly openIds: Signal<string[]>;
  open(id: string, widget: ManagedWidget): void;
  close(id: string): void;
  closeAll(): void;
  /** Reactive. */
  isOpen(id: string): boolean;
  /**
   * Moves a widget out of its panel or back (7.11), without re-creating its content: docked
   * beside its owner panel, a tab in the owner's group, a floating window, or back into the panel
   * where it last was. Out of the panel it is a workspace panel of its own, which the user can
   * move, minimise and close like any other; closing it closes the widget. It never goes into a
   * saved layout. Returns a result rather than throwing; a refusal changes nothing.
   *
   * ```ts
   * widgets.move('table', { to: 'docked', position: 'bottom', size: 0.35 });
   * widgets.move('table', { to: 'panel' });
   * ```
   */
  move(id: string, to: WidgetTarget): MoveResult;
  /** Where a widget is shown (7.11), or `null` if it isn't open. Reactive. */
  location(id: string): WidgetLocation | null;
  /**
   * Where a widget is now, as plain JSON to save with your own state (7.11), or `null` if it isn't
   * open: where it is in the panel (corner, stretch, free position, size), and, out of the panel,
   * whether it is docked, tabbed or floating there. Give it back as `open(id, { …, placement })`.
   * Not reactive: read it when you save.
   */
  placement(id: string): WidgetPlacement | null;
}

/**
 * Open and close floating widgets by id, without declaring each one in a template — for widgets
 * whose existence is data: one per selected feature, one per running job.
 *
 * ```ts
 * const widgets = injectFloatingWidgets();
 * widgets.open('feature-42', { title: 'Feature 42', component: FeatureInfo, inputs: { id: 42 }, anchor: 'top-right' });
 * ```
 *
 * An `<ndd-floating-widget>` in the template is the simpler option and behaves the same otherwise.
 */
export function injectFloatingWidgets(): FloatingWidgetsApi {
  const store = injectPanelOverlay();
  return {
    openIds: computed(() => store.managedIds()),
    open: (id, widget) => store.openManaged(id, widget),
    close: id => store.closeManaged(id),
    closeAll: () => store.closeAllManaged(),
    isOpen: id => store.managed().has(id),
    move: (id, to) => store.hosting.move(id, to),
    location: id => store.hosting.location(id),
    placement: id => store.placementOf(id),
  };
}
