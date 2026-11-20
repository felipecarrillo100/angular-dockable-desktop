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
 *
 * A panel that keeps its embeds (`preserveEmbeds`, 7.11) must never be detached, so it is not left
 * to this directive: `PanelHost` parks it before a render that can destroy a slot, and puts it
 * back in the newest slot alive for it after the render (each slot registers itself for that).
 * Here, it moves in only once this slot is in the document, so the move keeps its embeds.
 */
import { Directive, ElementRef, inject, input } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { PanelHost } from './panel-host';
import { optionsFor } from '../core/panel-options';
import { moveIntoWhenConnected } from '../core/dom-move';

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
  private unregister: () => void = () => undefined;
  /** A move waiting for this slot to be in the document (`preserveEmbeds`); cancelled on destroy. */
  private cancel: () => void = () => undefined;

  ngOnInit(): void {
    this.id = this.nddPanelSlot();
    const { dom } = this.host;
    this.unregister = dom.registerSlot(this.id, this.el);
    this.cancel = moveIntoWhenConnected(this.el, dom.elementFor(this.id), () => {
      // Waited, and a newer slot took over meanwhile: that one shows the panel.
      if (!dom.has(this.id) || dom.newestSlot(this.id) !== this.el) return;
      const state = this.workspace.state();
      dom.moveTo(this.id, this.el, {
        refocus: state.activePanelId === this.id,
        preserveScroll: optionsFor(this.workspace.registry, state.panels[this.id])?.preserveScroll !== false,
      });
    });
  }

  ngOnDestroy(): void {
    this.cancel();
    this.unregister();
    if (this.host.dom.has(this.id) && this.host.dom.hostOf(this.id) === this.el) this.host.dom.moveTo(this.id, null);
  }
}
