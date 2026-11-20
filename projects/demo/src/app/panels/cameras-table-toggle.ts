import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NddToolbarToggle, injectFloatingWidgets } from 'angular-dockable-desktop';
import type { ManagedWidget } from 'angular-dockable-desktop';
import { CamerasTable } from './cameras-table';
import type { TableCamera } from './cameras-table';

const ID = 'map-cameras';

/**
 * The toolbar toggle that opens the cameras table (1.11.0). A component of its own for the same
 * reason as `CameraWidgets`: `injectFloatingWidgets()` needs the overlay's injector, and the map
 * panel's own constructor sits outside its overlay.
 *
 * The table can leave the map: its title menu docks it below the map, opens it as a tab or floats
 * it, and, out of the panel, brings it back.
 */
@Component({
  selector: 'dd-cameras-table-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NddToolbarToggle],
  host: { style: 'display: contents' },
  template: `
    <ndd-toolbar-toggle title="Cameras table (can leave the map)" [active]="widgets.isOpen(id)" (activeChange)="toggle($event)">
      <span aria-hidden="true">▤</span>
    </ndd-toolbar-toggle>
  `,
})
export class CamerasTableToggle {
  readonly cameras = input.required<TableCamera[]>();
  readonly panTo = input.required<(at: [number, number]) => void>();

  protected readonly id = ID;
  protected readonly widgets = injectFloatingWidgets();

  protected toggle(on: boolean): void {
    if (on) this.widgets.open(ID, this.table());
    else this.widgets.close(ID);
  }

  private table(): ManagedWidget {
    return {
      title: 'Cameras',
      component: CamerasTable,
      inputs: { cameras: this.cameras(), panTo: this.panTo() },
      anchor: 'bottom-left',
      width: 300,
      height: 170,
      canDock: true,
      canFloat: true,
      titleMenu: w =>
        w.location === 'panel'
          ? [
              { label: 'Dock below the map', action: () => w.move({ to: 'docked', position: 'bottom', size: 0.3 }) },
              { label: 'Open as a tab', action: () => w.move({ to: 'tabbed' }) },
              { label: 'Float', action: () => w.move({ to: 'floating' }) },
            ]
          : [{ label: 'Back into the map', action: () => w.move({ to: 'panel' }) }],
    };
  }
}
