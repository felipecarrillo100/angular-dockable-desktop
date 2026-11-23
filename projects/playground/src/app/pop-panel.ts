import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, signal, viewChild } from '@angular/core';
import { Workspace, toast } from 'angular-dockable-desktop';
import { injectRcClass, rcIcon } from './runtime-css';

type W = Window & { __poLost?: number; __poGl?: WebGLRenderingContext | null; __poqResult?: unknown; __poMounts?: number };
const w = window as unknown as W;
const params = new URLSearchParams(location.search);

/**
 * `?po=1` (the M19 gate, 1.12.0): a panel that can pop out, with state, a scroll offset and a
 * WebGL context to keep. Inline layout, so it fills its slot whatever the window's stylesheets.
 * With `?po2=1`, `pp`'s #po-pop-q pops `pq` out: a click inside pp's window once it is out
 * (rdd 7.12.1).
 *
 * The zone case (the P2b spike): change detection `Eager`, so in a zone application a plain field
 * renders once the zone sees the event. #po-plain writes one from a template listener;
 * #po-arm adds a listener on the panel's own document (the pop-out's, once it is out) whose
 * #po-doc clicks write another, `docPlain`, outside any template: it renders in `?zone` only if
 * that window's events run in the Angular zone.
 *
 * `?rc=1` (P4): content styled by the runtime CSS-in-JS stand-in (runtime-css.ts), and a menu item's
 * and a toast's icon too: #po-rc, #po-menu, #po-toast.
 */
@Component({
  selector: 'pg-pop-panel',
  // Eager on purpose: the zone case needs a component zone.js's change detection reaches (see above).
  // eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div [attr.id]="pp() ? 'po-fill' : null" style="height: 100%; display: flex; flex-direction: column">
      <div>
        <button [attr.id]="pp() ? 'po-inc' : null" (click)="count.set(count() + 1)">+</button>
        <span [attr.id]="pp() ? 'po-count' : null">{{ count() }}</span>
        <canvas #canvas width="40" height="20"></canvas>
        @if (pp()) {
          @if (po2) {
            <button id="po-pop-q" (click)="popQ()">pop q</button>
          }
          <button id="po-plain" (click)="plain = plain + 1">plain</button>
          <span id="po-plain-out">{{ plain }}</span>
          <button id="po-arm" (click)="arm()">arm</button>
          <button id="po-doc">doc</button>
          <span id="po-doc-out">{{ docPlain }}</span>
          @if (rc) {
            <span id="po-rc" [class]="rcContent()">styled</span>
            <!-- Stopped: the menu dismisses on a click reaching the window, this one included. -->
            <button id="po-menu" (click)="openMenu($event); $event.stopPropagation()">menu</button>
            <button id="po-toast" (click)="raiseToast()">toast</button>
          }
        }
      </div>
      <div [attr.id]="pp() ? 'po-sc' : null" style="flex: 1; min-height: 0; overflow: auto">
        <div style="height: 3000px">scroll</div>
      </div>
    </div>
  `,
})
export class PopPanel {
  readonly panelId = input('');
  protected readonly pp = () => this.panelId() === 'pp';
  protected readonly po2 = params.get('po2') === '1';
  protected readonly count = signal(0);
  protected readonly rc = params.get('rc') === '1';
  protected readonly rcContent = injectRcClass('content', 'color: rgb(10, 20, 30); letter-spacing: 3px; border-bottom: 2px solid rgb(40, 50, 60);');
  /** Plain fields, not signals: they render only when change detection runs (the zone case). */
  protected plain = 0;
  protected docPlain = 0;
  private readonly workspace = inject(Workspace);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    afterNextRender(() => {
      if (!this.pp()) return;
      w.__poMounts = (w.__poMounts ?? 0) + 1;
      w.__poLost = 0;
      const canvas = this.canvas().nativeElement;
      canvas.addEventListener('webglcontextlost', () => {
        w.__poLost = (w.__poLost ?? 0) + 1;
      });
      w.__poGl = canvas.getContext('webgl');
    });
  }

  protected openMenu(event: MouseEvent): void {
    this.workspace.showContextMenu({ event, items: [{ label: 'Rc item', icon: rcIcon('menu'), action: () => undefined }] });
  }

  protected raiseToast(): void {
    toast('from pp', { icon: rcIcon('toast'), duration: 0 });
  }

  protected popQ(): void {
    w.__poqResult = this.workspace.popOutPanel('pq');
  }

  /** Listens on the document the panel is in now: a pop-out's, once it is out. */
  protected arm(): void {
    this.el.ownerDocument.addEventListener('click', event => {
      if ((event.target as Element | null)?.id === 'po-doc') this.docPlain++;
    });
  }
}
