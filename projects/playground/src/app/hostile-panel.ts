import { Component, ElementRef, afterNextRender, input, signal, viewChild } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { injectPanel } from 'angular-dockable-desktop';

type W = Window & Record<string, Record<string, unknown> | undefined>;
const w = window as unknown as W;
const bump = (key: string, id: string) => {
  const map = (w[key] ??= {});
  map[id] = ((map[id] as number | undefined) ?? 0) + 1;
};

/**
 * A panel designed to lose state if anything re-creates or carelessly re-parents it: a live
 * WebGL context, a playing video, a scrolled list, a focused input, a counter and a timer.
 * Ported from the M0 spike, now hosted by the real library.
 */
@Component({
  selector: 'pg-hostile-panel',
  template: `
    <div class="pg-hostile" [attr.data-panel]="panel.id">
      <div>
        <b>{{ panel.id }}</b> label=<span [attr.data-label]="panel.id">{{ label() }}</span>
        ticks=<span [attr.data-ticks]="panel.id">{{ ticks() }}</span>
        count=<span [attr.data-count]="panel.id">{{ count() }}</span>
        <button [attr.data-inc]="panel.id" (click)="count.set(count() + 1)">+1</button>
        active=<span [attr.data-active]="panel.id">{{ panel.isActive() }}</span>
      </div>
      <canvas #canvas [attr.data-canvas]="panel.id" width="60" height="40"></canvas>
      <video #video [attr.data-video]="panel.id" src="test.mp4" width="80" muted loop playsinline></video>
      <div class="pg-scroller" [attr.data-scroller]="panel.id">
        @for (n of rows; track n) { <div>row {{ n }}</div> }
      </div>
      <input [attr.data-input]="panel.id" value="hello world" aria-label="probe input" />
    </div>
  `,
})
export class HostilePanel implements OnDestroy {
  readonly label = input('initial');
  protected readonly panel = injectPanel();
  protected readonly ticks = signal(0);
  protected readonly count = signal(0);
  protected readonly rows = Array.from({ length: 60 }, (_, i) => i + 1);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    bump('__mounts', this.panel.id);
    afterNextRender(() => {
      const gl = this.canvas().nativeElement.getContext('webgl');
      (w['__gl'] ??= {})[this.panel.id] = gl;
      if (gl) {
        gl.clearColor(0.2, 0.7, 0.9, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      this.video().nativeElement.play().catch(() => undefined);
      this.timer = setInterval(() => this.ticks.update(t => t + 1), 50);
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    bump('__unmounts', this.panel.id);
  }
}
