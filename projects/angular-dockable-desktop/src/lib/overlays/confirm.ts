/**
 * A confirm/cancel dialog, meant to be opened as a modal — and what the library itself opens
 * when a dirty panel is closed.
 *
 * `onSettled` exists for that second use: the caller needs the answer however the dialog went
 * away — the buttons, Escape, the backdrop, or the ×. Resolving only on the buttons would leave
 * a close awaiting forever when the user pressed Escape. Ported from vdd `VddConfirm.vue`.
 */
import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, viewChild } from '@angular/core';
import type { AlertType, Label } from '../core/types';
import { injectPanel } from '../panel/panel-ref';
import { Workspace } from '../workspace/workspace';

@Component({
  selector: 'ndd-confirm',
  template: `
    <form class="ndd-confirmation-form-body" (submit)="$event.preventDefault(); confirm()">
      @if (alert()) {
        <div class="ndd-confirmation-alert" [class]="'ndd-confirmation-alert-' + alertType()" role="alert">
          <span>{{ alert() }}</span>
        </div>
      }
      <div class="ndd-confirmation-message">{{ workspace.format(message()) }}</div>
      <div class="ndd-confirmation-actions">
        <button type="button" class="ndd-btn ndd-btn-sm ndd-btn-outline" data-ndd-confirm-cancel (click)="cancel()">
          {{ workspace.format(yesNo() ? workspace.messages.no : workspace.messages.cancel) }}
        </button>
        <button #confirmButton type="submit" class="ndd-btn ndd-btn-sm ndd-btn-primary" data-ndd-confirm-ok>
          {{ workspace.format(yesNo() ? workspace.messages.yes : workspace.messages.ok) }}
        </button>
      </div>
    </form>
  `,
})
export class NddConfirm {
  readonly message = input.required<Label>();
  /** An extra banner above the message — which fields are invalid, say. */
  readonly alert = input<string | undefined>(undefined);
  readonly alertType = input<AlertType>('info');
  /** Label the buttons "Yes"/"No" rather than "OK"/"Cancel". */
  readonly yesNo = input(false);
  readonly onOk = input<(() => void) | undefined>(undefined);
  readonly onCancel = input<(() => void) | undefined>(undefined);
  /** Called exactly once, whichever way the dialog closes. `ok` says which. */
  readonly onSettled = input<((ok: boolean) => void) | undefined>(undefined);

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  private readonly panel = injectPanel();
  private readonly confirmButton = viewChild<ElementRef<HTMLButtonElement>>('confirmButton');
  private settled = false;

  constructor() {
    // Focus the confirm button, so Enter answers and a screen reader announces the choice.
    afterNextRender(() => this.confirmButton()?.nativeElement.focus({ preventScroll: true }));
    // Escape, the backdrop and the × all destroy us without going through cancel().
    inject(DestroyRef).onDestroy(() => this.settle(false));
  }

  /** Runs on every exit path, including a destroy the dialog did not initiate. */
  private settle(ok: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.onSettled()?.(ok);
  }

  protected confirm(): void {
    this.settle(true);
    this.onOk()?.();
    void this.panel.close({ force: true });
  }

  protected cancel(): void {
    this.settle(false);
    this.onCancel()?.();
    void this.panel.close({ force: true });
  }
}
