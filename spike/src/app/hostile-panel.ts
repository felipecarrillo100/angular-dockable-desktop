import { Component, ElementRef, InjectionToken, OnDestroy, afterNextRender, inject, input, signal, viewChild } from '@angular/core';

/** Provided through the element injector, as PanelRef will be in the library. */
export const PANEL_TOKEN = new InjectionToken<string>('PANEL_TOKEN');

type W = Window & Record<string, any>;
const w = window as unknown as W;
const bump = (key: string, id: string) => {
  w[key] = w[key] ?? {};
  w[key][id] = (w[key][id] ?? 0) + 1;
};

/**
 * A panel designed to lose state if anything remounts or re-parents it carelessly:
 * a live WebGL context, a playing video, a scrolled list, a focused input with a caret,
 * a running interval, a mid-flight CSS animation, and an iframe.
 */
@Component({
  selector: 'spike-hostile-panel',
  template: `
    <div class="panel" [attr.data-panel]="id()">
      <div class="meta">
        <b>{{ id() }}</b>
        label=<span [attr.data-label]="id()">{{ label() }}</span>
        token=<span [attr.data-token]="id()">{{ token }}</span>
        ticks=<span [attr.data-ticks]="id()">{{ ticks() }}</span>
      </div>
      <canvas #canvas [attr.data-canvas]="id()" width="60" height="40"></canvas>
      <video #video [attr.data-video]="id()" src="test.mp4" width="80" muted loop playsinline></video>
      <div class="scroller" [attr.data-scroller]="id()">
        @for (n of rows; track n) { <div class="item">row {{ n }}</div> }
      </div>
      <input [attr.data-input]="id()" value="hello world" />
      <div class="anim" [attr.data-anim]="id()"></div>
      <iframe [attr.data-iframe]="id()" src="iframe.html" width="70" height="26"></iframe>
    </div>
  `,
  styles: `
    .panel { display: flex; flex-wrap: wrap; gap: 4px; align-items: flex-start; font-size: 11px; }
    .meta { width: 100%; }
    .scroller { height: 52px; width: 90px; overflow: auto; border: 1px solid #555; }
    .item { padding: 1px 3px; }
    .anim { width: 12px; height: 12px; background: #f59e0b; animation: spike-slide 4s linear infinite; }
    @keyframes spike-slide { from { transform: translateX(0) } to { transform: translateX(60px) } }
    input { width: 90px; }
  `,
})
export class HostilePanel implements OnDestroy {
  readonly id = input.required<string>();
  readonly label = input('initial');
  protected readonly token = inject(PANEL_TOKEN, { optional: true }) ?? 'none';
  protected readonly ticks = signal(0);
  protected readonly rows = Array.from({ length: 60 }, (_, i) => i + 1);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    afterNextRender(() => {
      const id = this.id();
      bump('__mounts', id);
      const gl = this.canvas().nativeElement.getContext('webgl');
      w['__gl'] = w['__gl'] ?? {};
      w['__gl'][id] = gl;
      if (gl) { gl.clearColor(0.2, 0.7, 0.9, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      this.video().nativeElement.play().catch(() => { /* reported by the harness */ });
      // A signal written from a timer: proves change detection keeps rendering the panel
      // while it is detached from any leaf.
      this.timer = setInterval(() => this.ticks.update(t => t + 1), 50);
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    bump('__unmounts', this.id());
  }
}
