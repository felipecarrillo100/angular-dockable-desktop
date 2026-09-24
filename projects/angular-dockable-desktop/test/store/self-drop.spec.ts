/** Ported from vue-dockable-desktop `test/store/selfDrop.test.ts` — driving code converted to Angular by scripts/port/convert.py, then reviewed; assertions and test names unchanged unless a comment says otherwise (ADR 0009). */
/**
 * Dropping a panel onto its own group.
 *
 * The bug, reported against react-dockable-desktop and present here in a different shape:
 * with **one** docked panel, dragging it onto its own group's drop cross left the panel in
 * *no* group at all — `state: 'docked'`, no tab, nothing rendered — because detaching it
 * deleted the leaf the drop was aimed at, and the split then had no target to find. rdd's
 * variant duplicated the panel instead; the cause is the same, and so is the rule:
 *
 *   a panel in state `docked` appears in exactly one leaf, and no leaf lists a panel that
 *   another leaf also lists.
 *
 * SD1: a lone panel dropped on its own group is a no-op — every direction, and the centre
 * SD2: ...and its own tab strip, and the workspace edge
 * SD3: the panel stays reachable: docked, tabbed, active
 * SD4: real drops still work — the guard must not block them
 * SD5: a target group that no longer exists never costs the panel its place
 * SD6: an emptied root leaf keeps its own identity
 * SD7: `openPanel` docks a panel again if it somehow ends up in no group
 */
import { Component } from '@angular/core';
import { describe, it, expect, vi } from 'vitest';
import type { WritableSignal } from '@angular/core';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { WorkspaceState } from '../../src/lib/workspace/workspace';
import type { LayoutNode } from '../../src/lib/core/types';

@Component({ selector: 'ndd-test-mock-panel', template: '' })
class P {}

/** One docked panel, alone in a leaf whose id is *not* the reusable `group-default`. */
const LONE = JSON.stringify({
  version: 2,
  gridRoot: { type: 'leaf', id: 'group-solo', panels: ['alpha'], activePanelId: 'alpha' },
  floating: [],
  minimized: [],
  panels: { alpha: { id: 'alpha', title: 'Alpha', component: 'panel', state: 'docked' } },
  activePanelId: 'alpha',
});

const TWO = JSON.stringify({
  version: 2,
  gridRoot: { type: 'leaf', id: 'group-solo', panels: ['alpha', 'beta'], activePanelId: 'alpha' },
  floating: [],
  minimized: [],
  panels: {
    alpha: { id: 'alpha', title: 'Alpha', component: 'panel', state: 'docked' },
    beta: { id: 'beta', title: 'Beta', component: 'panel', state: 'docked' },
  },
  activePanelId: 'alpha',
});

const ws = (initialState: string) =>
  createWorkspace({ panels: { panel: { component: P } }, initialState });

const leaves = (node: LayoutNode): { id: string; panels: string[]; active: string | null }[] =>
  node.type === 'leaf'
    ? [{ id: node.id, panels: [...node.panels], active: node.activePanelId }]
    : node.children.flatMap(leaves);

/** The invariant both shapes of the bug violated. */
function expectSoundLayout(workspace: ReturnType<typeof createWorkspace>): void {
  const placed = leaves(workspace.state().gridRoot).flatMap((l) => l.panels);
  expect(new Set(placed).size).toBe(placed.length);
  for (const panel of Object.values(workspace.state().panels)) {
    if (panel.state !== 'docked') continue;
    expect(placed.filter((id) => id === panel.id)).toHaveLength(1);
  }
}

describe('SD1: a lone panel dropped on its own group', () => {
  for (const position of ['left', 'right', 'top', 'bottom', 'center'] as const) {
    it(`is a no-op for "${position}"`, () => {
      const w = ws(LONE);
      w.dockPanelToGroup('alpha', 'group-solo', position);
      expect(leaves(w.state().gridRoot)).toEqual([
        { id: 'group-solo', panels: ['alpha'], active: 'alpha' },
      ]);
      expectSoundLayout(w);
    });
  }
});

describe('SD2: the other targets that reach the same actions', () => {
  it('its own tab strip is a no-op', () => {
    const w = ws(LONE);
    w.movePanelOrder('alpha', 'group-solo', 0);
    expect(leaves(w.state().gridRoot)).toEqual([
      { id: 'group-solo', panels: ['alpha'], active: 'alpha' },
    ]);
    expectSoundLayout(w);
  });

  it('the workspace edge is a no-op for the only docked panel', () => {
    const w = ws(LONE);
    w.dockPanelToWorkspaceEdge('alpha', 'right');
    expect(leaves(w.state().gridRoot)).toEqual([
      { id: 'group-solo', panels: ['alpha'], active: 'alpha' },
    ]);
    expectSoundLayout(w);
  });

  it('...and leaves no empty group behind, which is what it used to do', () => {
    const w = ws(LONE);
    w.dockPanelToWorkspaceEdge('alpha', 'right');
    expect(leaves(w.state().gridRoot).filter((l) => l.panels.length === 0)).toEqual([]);
  });
});

describe('SD3: the panel stays reachable', () => {
  it('is still docked and still active after a self-drop', () => {
    const w = ws(LONE);
    w.dockPanelToGroup('alpha', 'group-solo', 'right');
    expect(w.state().panels['alpha']!.state).toBe('docked');
    expect(w.state().activePanelId).toBe('alpha');
    expect(w.isOpen('alpha')).toBe(true);
  });
});

