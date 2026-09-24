import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { Workspace, injectSidebar, injectToolbar } from 'angular-dockable-desktop';

export interface LayerDefinition {
  id: string;
  name: string;
  visible: boolean;
  /** A base map is always on, so its switch is disabled rather than absent. */
  locked?: boolean;
}

const LAYERS: LayerDefinition[] = [
  { id: 'basemap', name: '🗺️  Carto dark base map', visible: true, locked: true },
  { id: 'markers', name: '📍  London landmarks', visible: true },
  { id: 'polygons', name: '🏛️  District boundaries', visible: true },
  { id: 'polylines', name: '🌊  Thames path', visible: false },
];

/**
 * A layer catalogue that talks to the map panel through the workspace's event bus, reads the
 * toolbar's active tool, and drives the sidebar drawer.
 *
 * Three integration points in one small panel: `publish`/`subscribe` for panel-to-panel
 * messages, `injectToolbar()` for shared tool state, and `injectSidebar()` for the drawer — all
 * reachable without either panel knowing the other exists.
 *
 * It is used both as a sidebar tab and as a panel, so the sidebar is optional: a panel inside
 * the workspace is inside the sidebar too, but a caller elsewhere is not.
 */
@Component({
  selector: 'dd-layer-tree-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel">
      <div class="dd-section">
        <h5>Active tool, read from the workspace</h5>
        <code data-demo-active-tool>{{ activeTool() }}</code>
        <p class="dd-note">Open the Tools panel and pick a tool — this updates without the two panels knowing about each other.</p>
      </div>

      <div class="dd-section">
        <h5>Layers</h5>
        <div class="dd-col">
          @for (layer of layers; track layer.id) {
            <label class="dd-row" [style.opacity]="visibility()[layer.id] ? 1 : 0.5" [style.cursor]="layer.locked ? 'default' : 'pointer'">
              <input
                type="checkbox"
                [checked]="visibility()[layer.id]"
                [disabled]="layer.locked"
                [attr.data-demo-layer]="layer.id"
                (change)="toggle(layer.id)"
              />
              <span>{{ layer.name }}</span>
            </label>
          }
        </div>
        <p class="dd-note">Published on the event bus; the map subscribes.</p>
      </div>

      @if (sidebar) {
        <div class="dd-section">
          <h5>Drive the sidebar from inside a panel</h5>
          <div class="dd-row">
            <button type="button" data-demo-open-search (click)="sidebar.openTab('search')">Open Search</button>
            <button type="button" data-demo-close-drawer (click)="sidebar.closeDrawer()">Close drawer</button>
          </div>
          <p class="dd-note"><code>injectSidebar()</code> works from here because the workspace is the sidebar's own content — a panel is inside it.</p>
        </div>
      }
    </div>
  `,
})
export class LayerTreePanel {
  protected readonly layers = LAYERS;
  protected readonly visibility = signal<Record<string, boolean>>(Object.fromEntries(LAYERS.map(l => [l.id, l.visible])));
  private readonly ws = inject(Workspace);
  protected readonly sidebar = optionalSidebar();

  // The toolbar's state is on the workspace, so this reads the active tool without the toolbar
  // passing anything down — and without this panel knowing where the toolbar is.
  private readonly toolbar = injectToolbar();
  protected readonly activeTool = computed(() => this.toolbar.activeInGroup('demo-tool') ?? 'none');

  constructor() {
    // Announce the initial state, so the map starts in step with this panel.
    afterNextRender(() => {
      for (const layer of LAYERS) if (!layer.locked) this.ws.publish('layer-visibility', { layerId: layer.id, visible: this.visibility()[layer.id] });
    });
  }

  protected toggle(id: string): void {
    this.visibility.update(v => ({ ...v, [id]: !v[id] }));
    this.ws.publish('layer-visibility', { layerId: id, visible: this.visibility()[id] });
  }
}

function optionalSidebar(): ReturnType<typeof injectSidebar> | null {
  try {
    return injectSidebar();
  } catch {
    return null;
  }
}
