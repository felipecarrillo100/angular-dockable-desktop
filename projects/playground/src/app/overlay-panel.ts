import { Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import {
  NddFloatingWidget,
  NddPanelOverlay,
  NddPanelToolbar,
  NddToolbarButton,
  NddToolbarCenter,
  NddToolbarItem,
  NddToolbarSearch,
  NddToolbarSeparator,
  NddToolbarSpacer,
  NddToolbarToggle,
  injectFloatingWidgets,
  injectWidget,
} from 'angular-dockable-desktop';
import type { ManagedWidget, PanelFloatPlacement, SearchResult, WidgetPlacement } from 'angular-dockable-desktop';
import { EmbedFrame } from './embed-frame';

type Which = 'card' | 'strip' | 'free';

/**
 * A managed widget's content for the gate (7.11, M2): a counter, a text field, and a canvas that
 * stops its own pointerdown, as a map does, all inside `#wo-fill`, laid out with `height: 100%`.
 * Kept under 200px wide, so the widget fits beside the card in the overlay panel. M3 adds a
 * scrolled box (`#wo-scroll`) and a live WebGL context (`#wo-gl`), which the gate follows out of
 * the panel and back: the context is recorded on the canvas, with a count of context losses.
 * M5: it records each `onWillMove` / `onMoved` with its content element's size at that moment, in
 * `window.__woMoves`.
 */
@Component({
  selector: 'pg-widget-fill',
  template: `
    <div id="wo-fill" style="height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; padding: 4px">
      <button type="button" id="wo-count" (click)="n.set(n() + 1)">{{ n() }}</button>
      <input id="wo-text" aria-label="text" />
      <canvas id="wo-canvas" width="80" height="30" style="align-self: flex-start; width: 80px; height: 30px" (pointerdown)="$event.stopPropagation()"></canvas>
      <div id="wo-scroll" style="flex: 0 0 auto; height: 24px; overflow: auto"><div style="height: 200px">scrolled</div></div>
      <canvas id="wo-gl" width="40" height="12" style="flex: 0 0 auto; width: 40px; height: 12px"></canvas>
    </div>
  `,
})
class WidgetFill {
  protected readonly n = signal(0);
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const widget = injectWidget();
    const moves: { kind: string; w: number; h: number; location: string | null }[] = [];
    (window as unknown as Record<string, unknown>)['__woMoves'] = moves;
    // The host is the widget's content element itself, `.ndd-panel-float__content`.
    const note = (kind: string) => moves.push({ kind, w: host.offsetWidth, h: host.offsetHeight, location: widget?.location() ?? null });
    widget?.onWillMove(() => note('will'));
    widget?.onMoved(() => note('moved'));
    afterNextRender(() => {
      const canvas = host.querySelector<HTMLCanvasElement>('#wo-gl');
      const gl = canvas?.getContext('webgl');
      if (!canvas || !gl) return;
      gl.clearColor(0.2, 0.6, 0.9, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const record = canvas as unknown as Record<string, unknown>;
      record['__gl'] = gl;
      record['__glLost'] = 0;
      canvas.addEventListener('webglcontextlost', () => (record['__glLost'] = (record['__glLost'] as number) + 1));
    });
  }
}

const fill: ManagedWidget = { title: 'Out', component: WidgetFill, anchor: 'top-right', width: 190, height: 170 };
/** M4: the same widget with a titleMenu, as an app gives one: moves out, and back. */
const menu: Partial<ManagedWidget> = {
  canDock: true,
  canFloat: true,
  titleMenu: w =>
    w.location === 'panel'
      ? [
          { label: 'Dock below', action: () => w.move({ to: 'docked', position: 'bottom', size: 0.5 }) },
          { label: 'Open as a tab', action: () => w.move({ to: 'tabbed' }) },
        ]
      : [{ label: 'Back into the panel', action: () => w.move({ to: 'panel' }) }],
};

/** Exposes `injectFloatingWidgets()` of the overlay it sits in, as `window.__overlayWidgets`. */
@Component({ selector: 'pg-overlay-widgets', template: '' })
class OverlayWidgets {
  constructor() {
    const widgets = injectFloatingWidgets();
    (window as unknown as Record<string, unknown>)['__overlayWidgets'] = {
      openFill: (withMenu = false) => widgets.open('wo', withMenu ? { ...fill, ...menu } : fill),
      // M6: open it at a saved placement; M7: a widget whose iframe is kept across moves.
      openFillAt: (placement: WidgetPlacement) => widgets.open('wo', { ...fill, placement }),
      openEmbed: () =>
        widgets.open('emb', { title: 'Embed', component: EmbedFrame, inputs: { name: 'widget' }, preserveEmbeds: true, width: 190, height: 120 }),
      placement: (id: string) => widgets.placement(id),
      close: (id: string) => widgets.close(id),
      openIds: () => widgets.openIds(),
      move: (id: string, to: Parameters<typeof widgets.move>[1]) => widgets.move(id, to),
      location: (id: string) => widgets.location(id),
    };
  }
}
type Edge = 'top' | 'bottom' | 'left' | 'right';

/**
 * A panel whose content is a full overlay: toolbars on all four edges, a corner widget, a
 * full-width strip, and a widget the gate can reposition. Exists for the browser gate, which
 * needs real layout to measure what jsdom cannot — chiefly whether every resize handle is
 * actually hittable across its whole nominal area (D5). Ported from vdd's `OverlayPanel.vue`.
 */
@Component({
  selector: 'pg-overlay-panel',
  imports: [
    NddPanelOverlay,
    NddPanelToolbar,
    NddFloatingWidget,
    NddToolbarButton,
    NddToolbarToggle,
    NddToolbarSeparator,
    NddToolbarSpacer,
    NddToolbarItem,
    NddToolbarCenter,
    NddToolbarSearch,
    OverlayWidgets,
  ],
  template: `
    <ndd-panel-overlay>
      @if (toolbars.top()) {
        <ndd-panel-toolbar position="top" variant="frosted">
          <ndd-toolbar-button title="Save"><span>S</span></ndd-toolbar-button>
          <ndd-toolbar-separator />
          <ndd-toolbar-toggle title="Grid" [(active)]="grid"><span>#</span></ndd-toolbar-toggle>
          <ndd-toolbar-item><span class="pg-chip">12 layers</span></ndd-toolbar-item>
          <ndd-toolbar-center><span class="pg-chip">centre</span></ndd-toolbar-center>
          <ndd-toolbar-spacer />
          <ndd-toolbar-search [search]="search" />
          <ndd-toolbar-button title="Help"><span>?</span></ndd-toolbar-button>
        </ndd-panel-toolbar>
      }
      @if (toolbars.bottom()) {
        <ndd-panel-toolbar position="bottom"><ndd-toolbar-button title="Zoom"><span>Z</span></ndd-toolbar-button></ndd-panel-toolbar>
      }
      @if (toolbars.left()) {
        <ndd-panel-toolbar position="left"><ndd-toolbar-button title="Pan"><span>P</span></ndd-toolbar-button></ndd-panel-toolbar>
      }
      @if (toolbars.right()) {
        <ndd-panel-toolbar position="right"><ndd-toolbar-button title="Layers"><span>L</span></ndd-toolbar-button></ndd-panel-toolbar>
      }

      <div class="pg-overlay-body" data-overlay-body>panel content</div>
      <pg-overlay-widgets />

      <ndd-floating-widget widgetId="card" title="Card" icon="pg-icon" [width]="260" [height]="180" [(placement)]="state.card">
        <div data-widget-body="card">card</div>
      </ndd-floating-widget>
      <ndd-floating-widget widgetId="strip" title="Strip" [width]="240" [height]="70" [(placement)]="state.strip">
        <div data-widget-body="strip">strip</div>
      </ndd-floating-widget>
      <ndd-floating-widget widgetId="free" title="Free" [width]="220" [height]="150" [(placement)]="state.free">
        <div data-widget-body="free">free</div>
      </ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
export class OverlayPanel {
  protected readonly state: Record<Which, WritableSignal<PanelFloatPlacement>> = {
    card: signal({ anchor: 'top-left', stretch: null }),
    strip: signal({ anchor: 'bottom-left', stretch: 'width' }),
    free: signal({ anchor: 'bottom-right', stretch: null }),
  };
  protected readonly toolbars: Record<Edge, WritableSignal<boolean>> = {
    top: signal(true),
    bottom: signal(true),
    left: signal(true),
    right: signal(true),
  };
  protected readonly grid = signal(false);

  /** Every dropdown row class needs a result carrying a group, a description and an icon. */
  protected readonly search = (query: string): SearchResult[] =>
    query ? [{ id: 'r1', label: `Result ${query}`, description: 'a matching feature', group: 'Layers', icon: 'pg-icon' }] : [];

  constructor() {
    // The gate drives placement through this handle rather than by clicking, so what it measures
    // is the rendered result of a placement rather than the gesture that produced it.
    (window as unknown as Record<string, unknown>)['__overlay'] = {
      place: (which: Which, placement: PanelFloatPlacement) => this.state[which].set(placement),
      placement: (which: Which) => this.state[which](),
      setToolbars: (patch: Partial<Record<Edge, boolean>>) => {
        for (const [edge, on] of Object.entries(patch)) this.toolbars[edge as Edge].set(!!on);
      },
      grid: this.grid,
    };
  }
}
