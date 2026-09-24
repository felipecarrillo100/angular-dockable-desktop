/** Ported from vue-dockable-desktop `test/store/stateTransitions.test.ts` — driving code converted to Angular by scripts/port/convert.py, then reviewed; assertions and test names unchanged unless a comment says otherwise (ADR 0009). */
/**
 * Ported from react-dockable-desktop `StateTransitions.test.tsx` (34 tests), names preserved,
 * plus the regression tests for the defects vdd fixes (PARITY.md §4, D1–D4).
 *
 * The `activePanelId` invariant block is the most valuable thing in rdd's whole suite: it
 * guards a family of bugs where a panel the user could not see stayed globally active, so
 * contributed toolbar controls acted on the wrong panel while appearing to work.
 * The onActivate/onDeactivate test becomes an event-ordering test here
 * (docs/decisions/0006-refs-over-subscriptions.md).
 */
import { Component } from '@angular/core';
import { describe, it, expect } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { LayoutNode } from '../../src/lib/core/types';
import { findLeafForPanel } from '../../src/lib/core/layout-tree';

@Component({ selector: 'ndd-test-mock-panel', template: '' })
class P {}

/** Two leaves, so a leaf can be destroyed without emptying the grid. */
const STANDARD = JSON.stringify({
  version: 2,
  gridRoot: {
    type: 'branch',
    orientation: 'vertical',
    sizes: [0.75, 0.25],
    children: [
      { type: 'leaf', id: 'group-left-top', panels: [], activePanelId: null },
      { type: 'leaf', id: 'group-left-bottom', panels: [], activePanelId: null },
    ],
  },
  floating: [],
  minimized: [],
  panels: {},
});

const ws = (initialState: string | undefined = STANDARD) =>
  createWorkspace({
    panels: {
      map: { component: P },
      nondrag: { component: P, defaultOptions: { canDrag: false } },
      keep: { component: P, defaultOptions: { canClose: false } },
    },
    ...(initialState ? { initialState } : {}),
  });

describe('WindowManager State Transitions', () => {
  const scenarios = [
    { start: 'docked', to: 'floating', then: 'docked' },
    { start: 'docked', to: 'minimized', then: 'docked' },
    { start: 'floating', to: 'minimized', then: 'floating' },
    { start: 'floating', to: 'docked', then: 'floating' },
  ] as const;
  const variants = ['default', 'custom-title'] as const;

  scenarios.forEach((scenario, sIdx) => {
    variants.forEach((variant) => {
      it(`[Scenario ${sIdx} - ${variant}] should transition panel from ${scenario.start} to ${scenario.to} then to ${scenario.then}`, () => {
        const w = ws();
        const id = 'transition-panel';
        w.openPanel(id, 'map', {
          initialTarget: scenario.start,
          ...(variant === 'custom-title' ? { title: 'Custom Title' } : {}),
        });

        const go = (to: typeof scenario.to | typeof scenario.then) => {
          if (to === 'floating') w.floatPanel(id);
          else if (to === 'minimized') w.minimizePanel(id);
          else w.dockPanel(id);
        };

        go(scenario.to);
        expect(w.state().panels[id]!.state).toBe(scenario.to);
        go(scenario.then);
        expect(w.state().panels[id]!.state).toBe(scenario.then);
      });
    });
  });
});

describe('Minimized restore fallback behavior', () => {
  it('should restore as floating if the original leaf group ceased to exist and canDrag is true', () => {
    const w = ws();
    w.openPanel('fallback-test-panel', 'map');
    w.minimizePanel('fallback-test-panel');
    expect(w.state().panels['fallback-test-panel']!.state).toBe('minimized');
    w.closeLeafGroup('group-left-top');
    w.restorePanel('fallback-test-panel');
    expect(w.state().panels['fallback-test-panel']!.state).toBe('floating');
  });

  it('should restore as docked fallback if leaf group ceased to exist but canDrag is false', () => {
    const w = ws();
    w.openPanel('fallback-nondrag-panel', 'nondrag');
    w.minimizePanel('fallback-nondrag-panel');
    w.closeLeafGroup('group-left-top');
    w.restorePanel('fallback-nondrag-panel');
    expect(w.state().panels['fallback-nondrag-panel']!.state).toBe('docked');
  });

  it('restores into its original leaf when that leaf still exists', () => {
    const w = ws();
    w.openPanel('keeper', 'map');
    // A second panel must stay in the target leaf, or minimising `p` empties it and the leaf
    // is removed — in which case floating is the correct restore, not a bug.
    w.openPanel('leafKeeper', 'map');
    w.dockPanelToGroup('leafKeeper', 'group-left-bottom', 'center');
    w.openPanel('p', 'map');
    w.dockPanelToGroup('p', 'group-left-bottom', 'center');
    expect(findLeafForPanel(w.state().gridRoot, 'p')).toBe('group-left-bottom');
    w.minimizePanel('p');
    w.restorePanel('p');
    expect(findLeafForPanel(w.state().gridRoot, 'p')).toBe('group-left-bottom');
  });

  it('restores a floating panel to its saved rect and anchor', () => {
    const w = ws();
    w.openPanel('f', 'map');
    w.floatPanel('f', { x: 111, y: 222, width: 333, height: 444 }, 'bottom-right');
    w.minimizePanel('f');
    w.restorePanel('f');
    const win = w.state().floating.find((x) => x.id === 'f')!;
    expect({ w: win.width, h: win.height, anchor: win.anchor }).toEqual({
      w: 333,
      h: 444,
      anchor: 'bottom-right',
    });
  });
});

