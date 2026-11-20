/**
 * One place that answers "what options does this open panel have": its kind's registration, or,
 * for a panel showing a widget moved out of its owner panel, the widget's own (rdd 7.11.0).
 *
 * Every lookup of an open panel's options by its component goes through here, core and components
 * alike, so a hosted panel's own `canFloat` / `canDock` apply everywhere the user's rules are
 * checked. `openPanel` reads a kind that isn't open yet straight from the registry.
 * @internal
 */
import type { PanelInfo } from './types';
import type { PanelDefaultOptions, PanelRegistry } from './registry';

/**
 * The component key of a panel that shows a managed widget moved out of its owner panel. Reserved:
 * such a panel has no registration, and its content is the widget's, mounted by its owner.
 */
export const HOSTED_COMPONENT = 'ndd:widget';

/** What a hosted panel can do whatever its widget says: close, minimise, be dragged; stay mounted. */
const HOSTED_BASE: PanelDefaultOptions = { canDrag: true, canClose: true, canMinimize: true, keepAlive: true };

/**
 * The options that apply to an open panel. For an ordinary panel, its kind's registration; for a
 * hosted panel, the base above plus the widget's `canFloat` / `canDock` (both `false` unless the
 * widget allows them). `component` is the fallback for an id that is no longer in `state.panels`
 * (a minimised entry keeps its own copy). `undefined` when nothing is registered: callers that
 * want an object add `?? {}`.
 */
export function optionsFor(
  registry: Pick<PanelRegistry, 'get'>,
  panel: PanelInfo | undefined,
  component?: string,
): PanelDefaultOptions | undefined {
  if (panel?.owner) {
    return {
      ...HOSTED_BASE,
      canFloat: panel.owner.options?.canFloat ?? false,
      canDock: panel.owner.options?.canDock ?? false,
    };
  }
  const key = panel?.component ?? component;
  return key === undefined ? undefined : registry.get(key)?.defaultOptions;
}
