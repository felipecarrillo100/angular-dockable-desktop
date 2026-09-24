/**
 * The hover preview for a minimised panel.
 *
 * Not a screenshot — **the panel itself**, moved into a scaled box. The panel is still alive and
 * still running, so what you see is live: a map still renders, a video still plays. Only
 * possible because a panel's DOM is never re-created (ADR 0002). Rendered into `document.body`
 * (`[nddPortal]`) and positioned `fixed`, so the taskbar's own styling never clips it.
 *
 * Ported from vdd `VddTaskbarPreview.vue`.
 * @internal
 */
import { Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import type { AfterViewInit, OnDestroy } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { PanelHost } from '../panel/panel-host';
import { NddPortal } from '../common/portal';
import type { PanelInfo } from '../core/types';

/** The thumbnail never exceeds this box; the panel's real aspect ratio is preserved. */
const MAX_W = 220;
const MAX_H = 140;

@Component({
  selector: 'ndd-taskbar-preview',
  imports: [NddPortal],
  template: `
    <div
      nddPortal
      class="ndd-taskbar-item-tooltip"
      data-ndd-preview
      role="button"
      tabindex="0"
      [attr.dir]="workspace.dir()"
      [attr.aria-label]="title()"
      [style.position]="'fixed'"
      [style.left.px]="anchor().left + anchor().width / 2"
      [style.top.px]="anchor().top - 8"
      [style.transform]="'translateX(-50%) translateY(-100%)'"
      (click)="restore.emit()"
      (keydown.enter)="restore.emit()"
      (pointerenter)="keep.emit()"
      (pointerleave)="dismiss.emit()"
    >
      <div class="ndd-tooltip-header-row">
        <span class="ndd-tooltip-title-text ndd-text-truncate">{{ title() }}{{ panel()?.dirty ? ' *' : '' }}</span>
        <span
          class="ndd-tooltip-close-x"
          role="button"
          tabindex="0"
          [attr.data-ndd-preview-close]="panelId()"
          [attr.title]="workspace.format(workspace.messages.closePanel)"
          [attr.aria-label]="workspace.format(workspace.messages.closePanel)"
          (click)="$event.stopPropagation(); closeRequest.emit()"
          (keydown.enter)="$event.stopPropagation(); closeRequest.emit()"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </span>
      </div>
      <div class="ndd-taskbar-item-preview-frame" [style.width]="frame().width" [style.height]="frame().height">
        <!-- The panel's own element is moved in here. Nothing is rendered inside by Angular: a
             duplicate is exactly what a preview must not be. -->
        @if (live()) {
          <div
            #host
            class="ndd-taskbar-item-preview-host"
            [style.width.px]="source().width"
            [style.height.px]="source().height"
            [style.transform]="'scale(' + scale() + ')'"
            [style.transform-origin]="'top left'"
            [style.position]="'absolute'"
            [style.top]="'0'"
            [style.left]="'0'"
            [style.--ndd-preview-scale]="scale()"
          ></div>
        } @else {
          <div class="ndd-taskbar-item-preview-letter">{{ initial() }}</div>
        }
      </div>
    </div>
  `,
})
export class NddTaskbarPreview implements AfterViewInit, OnDestroy {
  readonly panelId = input.required<string>();
  /** The icon's on-screen rect, so the preview can sit above it. */
  readonly anchor = input.required<{ left: number; top: number; width: number }>();
  readonly restore = output();
  /** Not `close`: an output named like a native DOM event would also catch the DOM event. */
  readonly closeRequest = output();
  readonly dismiss = output();
  /** The pointer is over the preview: a pending dismissal must be cancelled. */
  readonly keep = output();

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  private readonly host = inject(PanelHost);
  private readonly hostEl = viewChild<ElementRef<HTMLElement>>('host');
  private mine: HTMLElement | null = null;

  // Typed with `undefined`: a Record index reads as always-present, but a closed panel is not.
  protected readonly panel = computed<PanelInfo | undefined>(() => this.workspace.panels()[this.panelId()]);
  protected readonly title = computed(() => this.workspace.format(this.panel()?.title));
  protected readonly live = computed(() => {
    const panel = this.panel();
    return (panel && this.workspace.registry.get(panel.component)?.defaultOptions?.disableLivePreview) !== true;
  });
  protected readonly source = computed(() => this.host.dom.sizeOf(this.panelId()));
  protected readonly scale = computed(() => Math.min(MAX_W / this.source().width, MAX_H / this.source().height));
  protected readonly frame = computed(() => ({
    width: `${Math.round(this.source().width * this.scale())}px`,
    height: `${Math.round(this.source().height * this.scale())}px`,
  }));
  /** First letter of the title, for a panel that opts out of a live preview. */
  protected readonly initial = computed(() => (Array.from(this.title() || this.panelId())[0] ?? 'P').toUpperCase());

  /**
   * Take the panel as the preview appears. `refocus: false`: hovering a taskbar icon must never
   * steal the caret from whatever the user is typing in.
   */
  ngAfterViewInit(): void {
    const el = this.hostEl()?.nativeElement;
    if (!el) return;
    this.mine = el;
    this.host.dom.moveTo(this.panelId(), el, { refocus: false });
  }

  /**
   * Give the panel back — only if this preview still has it. Restoring from the preview closes
   * the preview *and* gives the panel a slot, in no guaranteed order; parking unconditionally
   * could steal the panel back from the slot that just claimed it (vdd found this).
   */
  ngOnDestroy(): void {
    const id = this.panelId();
    if (this.mine && this.host.dom.has(id) && this.host.dom.hostOf(id) === this.mine) this.host.dom.moveTo(id, null, { refocus: false });
    this.mine = null;
  }
}
