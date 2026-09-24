/**
 * The standard panel menus, bound to a workspace: the same items wherever a panel is
 * right-clicked — a tab, a floating window's title bar, a taskbar icon.
 * @internal
 */
import type { Workspace } from '../workspace/workspace';
import { buildPanelMenu, buildTaskbarMenu } from '../core/panel-menu';
import type { PanelMenuActions } from '../core/panel-menu';
import type { ContextMenuItem } from '../core/context-menu';

function actionsFor(ws: Workspace<never>, id: string): PanelMenuActions {
  return {
    float: () => ws.floatPanel(id),
    minimize: () => ws.minimizePanel(id),
    close: () => void ws.requestClosePanel(id),
    restore: () => ws.restorePanel(id),
    maximize: () => ws.maximizePanel(id),
  };
}

const optionsFor = (ws: Workspace<never>, id: string) => {
  const panel = ws.state().panels[id];
  return (panel && ws.registry.get(panel.component)?.defaultOptions) || {};
};

/** The menu for a docked tab or a floating window. */
export function panelMenu(ws: Workspace<never>, id: string): ContextMenuItem[] {
  if (!ws.state().panels[id]) return [];
  return buildPanelMenu(ws, id, optionsFor(ws, id), actionsFor(ws, id));
}

/** The menu for a minimised panel's taskbar icon (vdd D1: its Maximize works). */
export function taskbarMenu(ws: Workspace<never>, id: string): ContextMenuItem[] {
  if (!ws.state().panels[id]) return [];
  return buildTaskbarMenu(ws, id, optionsFor(ws, id), actionsFor(ws, id));
}

/** Open a menu if it has anything in it. */
export function openMenu(ws: Workspace<never>, event: MouseEvent | PointerEvent, items: ContextMenuItem[]): void {
  if (items.length > 0) ws.showContextMenu({ event, items });
}
