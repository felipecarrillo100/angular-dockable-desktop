import { Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { NddPanelOverlay, injectFloatingWidgets, injectWidget } from 'angular-dockable-desktop';
import type { ManagedWidget } from 'angular-dockable-desktop';

type W = Window & { __wo?: Record<string, unknown>; __woPopResult?: unknown };
const w = window as unknown as W;
const params = new URLSearchParams(location.search);

/**
 * `?po=1&wo=1` (the M19 gate, P5, 1.12.0): a managed widget's content with state to keep through its
 * own window: a counter, a text field and a live WebGL context (recorded on its canvas, with a count
 * of context losses). Each `onWillMove` / `onMoved` is recorded in `window.__wo.calls` with the
 * content element's size at that moment (the host is that element, `.ndd-panel-float__content`).
 */
@Component({
  selector: 'pg-wo-fill',
  template: `
    <div id="wo-fill" style="height: 100%; box-sizing: border-box; padding: 4px">
      <button type="button" id="wo-count" (click)="n.set(n() + 1)">{{ n() }}</button>
      <input id="wo-text" aria-label="text" style="width: 80px" />
      <canvas id="wo-gl" width="40" height="20"></canvas>
    </div>
  `,
})
class WoFill {
  protected readonly n = signal(0);
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const widget = injectWidget();
    const probe = w.__wo!;
    const note = (kind: string) => () => {
      (probe['calls'] as string[]).push(kind === 'will' ? 'will' : `moved ${host.offsetWidth}x${host.offsetHeight}`);
    };
    widget?.onWillMove(note('will'));
    widget?.onMoved(note('moved'));
    afterNextRender(() => {
      const canvas = host.querySelector<HTMLCanvasElement>('#wo-gl');
      const gl = canvas?.getContext('webgl');
      if (!canvas || !gl) return;
      const record = canvas as unknown as Record<string, unknown>;
      record['__gl'] = gl;
      record['__glLost'] = 0;
      canvas.addEventListener('webglcontextlost', () => (record['__glLost'] = (record['__glLost'] as number) + 1));
    });
  }
}

/** Opens `wo` in the overlay it sits in, and exposes `injectFloatingWidgets()` as `window.__wo.api`. */
@Component({ selector: 'pg-wo-opener', template: '' })
class WoOpener {
  private readonly widgets = injectFloatingWidgets();

  constructor() {
    w.__wo = { calls: [], api: this.widgets };
    const config: ManagedWidget = {
      title: 'Wo',
      component: WoFill,
      anchor: 'top-left',
      width: 200,
      height: 130,
      canPopOut: true,
      titleMenu: m => [
        {
          label: 'Open in new window',
          disabled: !m.canPopOut || m.isPoppedOut,
          action: () => {
            w.__woPopResult = m.popOut();
          },
        },
        { label: 'Back into the panel', action: () => m.move({ to: 'panel' }) },
      ],
    };
    afterNextRender(() => this.widgets.open('wo', config));
  }
}

/**
 * The widget's owner panel (type `wover`): an overlay with the managed widget `wo` (canPopOut, and a
 * titleMenu with the app's own "Open in new window": the library adds none for a widget). Anchored
 * top-left, so its window fits a headless screen. With `?opo=1` the owner type can pop out too, and
 * #wo-po-in, a click inside it, pops the widget out from there (rdd 7.12.1's harness `opo=1`).
 */
@Component({
  selector: 'pg-wo-owner',
  imports: [NddPanelOverlay, WoOpener],
  template: `
    <ndd-panel-overlay>
      <div style="height: 100%; padding: 0 0 0 220px; box-sizing: border-box">
        owner
        @if (opo) {
          <button type="button" id="wo-po-in" (click)="popOut()">pop out wo here</button>
        }
      </div>
      <pg-wo-opener />
    </ndd-panel-overlay>
  `,
})
export class WoOwner {
  protected readonly opo = params.get('opo') === '1';

  protected popOut(): void {
    const api = w.__wo?.['api'] as { popOut(id: string): unknown } | undefined;
    w.__woPopResult = api?.popOut('wo');
  }
}
