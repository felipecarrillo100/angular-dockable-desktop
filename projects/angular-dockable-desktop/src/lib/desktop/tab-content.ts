/**
 * The app's own tab content (1.9.0): an `<ng-template nddTabContent let-tab>` inside
 * `<ndd-desktop>`, rendered inside each grid tab in place of the built-in icon, title and dirty
 * marker. The tab element itself (dragging, keyboard, accessibility, its menu, the close button)
 * stays the library's.
 *
 * The desktop finds it with `contentChild` and hands it to every group through
 * {@link TabContentSlot}, as it does the empty-workspace template.
 */
import { Directive, TemplateRef, inject, signal } from '@angular/core';
import type { TabContentProps } from '../core/types';

/** The context of an `nddTabContent` template: `let-tab` is the tab's {@link TabContentProps}. */
export interface TabContentContext {
  $implicit: TabContentProps;
}

/** Marks the template `<ndd-desktop>` renders inside each grid tab. */
@Directive({ selector: 'ng-template[nddTabContent]' })
export class NddTabContentTemplate {
  readonly template = inject<TemplateRef<TabContentContext>>(TemplateRef);

  /** Types `let-tab` in the app's template. */
  static ngTemplateContextGuard(_dir: NddTabContentTemplate, _ctx: unknown): _ctx is TabContentContext {
    return true;
  }
}

/** @internal — one per `<ndd-desktop>`, provided in its `providers`. */
export class TabContentSlot {
  readonly template = signal<TemplateRef<TabContentContext> | null>(null);
}