describe('openPanel() activation (focus) behavior', () => {
  it('sets activePanelId when opening a brand-new docked panel', () => {
    const w = ws();
    expect(w.state().activePanelId).toBeNull();
    w.openPanel('new-docked', 'map');
    expect(w.state().activePanelId).toBe('new-docked');
  });

  it('sets activePanelId when opening a brand-new floating panel', () => {
    const w = ws();
    w.openPanel('new-floating', 'map', { initialTarget: 'floating' });
    expect(w.state().activePanelId).toBe('new-floating');
  });

  it('sets activePanelId when opening (restoring) an already-minimized panel', () => {
    const w = ws();
    w.openPanel('to-minimize', 'map');
    w.minimizePanel('to-minimize');
    w.openPanel('other', 'map');
    expect(w.state().activePanelId).toBe('other');
    w.openPanel('to-minimize', 'map');
    expect(w.state().panels['to-minimize']!.state).not.toBe('minimized');
    expect(w.state().activePanelId).toBe('to-minimize');
  });

  it('sets activePanelId when re-opening an already-open docked panel', () => {
    const w = ws();
    w.openPanel('a', 'map');
    w.openPanel('b', 'map');
    expect(w.state().activePanelId).toBe('b');
    w.openPanel('a', 'map');
    expect(w.state().activePanelId).toBe('a');
  });

  it('{ focus: false } opens the panel without changing activePanelId', () => {
    const w = ws();
    w.openPanel('first', 'map');
    w.openPanel('background', 'map', { focus: false });
    expect(w.isOpen('background')).toBe(true);
    expect(w.state().activePanelId).toBe('first');
  });
});

describe('Workspace outer edge drop zones', () => {
  const edge = (position: 'left' | 'right' | 'top' | 'bottom') => {
    const w = ws();
    w.openPanel('a', 'map');
    w.openPanel('e', 'map');
    w.dockPanelToWorkspaceEdge('e', position);
    return w.state().gridRoot as {
      type: string;
      orientation: string;
      children: unknown[];
      sizes: number[];
    };
  };

  it('should split the root branch horizontally when a panel is docked to the left edge', () => {
    const root = edge('left');
    expect(root.orientation).toBe('horizontal');
    expect(JSON.stringify(root.children[0])).toContain('"e"');
    expect(root.sizes[0]).toBeCloseTo(0.2);
  });

  it('should split the root branch horizontally when a panel is docked to the right edge', () => {
    const root = edge('right');
    expect(root.orientation).toBe('horizontal');
    expect(JSON.stringify(root.children[1])).toContain('"e"');
  });

  it('should split the root branch vertically when a panel is docked to the top edge', () => {
    const root = edge('top');
    expect(root.orientation).toBe('vertical');
    expect(JSON.stringify(root.children[0])).toContain('"e"');
  });

  it('should split the root branch vertically when a panel is docked to the bottom edge', () => {
    const root = edge('bottom');
    expect(root.orientation).toBe('vertical');
    expect(JSON.stringify(root.children[1])).toContain('"e"');
  });
});

