/**
 * The controls a `<ndd-panel-toolbar>` holds: button, toggle, separator, spacer, item, centre.
 *
 * `<ndd-toolbar-button>` has no `click` output of its own: the native `click` of its inner
 * `<button>` bubbles to it, so `(click)` on the element works as on any button — and, like a
 * native button, fires nothing while disabled. `<ndd-toolbar-toggle>`'s state is a `model()`, so
 * `[(active)]` is rdd's `active` plus `onToggle` without the boilerplate. Ported from vdd's
 * `VddToolbarButton`, `…Toggle`, `…Separator`, `…Spacer`, `…Item` and `…Center`.
 */
import { Component, input, model } from '@angular/core';
import type { ButtonVariant } from '../core/panel-overlay';

@Component({
  selector: 'ndd-toolbar-button',
  host: { style: 'display: contents' },
  template: `
    <button
      type="button"
      class="ndd-panel-toolbar-btn"
      [attr.title]="title()"
      [attr.aria-label]="title()"
      [disabled]="disabled()"
      [attr.data-variant]="variant()"
    ><ng-content /></button>
  `,
})
export class NddToolbarButton {
  /** Tooltip and accessible name. */
  readonly title = input<string | undefined>(undefined);
  readonly disabled = input(false);
  /** Overrides the toolbar's own `buttonVariant`. */
  readonly variant = input<ButtonVariant | undefined>(undefined);
}

@Component({
  selector: 'ndd-toolbar-toggle',
  host: { style: 'display: contents' },
  template: `
    <button
      type="button"
      class="ndd-panel-toolbar-btn"
      [class.ndd-panel-toolbar-btn--active]="active()"
      [attr.title]="title()"
      [attr.aria-label]="title()"
      [attr.aria-pressed]="active()"
      [disabled]="disabled()"
      [attr.data-variant]="variant()"
      (click)="active.set(!active())"
    ><ng-content /></button>
  `,
})
export class NddToolbarToggle {
  readonly title = input<string | undefined>(undefined);
  readonly disabled = input(false);
  readonly variant = input<ButtonVariant | undefined>(undefined);
  /** On or off. Bind `[(active)]` to own it. */
  readonly active = model(false);
}

/** A divider between groups of toolbar items. Decorative, so hidden from assistive technology. */
@Component({ selector: 'ndd-toolbar-separator', host: { class: 'ndd-panel-toolbar__sep', 'aria-hidden': 'true' }, template: '' })
export class NddToolbarSeparator {}

/** Grows to push everything after it to the far end of the toolbar. */
@Component({ selector: 'ndd-toolbar-spacer', host: { class: 'ndd-panel-toolbar__spacer', 'aria-hidden': 'true' }, template: '' })
export class NddToolbarSpacer {}

/** Wraps a control that is not one of the library's buttons — a select, an input, a badge. */
@Component({ selector: 'ndd-toolbar-item', host: { class: 'ndd-panel-toolbar__item' }, template: '<ng-content />' })
export class NddToolbarItem {}

/** Centres its content in the toolbar, independent of what sits on either side. */
@Component({ selector: 'ndd-toolbar-center', host: { class: 'ndd-panel-toolbar__center' }, template: '<ng-content />' })
export class NddToolbarCenter {}
