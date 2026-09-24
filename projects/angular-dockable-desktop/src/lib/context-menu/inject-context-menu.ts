/**
 * Opening menus, and contributing to a panel's own menu.
 *
 *   // anywhere with an injection context:
 *   private readonly showMenu = injectContextMenu();
 *   onRightClick(event: MouseEvent) { this.showMenu({ event, items: [{ label: 'Rename', action: … }] }); }
 *
 *   // inside a panel: items appended to this panel's tab / title-bar / taskbar menu
 *   injectPanelContextMenu(() => [
 *     { label: 'Save', action: () => this.save() },
 *     { label: 'Revert', action: () => this.revert(), disabled: !this.dirty() },
 *   ]);
 *
 * The request is workspace state, so a service can open a menu too; `<ndd-context-menu>`
 * renders what is pending. Ported from vdd `useContextMenu.ts`.
 */
import { DestroyRef, Directive, inject, input } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { PANEL_CONTEXT } from '../panel/panel-ref';
import type { ContextMenuItem, ShowContextMenuOptions } from '../core/context-menu';

/** A function that opens a context menu. Call in an injection context. */
export function injectContextMenu(): (options: ShowContextMenuOptions) => void {
  const workspace = inject(Workspace);
  return (options) => workspace.showContextMenu(options);
}

/**
 * Contribute items to *this panel's* own context menu. Pass a getter: it is read each time the
 * menu opens, so items that enable, disable, check or disappear with the panel's state need no
 * extra wiring. Disposed with the component — nothing to unsubscribe. Outside a panel it does
 * nothing (with a development warning), so the component still renders standalone.
 */
export function injectPanelContextMenu(items: () => ContextMenuItem[]): void {
  const workspace = inject(Workspace);
  const panel = inject(PANEL_CONTEXT, { optional: true });
  if (!panel) {
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      console.warn(
        '[angular-dockable-desktop] injectPanelContextMenu() was called outside a panel, so it did ' +
          'nothing. This is expected when a panel component is rendered standalone.',
      );
    }
    return;
  }
  inject(DestroyRef).onDestroy(workspace.registerPanelMenu(panel.id, items));
}

/**
 * `[nddContextMenu]="items"` — open these items on right-click (or a long press's `contextmenu`)
 * over the host element. `items` may be an array or a getter, read at the moment of opening.
 */
@Directive({
  selector: '[nddContextMenu]',
  host: { '(contextmenu)': 'open($event)' },
})
export class NddContextMenuTrigger {
  readonly nddContextMenu = input.required<ContextMenuItem[] | (() => ContextMenuItem[])>();
  private readonly workspace = inject(Workspace);

  protected open(event: MouseEvent): void {
    const value = this.nddContextMenu();
    const items = typeof value === 'function' ? value() : value;
    if (!items.length) return;
    event.stopPropagation();
    this.workspace.showContextMenu({ event, items });
  }
}
