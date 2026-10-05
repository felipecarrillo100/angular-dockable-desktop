/**
 * The icon slot left of a dialog's message (1.6.0). `icon` undefined draws the built-in icon — a
 * question mark for a confirmation, the type's icon for an alert — `null` draws nothing, and an
 * {@link NddIcon} is drawn in its place. Coloured by `ndd-dialog-icon-${type}`; the glyphs use
 * currentColor, on the same grid as the toast icons. Ported from vdd `VddDialogIcon.vue`.
 * @internal
 */
import { Component, input } from '@angular/core';
import { NddIconView } from '../common/icon';
import type { NddIcon } from '../core/icon';
import type { AlertType } from '../core/types';

@Component({
  selector: 'ndd-dialog-icon',
  imports: [NddIconView],
  host: { style: 'display: contents' },
  template: `
    @if (icon() !== null) {
      <div class="ndd-dialog-icon" [class]="'ndd-dialog-icon-' + type()" [attr.data-ndd-dialog-icon]="icon() === undefined ? 'default' : 'custom'">
        @if (icon(); as custom) {
          <ndd-icon [icon]="custom" />
        } @else {
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            @if (question()) {
              <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
              <path d="M6.25 6.25a1.75 1.75 0 1 1 2.6 1.53c-.5.28-.85.7-.85 1.27v.2M8 11.25v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            } @else if (type() === 'warning') {
              <path d="M8 2.5L14 13.5H2L8 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
              <path d="M8 7v2.5M8 11.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            } @else {
              <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
              @switch (type()) {
                @case ('success') {
                  <path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                }
                @case ('danger') {
                  <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                }
                @default {
                  <path d="M8 5v.01M8 7.5v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                }
              }
            }
          </svg>
        }
      </div>
    }
  `,
})
export class NddDialogIcon {
  readonly icon = input<NddIcon | null | undefined>(undefined);
  readonly type = input.required<AlertType>();
  readonly question = input(false);
}
