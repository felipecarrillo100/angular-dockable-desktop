/**
 * A message with a single OK button, meant to be opened as a modal (1.6.0) — telling rather than
 * asking. `injectModals().alert()` opens it and returns a promise.
 *
 * `onSettled` fires exactly once however it goes away: OK, Enter, Escape, the backdrop or the ×.
 * Escape, the backdrop and the × only dismiss it while the modal is closable. Ported from vdd
 * `VddAlert.vue`.
 */
import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, viewChild } from '@angular/core';
import type { NddIcon } from '../core/icon';
import type { AlertType, Label } from '../core/types';
import { injectPanel } from '../panel/panel-ref';
import { Workspace } from '../workspace/workspace';
import { NddDialogIcon } from './dialog-icon';

@Component({
  selector: 'ndd-alert',
  imports: [NddDialogIcon],
  template: `
    <form class="ndd-confirmation-form-body" (submit)="$event.preventDefault(); acknowledge()">
      <div class="ndd-dialog-content">
        <ndd-dialog-icon [icon]="icon()" [type]="alertType()" />
        <div class="ndd-confirmation-message">{{ workspace.format(message()) }}</div>
      </div>
      <div class="ndd-confirmation-actions">
        <button #okButton type="submit" class="ndd-btn ndd-btn-sm ndd-btn-primary" data-ndd-alert-ok>
          {{ workspace.format(okLabel() ?? workspace.messages.ok) }}
        </button>
      </div>
    </form>
  `,
})
export class NddAlert {
  readonly message = input.required<Label>();
  /** Picks the built-in icon and its colour. */
  readonly alertType = input<AlertType>('info');
  /** Omit it for the built-in icon of `alertType`, pass `null` for none, or pass an icon. */
  readonly icon = input<NddIcon | null | undefined>(undefined);
  /** The button label. Defaults to the `ok` message. */
  readonly okLabel = input<Label | undefined>(undefined);
  /** Called exactly once, whichever way the dialog closes. */
  readonly onSettled = input<(() => void) | undefined>(undefined);

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  private readonly panel = injectPanel();
  private readonly okButton = viewChild<ElementRef<HTMLButtonElement>>('okButton');
  private settled = false;

  constructor() {
    afterNextRender(() => this.okButton()?.nativeElement.focus({ preventScroll: true }));
    // Escape, the backdrop and the × all destroy us without going through acknowledge().
    inject(DestroyRef).onDestroy(() => this.settle());
  }

  /** Runs on every exit path, including a destroy the dialog did not initiate. */
  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.onSettled()?.();
  }

  protected acknowledge(): void {
    this.settle();
    void this.panel.close({ force: true });
  }
}
