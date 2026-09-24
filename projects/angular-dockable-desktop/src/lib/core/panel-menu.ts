/**
 * The standard menus the library offers for a panel.
 *
 * Built here rather than in a component so the same menu is offered wherever a panel is
 * right-clicked — a tab, a floating window's title bar, a taskbar icon — and so the item
 * set is testable without rendering anything.
 */
import type { ContextMenuItem } from './context-menu';
import type { PanelDefaultOptions } from './registry';
import type { Label, MessageDescriptor } from './types';

/**
 * Just enough of the workspace to build a menu, so this module does not depend on the store.
 *
 * `format` takes `Label | undefined`, matching the workspace exactly: widening it to
 * `unknown` looks harmless but breaks assignability, since a function accepting a narrow
 * type cannot stand in for one accepting anything.
 */
interface MenuHost {
  format: (label: Label | undefined) => string;
  messages: Record<string, MessageDescriptor>;
  panelMenuItems: (id: string) => ContextMenuItem[];
}

export interface PanelMenuActions {
  float: () => void;
  minimize: () => void;
  close: () => void;
  restore: () => void;
  maximize: () => void;
}

/**
 * The menu for a docked tab or a floating window.
 *
 * Entries the panel forbids are absent rather than disabled: an action a panel has opted out
 * of is not a temporarily unavailable action, it is not an action at all.
 */
export function buildPanelMenu(
  host: MenuHost,
  panelId: string,
  options: PanelDefaultOptions,
  actions: PanelMenuActions,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (options.canDrag !== false)
    items.push({ label: host.messages['floatWindow']!, action: actions.float });
  if (options.canMinimize !== false)
    items.push({
      label: host.messages['minimizePanel']!,
      action: actions.minimize,
    });
  if (items.length > 0 && options.canClose !== false) items.push({ separator: true });
  if (options.canClose !== false)
    items.push({ label: host.messages['closeTab']!, action: actions.close });
  return withPanelContributions(host, panelId, items);
}

/**
 * The menu for a minimised panel's taskbar icon.
 *
 * "Maximize" works here. rdd offered the same item but its `maximizePanel` only mapped over
 * floating windows, where a minimised panel is not — so the item did nothing at all
 * (divergence D1). Restoring first is what makes it mean something.
 */
export function buildTaskbarMenu(
  host: MenuHost,
  panelId: string,
  options: PanelDefaultOptions,
  actions: PanelMenuActions,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: host.messages['restorePanel']!, action: actions.restore },
  ];
  if (options.canDrag !== false)
    items.push({
      label: host.messages['maximizePanel']!,
      action: actions.maximize,
    });
  if (options.canClose !== false) {
    items.push({ separator: true });
    items.push({ label: host.messages['closePanel']!, action: actions.close });
  }
  return withPanelContributions(host, panelId, items);
}

/** Append whatever the panel itself contributed, behind a separator. */
function withPanelContributions(
  host: MenuHost,
  panelId: string,
  items: ContextMenuItem[],
): ContextMenuItem[] {
  const contributed = host.panelMenuItems(panelId);
  if (contributed.length === 0) return items;
  return items.length > 0 ? [...items, { separator: true }, ...contributed] : [...contributed];
}
