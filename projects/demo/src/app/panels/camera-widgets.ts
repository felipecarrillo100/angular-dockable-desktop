import { ChangeDetectionStrategy, Component, effect, input, output, untracked } from '@angular/core';
import { injectFloatingWidgets } from 'angular-dockable-desktop';
import type { FloatAnchor } from 'angular-dockable-desktop';
import { CameraFeed } from './camera-feed';

/** A camera that should have a widget open, with the corner it starts in. */
export interface OpenCamera {
  id: string;
  name: string;
  colour: string;
  corner: FloatAnchor;
}

/**
 * One floating widget per open camera, opened through `injectFloatingWidgets()`.
 *
 * A component of its own rather than part of `MainMapPanel`, because `injectFloatingWidgets()`
 * needs the overlay's injector, and the panel is the component that *renders* the overlay — so
 * the panel's own constructor sits outside it. Every application that opens widgets from data
 * hits this, which is why the manual shows the same shape.
 *
 * This is the `open()`-from-data path; the legend and status widgets beside it are declarative,
 * so the demo exercises both.
 *
 * The widget's own × closes it in the overlay, not here, so `openIds` is watched and the
 * removal reported back to the panel that owns the camera list.
 */
@Component({
  selector: 'dd-camera-widgets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { hidden: '' },
  template: '',
})
export class CameraWidgets {
  readonly cameras = input.required<OpenCamera[]>();
  readonly closed = output<string>();

  constructor() {
    const widgets = injectFloatingWidgets();

    // Open what is missing, close what is gone. `anchor` is only a seed, so a camera that is
    // already open is left exactly where the user dragged it.
    effect(() => {
      const cameras = this.cameras();
      untracked(() => {
        const wanted = new Set(cameras.map(c => c.id));
        for (const id of widgets.openIds()) if (!wanted.has(id)) widgets.close(id);
        for (const camera of cameras) {
          if (widgets.isOpen(camera.id)) continue;
          widgets.open(camera.id, {
            title: camera.name,
            component: CameraFeed,
            inputs: { name: camera.name, colour: camera.colour },
            anchor: camera.corner,
            width: 260,
            height: 190,
          });
        }
      });
    });

    // A × on the widget itself removes it from the overlay; tell the panel so its list follows.
    effect(() => {
      const live = new Set(widgets.openIds());
      for (const camera of untracked(this.cameras)) if (!live.has(camera.id)) this.closed.emit(camera.id);
    });
  }
}
