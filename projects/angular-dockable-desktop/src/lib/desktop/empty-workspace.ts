/**
 * The app's own empty-workspace view (1.7.0): an `<ng-template nddEmptyWorkspace>` inside
 * `<ndd-desktop>`, shown in place of the built-in message while no panel is docked.
 *
 * The desktop finds it with `contentChild` and hands it to its groups through
 * {@link EmptyWorkspaceSlot}; a group shows it only while it is the grid's root and empty, so
 * empty groups inside a split keep the built-in message.
 */
import { Directive, TemplateRef, inject, signal } from '@angular/core';

/** Marks the template `<ndd-desktop>` shows while no panel is docked. */
@Directive({ selector: 'ng-template[nddEmptyWorkspace]' })
export class NddEmptyWorkspaceTemplate {
  readonly template = inject<TemplateRef<void>>(TemplateRef);
}

/** @internal — one per `<ndd-desktop>`, provided in its `providers`. */
export class EmptyWorkspaceSlot {
  readonly template = signal<TemplateRef<void> | null>(null);
}
