import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import * as L from 'leaflet';
import {
  NddFloatingWidget, NddPanelOverlay, NddPanelToolbar, NddToolbarButton,
  NddToolbarSeparator, NddToolbarSpacer, NddToolbarToggle,
  Workspace, injectPanel,
} from 'angular-dockable-desktop';
import type { PanelFloatPlacement } from 'angular-dockable-desktop';
import { CameraWidgets } from './camera-widgets';

const CAMERAS = [
  { id: 'cam-north', name: 'North Gate', colour: '#38bdf8', at: [51.515, -0.09] as [number, number] },
  { id: 'cam-east', name: 'East Yard', colour: '#22c55e', at: [51.505, -0.07] as [number, number] },
  { id: 'cam-south', name: 'South Dock', colour: '#f59e0b', at: [51.495, -0.1] as [number, number] },
  { id: 'cam-west', name: 'West Lane', colour: '#a855f7', at: [51.508, -0.115] as [number, number] },
];
const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;

/**
 * OpenStreetMap's standard tiles, which need no API key. The dark variant is a CSS filter on
 * the tile pane rather than a second provider — see `styles.css`.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * The main map: a panel with its own overlay — toolbars on its edges and floating widgets
 * over its content, all scoped to this panel rather than to the workspace.
 *
 * This is the panel overlay system in full. A widget docked to a corner tracks that corner as
 * the panel resizes; the status strip spans the panel's width instead of carrying one, so CSS
 * keeps it in step with no JavaScript. Click a camera marker and a widget opens for it, from
 * data, through `injectFloatingWidgets()`.
 *
 * It is registered with `canClose: false` and `disableLivePreview: true`: the workspace's
 * primary view should not be closable, and a tiled map is not worth scaling into a 160px
 * thumbnail.
 */
@Component({
  selector: 'dd-main-map-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NddPanelOverlay, NddPanelToolbar, NddToolbarButton, NddToolbarSeparator, NddToolbarSpacer, NddToolbarToggle, NddFloatingWidget, CameraWidgets],
  template: `
    <ndd-panel-overlay>
      <!-- A toolbar on the panel's own edge. Docked widgets keep clear of it, and cannot be
           resized over it. -->
      <ndd-panel-toolbar position="top" variant="frosted" buttonVariant="ghost">
        <ndd-toolbar-button title="Zoom in" (click)="zoom(1)"><span aria-hidden="true">＋</span></ndd-toolbar-button>
        <ndd-toolbar-button title="Zoom out" (click)="zoom(-1)"><span aria-hidden="true">－</span></ndd-toolbar-button>
        <ndd-toolbar-separator />
        <ndd-toolbar-button title="Recentre" (click)="recentre()"><span aria-hidden="true">◎</span></ndd-toolbar-button>
        <ndd-toolbar-toggle title="Graticule" [(active)]="grid"><span aria-hidden="true">#</span></ndd-toolbar-toggle>
        <ndd-toolbar-spacer />
        <span style="font: 0.68rem ui-monospace, monospace; opacity: 0.7; padding-inline-end: 0.4rem">{{ readout() }}</span>
      </ndd-panel-toolbar>

      <div #host class="dd-leaflet" data-demo-mainmap></div>

      <!-- A corner-docked widget. Drag its header to tear it off, drop it on another corner. -->
      <ndd-floating-widget widgetId="legend" title="Legend" [(placement)]="legend" [width]="200" [height]="150">
        <div class="dd-panel" style="padding: 0.5rem 0.6rem">
          @for (camera of cameras; track camera.id) {
            <div class="dd-row" style="font-size: 0.72rem"><span class="dd-swatch" [style.background]="camera.colour"></span>{{ camera.name }}</div>
          }
          <p class="dd-note">Click a marker to open its feed.</p>
        </div>
      </ndd-floating-widget>

      <!-- A full-width strip: \`stretch: 'width'\` pins both inline ends and carries no width, so
           it tracks the panel with no JavaScript at all. -->
      <ndd-floating-widget widgetId="status" title="Status" [(placement)]="status" [width]="260" [height]="64">
        <div class="dd-row" style="padding: 0.3rem 0.6rem; font: 0.7rem ui-monospace, monospace; gap: 1rem">
          <span data-demo-feeds>{{ openCameras().length }}/{{ cameras.length }} feeds</span>
          <span>graticule {{ grid() ? 'on' : 'off' }}</span>
          <span style="opacity: 0.55">this strip spans the panel — two pins, no width</span>
        </div>
      </ndd-floating-widget>

      <!-- Widgets from data: one per open camera, seeded to a corner and then free to be dragged.
           Opened through injectFloatingWidgets(), which needs the overlay's injector — hence the
           child component. -->
      <dd-camera-widgets [cameras]="cameraWidgets()" (closed)="toggleCamera($event)" />
    </ndd-panel-overlay>
  `,
})
export class MainMapPanel {
  protected readonly cameras = CAMERAS;
  protected readonly grid = signal(false);
  protected readonly readout = signal('51.5050, -0.0900 · z13');
  protected readonly legend = signal<PanelFloatPlacement>({ anchor: 'top-left', stretch: null });
  protected readonly status = signal<PanelFloatPlacement>({ anchor: 'bottom-left', stretch: 'width' });

