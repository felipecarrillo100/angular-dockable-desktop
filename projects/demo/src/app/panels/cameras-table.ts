import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { injectWidget } from 'angular-dockable-desktop';

/** A camera as the table lists it. */
export interface TableCamera {
  id: string;
  name: string;
  colour: string;
  at: [number, number];
}

/**
 * The cameras as a table: a managed widget that can leave the map (1.11.0, rdd 7.11.0's "Cameras
 * table"). Docked below the map, as a tab, or floating, it is still this one component: the
 * selected row survives every move, and a click still pans the map that owns it.
 */
@Component({
  selector: 'dd-cameras-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="padding: 0.4rem; font-size: 0.72rem">
      <div style="opacity: 0.6; margin-bottom: 0.25rem">Shown: {{ widget?.location() ?? '—' }}</div>
      <table style="width: 100%; border-collapse: collapse">
        <tbody>
          @for (camera of cameras(); track camera.id) {
            <tr
              [style.cursor]="'pointer'"
              [style.background]="selected() === camera.id ? 'rgba(56,189,248,0.18)' : null"
              (click)="pick(camera)"
            >
              <td style="padding: 0.2rem 0.4rem"><span [style.color]="camera.colour">●</span> {{ camera.name }}</td>
              <td style="padding: 0.2rem 0.4rem; opacity: 0.6; text-align: end; font-family: ui-monospace, monospace">
                {{ camera.at[0].toFixed(3) }}, {{ camera.at[1].toFixed(3) }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class CamerasTable {
  readonly cameras = input<TableCamera[]>([]);
  /** Pans the owning map. A function, so it reaches the map wherever the table is shown. */
  readonly panTo = input<(at: [number, number]) => void>(() => undefined);

  protected readonly widget = injectWidget();
  protected readonly selected = signal<string | null>(null);

  protected pick(camera: TableCamera): void {
    this.selected.set(camera.id);
    this.panTo()(camera.at);
  }
}
