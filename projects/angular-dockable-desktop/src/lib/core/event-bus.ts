/**
 * The inter-panel event bus.
 *
 * Panels are deliberately unaware of each other; this is how they communicate. It is a
 * domain feature, not DOM events, so it stays a workspace method rather than becoming
 * component `emits`.
 *
 * Framework-agnostic (ported verbatim from vdd): subscriptions made in an injection context
 * are disposed through `DestroyRef` by the Workspace wrapper, not by the bus itself.
 */

/** Events the library publishes itself. An application's own events are merged with these. */
export interface BuiltInEvents {
  'panel:opened': { id: string; component: string };
  'panel:closed': { id: string };
  'panel:minimized': { id: string };
  'panel:restored': { id: string };
  /** The globally active panel changed. The ordered channel for handing off between panels —
   *  an `effect()` on `injectPanel().isActive` sees the same change but not the ordering. */
  'panel:activated': { id: string | null; previous: string | null };
  /**
   * Anything `saveLayout()` would capture has changed: open, close, minimise, restore, a
   * dedupe redirect, and every placement change (dock, float, reorder, edge-dock, split
   * resize). Coalesced so an autosave needs one subscription.
   *
   * Does **not** fire when an `onSaveState` provider's own return value changes — that is a
   * pull, and nothing can observe it changing. Save on your own trigger too if it matters.
   */
  'layout:changed': Record<string, never>;
  /**
   * Fired from inside `saveLayout()`, only when that call excluded at least one panel whose
   * current props failed the serialisability check. A passive flag is not enough: nobody may
   * be looking at the moment something silently drops out of a snapshot.
   */
  'layout:panels-excluded': { panels: { id: string; component: string }[] };
}

type Listener = (data: unknown) => void;

export class EventBus<TEvents extends Record<string, unknown> = Record<string, unknown>> {
  private listeners = new Map<string, Set<Listener>>();

  subscribe<K extends keyof (TEvents & BuiltInEvents) & string>(
    event: K,
    callback: (data: (TEvents & BuiltInEvents)[K]) => void,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const listener = callback as Listener;
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  publish<K extends keyof (TEvents & BuiltInEvents) & string>(
    event: K,
    data: (TEvents & BuiltInEvents)[K],
  ): void {
    this.dispatch(event, data);
  }

  /**
   * Publish one of the library's own events.
   *
   * Separate from `publish` because `TEvents & BuiltInEvents` is not provably satisfied by a
   * built-in payload: an application could declare its own narrower type for a built-in key.
   * This path is typed against `BuiltInEvents` alone, so the library's own call sites are
   * checked properly instead of being cast.
   *
   * @internal
   */
  emit<K extends keyof BuiltInEvents & string>(event: K, data: BuiltInEvents[K]): void {
    this.dispatch(event, data);
  }

  private dispatch(event: string, data: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Iterate a copy: a listener that unsubscribes itself (or another) during dispatch must
    // not change the set being walked.
    for (const listener of Array.from(set)) listener(data);
  }

  /** Listener count for an event — for tests and diagnostics. */
  count(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Drop every listener. Called by `workspace.dispose()`. */
  clear(): void {
    this.listeners.clear();
  }
}
