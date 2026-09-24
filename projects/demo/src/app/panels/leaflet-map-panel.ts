import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, effect, inject, signal, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { Workspace, injectPanel } from 'angular-dockable-desktop';

const LANDMARKS: [number, number, string][] = [
  [51.5007, -0.1246, 'Big Ben'],
  [51.5081, -0.0759, 'Tower of London'],
  [51.5033, -0.1196, 'London Eye'],
  [51.5194, -0.127, 'British Museum'],
];

/**
 * Leaflet in a dockable panel.
 *
 * The reason this matters: a map instance is bound to a DOM element, and most layout engines
 * re-create a panel's DOM when it moves. Leaflet survives here because the element is moved
 * intact — the map keeps its centre, its zoom, its layers and its tile cache through docking,
 * floating and minimising. All it needs is `invalidateSize()` when its box changes, which
 * `injectPanel().size` reports as a signal.
 *
 * Its live thumbnail is disabled in the registry (`disableLivePreview`), because scaling a
 * tiled map into a 160px preview is wasted work — the taskbar shows its initial instead.
 *
 * Leaflet listens to the pointer at high frequency, so it is created outside Angular: a pan
 * costs no change detection. Only the readout re-enters.
 */
@Component({
  selector: 'dd-leaflet-map-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel dd-panel--flush" style="position: relative">
      <div #host class="dd-leaflet" data-demo-leaflet></div>
      <div
        style="position: absolute; inset-block-end: 6px; inset-inline-start: 6px; z-index: 500;
               padding: 0.15rem 0.45rem; border-radius: 4px; background: rgba(0,0,0,0.55);
               font: 0.68rem ui-monospace, monospace; color: #cfe3f5; pointer-events: none"
      >{{ readout() }}</div>
    </div>
  `,
})
export class LeafletMapPanel {
  protected readonly readout = signal('');
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private map: L.Map | null = null;
  private readonly layers = new Map<string, L.Layer>();

  constructor() {
    const zone = inject(NgZone);
    const panel = injectPanel();
    const ws = inject(Workspace);

    afterNextRender(() => zone.runOutsideAngular(() => this.create()));

    // `injectPanel().size` is a signal, so this is an effect rather than a subscription.
    effect(() => {
      if (panel.size() && this.map) this.map.invalidateSize();
    });

    // The layer panel publishes; this subscribes. Neither knows about the other, and the
    // subscription is disposed with the component because it was made in an injection context.
    ws.subscribe('layer-visibility', data => {
      const { layerId, visible } = data as { layerId: string; visible: boolean };
      const layer = this.layers.get(layerId);
      if (!layer || !this.map) return;
      if (visible) layer.addTo(this.map);
      else this.map.removeLayer(layer);
    });

    inject(DestroyRef).onDestroy(() => {
      this.map?.remove();
      this.map = null;
    });
  }

  private create(): void {
    const map = L.map(this.host().nativeElement, { center: [51.505, -0.09], zoom: 12, zoomControl: true, attributionControl: false });
    this.map = map;
    // OpenStreetMap's standard tiles: no API key. The dark look is a CSS filter (styles.css).
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    this.layers.set('markers', L.layerGroup(
      LANDMARKS.map(([lat, lng, name]) => L.circleMarker([lat, lng], { radius: 5, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 0.85, weight: 1 }).bindTooltip(name)),
    ).addTo(map));
    this.layers.set('polygons', L.polygon([[[51.52, -0.14], [51.52, -0.08], [51.49, -0.08], [51.49, -0.14]]], { color: '#f59e0b', weight: 1.5, fillOpacity: 0.08 }).addTo(map));
    // Off by default, matching what the layer panel publishes on first render.
    this.layers.set('polylines', L.polyline([[51.487, -0.23], [51.49, -0.17], [51.505, -0.12], [51.508, -0.06], [51.5, 0.0]], { color: '#22d3ee', weight: 2.5 }));

    const report = () => {
      const c = map.getCenter();
      this.readout.set(`${c.lat.toFixed(4)}, ${c.lng.toFixed(4)} · z${map.getZoom()}`);
    };
    map.on('moveend zoomend', report);
    report();
  }
}
