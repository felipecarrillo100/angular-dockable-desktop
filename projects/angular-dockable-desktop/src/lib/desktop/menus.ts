/**
 * The standard panel menus, bound to a workspace: the same items wherever a panel is
 * right-clicked — a tab, a floating window's title bar, a taskbar icon.
 * @internal
 */
import type { Workspace } from '../workspace/workspace';
import { buildMoreActionsMenu, buildPanelMenu, buildTaskbarMenu } from '../core/panel-menu';
import type { PanelMenuActions, PopOutMenu } from '../core/panel-menu';
import type { ContextMenuItem } from '../core/context-menu';
import { optionsFor } from '../core/panel-options';

function actionsFor(ws: Workspace<never>, id: string): PanelMenuActions {
  return {
    float: () => ws.floatPanel(id),
    minimize: () => ws.minimizePanel(id),
    close: () => void ws.requestClosePanel(id),
    restore: () => ws.restorePanel(id),
    maximize: () => ws.maximizePanel(id),
  };
}

/** The menu for a docked tab or a floating window; with `popOut`, "Open in new window" too (1.12.0). */
export function panelMenu(ws: Workspace<never>, id: string, popOut?: PopOutMenu): ContextMenuItem[] {
  if (!ws.state().panels[id]) return [];
  return buildPanelMenu(ws, id, optionsFor(ws.registry, ws.state().panels[id]) ?? {}, actionsFor(ws, id), popOut);
}

/**
 * A floating window's ⋮ menu: the panel's own items; a hosted panel's end with Close (7.11). With
 * `popOut`, led by "Open in new window" (1.12.0).
 */
export function moreActionsMenu(ws: Workspace<never>, id: string, popOut?: PopOutMenu): ContextMenuItem[] {
  if (!ws.state().panels[id]) return [];
  return buildMoreActionsMenu(ws, id, optionsFor(ws.registry, ws.state().panels[id]) ?? {}, () => void ws.requestClosePanel(id), popOut);
}

/** The menu for a minimised panel's taskbar icon (vdd D1: its Maximize works). */
export function taskbarMenu(ws: Workspace<never>, id: string): ContextMenuItem[] {
  if (!ws.state().panels[id]) return [];
  return buildTaskbarMenu(ws, id, optionsFor(ws.registry, ws.state().panels[id]) ?? {}, actionsFor(ws, id));
}

/**
 * Open a menu if it has anything in it. A click from the keyboard (Enter or Space on a button,
 * `detail` 0) opens it on its first item; otherwise the menu itself takes focus.
 */
export function openMenu(ws: Workspace<never>, event: MouseEvent | PointerEvent, items: ContextMenuItem[]): void {
  if (items.length === 0) return;
  const fromKeyboard = event.type === 'click' && event.detail === 0;
  ws.showContextMenu({ event, items, ...(fromKeyboard ? { initialFocus: 'first-item' as const } : {}) });
}
