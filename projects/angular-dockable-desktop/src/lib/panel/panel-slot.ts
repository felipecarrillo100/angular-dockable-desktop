/**
 * A place a panel is shown: `<div [nddPanelSlot]="panelId">`.
 *
 * The directive's host is an empty box; on init it moves the panel's element into itself. The
 * panel's DOM is never a child of this directive in Angular's eyes — the panel host owns it —
 * so the slot can be created, destroyed and re-rendered freely without touching panel state.
 *
 * On destroy it parks the panel off-screen, **unless another slot has already claimed it** —
 * which is what happens when a panel moves from one leaf to another in the same render.
 * Angular removes this element before `ngOnDestroy` runs (ADR 0002 finding 1), so the panel
 * may be briefly detached; its scroll and focus survive through the live record.
 */
import { Directive, ElementRef, inject, input } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { PanelHost } from './panel-host';

@Directive({
  selector: '[nddPanelSlot]',
  host: { class: 'ndd-panel-slot', '[attr.data-ndd-slot]': 'nddPanelSlot()' },
})
export class NddPanelSlot implements OnInit, OnDestroy {
  /** The panel to show here. */
  readonly nddPanelSlot = input.required<string>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly host = inject(PanelHost);
  private readonly workspace = inject(Workspace) as Workspace<never>;
  private id = '';

  ngOnInit(): void {
    this.id = this.nddPanelSlot();
    const state = this.workspace.state();
    this.host.dom.moveTo(this.id, this.el, {
      refocus: state.activePanelId === this.id,
      preserveScroll: this.workspace.registry.get(state.panels[this.id]?.component ?? '')?.defaultOptions?.preserveScroll !== false,
    });
  }

  ngOnDestroy(): void {
    if (this.host.dom.has(this.id) && this.host.dom.hostOf(this.id) === this.el) this.host.dom.moveTo(this.id, null);
  }
}
