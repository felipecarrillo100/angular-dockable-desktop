/**
 * `[nddPortal]` — move this element to `document.body` for as long as it exists.
 *
 * For chrome that must escape its ancestors' clipping and stacking: a hover preview, a menu, a
 * flyout. `position: fixed` alone is not enough — an ancestor with `transform`, `filter` or
 * `backdrop-filter` (the glassy taskbar has one) becomes the fixed element's containing block
 * and clips it. The element stays in Angular's view; only its DOM parent changes, and Angular's
 * renderer removes it with `node.remove()` wherever it is. The Angular counterpart of vdd's
 * `<Teleport to="body">`.
 * @internal
 */
import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';

@Directive({ selector: '[nddPortal]' })
export class NddPortal implements OnInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);

  ngOnInit(): void {
    this.doc.body.appendChild(this.el);
  }

  ngOnDestroy(): void {
    this.el.remove();
  }
}
