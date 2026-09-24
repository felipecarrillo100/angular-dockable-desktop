import { Component, signal } from '@angular/core';
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
} from 'angular-dockable-desktop';
import type { PanelFloatPlacement, SearchResult } from 'angular-dockable-desktop';

type Which = 'card' | 'strip' | 'free';
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
