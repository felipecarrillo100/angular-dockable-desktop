/**
 * Where a managed widget's content is shown (7.11): `<div [nddWidgetContent]="el">`. Internal.
 *
 * The host is an empty box; the directive moves the widget's content element into it, as
 * `[nddPanelSlot]` does for a panel. The content's component was created on that element by the
 * overlay store, once for the widget's whole life, so this directive can be created and destroyed
 * freely without touching it.
 *
 * It follows the **element**, not the widget's id: a re-open with another component gives the id
 * a new element, and the slot shows that one. The owner of the frame's lifetime (the overlay)
 * gives the element back to the hidden store *before* a frame goes away while its widget stays
 * open, because Angular removes this box from the document before any destroy hook runs; the
 * destroy hook here is only the fallback, and takes the element only if it is still here.
 *
 * A `pointerdown` anywhere in the content is reported in the **capture** phase, so content that
 * stops the event (a map canvas) still raises its widget.
 */
import { DestroyRef, Directive, ElementRef, effect, inject, input, output, untracked } from '@angular/core';
import { PANEL_OVERLAY } from './overlay-store';

@Directive({ selector: '[nddWidgetContent]' })
export class NddWidgetContentSlot {
  /** The content element to show here. */
  readonly nddWidgetContent = input.required<HTMLElement>();
  /** A pointerdown anywhere inside, seen in the capture phase. */
  readonly contentPress = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly content = inject(PANEL_OVERLAY).content;

  constructor() {
    let shown: HTMLElement | null = null;
    effect(() => {
      const el = this.nddWidgetContent();
      untracked(() => {
        if (shown && shown !== el) this.content.leave(shown, this.host);
        this.content.attach(el, this.host);
        shown = el;
      });
    });
    const press = () => this.contentPress.emit();
    this.host.addEventListener('pointerdown', press, true);
    inject(DestroyRef).onDestroy(() => {
      this.host.removeEventListener('pointerdown', press, true);
      if (shown) this.content.leave(shown, this.host);
    });
  }
}
