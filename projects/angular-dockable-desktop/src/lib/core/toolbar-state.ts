/**
 * Toolbar selection state: which item is active in each radio group, and which toggles are on.
 *
 * On the workspace, so it needs no provider and is reachable from anywhere — including a
 * service. Every item can instead be *controlled* by the caller, in which case none of this is
 * consulted for it. Reads are signal reads, so templates and `computed()` track them.
 */
import { signal } from '@angular/core';

export interface ToolbarState {
  /** The active item in a radio group, or `null`. Reactive. */
  activeInGroup: (group: string) => string | null;
  /** Set the active item in a group. `null` clears it. */
  setActiveInGroup: (group: string, id: string | null) => void;
  /** Whether a toggle is on. Reactive. */
  isToggled: (id: string) => boolean;
  /** Set a toggle explicitly. */
  setToggled: (id: string, on: boolean) => void;
  /** Flip a toggle. */
  toggle: (id: string) => void;
}

export function createToolbarState(): ToolbarState {
  const groups = signal<Readonly<Record<string, string | null>>>({});
  const toggles = signal<Readonly<Record<string, boolean>>>({});
  return {
    activeInGroup: group => groups()[group] ?? null,
    setActiveInGroup: (group, id) => groups.update(g => ({ ...g, [group]: id })),
    isToggled: id => toggles()[id] === true,
    setToggled: (id, on) => toggles.update(t => ({ ...t, [id]: on })),
    toggle: id => toggles.update(t => ({ ...t, [id]: !t[id] })),
  };
}
