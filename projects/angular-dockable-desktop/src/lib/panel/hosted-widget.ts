/**
 * What a hosted panel renders (7.11, widgets out of the panel): the content element of the
 * managed widget it hosts. Internal.
 *
 * `PanelHost` creates this instead of a registered component for a panel with `owner`: there is
 * no registration to look up and nothing "unregistered" to report. Its host is the panel's own
 * `.ndd-panel-content` element, marked `.ndd-hosted-widget` (full size, `overflow: auto`, so it
 * scrolls as the widget's frame body does). The widget's component was created on its element by
 * its overlay, once, for the widget's whole life; this only shows the element.
 *
 * It follows the **element** the workspace's hosted-content registry holds for this panel id, not
 * just the id: a widget closed and re-opened out of the panel in one tick keeps the panel id (so
 * this component is not re-created) but brings a new element, which is the one shown. An element
 * leaves only if it is still here: whichever slot shows it next may already have taken it, so the
 * order of this one's cleanup and the next one's attach does not matter. rdd's `HostedWidgetSlot`.
 */
import { Component, DestroyRef, ElementRef, effect, inject, input, untracked } from '@angular/core';
import type { HostedContent, PanelDomCache } from './panel-dom';

@Component({ selector: 'ndd-hosted-widget', template: '' })
export class NddHostedWidget {
  /** The hosted panel's id. Set by `PanelHost`. */
  readonly panelId = input('');
  /** The workspace's panel DOM cache, which holds the hosted-content registry. Set by `PanelHost`. */
  readonly dom = input<PanelDomCache | null>(null);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    host.classList.add('ndd-hosted-widget');
    let shown: HostedContent | null = null;
    effect(() => {
      const content = this.dom()?.hostedContent(this.panelId()) ?? null;
      untracked(() => {
        if (shown && shown.el !== content?.el) shown.cache.leave(shown.el, host);
        if (content) content.cache.attach(content.el, host);
        shown = content;
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (shown) shown.cache.leave(shown.el, host);
    });
  }
}