  /** Widgets opened from data — one per camera — rather than declared in the template. */
  protected readonly openCameras = signal<string[]>([]);
  protected readonly cameraWidgets = computed(() =>
    CAMERAS.map((camera, index) => ({ ...camera, corner: CORNERS[index % CORNERS.length]! })).filter(camera => this.openCameras().includes(camera.id)),
  );

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly zone = inject(NgZone);
  private map: L.Map | null = null;
  private readonly groups = new Map<string, L.LayerGroup>();

  constructor() {
    const panel = injectPanel();
    afterNextRender(() => this.zone.runOutsideAngular(() => this.create()));
    effect(() => {
      if (panel.size() && this.map) this.map.invalidateSize();
    });
    inject(Workspace).subscribe('layer-visibility', data => {
      const { layerId, visible } = data as { layerId: string; visible: boolean };
      const group = this.groups.get(layerId);
      if (!group || !this.map) return;
      if (visible) group.addTo(this.map);
      else this.map.removeLayer(group);
    });
    inject(DestroyRef).onDestroy(() => {
      this.map?.remove();
      this.map = null;
    });
  }

  protected toggleCamera(id: string): void {
    this.openCameras.update(open => (open.includes(id) ? open.filter(x => x !== id) : [...open, id]));
  }

  protected zoom(by: number): void {
    this.map?.setZoom(this.map.getZoom() + by);
  }

  protected recentre(): void {
    this.map?.setView([51.505, -0.09], 13);
  }

  private create(): void {
    const map = L.map(this.host().nativeElement, { center: [51.505, -0.09], zoom: 13, zoomControl: false, attributionControl: false });
    this.map = map;
    L.tileLayer(TILE_URL, { maxZoom: 19 }).addTo(map);

    this.groups.set('markers', L.layerGroup(CAMERAS.map(camera => {
      const marker = L.circleMarker(camera.at, { radius: 7, color: camera.colour, fillColor: camera.colour, weight: 2, fillOpacity: 0.7 }).bindTooltip(`📷 ${camera.name}`, { direction: 'top' });
      // Leaflet runs outside Angular; the click re-enters, since it changes state the template shows.
      marker.on('click', () => this.zone.run(() => this.toggleCamera(camera.id)));
      return marker;
    })).addTo(map));

    // `interactive: false` because this is decoration: it is added after the markers, so it
    // paints — and hit-tests — above them in Leaflet's shared overlay pane, and it covers the
    // whole cluster. Without it, not one camera marker could be clicked (vdd's M14 finding).
    this.groups.set('polygons', L.layerGroup([L.polygon([[[51.52, -0.14], [51.52, -0.06], [51.49, -0.06], [51.49, -0.14]]], { color: '#f59e0b', weight: 1.4, fillOpacity: 0.06, interactive: false })]).addTo(map));
    this.groups.set('polylines', L.layerGroup([L.polyline([[51.487, -0.23], [51.49, -0.17], [51.505, -0.12], [51.508, -0.06], [51.5, 0.0]], { color: '#22d3ee', weight: 2.5 })]));

    const report = () => {
      const centre = map.getCenter();
      this.readout.set(`${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)} · z${map.getZoom()}`);
    };
    map.on('moveend zoomend', report);
    report();
  }
}
