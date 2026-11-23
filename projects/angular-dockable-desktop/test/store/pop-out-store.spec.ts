/**
 * Pop-out windows, the store side (1.12.0). Ported from vue-dockable-desktop
 * `test/store/popOutStore.test.ts` (113 tests, names unchanged), itself react-dockable-desktop
 * 7.12.1 `PopOut.test.tsx`: the cases that test the state, the return places and the save. A
 * popped-out panel is a floating panel with a flag. rdd drives it through a stubbed `window.open`;
 * with no windows registry yet (P2b), these drive the workspace's `setPoppedOut` /
 * `clearPoppedOut` directly, which is what rdd's windows call, and `returnPanel`, which falls back
 * to them. Driving code converted to TestBed: `nextTick` is `fixture.whenStable()`, `vdd-` is
 * `ndd-`, `toRaw(ws.state)` is `ws.state()`.
 *
 * XPO1:  disabled: 'disabled' and one warning; `popOut` is not on workspace.config
 * XPO2:  a type with canPopOut on a workspace without popOut warns, naming the types
 * XPO4:  a docked panel is floating with the flag, remembering its group; no frame in the workspace
 * XPO6:  where it returns: its group, beside its neighbour (both orientations), the empty grid,
 *        floating with a frame, the first group for a type that can't float; floating at its rect
 * XPO8:  the store tells the windows: closePanel, loadLayout, dockPanel; a minimized panel pops
 *        out from where it would restore
 * XPO9:  saveLayout writes the return place, without the flag; a loaded flag is ignored
 * XPO16: maximizePanel and floatPanel are ignored while out
 * XPO17: the hidden entry is left out of the cascade and the on-screen clamp
 * XPO20: placesBeside / returnBeside
 * XPO21: the edge case through the workspace
 * XPO22: minimizing while out returns it to its place first
 * XPO27, XPO27b, XPO28: neighbours out at once, live and saved
 * XPO29–XPO31: the whole grid; a kept-empty neighbour; the share is exact
 * XPO33–XPO36, XPO33b, XPO35b: every panel out, tabs of one group, tab order, distinct group
 *        ids, old sizes only in the old split
 * XPO37: the reviewer's matrix: 13 layouts × every set of 2 and 3 × every pop and return order,
 *        live and saved (1,332 cases)
 * XPO38–XPO43, XPO40b: group-default, sizes with a tab-mate out, only kept groups left, its own
 *        kept group, interleaved, a kept group standing in (D1), a minimized panel (D2)
 * XPO44 (vdd): neighbours out beside an empty group, locked to rdd 7.12.1's result (checked on
 *        rdd's own core); the parity lock for an empty kept group
 * XPO28b, XPO35c, XPO38b, XPO40c (vdd): the save order, the nearest mate, a refilled kept group,
 *        the empty-grid rule skipping a waiting group
 * XPOS1–XPOS4 (vdd): the public methods before a windows registry is bound, and their delegation
 */
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { PopOutWindowsBinding, Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import {
  findLeafForPanel,
  placesBeside,
  removePanelFromTree,
  returnBeside,
} from '../../src/lib/core/layout-tree';
import type { LayoutGridNode, LayoutLeafNode, LayoutNode } from '../../src/lib/core/types';

@Component({
  selector: 'ndd-test-po-counter',
  template: '<button class="po-count" [attr.data-id]="panelId()">0</button>',
})
class Counter {
  readonly panelId = input('');
}

let fixture: ComponentFixture<NddDesktop> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach((e) => e.remove());
  vi.restoreAllMocks();
});

const panels = {
  counter: { component: Counter, defaultOptions: { canPopOut: true } },
  fixed: { component: Counter, defaultOptions: { canPopOut: true, canFloat: false } },
  plain: { component: Counter },
};

/** rdd's `mount()`, without the provider: panels a and b in one group, a shown. */
function make(opts: { popOut?: boolean } = {}): Workspace {
  const ws = createWorkspace({ popOut: opts.popOut ?? true, panels });
  ws.openPanel('a', 'counter', { title: 'Alpha' });
  ws.openPanel('b', 'counter', { title: 'Beta' });
  ws.focusPanel('a');
  return ws;
}
/** The same workspace, rendered in an `<ndd-desktop>`. */
function makeMounted(): Workspace {
  const ws = make();
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  fixture = TestBed.createComponent(NddDesktop);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  return ws;
}
/** Lets the rendered desktop catch up (vdd's `nextTick`). */
const settle = async () => {
  await fixture!.whenStable();
  await fixture!.whenStable();
};
const out = (ws: Workspace, id: string) => {
  expect(ws.setPoppedOut(id)).toBe(true);
};
const leafOf = (ws: Workspace, id: string) => findLeafForPanel(ws.state().gridRoot, id);
const frame = (id: string) => document.querySelector(`[data-ndd-window="${id}"]`);
/** The live state as JSON: what "the save didn't touch the live state" compares. */
const liveJson = (ws: Workspace) => JSON.stringify(ws.state());

describe('XPO1: disabled', () => {
  it('refuses with "disabled" and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = make({ popOut: false });
    expect(ws.popOutPanel('a')).toEqual({ ok: false, reason: 'disabled' });
    expect(ws.popOutPanel('a')).toEqual({ ok: false, reason: 'disabled' });
    expect(ws.setPoppedOut('a')).toBe(false);
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes('popOutPanel("a") was refused')),
    ).toHaveLength(1);
  });

  it('is not on workspace.config (rdd S2.1)', () => {
    expect('popOut' in createWorkspace({ popOut: true }).config).toBe(false);
    expect(createWorkspace({ popOut: true, zIndexBase: 5 }).config.zIndexBase).toBe(5);
  });
});