describe('activePanelId invariant (close / minimize / restore / placement)', () => {
  const two = () => {
    const w = ws();
    w.openPanel('p1', 'map');
    w.openPanel('p2', 'map');
    expect(w.state().activePanelId).toBe('p2');
    return w;
  };

  it('closing the active panel activates whatever becomes visible', () => {
    const w = two();
    w.closePanel('p2');
    expect(w.state().activePanelId).toBe('p1');
  });

  it('closing the last panel clears activePanelId instead of leaving a stale id', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    w.closePanel('p1');
    expect(w.state().activePanelId).toBeNull();
  });

  it('closing a non-active panel leaves activePanelId alone', () => {
    const w = two();
    w.closePanel('p1');
    expect(w.state().activePanelId).toBe('p2');
  });

  it('minimizing the active panel moves active off the now-invisible panel', () => {
    const w = two();
    w.minimizePanel('p2');
    expect(w.state().panels['p2']!.state).toBe('minimized');
    expect(w.state().activePanelId).toBe('p1');
  });

  it('minimizing the only panel clears activePanelId', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    w.minimizePanel('p1');
    expect(w.state().activePanelId).toBeNull();
  });

  it('minimizing a non-active panel leaves activePanelId alone', () => {
    const w = two();
    w.focusPanel('p1');
    w.minimizePanel('p2');
    expect(w.state().activePanelId).toBe('p1');
  });

  it('minimizing the active panel emits panel:activated for its replacement', () => {
    // rdd asserted this through onDeactivate/onActivate callbacks; the equivalent guarantee
    // here is the ordered event, since watchers on `isActive` do not promise relative order.
    const w = two();
    const seen: { id: string | null; previous: string | null }[] = [];
    w.subscribe('panel:activated', (e) => seen.push(e));
    w.minimizePanel('p2');
    expect(seen).toEqual([{ id: 'p1', previous: 'p2' }]);
  });

  it('never activates a minimized panel, even when it is the only one', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    w.minimizePanel('p1');
    expect(w.state().activePanelId).toBeNull();
    expect(w.state().panels['p1']!.state).toBe('minimized');
  });

  it('honours an explicit focusPanel() on a minimized panel as a deliberate caller decision', () => {
    // Matches rdd: the invariant is about what the *library* chooses, not what a caller
    // insists on. This is why there is no blanket assert on the invariant.
    const w = two();
    w.minimizePanel('p2');
    w.focusPanel('p2');
    expect(w.state().activePanelId).toBe('p2');
  });

  it('restoring a minimized panel activates it (D2 family, fixed in rdd 6.2.0)', () => {
    const w = two();
    w.minimizePanel('p2');
    expect(w.state().activePanelId).toBe('p1');
    w.restorePanel('p2');
    expect(w.state().activePanelId).toBe('p2');
  });

  it('restorePanel({ focus: false }) restores without stealing focus', () => {
    const w = two();
    w.minimizePanel('p2');
    w.restorePanel('p2', { focus: false });
    expect(w.state().panels['p2']!.state).toBe('docked');
    expect(w.state().activePanelId).toBe('p1');
  });
});

describe('D2: every placement action resolves the active panel', () => {
  // rdd left activePanelId stale after all five of these, so the visibly selected tab could
  // render unfocused while a different panel was globally active, and contributed controls
  // bound to the wrong panel. Funnelled through one resolution point here.
  const setup = () => {
    const w = ws();
    w.openPanel('a', 'map');
    w.openPanel('b', 'map');
    expect(w.state().activePanelId).toBe('b');
    return w;
  };

  it('dockPanelToGroup activates the docked panel', () => {
    const w = setup();
    w.dockPanelToGroup('a', 'group-left-bottom', 'center');
    expect(w.state().activePanelId).toBe('a');
  });

  it('dockPanelToGroup with a split activates the docked panel', () => {
    const w = setup();
    w.dockPanelToGroup('a', 'group-left-bottom', 'right');
    expect(w.state().activePanelId).toBe('a');
  });

  it('floatPanel activates the floated panel', () => {
    const w = setup();
    w.floatPanel('a');
    expect(w.state().activePanelId).toBe('a');
  });

  it('dockPanel activates the docked panel', () => {
    const w = setup();
    w.floatPanel('a');
    w.focusPanel('b');
    w.dockPanel('a');
    expect(w.state().activePanelId).toBe('a');
  });

  it('dockPanelToWorkspaceEdge activates the docked panel', () => {
    const w = setup();
    w.dockPanelToWorkspaceEdge('a', 'bottom');
    expect(w.state().activePanelId).toBe('a');
  });

  it('movePanelOrder activates the moved panel', () => {
    const w = setup();
    w.movePanelOrder('a', 'group-left-bottom', 0);
    expect(w.state().activePanelId).toBe('a');
  });

  it('the leaf selection and the global active panel never disagree', () => {
    const w = setup();
    w.dockPanelToGroup('a', 'group-left-bottom', 'center');
    const leafId = findLeafForPanel(w.state().gridRoot, w.state().activePanelId!);
    const walk = (n: ReturnType<typeof w.state>['gridRoot']): string | null =>
      n.type === 'leaf'
        ? n.id === leafId
          ? n.activePanelId
          : null
        : n.children.reduce<string | null>((acc, c) => acc ?? walk(c), null);
    expect(walk(w.state().gridRoot)).toBe(w.state().activePanelId);
  });
});

