/**
 * Docking rules (1.8.0): what the *user* may do with a panel. The kind's own `canFloat` /
 * `canDock` first, then the workspace's `canDrop`. Never consulted by the app's own calls.
 */
import type { PanelDropTarget } from './types';
import type { Workspace } from '../workspace/workspace';

type RuleHost = Pick<Workspace<never>, 'panels' | 'registry' | 'config'>;

export function isDropAllowed(ws: RuleHost, panelId: string, to: PanelDropTarget): boolean {
  const panel = ws.panels()[panelId];
  if (!panel) return false;
  const options = ws.registry.get(panel.component)?.defaultOptions;
  if (to.kind === 'float') {
    // Blocks *becoming* floating; a window that already floats may still change corner.
    if (options?.canFloat === false && panel.state !== 'floating') return false;
  } else if (options?.canDock === false) {
    return false;
  }
  const canDrop = ws.config.canDrop;
  if (!canDrop) return true;
  try {
    return canDrop({ panelId, component: panel.component, to }) !== false;
  } catch (e) {
    console.error('[angular-dockable-desktop] canDrop threw; the move is allowed:', e);
    return true;
  }
}