describe('SD4: real drops still work', () => {
  it('two panels: dropping one on its group splits it', () => {
    const w = ws(TWO);
    w.dockPanelToGroup('alpha', 'group-solo', 'right');
    const result = leaves(w.state().gridRoot);
    expect(result).toHaveLength(2);
    expect(result.map((l) => l.panels)).toEqual([['beta'], ['alpha']]);
    expectSoundLayout(w);
  });

  it('two panels: the workspace edge still docks', () => {
    const w = ws(TWO);
    w.dockPanelToWorkspaceEdge('alpha', 'bottom');
    expect(leaves(w.state().gridRoot)).toHaveLength(2);
    expectSoundLayout(w);
  });

  it('two panels: reordering within the strip still moves the tab', () => {
    const w = ws(TWO);
    w.movePanelOrder('alpha', 'group-solo', 1);
    expect(leaves(w.state().gridRoot)[0]!.panels).toEqual(['beta', 'alpha']);
    expectSoundLayout(w);
  });

  it('a panel dropped on a *different* group still lands there', () => {
    const w = ws(TWO);
    w.dockPanelToGroup('alpha', 'group-solo', 'right');
    const target = leaves(w.state().gridRoot).find((l) => l.panels.includes('alpha'))!;
    w.dockPanelToGroup('beta', target.id, 'center');
    expect(
      leaves(w.state().gridRoot)
        .find((l) => l.id === target.id)!
        .panels.sort(),
    ).toEqual(['alpha', 'beta']);
    expectSoundLayout(w);
  });
});

describe('SD5: a target group that no longer exists', () => {
  it('dockPanelToGroup leaves the panel where it is, and says why', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = ws(LONE);
    w.dockPanelToGroup('alpha', 'group-ghost', 'right');
    expect(leaves(w.state().gridRoot)).toEqual([
      { id: 'group-solo', panels: ['alpha'], active: 'alpha' },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no group with that id'));
    expectSoundLayout(w);
    warn.mockRestore();
  });

  it('movePanelOrder leaves the panel where it is', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = ws(LONE);
    w.movePanelOrder('alpha', 'group-ghost', 0);
    expect(leaves(w.state().gridRoot)).toEqual([
      { id: 'group-solo', panels: ['alpha'], active: 'alpha' },
    ]);
    expectSoundLayout(w);
    warn.mockRestore();
  });
});

describe('SD5b: a refused placement changes nothing at all', () => {
  it('publishes no layout:changed, since the layout did not change', () => {
    const w = ws(LONE);
    let changes = 0;
    w.subscribe('layout:changed', () => {
      changes++;
    });
    w.dockPanelToGroup('alpha', 'group-solo', 'right');
    w.movePanelOrder('alpha', 'group-solo', 0);
    w.dockPanelToWorkspaceEdge('alpha', 'left');
    expect(changes).toBe(0);
  });

  it('...while a placement that does change the layout still publishes', () => {
    const w = ws(TWO);
    let changes = 0;
    w.subscribe('layout:changed', () => {
      changes++;
    });
    w.dockPanelToGroup('alpha', 'group-solo', 'right');
    expect(changes).toBe(1);
  });
});

describe('SD6: an emptied root leaf keeps its identity', () => {
  it('floating the only panel leaves the same leaf, not a fresh group-default', () => {
    const w = ws(LONE);
    w.floatPanel('alpha');
    expect(leaves(w.state().gridRoot)).toEqual([{ id: 'group-solo', panels: [], active: null }]);
  });

  it('a root leaf that asked to stay keeps keepOnEmpty through the collapse', () => {
    const w = createWorkspace({
      panels: { panel: { component: P } },
      initialState: JSON.stringify({
        version: 2,
        gridRoot: {
          type: 'leaf',
          id: 'group-solo',
          panels: ['alpha'],
          activePanelId: 'alpha',
          keepOnEmpty: true,
        },
        floating: [],
        minimized: [],
        panels: { alpha: { id: 'alpha', title: 'Alpha', component: 'panel', state: 'docked' } },
        activePanelId: 'alpha',
      }),
    });
    w.closePanel('alpha');
    const root = w.state().gridRoot;
    expect(root.type).toBe('leaf');
    expect(root.type === 'leaf' && root.id).toBe('group-solo');
    expect(root.type === 'leaf' && root.keepOnEmpty).toBe(true);
  });
});

describe('SD7: openPanel recovers a panel that is in no group', () => {
  it('docks it again instead of only focusing it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = ws(
      JSON.stringify({
        version: 2,
        gridRoot: { type: 'leaf', id: 'group-solo', panels: [], activePanelId: null },
        floating: [],
        minimized: [],
        panels: {},
        activePanelId: null,
      }),
    );
    // The state the bug produced: open, docked, in no leaf. With the guards in place nothing
    // reaches it any more, and loading such a layout repairs it — so the only way to exercise
    // the safety net is to write the state directly. `state` is readonly to consumers; the
    // cast is the test reaching past that, deliberately.
    (w as unknown as { _state: WritableSignal<WorkspaceState> })._state.update((s) => ({
      ...s,
      panels: {
        alpha: { id: 'alpha', title: 'Alpha', component: 'panel', state: 'docked' },
      } as unknown as WorkspaceState['panels'],
    }));
    w.openPanel('alpha', 'panel');
    expect(leaves(w.state().gridRoot)).toEqual([
      { id: 'group-solo', panels: ['alpha'], active: 'alpha' },
    ]);
    expect(w.state().activePanelId).toBe('alpha');
    expectSoundLayout(w);
    warn.mockRestore();
  });
});
