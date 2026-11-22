/**
 * `[nddPortal]` — move this element to a document's `<body>` for as long as it exists.
 *
 * For chrome that must escape its ancestors' clipping and stacking: a hover preview, a menu, a
 * flyout. `position: fixed` alone is not enough — an ancestor with `transform`, `filter` or
 * `backdrop-filter` (the glassy taskbar has one) becomes the fixed element's containing block
 * and clips it. The element stays in Angular's view; only its DOM parent changes, and Angular's
 * renderer removes it with `node.remove()` wherever it is. The Angular counterpart of vdd's
 * `<Teleport to="body">`.
 *
 * Which body (1.12.0): the input names a document, or a node of one, whose `<body>` takes the
 * element, so chrome opened from a pop-out window shows in that window. It is read once, when the
 * element is created: a menu or a flyout chooses its document per open. Left empty
 * (`<div nddPortal>`), it is the main document's, as before.
 * @internal
 */
import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, InjectionToken, inject, input } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { docOf } from '../core/dom-context';

/**
 * @internal Where a `[nddPortal]` goes instead of its document's `<body>` (1.12.0): the element
 * projected into the app's `popoutWrapper` (`*nddPopoutWrap`), when it is in that document.
 */
export const NDD_PORTAL_INTO = new InjectionToken<Element>('ndd-portal-into');

@Directive({ selector: '[nddPortal]' })
export class NddPortal implements OnInit, OnDestroy {
  /** The document (or a node of it) whose body this element goes into; the main one when empty. */
  readonly nddPortal = input<Document | Node | null | undefined | ''>(null);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);
  private readonly into = inject(NDD_PORTAL_INTO, { optional: true });

  ngOnInit(): void {
    const target = this.nddPortal();
    const doc = target ? docOf(target) : this.doc;
    // Inside the app's popoutWrapper for this document: into the element it is around.
    (this.into && this.into.ownerDocument === doc ? this.into : doc.body).appendChild(this.el);
  }

  ngOnDestroy(): void {
    this.el.remove();
  }
}
