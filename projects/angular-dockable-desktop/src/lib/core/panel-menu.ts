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
import { isDropAllowed } from './dock-rules';
import type { Workspace } from '../workspace/workspace';

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
  /** For the docking rules (1.8.0): floating is a move they decide. */
  panels: Workspace<never>['panels'];
  registry: Workspace<never>['registry'];
  config: Workspace<never>['config'];
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
  // A hosted panel (a widget out of its panel, 7.11) has no built-in Float: the widget's own
  // titleMenu items, which lead its menu below, are what move it.
  const hosted = !!host.panels()[panelId]?.owner;
  if (!hosted && options.canDrag !== false && isDropAllowed(host, panelId, { kind: 'float', anchor: null }))
    items.push({ label: host.messages['floatWindow']!, action: actions.float });
  if (options.canMinimize !== false)
    items.push({
      label: host.messages['minimizePanel']!,
      action: actions.minimize,
    });
  if (items.length > 0 && options.canClose !== false) items.push({ separator: true });
  if (options.canClose !== false)
    items.push({ label: host.messages['closeTab']!, action: actions.close });
  if (hosted) {
    const contributed = host.panelMenuItems(panelId);
    return contributed.length === 0 ? items : [...contributed, { separator: true }, ...items];
  }
  return withPanelContributions(host, panelId, items);
}

/**
 * A floating window's ⋮ menu: what the panel contributed. For a hosted panel (7.11) that is its
 * widget's titleMenu items, then the built-in Close (no Minimize: the title bar has its own).
 * Empty when the panel contributed nothing, so the button is not shown.
 */
export function buildMoreActionsMenu(
  host: MenuHost,
  panelId: string,
  options: PanelDefaultOptions,
  close: () => void,
): ContextMenuItem[] {
  const contributed = host.panelMenuItems(panelId);
  if (contributed.length === 0) return [];
  if (!host.panels()[panelId]?.owner || options.canClose === false) return contributed;
  return [...contributed, { separator: true }, { label: host.messages['closePanel']!, action: close }];
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
  // A panel that was floating only goes back to floating; one from a group is floated, which the
  // rules decide (1.8.0).
  const wasFloating = host.panels()[panelId]?.previousState === 'floating';
  if (options.canDrag !== false && (wasFloating || isDropAllowed(host, panelId, { kind: 'float', anchor: null })))
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
