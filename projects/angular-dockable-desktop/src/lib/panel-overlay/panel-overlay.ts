/**
 * `<ndd-panel-overlay>` and `<ndd-panel-toolbar>`: toolbars on a panel's edges and floating
 * widgets over its content, plus `injectFloatingWidgets()`.
 *
 * Wrap a panel's content in `<ndd-panel-overlay>` to enable toolbars, widgets and
 * `injectFloatingWidgets()`. It is scoped to the panel: each has its own toolbars, its own
 * widget stacks and its own z-order — nothing here is global. Ported from vdd
 * `VddPanelOverlay.vue`, `VddPanelToolbar.vue` and `usePanelOverlay.ts`.
 */
import { NgComponentOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, input } from '@angular/core';
import type { Signal } from '@angular/core';
import { ANCHORS } from '../core/panel-overlay';
import type { ButtonVariant, ToolbarPosition, ToolbarVariant } from '../core/panel-overlay';
import type { PanelFloatPlacement } from '../core/stretch';
import { NddFloatingWidget } from './floating-widget';
import { PANEL_OVERLAY, createPanelOverlayStore } from './overlay-store';
import type { ManagedWidget, PanelOverlayStore } from './overlay-store';

@Component({
  selector: 'ndd-panel-overlay',
  imports: [NddFloatingWidget, NgComponentOutlet],
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
      A managed widget's placement is bound to the store's own record and written straight back.
      An Angular model re-syncs from its input only when the bound value changes, and the record
      is replaced exactly when the widget reports a new placement — so an unrelated render (a drop
      zone lighting up, another widget opening) can never reset a gesture. vdd 1.0.0 shipped the
      opposite: a fresh object literal, which reset the widget on every render.
    -->
    @for (item of managed(); track item.id) {
      <ndd-floating-widget
        [widgetId]="item.id"
        [title]="item.widget.title"
        [icon]="item.widget.icon"
        [open]="true"
        [placement]="item.placement"
        [width]="item.widget.width ?? 320"
        [height]="item.widget.height ?? 240"
        (openChange)="!$event && store.closeManaged(item.id)"
        (placementChange)="store.setManagedPlacement(item.id, $event)"
      >
        <ng-container *ngComponentOutlet="item.widget.component; inputs: item.widget.inputs ?? {}" />
      </ndd-floating-widget>
    }
  `,
})
export class NddPanelOverlay {
  protected readonly store = inject(PANEL_OVERLAY);
  protected readonly anchors = ANCHORS;
  /** Drop zones are only shown while something is being dragged. */
  protected readonly dragging = computed(() => this.store.draggingId() !== null);
  /** Widgets opened through `injectFloatingWidgets()`, rather than placed in a template. */
  protected readonly managed = computed(() => {
    const placements = this.store.managedPlacements();
    return [...this.store.managed()].map(([id, widget]) => ({
      id,
      widget,
      // Present for every open id: `openManaged` seeds it first.
      placement: placements[id] as PanelFloatPlacement,
    }));
  });

  constructor() {
    this.store.container.set(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement);
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
  /** Icon button size in pixels. Left to the stylesheet when unset. */
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
  };
}