describe('XPO2: canPopOut without popOut', () => {
  it('warns, naming the types', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createWorkspace({
      panels: {
        chart: { component: Counter, defaultOptions: { canPopOut: true } },
        plain: { component: Counter },
      },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('"chart"');
    expect(String(warn.mock.calls[0]![0])).not.toContain('"plain"');
    warn.mockClear();
    createWorkspace({
      popOut: true,
      panels: { chart: { component: Counter, defaultOptions: { canPopOut: true } } },
    });
    createWorkspace({ panels: { plain: { component: Counter } } });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('XPO4: state', () => {
  it('a docked panel is floating with the flag, remembering its group, and has no frame in the workspace', async () => {
    const ws = makeMounted();
    const leaf = leafOf(ws, 'a');
    out(ws, 'a');
    await settle();
    expect(ws.state().panels['a']).toMatchObject({
      state: 'floating',
      poppedOut: true,
      previousState: 'docked',
      lastLeafId: leaf,
    });
    expect(ws.state().floating.some((w) => w.id === 'a')).toBe(true);
    expect(leafOf(ws, 'a')).toBeNull();
    expect(frame('a')).toBeNull();
    // A second call changes nothing.
    const before = liveJson(ws);
    out(ws, 'a');
    expect(liveJson(ws)).toBe(before);
  });
});

describe('XPO6: where it returns', () => {
  it('a docked panel goes back into its group', () => {
    const ws = make();
    const leaf = leafOf(ws, 'a');
    out(ws, 'a');
    expect(ws.returnPanel('a')).toEqual({ ok: true });
    const s = ws.state();
    expect(s.panels['a']!.state).toBe('docked');
    expect(s.panels['a']!.poppedOut).toBeUndefined();
    expect(leafOf(ws, 'a')).toBe(leaf);
    expect(s.floating.some((w) => w.id === 'a')).toBe(false);
  });

  it('a panel alone in its group comes back beside its neighbour, on the same side, at the same share', () => {
    const ws = make();
    ws.dockPanelToWorkspaceEdge('b', 'right'); // [a | b], b takes 0.2
    expect(ws.state().gridRoot).toMatchObject({ type: 'branch', orientation: 'horizontal' });
    out(ws, 'a'); // 'a' was alone in its group: the group goes with it
    expect(ws.state().gridRoot.type).toBe('leaf');
    ws.returnPanel('a');
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    const root = ws.state().gridRoot as LayoutGridNode;
    expect(root).toMatchObject({ type: 'branch', orientation: 'horizontal' });
    expect(root.children.map((c) => (c.type === 'leaf' ? c.panels : null))).toEqual([['a'], ['b']]);
    expect(root.sizes[0]).toBeCloseTo(0.8);
  });

  it('...below a neighbour above it, in a vertical split', () => {
    const ws = make();
    ws.dockPanelToWorkspaceEdge('a', 'bottom'); // [b / a]
    out(ws, 'a');
    ws.returnPanel('a');
    const root = ws.state().gridRoot as LayoutGridNode;
    expect(root).toMatchObject({ type: 'branch', orientation: 'vertical' });
    expect(root.children.map((c) => (c.type === 'leaf' ? c.panels : null))).toEqual([['b'], ['a']]);
    expect(root.sizes[1]).toBeCloseTo(0.2);
  });

  it('...into the grid when nothing of its old layout is docked and the grid is empty (S2.4)', () => {
    const ws = make();
    ws.openPanel('x', 'counter', { dockTo: { panel: 'a', position: 'right' } });
    out(ws, 'x');
    ws.closePanel('a');
    ws.closePanel('b'); // its neighbour's group goes too
    ws.returnPanel('x');
    expect(ws.state().panels['x']!.state).toBe('docked');
    expect(ws.state().gridRoot).toMatchObject({ type: 'leaf', panels: ['x'] });
  });

  it('...and stays floating, with a frame, when nothing of its old layout is docked but other panels are', async () => {
    const ws = makeMounted();
    ws.openPanel('x', 'counter', { dockTo: { panel: 'a', position: 'right' } });
    out(ws, 'x');
    ws.closePanel('a');
    ws.closePanel('b');
    ws.openPanel('z', 'counter');
    ws.returnPanel('x');
    await settle();
    expect(ws.state().panels['x']).toMatchObject({ state: 'floating' });
    expect(ws.state().panels['x']!.poppedOut).toBeUndefined();
    expect(frame('x')).not.toBeNull();
  });

  it("...or goes into the first group when its type can't float", () => {
    const ws = make();
    ws.openPanel('x', 'fixed', { dockTo: { panel: 'a', position: 'right' } });
    out(ws, 'x');
    ws.closePanel('a');
    ws.closePanel('b'); // its neighbour and the rest go
    ws.openPanel('c', 'counter');
    ws.returnPanel('x');
    expect(ws.state().panels['x']!.state).toBe('docked');
    expect(leafOf(ws, 'x')).toBe(leafOf(ws, 'c'));
  });

  it('a floating panel stays floating at its rect', async () => {
    const ws = makeMounted();
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    const rect = { ...ws.state().floating.find((w) => w.id === 'f')! };
    out(ws, 'f');
    expect(ws.state().panels['f']).toMatchObject({
      state: 'floating',
      poppedOut: true,
      previousState: 'floating',
    });
    ws.returnPanel('f');
    await settle();
    const b = ws.state().floating.find((w) => w.id === 'f')!;
    expect({ x: b.x, y: b.y, width: b.width, height: b.height }).toEqual({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    expect(frame('f')).not.toBeNull();
  });

  it('the panel that comes back is the active one, also with another panel active elsewhere (vdd)', () => {
    const ws = make();
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    out(ws, 'a');
    ws.focusPanel('f');
    const activated = vi.fn();
    ws.subscribe('panel:activated', activated);
    ws.returnPanel('a');
    expect(ws.state().activePanelId).toBe('a');
    expect(activated).toHaveBeenCalledWith({ id: 'a', previous: 'f' });
  });

  it('returnPanel on a panel that is not out is { ok: false }', () => {
    const ws = make();
    expect(ws.returnPanel('a')).toEqual({ ok: false });
    expect(ws.returnPanel('nope')).toEqual({ ok: false });
  });
});

describe('XPO8: the store tells the windows', () => {
  const listen = (ws: Workspace) => {
    const ended = vi.fn();
    ws.onPopOutEnded(ended);
    return ended;
  };

  it('closePanel on a popped-out panel ends its pop-out', () => {
    const ws = make();
    const ended = listen(ws);
    out(ws, 'a');
    ws.closePanel('a');
    expect(ended).toHaveBeenCalledWith('a');
    expect(ws.isOpen('a')).toBe(false);
  });

  it('loadLayout ends every pop-out', () => {
    const ws = make();
    const saved = ws.saveLayout();
    const ended = listen(ws);
    out(ws, 'a');
    ws.loadLayout(saved);
    expect(ended).toHaveBeenCalledWith('a');
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    expect(ws.state().panels['a']!.state).toBe('docked');
  });

  it('dockPanel from code ends it and clears the flag', () => {
    const ws = make();
    const ended = listen(ws);
    out(ws, 'a');
    expect(ended).not.toHaveBeenCalled();
    ws.dockPanel('a');
    expect(ended).toHaveBeenCalledWith('a');
    expect(ws.state().panels['a']).toMatchObject({ state: 'docked' });
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
  });

  it('a minimized panel pops out from where it would restore', () => {
    const ws = make();
    const leaf = leafOf(ws, 'a');
    ws.minimizePanel('a');
    out(ws, 'a');
    expect(ws.state().panels['a']).toMatchObject({
      state: 'floating',
      poppedOut: true,
      lastLeafId: leaf,
    });
    expect(ws.state().minimized.some((m) => m.id === 'a')).toBe(false);
  });
});

describe('XPO9: saved layouts (where it would come back to)', () => {
  /** The tree's shape: panels per group and sizes, without the generated group ids. */
  const shape = (n: LayoutNode): unknown =>
    n.type === 'leaf'
      ? n.panels
      : {
          o: n.orientation,
          sizes: n.sizes.map((x) => Math.round(x * 100)),
          c: n.children.map(shape),
        };

  it('a docked panel is saved docked in its group, without the flag; the live state is untouched', () => {
    const ws = make();
    const leaf = leafOf(ws, 'a');
    out(ws, 'a');
    const live = liveJson(ws);
    const saved = JSON.parse(ws.saveLayout());
    expect(liveJson(ws)).toBe(live);
    expect(saved.panels['a'].state).toBe('docked');
    expect('poppedOut' in saved.panels['a']).toBe(false);
    expect(saved.floating.some((w: { id: string }) => w.id === 'a')).toBe(false);
    ws.returnPanel('a');
    ws.closePanel('a');
    ws.loadLayout(JSON.stringify(saved));
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(leafOf(ws, 'a')).toBe(leaf);
  });

  it('a panel alone in its group is saved beside the same panels: the layout it had', () => {
    const ws = make();
    ws.openPanel('c', 'counter', { dockTo: { panel: 'a', position: 'right' } });
    ws.dockPanelToWorkspaceEdge('b', 'right'); // [[a | c] | b], 80/20
    const before = shape(ws.state().gridRoot);
    out(ws, 'b');
    const saved = JSON.parse(ws.saveLayout());
    expect(shape(saved.gridRoot)).toEqual(before);
    expect(saved.panels['b'].state).toBe('docked');
  });

  it('it comes back at its own tab position: in the page, and in a saved layout, where the group keeps its selected tab', () => {
    const ws = make();
    const leafWithB = (src: LayoutNode) => {
      const find = (n: LayoutNode): LayoutLeafNode | null =>
        n.type === 'leaf'
          ? n.panels.includes('b')
            ? n
            : null
          : (n.children.map(find).find(Boolean) ?? null);
      return find(src)!;
    };
    expect(leafWithB(ws.state().gridRoot).panels).toEqual(['a', 'b']);
    out(ws, 'a');
    ws.focusPanel('b');
    const saved = JSON.parse(ws.saveLayout());
    expect(leafWithB(saved.gridRoot)).toMatchObject({ panels: ['a', 'b'], activePanelId: 'b' });
    ws.returnPanel('a');
    expect(leafWithB(ws.state().gridRoot)).toMatchObject({
      panels: ['a', 'b'],
      activePanelId: 'a',
    });
    expect(ws.state().activePanelId).toBe('a');
  });

  it('the saved active panel is the one active on the page, not the popped-out one', () => {
    const ws = make();
    out(ws, 'a');
    ws.focusPanel('b');
    expect(ws.state().activePanelId).toBe('b');
    expect(JSON.parse(ws.saveLayout()).activePanelId).toBe('b');
  });

  it('a floating panel is saved floating at its rect', () => {
    const ws = make();
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    const rect = { ...ws.state().floating.find((w) => w.id === 'f')! };
    out(ws, 'f');
    const saved = JSON.parse(ws.saveLayout());
    expect(saved.panels['f'].state).toBe('floating');
    expect('poppedOut' in saved.panels['f']).toBe(false);
    expect(saved.floating.find((w: { id: string }) => w.id === 'f')).toMatchObject({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  });

  it("a type that can't float is never saved floating", () => {
    const ws = make();
    ws.openPanel('x', 'fixed', { dockTo: { panel: 'a', position: 'right' } });
    out(ws, 'x');
    ws.closePanel('a');
    ws.closePanel('b');
    ws.openPanel('c', 'counter');
    const saved = JSON.parse(ws.saveLayout());
    expect(saved.panels['x'].state).toBe('docked');
    expect(saved.floating.some((w: { id: string }) => w.id === 'x')).toBe(false);
  });

  it('a flag in a loaded layout is ignored', () => {
    const ws = make();
    const raw = JSON.parse(ws.saveLayout());
    raw.panels['a'].poppedOut = true;
    ws.loadLayout(JSON.stringify(raw));
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    expect(ws.state().panels['a']!.state).toBe('docked');
    const fresh = createWorkspace({
      popOut: true,
      panels: { counter: { component: Counter } },
      initialState: JSON.stringify(raw),
    });
    expect(fresh.state().panels['a']!.poppedOut).toBeUndefined();
  });
});

describe('XPO16: ignored while out', () => {
  it('maximizePanel and floatPanel leave the hidden entry alone', () => {
    const ws = make();
    out(ws, 'a');
    const entry = ws.state().floating.find((w) => w.id === 'a');
    ws.maximizePanel('a');
    ws.floatPanel('a', { x: 1, y: 2, width: 300, height: 200 });
    expect(ws.state().floating.find((w) => w.id === 'a')).toBe(entry);
    expect(ws.state().panels['a']!.poppedOut).toBe(true);
  });
});

describe('XPO17: the hidden entry is not in the way', () => {
  it('a new floating window is not cascaded off it', () => {
    const ws = make();
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    const at = { ...ws.state().floating.find((w) => w.id === 'f')! };
    out(ws, 'f');
    ws.openPanel('g', 'counter', { initialTarget: 'floating' });
    const g = ws.state().floating.find((w) => w.id === 'g')!;
    expect({ x: g.x, y: g.y }).toEqual({ x: at.x, y: at.y });
  });

  it("the workspace's on-screen clamp leaves it alone", async () => {
    const ws = makeMounted();
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    out(ws, 'f');
    ws.updateFloatingPosition('f', { x: 5000, y: 5000 });
    ws.updatePanelTitle('b', 'Re-render');
    await settle();
    expect(ws.state().floating.find((w) => w.id === 'f')).toMatchObject({ x: 5000, y: 5000 });
    // ...which still keeps the others on screen.
    ws.openPanel('g', 'counter', { initialTarget: 'floating' });
    ws.updateFloatingPosition('g', { x: 5000, y: 5000 });
    await settle();
    expect(Number(ws.state().floating.find((w) => w.id === 'g')!.x)).toBeLessThan(5000);
  });

  it('a pinned window is stacked as if the hidden one were not in its corner', async () => {
    const ws = makeMounted();
    ws.openPanel('p', 'counter', { initialTarget: 'floating', anchor: 'top-right' });
    ws.openPanel('q', 'counter', { initialTarget: 'floating', anchor: 'top-right' });
    await settle();
    const offset = () => (frame('q') as HTMLElement).style.top;
    const stacked = offset();
    out(ws, 'p');
    await settle();
    expect(offset()).not.toBe(stacked);
    ws.returnPanel('p');
    await settle();
    expect(offset()).toBe(stacked);
  });
});

// ─── S2.2: the tree helpers ─────────────────────────────────────────────────

const L = (...ps: string[]): LayoutNode => ({
  type: 'leaf',
  id: `g-${ps.join('')}`,
  panels: ps,
  activePanelId: ps[0] ?? null,
});
const H = (sizes: number[], ...children: LayoutNode[]): LayoutNode => ({
  type: 'branch',
  orientation: 'horizontal',
  sizes,
  children,
});
const V = (sizes: number[], ...children: LayoutNode[]): LayoutNode => ({
  type: 'branch',
  orientation: 'vertical',
  sizes,
  children,
});
/** Panels per group and sizes (rounded), without group ids. */
const shapeOf = (n: LayoutNode): unknown =>
  n.type === 'leaf'
    ? [...n.panels]
    : {
        o: n.orientation,
        sizes: n.sizes.map((x) => Math.round(x * 1000) / 1000),
        c: n.children.map(shapeOf),
      };
/** Records P's place, takes it out, optionally edits the tree, and puts it back. */
const roundTrip = (tree: LayoutNode, edit: (t: LayoutNode) => LayoutNode = (t) => t) => {
  const places = placesBeside(tree, 'P');
  const rest = edit(removePanelFromTree(tree, 'P')!);
  for (const place of places) {
    const b = returnBeside(rest, 'P', place, 'g-new');
    if (b) return b;
  }
  return null;
};
const norm = (t: LayoutNode) => shapeOf(t);

describe('XPO20: placesBeside / returnBeside', () => {
  it('edge dock: [[p1 p2 | p3] | P] at 80/20 comes back exactly', () => {
    const t = H([0.8, 0.2], H([0.6, 0.4], L('p1', 'p2'), L('p3')), L('P'));
    expect(placesBeside(t, 'P')[0]).toMatchObject({
      panels: ['p1', 'p2', 'p3'],
      position: 'right',
      size: 0.2,
      sizes: null,
    });
    expect(norm(roundTrip(t)!)).toEqual(norm(t));
  });

  it('a nested split of the other direction', () => {
    const t = V([0.6, 0.4], H([0.7, 0.3], L('A'), L('P')), L('B'));
    expect(norm(roundTrip(t)!)).toEqual(norm(t));
  });

  it('a split of three: back between the two, at its own size', () => {
    const t = H([0.2, 0.3, 0.5], L('A'), L('P'), L('B'));
    expect(norm(roundTrip(t)!)).toEqual(norm(t));
  });

  it('a first child goes back before its following sibling', () => {
    const t = V([0.25, 0.75], L('P'), H([0.5, 0.5], L('A'), L('B')));
    expect(placesBeside(t, 'P')[0]).toMatchObject({ position: 'top', size: 0.25 });
    expect(norm(roundTrip(t)!)).toEqual(norm(t));
    const three = H([0.3, 0.3, 0.4], L('P'), L('A'), L('B'));
    expect(norm(roundTrip(three)!)).toEqual(norm(three));
  });

  it('a neighbour moved away: beside the panels still there', () => {
    const t = H([0.8, 0.2], H([0.6, 0.4], L('p1', 'p2'), L('p3')), L('P'));
    const b = roundTrip(t, (o) => removePanelFromTree(o, 'p3')!);
    expect(norm(b!)).toEqual(norm(H([0.8, 0.2], L('p1', 'p2'), L('P'))));
  });

  it('the neighbours went elsewhere in the grid: beside the smallest part that holds them', () => {
    const t = H([0.5, 0.5], L('A'), L('P'));
    // A now shares a split with a new group C: P goes beside that split, not inside it.
    const b = roundTrip(t, (o) => H([0.5, 0.5], o, L('C')));
    expect(norm(b!)).toEqual(norm(H([0.5, 0.5], H([0.5, 0.5], L('A'), L('P')), L('C'))));
  });

  it('it goes back beside the preceding sibling: with that one there, the following one may go', () => {
    const t = H([0.4, 0.3, 0.3], L('A'), L('P'), L('B'));
    const b = roundTrip(t, (o) => removePanelFromTree(o, 'B')!);
    expect(norm(b!)).toEqual(norm(H([0.7, 0.3], L('A'), L('P'))));
  });

  it('with both siblings still there but moved apart, the preceding one is used', () => {
    const t = H([0.4, 0.3, 0.3], L('A'), L('P'), L('B'));
    const b = roundTrip(t, () => V([0.5, 0.5], L('A'), L('B')));
    expect(norm(b!)).toEqual(norm(V([0.5, 0.5], H([0.7, 0.3], L('A'), L('P')), L('B'))));
  });

  it('none of them docked any more: null (the caller falls back)', () => {
    const t = H([0.5, 0.5], L('A'), L('P'));
    expect(roundTrip(t, () => L('Z'))).toBeNull();
  });
});

describe('XPO21: the edge case through the workspace', () => {
  it('[[a b | c] | e] at 80/20 comes back exactly after a pop-out', () => {
    const ws = make();
    ws.openPanel('c', 'counter', { dockTo: { panel: 'a', position: 'right' } });
    ws.openPanel('e', 'counter');
    ws.dockPanelToWorkspaceEdge('e', 'right');
    const before = shapeOf(ws.state().gridRoot);
    expect(before).toMatchObject({ o: 'horizontal', sizes: [0.8, 0.2] });
    out(ws, 'e');
    ws.returnPanel('e');
    expect(shapeOf(ws.state().gridRoot)).toEqual(before);
  });
});

describe('XPO22: moved from code while out', () => {
  it('minimizing returns it to its group first, so a restore docks it there', () => {
    const ws = make();
    const ended = vi.fn();
    ws.onPopOutEnded(ended);
    const leaf = leafOf(ws, 'a');
    out(ws, 'a');
    ws.minimizePanel('a');
    expect(ended).toHaveBeenCalledWith('a');
    expect(ws.state().panels['a']).toMatchObject({
      state: 'minimized',
      previousState: 'docked',
      lastLeafId: leaf,
    });
    ws.restorePanel('a');
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(leafOf(ws, 'a')).toBe(leaf);
  });

  it('a lone panel minimized while out ends as if it had been minimized where it was', () => {
    const ws = make();
    ws.dockPanelToWorkspaceEdge('b', 'right');
    out(ws, 'b');
    expect(ws.state().gridRoot.type).toBe('leaf'); // its group went with it
    ws.minimizePanel('b');
    // Back first (its own split again), then minimized from there, as minimizing it in place does.
    const minimizedOut = { ...ws.state().panels['b']! };
    ws.restorePanel('b');
    const control = make();
    control.dockPanelToWorkspaceEdge('b', 'right');
    control.minimizePanel('b');
    expect(minimizedOut).toMatchObject({ state: 'minimized', previousState: 'docked' });
    expect(minimizedOut.previousState).toBe(control.state().panels['b']!.previousState);
    control.restorePanel('b');
    expect(ws.state().panels['b']!.state).toBe(control.state().panels['b']!.state);
    expect(shapeOf(ws.state().gridRoot)).toEqual(shapeOf(control.state().gridRoot));
  });

  it('docking to a group or an edge, and a tab move, end it too; a tab move without a stop on the way', () => {
    const ws = make();
    ws.openPanel('c', 'counter', { dockTo: { panel: 'a', position: 'right' } });
    const ended = vi.fn();
    ws.onPopOutEnded(ended);
    const groupOfB = leafOf(ws, 'b')!;
    out(ws, 'c');
    ws.dockPanelToGroup('c', groupOfB, 'center');
    expect(ended).toHaveBeenLastCalledWith('c');
    expect(ws.state().panels['c']).toMatchObject({ state: 'docked' });
    expect(ws.state().panels['c']!.poppedOut).toBeUndefined();
    out(ws, 'c');
    ws.dockPanelToWorkspaceEdge('c', 'top');
    expect(ended).toHaveBeenCalledTimes(2);
    expect(ws.state().panels['c']!.poppedOut).toBeUndefined();
    out(ws, 'c');
    const changed = vi.fn();
    ws.subscribe('layout:changed', changed);
    ws.movePanelOrder('c', groupOfB, 0);
    expect(ended).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenCalledTimes(1); // the move only: no return first
    expect(ws.state().panels['c']).toMatchObject({ state: 'docked' });
    expect(ws.state().panels['c']!.poppedOut).toBeUndefined();
    expect(findLeafForPanel(ws.state().gridRoot, 'c')).toBe(groupOfB);
  });
});

// ─── S2.3 ─────────────────────────────────────────────────────────────────────

/** Two layouts with two neighbouring panels that can pop out (c and e). */
const layouts: [string, (ws: Workspace) => void][] = [
  // [[a b | c] | e] at 80/20: c and e in different splits.
  [
    'an edge dock beside a split',
    (ws) => {
      ws.openPanel('c', 'counter', { dockTo: { panel: 'a', position: 'right' } });
      ws.openPanel('e', 'counter');
      ws.dockPanelToWorkspaceEdge('e', 'right');
    },
  ],
  // [a b | [c | e]]: c and e the two sides of one split.
  [
    'two sides of one split',
    (ws) => {
      ws.openPanel('c', 'counter', { dockTo: { panel: 'a', position: 'right', size: 0.4 } });
      ws.openPanel('e', 'counter', { dockTo: { panel: 'c', position: 'bottom', size: 0.3 } });
    },
  ],
];

describe('XPO27: neighbours out at once', () => {
  for (const [name, build] of layouts) {
    for (const order of [
      ['c', 'e'],
      ['e', 'c'],
    ] as const) {
      it(`${name}: c and e out, back ${order.join(' then ')}: the original layout`, () => {
        const ws = make();
        build(ws);
        const before = shapeOf(ws.state().gridRoot);
        out(ws, 'c');
        out(ws, 'e');
        ws.returnPanel(order[0]);
        expect(ws.state().panels[order[0]]!.state).toBe('docked'); // never floats with its layout still docked
        ws.returnPanel(order[1]);
        expect(shapeOf(ws.state().gridRoot)).toEqual(before);
      });
    }
  }
});

describe('XPO28: saving with several panels out', () => {
  for (const [name, build] of layouts) {
    for (const popOrder of [
      ['c', 'e'],
      ['e', 'c'],
    ]) {
      it(`${name}, out ${popOrder.join(' then ')}: the saved layout is the one from before`, () => {
        const ws = make();
        build(ws);
        const before = shapeOf(ws.state().gridRoot);
        popOrder.forEach((id) => out(ws, id));
        const live = liveJson(ws);
        const saved = JSON.parse(ws.saveLayout());
        expect(liveJson(ws)).toBe(live);
        expect(shapeOf(saved.gridRoot)).toEqual(before);
        expect(saved.panels['c'].state).toBe('docked');
        expect(saved.panels['e'].state).toBe('docked');
      });
    }
  }
});

describe('XPO29: the whole grid', () => {
  it('a panel that was alone in the grid comes back into the empty grid, whatever its group id', () => {
    const ws = make();
    ws.openPanel('x', 'counter', { dockTo: { panel: 'a', position: 'right' } });
    ws.closePanel('a');
    ws.closePanel('b');
    const root = ws.state().gridRoot;
    expect(root).toMatchObject({ type: 'leaf', panels: ['x'] });
    expect((root as LayoutLeafNode).id).not.toBe('group-default');
    out(ws, 'x');
    ws.returnPanel('x');
    expect(ws.state().panels['x']!.state).toBe('docked');
    expect(ws.state().gridRoot).toMatchObject({ type: 'leaf', panels: ['x'] });
    expect(ws.state().floating.some((w) => w.id === 'x')).toBe(false);
  });
});

describe('XPO30: a kept-empty neighbour group', () => {
  it('the panel goes back beside the neighbour on its other side, in its old split', () => {
    const ws = make();
    const layout = {
      version: 2,
      gridRoot: {
        type: 'branch',
        orientation: 'horizontal',
        sizes: [0.3, 0.3, 0.4],
        children: [
          { type: 'leaf', id: 'kept', panels: [], activePanelId: null, keepOnEmpty: true },
          { type: 'leaf', id: 'ga', panels: ['a'], activePanelId: 'a' },
          { type: 'leaf', id: 'gb', panels: ['b'], activePanelId: 'b' },
        ],
      },
      floating: [],
      minimized: [],
      panels: {
        a: { id: 'a', title: 'Alpha', component: 'counter', state: 'docked', serializable: true },
        b: { id: 'b', title: 'Beta', component: 'counter', state: 'docked', serializable: true },
      },
    };
    ws.loadLayout(JSON.stringify(layout));
    const before = shapeOf(ws.state().gridRoot);
    expect(before).toEqual({ o: 'horizontal', sizes: [0.3, 0.3, 0.4], c: [[], ['a'], ['b']] });
    out(ws, 'a');
    ws.returnPanel('a');
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(shapeOf(ws.state().gridRoot)).toEqual(before);
  });

  it('(the tree helpers) an empty preceding group is skipped for the following one', () => {
    const t = H([0.3, 0.3, 0.4], L(), L('P'), L('B'));
    expect(norm(roundTrip(t)!)).toEqual(norm(t));
  });
});

describe('XPO31: the share is exact', () => {
  it('under 10% and over 90% come back as they were', () => {
    const small = H([0.95, 0.05], L('A'), L('P'));
    expect(placesBeside(small, 'P')[0]!.size).toBeCloseTo(0.05);
    expect(norm(roundTrip(small)!)).toEqual(norm(small));
    const big = V([0.04, 0.96], L('A'), L('P'));
    expect(norm(roundTrip(big)!)).toEqual(norm(big));
  });
});

describe('XPO27b: more neighbours out at once', () => {
  const threeWide = {
    version: 2,
    gridRoot: {
      type: 'branch',
      orientation: 'horizontal',
      sizes: [0.5, 0.25, 0.25],
      children: [
        { type: 'leaf', id: 'ga', panels: ['a'], activePanelId: 'a' },
        { type: 'leaf', id: 'gc', panels: ['c'], activePanelId: 'c' },
        { type: 'leaf', id: 'ge', panels: ['e'], activePanelId: 'e' },
      ],
    },
    floating: [],
    minimized: [],
    panels: Object.fromEntries(
      ['a', 'c', 'e'].map((id) => [
        id,
        { id, title: id, component: 'counter', state: 'docked', serializable: true },
      ]),
    ),
  };
  for (const order of [
    ['c', 'e'],
    ['e', 'c'],
  ] as const) {
    it(`a split of three, c and e out, back ${order.join(' then ')}: [a, c, e] at its sizes`, () => {
      const ws = make();
      ws.loadLayout(JSON.stringify(threeWide));
      const before = shapeOf(ws.state().gridRoot);
      out(ws, 'c');
      out(ws, 'e');
      expect(shapeOf(JSON.parse(ws.saveLayout()).gridRoot)).toEqual(before);
      ws.returnPanel(order[0]);
      expect(ws.state().panels[order[0]]!.state).toBe('docked');
      ws.returnPanel(order[1]);
      expect(shapeOf(ws.state().gridRoot)).toEqual(before);
    });

    const tabsOut: Record<string, string> = { c: 'b', e: 'c' };
    it(`two tabs of one group out, back ${order.map((o) => tabsOut[o]).join(' then ')}: the same tab order, saved too`, () => {
      const ws = make();
      ws.openPanel('c', 'counter', { dockTo: { panel: 'a', position: 'center' } });
      const tabs = () => {
        const l = ws.state().gridRoot;
        return l.type === 'leaf' ? [...l.panels] : null;
      };
      expect(tabs()).toEqual(['a', 'b', 'c']);
      out(ws, 'b');
      out(ws, 'c');
      expect(JSON.parse(ws.saveLayout()).gridRoot.panels).toEqual(['a', 'b', 'c']);
      ws.returnPanel(tabsOut[order[0]]!);
      ws.returnPanel(tabsOut[order[1]]!);
      expect(tabs()).toEqual(['a', 'b', 'c']);
    });
  }
});

// ─── S2.4 ─────────────────────────────────────────────────────────────────────

/** A layout, as loadLayout takes it, of `counter` panels. */
const layoutOf = (gridRoot: LayoutNode) => {
  const ids = (n: LayoutNode): string[] => (n.type === 'leaf' ? n.panels : n.children.flatMap(ids));
  return JSON.stringify({
    version: 2,
    gridRoot,
    floating: [],
    minimized: [],
    panels: Object.fromEntries(
      ids(gridRoot).map((id) => [
        id,
        { id, title: id, component: 'counter', state: 'docked', serializable: true },
      ]),
    ),
  });
};
/** A workspace store: from a tree, or built through the public API (which uses `group-default` for the first group). */
const storeOf = (from: LayoutNode | ((ws: Workspace) => void)) => {
  const ws = createWorkspace({
    popOut: true,
    panels: { counter: { component: Counter, defaultOptions: { canPopOut: true } } },
    ...(typeof from === 'function' ? {} : { initialState: layoutOf(from) }),
  });
  if (typeof from === 'function') from(ws);
  return {
    ws,
    out: (id: string) => {
      expect(ws.setPoppedOut(id)).toBe(true);
    },
    back: (id: string) => {
      ws.clearPoppedOut(id, true);
    },
    shape: () => shapeOf(ws.state().gridRoot),
    state: () => ws.state(),
  };
};
/** A leaf with an id of its own (not group-default). */
const T = (id: string, ...ps: string[]): LayoutNode => ({
  type: 'leaf',
  id,
  panels: ps,
  activePanelId: ps[0] ?? null,
});
/** ...that is kept when it empties (`keepOnEmpty`, from a loaded layout). */
const K = (id: string, ...ps: string[]): LayoutNode =>
  ({ ...T(id, ...ps), keepOnEmpty: true }) as LayoutNode;

/** Every ordering of `xs`. */
function permutations<X>(xs: X[]): X[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}
/** Every set of `k` of `xs`. */
function combinations<X>(xs: X[], k: number): X[][] {
  if (k === 0) return [[]];
  return xs.flatMap((x, i) => combinations(xs.slice(i + 1), k - 1).map((rest) => [x, ...rest]));
}
const idsOf = (n: LayoutNode): string[] =>
  n.type === 'leaf' ? [...n.panels] : n.children.flatMap(idsOf);

describe('XPO33: every docked panel out at once', () => {
  const cases: [string, LayoutNode][] = [
    ['H[a | b] at 0.3/0.7', H([0.3, 0.7], T('ga', 'a'), T('gb', 'b'))],
    ['H[a | b | c]', H([0.2, 0.3, 0.5], T('ga', 'a'), T('gb', 'b'), T('gc', 'c'))],
    ['H[[a b] | c]', H([0.4, 0.6], T('gab', 'a', 'b'), T('gc', 'c'))],
  ];
  for (const [name, tree] of cases) {
    it(`${name}: back in every order, live and saved, is the original`, () => {
      const all = idsOf(tree);
      for (const order of permutations(all)) {
        const st = storeOf(tree);
        const before = st.shape();
        all.forEach(st.out);
        expect(shapeOf(JSON.parse(st.ws.saveLayout()).gridRoot)).toEqual(before);
        order.forEach(st.back);
        expect(st.shape(), order.join(',')).toEqual(before);
        expect(all.every((id) => st.state().panels[id]!.state === 'docked')).toBe(true);
      }
    });
  }
});

describe('XPO34: all tabs of one group out', () => {
  it('H[[a b] | c] at 0.4/0.6, a and b out, back in either order: one group again', () => {
    for (const order of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      const st = storeOf(H([0.4, 0.6], T('gab', 'a', 'b'), T('gc', 'c')));
      const before = st.shape();
      st.out('a');
      st.out('b');
      order.forEach(st.back);
      expect(st.shape()).toEqual(before);
    }
  });

  it('H[V[a | b] | [c d]], c and d out: back as one group beside the split', () => {
    for (const order of [
      ['c', 'd'],
      ['d', 'c'],
    ]) {
      const st = storeOf(
        H([0.5, 0.5], V([0.5, 0.5], T('ga', 'a'), T('gb', 'b')), T('gcd', 'c', 'd')),
      );
      const before = st.shape();
      st.out('c');
      st.out('d');
      order.forEach(st.back);
      expect(st.shape()).toEqual(before);
    }
  });

  it('a 3-tab group filling the grid (not group-default): all three come back docked, in order', () => {
    for (const order of permutations(['a', 'b', 'c'])) {
      const st = storeOf(T('g1', 'a', 'b', 'c'));
      ['a', 'b', 'c'].forEach(st.out);
      order.forEach(st.back);
      expect(st.shape(), order.join(',')).toEqual(['a', 'b', 'c']);
    }
  });
});

describe('XPO35: tab order', () => {
  it('group [a, b, c]: out a then b, back b then a: [a, b, c]; a save in between too', () => {
    const st = storeOf(T('g1', 'a', 'b', 'c'));
    st.out('a');
    st.out('b');
    expect(JSON.parse(st.ws.saveLayout()).gridRoot.panels).toEqual(['a', 'b', 'c']);
    st.back('b');
    st.back('a');
    expect(st.shape()).toEqual(['a', 'b', 'c']);
  });
});

describe('XPO35b: tabs reordered while out', () => {
  it('it goes after its nearest earlier group-mate, before a later one only when no earlier one is there', () => {
    const st = storeOf(T('g1', 'a', 'b', 'c'));
    st.out('b');
    st.ws.movePanelOrder('c', 'g1', 0); // [c, a]
    expect(st.shape()).toEqual(['c', 'a']);
    st.back('b');
    expect(st.shape()).toEqual(['c', 'a', 'b']);
    // With no earlier mate there, before the nearest later one.
    const st2 = storeOf(T('g1', 'a', 'b', 'c'));
    st2.out('a');
    st2.out('b');
    st2.ws.openPanel('z', 'counter'); // [c, z]
    st2.ws.movePanelOrder('z', 'g1', 0); // [z, c]
    st2.back('b');
    expect(st2.shape()).toEqual(['z', 'b', 'c']);
  });
});

describe('XPO35c (vdd): the nearest group-mate decides the group', () => {
  it("group [a..e]: b out, e docked at an edge: b goes back beside a and c, not into e's group", () => {
    const st = storeOf(T('g1', 'a', 'b', 'c', 'd', 'e'));
    st.out('b');
    st.ws.dockPanelToWorkspaceEdge('e', 'right');
    st.back('b');
    expect(findLeafForPanel(st.state().gridRoot, 'b')).toBe('g1');
    expect(st.shape()).toMatchObject({ c: [['a', 'b', 'c', 'd'], ['e']] });
  });
});

describe('XPO33b: groups made by returns have ids of their own', () => {
  it('in one millisecond too: a save with every panel out lists each panel once, in groups with distinct ids', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const st = storeOf(
      H([0.35, 0.65], T('gab', 'a', 'b'), V([0.5, 0.5], T('gc', 'c'), T('gd', 'd'))),
    );
    ['a', 'c', 'b'].forEach(st.out);
    const saved = JSON.parse(st.ws.saveLayout()).gridRoot as LayoutNode;
    const leaves = (n: LayoutNode): LayoutLeafNode[] =>
      n.type === 'leaf' ? [n] : n.children.flatMap(leaves);
    const ids = leaves(saved).map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      leaves(saved)
        .flatMap((l) => l.panels)
        .sort(),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('XPO36: old sizes only in the old split', () => {
  it('H[x | y | p]: p out, n docked beside y, p back: the new split does not get the old sizes', () => {
    const st = storeOf(H([0.2, 0.3, 0.5], T('gx', 'x'), T('gy', 'y'), T('gp', 'p')));
    st.out('p');
    st.ws.openPanel('n', 'counter', { dockTo: { panel: 'y', position: 'right' } });
    st.back('p');
    const root = st.state().gridRoot as LayoutGridNode;
    const inner = root.children.find((c) => c.type === 'branch') as LayoutGridNode;
    expect(inner).toBeDefined();
    expect(inner.sizes.map((x) => Math.round(x * 100) / 100)).not.toEqual([0.2, 0.3, 0.5]);
    expect(inner.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe('XPO37: the matrix', () => {
  const matrix: [string, LayoutNode | ((ws: Workspace) => void)][] = [
    [
      'H[a | b] through the API (group-default)',
      (ws) => {
        ws.openPanel('a', 'counter');
        ws.openPanel('b', 'counter', { dockTo: { panel: 'a', position: 'right' } });
      },
    ],
    [
      'three panels through the API (group-default)',
      (ws) => {
        ws.openPanel('a', 'counter');
        ws.openPanel('b', 'counter', { dockTo: { panel: 'a', position: 'right', size: 0.4 } });
        ws.openPanel('c', 'counter', { dockTo: { panel: 'b', position: 'bottom', size: 0.3 } });
      },
    ],
    [
      'a tab group inside a split of three',
      H([0.2, 0.3, 0.5], T('ga', 'a'), T('gby', 'b', 'y'), T('gc', 'c')),
    ],
    [
      'a kept group in a nested split (D1)',
      H([0.5, 0.5], H([0.7, 0.3], K('ga', 'a'), T('gb', 'b')), T('gc', 'c')),
    ],
    ['a kept group beside a leaf (D1)', H([0.4, 0.6], K('ga', 'a'), T('gb', 'b'))],
    [
      'nested mixed split',
      H(
        [0.6, 0.4],
        V([0.4, 0.6], T('ga', 'a'), H([0.3, 0.7], T('gb', 'b'), T('gc', 'c'))),
        T('gd', 'd'),
      ),
    ],
    ['split of three', H([0.2, 0.3, 0.5], T('ga', 'a'), T('gb', 'b'), T('gc', 'c'))],
    [
      'two rows',
      V(
        [0.45, 0.55],
        H([0.3, 0.7], T('ga', 'a'), T('gb', 'b')),
        H([0.6, 0.4], T('gc', 'c'), T('gd', 'd')),
      ),
    ],
    [
      'tabs inside a split',
      H([0.35, 0.65], T('gab', 'a', 'b'), V([0.5, 0.5], T('gc', 'c'), T('gd', 'd'))),
    ],
    ['one tab group filling the grid', T('g1', 'a', 'b', 'c', 'd')],
    ['a tab group beside a leaf', V([0.7, 0.3], T('gabc', 'a', 'b', 'c'), T('gd', 'd'))],
    ['two leaves', H([0.3, 0.7], T('ga', 'a'), T('gb', 'b'))],
    [
      'a split of four',
      H([0.1, 0.2, 0.3, 0.4], T('ga', 'a'), T('gb', 'b'), T('gc', 'c'), T('gd', 'd')),
    ],
  ];
  let cases = 0;
  for (const [name, tree] of matrix) {
    it(`${name}: every set of 2 and 3, every pop and return order`, () => {
      const all = idsOf(storeOf(tree).state().gridRoot);
      const failures: string[] = [];
      for (const k of [2, 3]) {
        if (k > all.length) continue;
        for (const set of combinations(all, k)) {
          for (const popOrder of permutations(set)) {
            for (const returnOrder of permutations(set)) {
              cases++;
              const st = storeOf(tree);
              const before = st.shape();
              popOrder.forEach(st.out);
              const live = liveJson(st.ws);
              const saved = shapeOf(JSON.parse(st.ws.saveLayout()).gridRoot);
              if (liveJson(st.ws) !== live)
                failures.push(`${popOrder} save touched the live state`);
              if (JSON.stringify(saved) !== JSON.stringify(before))
                failures.push(`out ${popOrder}: saved ${JSON.stringify(saved)}`);
              returnOrder.forEach(st.back);
              const after = st.shape();
              if (JSON.stringify(after) !== JSON.stringify(before))
                failures.push(`out ${popOrder}, back ${returnOrder}: ${JSON.stringify(after)}`);
            }
          }
        }
      }
      expect(failures.slice(0, 5)).toEqual([]);
    });
  }
  afterAll(() => {
    expect(cases).toBe(1332);
  });
});

describe('XPO38: group-default, reused by the empty grid', () => {
  for (const order of [
    ['b', 'a'],
    ['a', 'b'],
  ]) {
    it(`H[a | b] through the API, a and b out, back ${order.join(' then ')}: H[a | b], saved too`, () => {
      const st = storeOf((ws) => {
        ws.openPanel('a', 'counter');
        ws.openPanel('b', 'counter', { dockTo: { panel: 'a', position: 'right' } });
      });
      const before = st.shape();
      expect(before).toMatchObject({ o: 'horizontal', c: [['a'], ['b']] });
      st.out('a');
      st.out('b');
      expect(shapeOf(JSON.parse(st.ws.saveLayout()).gridRoot)).toEqual(before);
      order.forEach(st.back);
      expect(st.shape()).toEqual(before);
    });
  }

  it('a group with its old id, refilled with other panels, is not its own group', () => {
    const st = storeOf((ws) => {
      ws.openPanel('a', 'counter');
      ws.openPanel('b', 'counter', { dockTo: { panel: 'a', position: 'right' } });
    });
    st.out('a'); // a's group-default goes; b fills the grid
    st.ws.closePanel('b'); // the grid is empty again
    st.ws.openPanel('z', 'counter'); // ...and refilled with z
    st.back('a');
    // Not a tab beside z: nothing of its old layout is there, so it floats.
    expect(st.state().panels['a']!.state).toBe('floating');
    expect(st.shape()).toEqual(['z']);
  });
});

describe('XPO38b (vdd): a kept group refilled while out', () => {
  it("is not its own group: it goes back beside its neighbour (vdd keeps a group's id where rdd made a new group-default)", () => {
    const st = storeOf(H([0.4, 0.6], K('ga', 'a'), T('gb', 'b')));
    st.out('a');
    st.ws.openPanel('z', 'counter');
    st.ws.dockPanelToGroup('z', 'ga', 'center');
    st.back('a');
    expect(findLeafForPanel(st.state().gridRoot, 'a')).not.toBe('ga');
    expect(st.state().panels['a']!.state).toBe('docked');
    expect(st.shape()).toEqual({
      o: 'horizontal',
      sizes: [0.4, 0.6],
      c: [['z'], { o: 'horizontal', sizes: [0.4, 0.6], c: [['a'], ['b']] }],
    });
  });
});

describe('XPO39: split sizes with a tab-mate still out', () => {
  it('H(0.2, 0.3, 0.5)[a | (b, y) | c]: out c, b, y; back y, c, b: the sizes too', () => {
    const st = storeOf(H([0.2, 0.3, 0.5], T('ga', 'a'), T('gby', 'b', 'y'), T('gc', 'c')));
    const before = st.shape();
    ['c', 'b', 'y'].forEach(st.out);
    ['y', 'c'].forEach(st.back);
    expect(st.shape()).toMatchObject({ sizes: [0.2, 0.3, 0.5] }); // b still out
    st.back('b');
    expect(st.shape()).toEqual(before);
  });
});

describe('XPO40: only kept-empty groups left', () => {
  it('H[a | b | c] with b and c kept: a out, b and c closed, a back docked into the first group', () => {
    const st = storeOf(H([0.2, 0.3, 0.5], T('ga', 'a'), K('gb', 'b'), K('gc', 'c')));
    st.out('a');
    st.ws.closePanel('b');
    st.ws.closePanel('c');
    expect(shapeOf(st.state().gridRoot)).toMatchObject({ c: [[], []] });
    st.back('a');
    expect(st.state().panels['a']!.state).toBe('docked');
    expect(shapeOf(st.state().gridRoot)).toMatchObject({ c: [['a'], []] });
  });
});

describe('XPO40c (vdd): the empty-grid rule skips a group waiting for another panel', () => {
  it('H[gk(kept, empty) | p]: p out, q into gk and out; p back floats, q back into gk', () => {
    const st = storeOf(H([0.5, 0.5], K('gk'), T('gp', 'p')));
    st.out('p');
    st.ws.openPanel('q', 'counter');
    expect(findLeafForPanel(st.state().gridRoot, 'q')).toBe('gk');
    st.out('q');
    st.back('p');
    expect(st.state().panels['p']!.state).toBe('floating');
    st.back('q');
    expect(findLeafForPanel(st.state().gridRoot, 'q')).toBe('gk');
  });
});

describe('XPO40b: its own kept group', () => {
  it('a panel alone in a kept group goes back into that group, which waited empty', () => {
    const st = storeOf(H([0.3, 0.7], K('ga', 'a'), T('gb', 'b')));
    const before = st.shape();
    st.out('a');
    expect(st.shape()).toEqual({ o: 'horizontal', sizes: [0.3, 0.7], c: [[], ['b']] });
    st.back('a');
    expect(st.shape()).toEqual(before);
  });
});

describe('XPO41: interleaved pop-outs and returns', () => {
  const run = (tree: LayoutNode | ((ws: Workspace) => void), steps: string) => {
    const st = storeOf(tree);
    const before = st.shape();
    for (const step of steps.split(' ')) (step[0] === '+' ? st.out : st.back)(step.slice(1));
    return { before, after: st.shape(), st };
  };
  it('H(0.2, 0.3, 0.5)[a | b | c]: +a +b +c -b +b -c -b -a', () => {
    const { before, after } = run(
      H([0.2, 0.3, 0.5], T('ga', 'a'), T('gb', 'b'), T('gc', 'c')),
      '+a +b +c -b +b -c -b -a',
    );
    expect(after).toEqual(before);
  });
  it('the same through the API, with group-default; and a save in the middle', () => {
    const build = (ws: Workspace) => {
      ws.openPanel('a', 'counter');
      ws.openPanel('b', 'counter', { dockTo: { panel: 'a', position: 'right', size: 0.4 } });
      ws.openPanel('c', 'counter', { dockTo: { panel: 'b', position: 'right', size: 0.3 } });
    };
    const { before, after } = run(build, '+a +b +c -b +b -c -b -a');
    expect(after).toEqual(before);
    const mid = run(build, '+a +b +c -b +b');
    expect(shapeOf(JSON.parse(mid.st.ws.saveLayout()).gridRoot)).toEqual(mid.before);
  });
  it('H[a | b] through the API: +a -a +b +a -b -a', () => {
    const { before, after } = run((ws) => {
      ws.openPanel('a', 'counter');
      ws.openPanel('b', 'counter', { dockTo: { panel: 'a', position: 'right' } });
    }, '+a -a +b +a -b -a');
    expect(after).toEqual(before);
  });
});

describe('XPO42: a kept group stands in for its panel while it is out (D1)', () => {
  const tree = H([0.5, 0.5], H([0.7, 0.3], K('ga', 'a'), T('gb', 'b')), T('gc', 'c'));
  for (const popOrder of [
    ['a', 'b'],
    ['b', 'a'],
  ]) {
    for (const backOrder of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      it(`H[H[ga(kept):a | b] | c]: out ${popOrder}, back ${backOrder}: the original, saved too`, () => {
        const st = storeOf(tree);
        const before = st.shape();
        popOrder.forEach(st.out);
        expect(shapeOf(JSON.parse(st.ws.saveLayout()).gridRoot)).toEqual(before);
        backOrder.forEach(st.back);
        expect(st.shape()).toEqual(before);
      });
    }
  }

  it("the quieter form, H[ga(kept):a | b]: back b first, b does not take over a's kept group", () => {
    const st = storeOf(H([0.4, 0.6], K('ga', 'a'), T('gb', 'b')));
    const before = st.shape();
    st.out('a');
    st.out('b');
    st.back('b');
    const leaves = (n: LayoutNode): LayoutNode[] =>
      n.type === 'leaf' ? [n] : n.children.flatMap(leaves);
    const ga = leaves(st.state().gridRoot).find(
      (l) => l.type === 'leaf' && l.id === 'ga',
    ) as LayoutLeafNode;
    expect(ga.panels).toEqual([]); // still waiting for a
    st.back('a');
    expect(st.shape()).toEqual(before);
  });
});

describe('XPO43: a minimized panel popped out while its group is empty (D2)', () => {
  for (const order of [
    ['a', 'b'],
    ['b', 'a'],
  ]) {
    it(`group-default [a, b]: b minimized, a out, b out; back ${order.join(' then ')}: tabs [a, b]; saved too`, () => {
      const st = storeOf((ws) => {
        ws.openPanel('a', 'counter');
        ws.openPanel('b', 'counter');
      });
      expect(st.shape()).toEqual(['a', 'b']);
      st.ws.minimizePanel('b');
      st.out('a');
      st.out('b');
      expect(st.state().minimized).toEqual([]);
      expect(st.state().panels['b']).toMatchObject({
        state: 'floating',
        poppedOut: true,
        previousState: 'docked',
      });
      const saved = JSON.parse(st.ws.saveLayout());
      expect(shapeOf(saved.gridRoot)).toEqual(['a', 'b']);
      expect(saved.panels['a'].state).toBe('docked');
      order.forEach(st.back);
      expect(st.shape()).toEqual(['a', 'b']);
      expect(st.state().panels['a']!.state).toBe('docked');
      expect(st.state().panels['b']!.state).toBe('docked');
    });
  }
});

describe('XPO44 (vdd): neighbours out beside an empty group, matching rdd 7.12.1', () => {
  // The P2b playground case: H[L | R] with R empty, two neighbours out and back. rdd's own core,
  // run on the same layouts and sequences, gives these results (checked against rdd 7.12.1).
  const kept = (leaf: boolean) => (leaf ? K('R') : T('R'));
  const ppR = { o: 'vertical', sizes: [0.5, 0.5], c: [['pp'], ['pq']] };
  for (const keepR of [false, true]) {
    for (const order of [
      ['pp', 'pq'],
      ['pq', 'pp'],
    ]) {
      const tag = `${keepR ? 'R kept' : 'R plain'}, back ${order.join(' then ')}`;
      it(`[[p1 | R] | V[pp / pq]] at the edge: back beside p1 only, as rdd does (${tag})`, () => {
        const st = storeOf(H([0.5, 0.5], T('L', 'p1', 'pp', 'pq'), kept(keepR)));
        st.ws.dockPanelToWorkspaceEdge('pp', 'right');
        st.ws.dockPanelToGroup('pq', leafOf(st.ws, 'pp')!, 'bottom');
        expect(st.shape()).toEqual({
          o: 'horizontal',
          sizes: [0.8, 0.2],
          c: [{ o: 'horizontal', sizes: [0.5, 0.5], c: [['p1'], []] }, ppR],
        });
        st.out('pp');
        st.out('pq');
        expect(st.shape()).toEqual({ o: 'horizontal', sizes: [0.5, 0.5], c: [['p1'], []] });
        order.forEach(st.back);
        // The smallest subtree still holding p1 is p1's own group: the empty R holds no panel.
        expect(st.shape()).toEqual({
          o: 'horizontal',
          sizes: [0.5, 0.5],
          c: [{ o: 'horizontal', sizes: [0.8, 0.2], c: [['p1'], ppR] }, []],
        });
      });
      it(`tabs, and neighbours split beside p1 next to R: back to the original (${tag})`, () => {
        const trees = [
          H([0.5, 0.5], T('L', 'p1', 'pp', 'pq'), kept(keepR)),
          H(
            [0.4, 0.3, 0.3],
            T('L', 'p1'),
            V([0.5, 0.5], T('gp', 'pp'), T('gq', 'pq')),
            kept(keepR),
          ),
          H(
            [0.5, 0.5],
            H([0.5, 0.5], T('L', 'p1'), V([0.5, 0.5], T('gp', 'pp'), T('gq', 'pq'))),
            kept(keepR),
          ),
          H([0.25, 0.25, 0.25, 0.25], T('L', 'p1'), T('gp', 'pp'), T('gq', 'pq'), kept(keepR)),
        ];
        for (const tree of trees) {
          const st = storeOf(tree);
          const before = st.shape();
          st.out('pp');
          st.out('pq');
          order.forEach(st.back);
          expect(st.shape()).toEqual(before);
        }
      });
    }
  }
});

describe('XPO28b (vdd): a save puts them back last out first', () => {
  it('H(0.2, 0.3, 0.5)[a | b | c]: a out, c out, b closed: the save is the layout returning c, then a, gives', () => {
    const st = storeOf(H([0.2, 0.3, 0.5], T('ga', 'a'), T('gb', 'b'), T('gc', 'c')));
    st.out('a');
    st.out('c');
    st.ws.closePanel('b');
    const saved = shapeOf(JSON.parse(st.ws.saveLayout()).gridRoot);
    st.back('c');
    st.back('a');
    expect(saved).toEqual(st.shape());
    expect(saved).toEqual({ o: 'horizontal', sizes: [0.2, 0.8], c: [['a'], ['c']] });
  });
});

// ─── vdd: the public methods before and after a windows registry is bound ─────────

describe('XPOS1: popOutPanel with no windows registry', () => {
  it('is "no-window" with popOut on, and changes nothing', () => {
    const ws = make();
    const before = liveJson(ws);
    expect(ws.popOutPanel('a')).toEqual({ ok: false, reason: 'no-window' });
    expect(liveJson(ws)).toBe(before);
  });
});

describe('XPOS2: the windows registry gets the calls once bound', () => {
  it('popOutPanel, returnPanel and focusPanelWindow delegate; unbinding takes them back', () => {
    const ws = make();
    const windows: PopOutWindowsBinding = {
      popOut: vi.fn(() => ({ ok: false, reason: 'blocked' }) as const),
      returnPanel: vi.fn(() => ({ ok: true })),
      focusWindow: vi.fn(() => true),
    };
    const unbind = ws.bindPopOutWindows(windows);
    expect(ws.popOutPanel('a')).toEqual({ ok: false, reason: 'blocked' });
    expect(windows.popOut).toHaveBeenCalledWith('a');
    expect(ws.returnPanel('a')).toEqual({ ok: true });
    expect(windows.returnPanel).toHaveBeenCalledWith('a');
    out(ws, 'b');
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    expect(ws.focusPanelWindow('b')).toEqual({ ok: true });
    expect(windows.focusWindow).toHaveBeenCalledWith('b');
    expect(focus).not.toHaveBeenCalled();
    unbind();
    expect(ws.popOutPanel('a')).toEqual({ ok: false, reason: 'no-window' });
    // A disabled workspace never asks it.
    const off = make({ popOut: false });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const asked = vi.fn(() => ({ ok: true }) as const);
    off.bindPopOutWindows({
      popOut: asked,
      returnPanel: () => ({ ok: false }),
      focusWindow: () => false,
    });
    expect(off.popOutPanel('a')).toEqual({ ok: false, reason: 'disabled' });
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('XPOS3: focusPanelWindow', () => {
  it('activates the panel and focuses the main window for a panel in the page; false for an unknown id', () => {
    const ws = make();
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    expect(ws.focusPanelWindow('nope')).toEqual({ ok: false });
    expect(focus).not.toHaveBeenCalled();
    expect(ws.focusPanelWindow('b')).toEqual({ ok: true });
    expect(ws.state().activePanelId).toBe('b');
    expect(focus).toHaveBeenCalledTimes(1);
  });
});

describe('XPOS4: the end-of-pop-out hook', () => {
  it('runs once per ending, not for a panel that was not out, and stops when removed', () => {
    const ws = make();
    const ended = vi.fn();
    const off = ws.onPopOutEnded(ended);
    ws.clearPoppedOut('a', true); // not out: nothing
    ws.dockPanel('b');
    expect(ended).not.toHaveBeenCalled();
    out(ws, 'a');
    ws.clearPoppedOut('a', false);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ws.state().panels['a']).toMatchObject({ state: 'floating' }); // without its place: where it is
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    off();
    out(ws, 'a');
    ws.returnPanel('a');
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("runs for a widget's hosted panel removed while out", () => {
    const ws = make();
    const ended = vi.fn();
    ws.onPopOutEnded(ended);
    expect(
      ws.openHostedPanel('a/w', { panelId: 'a', widgetId: 'w' }, 'W', {
        kind: 'float',
        rect: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ).toBe(true);
    out(ws, 'a/w');
    ws.removeHostedPanel('a/w');
    expect(ended).toHaveBeenCalledWith('a/w');
    expect(ws.isOpen('a/w')).toBe(false);
  });
});

// ─── ndd: rules the ported cases leave open (found by the P2a mutation check) ───────

describe('XPON1 (ndd): the panel popped out is the active one', () => {
  it('a floating panel becomes active as it pops out, as a docked one does (rdd: activePanelId: id)', () => {
    const ws = make();
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    ws.focusPanel('b');
    out(ws, 'f');
    expect(ws.state().activePanelId).toBe('f');
    ws.focusPanel('b');
    out(ws, 'a');
    expect(ws.state().activePanelId).toBe('a');
  });
});

describe('XPON2 (ndd): layout:changed', () => {
  it('once for a pop-out, once for a return that moves it, none for a flag cleared in place', () => {
    const ws = make();
    const changed = vi.fn();
    ws.subscribe('layout:changed', changed);
    out(ws, 'a');
    expect(changed).toHaveBeenCalledTimes(1);
    ws.returnPanel('a');
    expect(changed).toHaveBeenCalledTimes(2);
    out(ws, 'a');
    changed.mockClear();
    ws.clearPoppedOut('a', false);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('XPON3 (ndd): a floating panel never docks on return', () => {
  it('floating, out, every other panel closed: back floating, not into the empty grid', () => {
    const ws = make();
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    out(ws, 'f');
    ws.closePanel('a');
    ws.closePanel('b');
    ws.returnPanel('f');
    expect(ws.state().panels['f']!.state).toBe('floating');
    expect(ws.state().floating.some((w) => w.id === 'f')).toBe(true);
    expect(idsOf(ws.state().gridRoot)).toEqual([]);
  });
});

describe('XPON4 (ndd): a panel re-recorded at a later pop-out keeps its place in the order', () => {
  it('H(0.1, 0.2, 0.3, 0.4)[a | b | c | d]: out b, a, c, d closed: the save is c, then a, then b coming back', () => {
    const st = storeOf(
      H([0.1, 0.2, 0.3, 0.4], T('ga', 'a'), T('gb', 'b'), T('gc', 'c'), T('gd', 'd')),
    );
    ['b', 'a', 'c'].forEach(st.out);
    st.ws.closePanel('d');
    const saved = shapeOf(JSON.parse(st.ws.saveLayout()).gridRoot);
    ['c', 'a', 'b'].forEach(st.back);
    expect(saved).toEqual(st.shape());
    expect(saved).toEqual({ o: 'horizontal', sizes: [0.08, 0.2, 0.72], c: [['a'], ['b'], ['c']] });
  });
});

describe('XPON5 (ndd): a minimized floating panel', () => {
  it('pops out from its rect: off the taskbar, floating, active', () => {
    const ws = make();
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    ws.updateFloatingPosition('f', { x: 40, y: 50 });
    ws.minimizePanel('f');
    out(ws, 'f');
    expect(ws.state().minimized.some((m) => m.id === 'f')).toBe(false);
    expect(ws.state().panels['f']).toMatchObject({
      state: 'floating',
      poppedOut: true,
      previousState: 'floating',
    });
    expect(ws.state().floating.filter((w) => w.id === 'f')).toHaveLength(1);
    expect(ws.state().activePanelId).toBe('f');
    ws.returnPanel('f');
    expect(ws.state().floating.find((w) => w.id === 'f')).toMatchObject({ x: 40, y: 50 });
  });
});

describe('XPON6 (ndd): back into its kept group, in a save', () => {
  it('the group that waited empty has it as its selected tab', () => {
    const st = storeOf(H([0.3, 0.7], K('ga', 'a'), T('gb', 'b')));
    st.out('a');
    const saved = JSON.parse(st.ws.saveLayout()).gridRoot as LayoutGridNode;
    expect(saved.children[0]).toMatchObject({ id: 'ga', panels: ['a'], activePanelId: 'a' });
  });
});

describe("XPON7 (ndd): placesBeside reads a split's sizes as shares", () => {
  it('sizes that do not add up to 1 are normalised', () => {
    const t = H([2, 6], L('A'), L('P'));
    expect(placesBeside(t, 'P')[0]!.size).toBeCloseTo(0.75);
    const three = H([1, 1, 2], L('A'), L('P'), L('B'));
    expect(placesBeside(three, 'P')[0]!.sizes).toEqual([0.25, 0.25, 0.5]);
  });
});

describe('XPON8 (ndd): the saved active panel', () => {
  it("stays the page's active one while another panel is put back on the copy", () => {
    const st = storeOf(H([0.3, 0.3, 0.4], T('ga', 'a'), T('gb', 'b'), T('gx', 'x')));
    st.out('x');
    st.ws.focusPanel('b');
    expect(JSON.parse(st.ws.saveLayout()).activePanelId).toBe('b');
  });
});

describe('XPON9 (ndd): the nearest group-mate wins over the first one', () => {
  it("group [a..e]: d out, a docked at an edge: d goes back between c and e, not into a's group", () => {
    const st = storeOf(T('g1', 'a', 'b', 'c', 'd', 'e'));
    st.out('d');
    st.ws.dockPanelToWorkspaceEdge('a', 'left');
    st.back('d');
    expect(findLeafForPanel(st.state().gridRoot, 'd')).toBe('g1');
    expect(st.shape()).toMatchObject({ c: [['a'], ['b', 'c', 'd', 'e']] });
  });
});