describe('D1: maximize works on a minimized panel', () => {
  it('restores the panel, then maximizes it', () => {
    // rdd's taskbar context menu offered "Maximize" on a minimized panel; maximizePanel only
    // mapped over `floating`, where a minimized panel is not, so the item did nothing at all.
    const w = ws();
    w.openPanel('m', 'map');
    w.minimizePanel('m');
    w.maximizePanel('m');
    expect(w.state().panels['m']!.state).toBe('floating');
    expect(w.state().floating.find((x) => x.id === 'm')!.maximized).toBe(true);
    expect(w.state().minimized).toEqual([]);
  });

  it('maximizes a docked panel by floating it first', () => {
    const w = ws();
    w.openPanel('d', 'map');
    w.maximizePanel('d');
    expect(w.state().floating.find((x) => x.id === 'd')!.maximized).toBe(true);
  });

  it('toggles a maximized floating window back', () => {
    const w = ws();
    w.openPanel('f', 'map', { initialTarget: 'floating' });
    w.maximizePanel('f');
    expect(w.state().floating[0]!.maximized).toBe(true);
    w.maximizePanel('f');
    expect(w.state().floating[0]!.maximized).toBe(false);
  });
});

describe('D3: openPanel and restorePanel agree about where a minimized panel goes', () => {
  it('both return it to its original leaf, not the first leaf', () => {
    // rdd's openPanel used findFirstLeafId while restorePanel used lastLeafId, so the two
    // paths disagreed: verified against rdd, restorePanel -> 'R', openPanel -> 'L'.
    const make = () => {
      const w = ws();
      w.openPanel('keepL', 'map'); // holds group-left-top
      w.openPanel('keepR', 'map');
      w.dockPanelToGroup('keepR', 'group-left-bottom', 'center'); // holds group-left-bottom
      w.openPanel('p', 'map');
      w.dockPanelToGroup('p', 'group-left-bottom', 'center');
      expect(findLeafForPanel(w.state().gridRoot, 'p')).toBe('group-left-bottom');
      w.minimizePanel('p');
      return w;
    };
    const viaRestore = make();
    viaRestore.restorePanel('p');
    const viaOpen = make();
    viaOpen.openPanel('p', 'map');
    expect(findLeafForPanel(viaRestore.state().gridRoot, 'p')).toBe('group-left-bottom');
    expect(findLeafForPanel(viaOpen.state().gridRoot, 'p')).toBe('group-left-bottom');
  });
});

describe('D4: re-opening a minimized panel publishes the layout change', () => {
  it('publishes panel:restored and layout:changed', () => {
    // rdd gated its events on `isNew || isRedirect`, both false here, so an autosave
    // listening to layout:changed missed the change entirely.
    const w = ws();
    w.openPanel('p', 'map');
    w.minimizePanel('p');
    const seen: string[] = [];
    w.subscribe('panel:restored', () => seen.push('restored'));
    w.subscribe('layout:changed', () => seen.push('layout'));
    w.openPanel('p', 'map');
    expect(seen).toContain('restored');
    expect(seen).toContain('layout');
  });

  it('publishes layout:changed for every placement action', () => {
    const w = ws();
    w.openPanel('a', 'map');
    w.openPanel('b', 'map');
    let count = 0;
    w.subscribe('layout:changed', () => {
      count++;
    });
    w.floatPanel('a');
    w.dockPanel('a');
    w.dockPanelToGroup('a', 'group-left-bottom', 'center');
    w.dockPanelToWorkspaceEdge('a', 'top');
    // The edge dock moved `a` into a leaf of its own, which removed the one it came from, so
    // the reorder has to name a leaf that still exists. It used to name the removed one: the
    // call published a layout change while leaving `a` in no leaf at all, which is the bug
    // the guard in movePanelOrder now refuses. A refused placement publishes nothing.
    const leaves: { id: string; panels: string[] }[] = [];
    const walk = (n: LayoutNode) =>
      n.type === 'leaf' ? leaves.push({ id: n.id, panels: n.panels }) : n.children.forEach(walk);
    walk(w.state().gridRoot);
    w.movePanelOrder('a', leaves.find((l) => l.panels.includes('b'))!.id, 0);
    w.minimizePanel('a');
    w.restorePanel('a');
    w.closePanel('a');
    expect(count).toBe(8);
  });
});
