/**
 * The 1.3.1 fixes, ported from react-dockable-desktop 7.4.1 (`Patch741.test.ts`), found in a
 * review of 7.4.0. Each runs against the workspace alone — nothing rendered — since that is where
 * the defect lived.
 *
 * - The default message formatter replaces every `{key}`, not only the first.
 * - Layout repair drops leaf panel ids that aren't in `panels`, and gives a branch whose `sizes`
 *   don't match its children (or aren't finite and positive) even sizes — otherwise
 *   `flex-basis: NaN%`.
 * - A throwing event subscriber no longer stops delivery to the others.
 */
import { Component } from '@angular/core';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { formatLabel } from '../../src/lib/core/messages';
import type { LayoutNode } from '../../src/lib/core/types';

@Component({ selector: 'ndd-test-review-fixes-panel', template: '' })
class P {}

const ws = () => createWorkspace({ panels: { p: { component: P } } });
const panel = (id: string) => ({ id, title: id.toUpperCase(), component: 'p', state: 'docked' });
const leaf = (id: string, p: string) => ({ type: 'leaf', id, panels: [p], activePanelId: p });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the default message formatter', () => {
  const label = { id: 'x', defaultMessage: '{n} of {n}, {m}', values: { n: 2, m: 'ok' } };

  it('replaces every occurrence of a placeholder', () => {
    expect(formatLabel(label)).toBe('2 of 2, ok');
  });

  it("is the workspace's formatter when none is configured", () => {
    expect(ws().format(label)).toBe('2 of 2, ok');
  });
});

describe('layout repair', () => {
  const load = (gridRoot: unknown, panels: Record<string, unknown>) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = ws();
    expect(w.loadLayout(JSON.stringify({ version: 2, gridRoot, floating: [], minimized: [], panels }))).toBe(true);
    return { root: w.state().gridRoot, warn };
  };

  it('drops a leaf panel id that is not in panels, and re-derives the active one', () => {
    const { root, warn } = load({ type: 'leaf', id: 'g', panels: ['ghost', 'a'], activePanelId: 'ghost' }, { a: panel('a') });
    expect(root).toMatchObject({ type: 'leaf', panels: ['a'], activePanelId: 'a' });
    expect(String(warn.mock.calls[0]?.[0])).toContain('ghost');
  });

  it('gives a branch whose sizes do not match its children even sizes', () => {
    const { root } = load(
      { type: 'branch', orientation: 'horizontal', sizes: [1], children: [leaf('l1', 'a'), leaf('l2', 'b'), leaf('l3', 'c')] },
      { a: panel('a'), b: panel('b'), c: panel('c') },
    );
    const sizes = (root as Extract<LayoutNode, { type: 'branch' }>).sizes;
    expect(sizes).toHaveLength(3);
    for (const s of sizes) expect(s).toBeCloseTo(1 / 3);
  });

  it('gives a branch with a non-finite size even sizes', () => {
    const { root } = load(
      { type: 'branch', orientation: 'horizontal', sizes: [0.5, null], children: [leaf('l1', 'a'), leaf('l2', 'b')] },
      { a: panel('a'), b: panel('b') },
    );
    expect((root as Extract<LayoutNode, { type: 'branch' }>).sizes).toEqual([0.5, 0.5]);
  });

  it('leaves a layout saved by this version alone (no warning)', () => {
    const w = ws();
    w.openPanel('a', 'p');
    w.openPanel('b', 'p');
    w.dockPanelToWorkspaceEdge('b', 'right');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ws().loadLayout(w.saveLayout())).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the event bus', () => {
  it('delivers to every subscriber even when one throws, and reports the error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = ws();
    const got: unknown[] = [];
    w.subscribe('probe', () => {
      throw new Error('bad listener');
    });
    w.subscribe('probe', (d) => got.push(d));
    expect(() => w.publish('probe', 42)).not.toThrow();
    expect(got).toEqual([42]);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/angular-dockable-desktop.*"probe"/);
  });

  it('a throwing subscriber does not stop loadLayout before layout:changed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = ws();
    source.openPanel('a', 'p');
    const saved = source.saveLayout();
    const w = ws();
    let changed = 0;
    w.subscribe('panel:activated', () => {
      throw new Error('bad listener');
    });
    w.subscribe('layout:changed', () => changed++);
    expect(() => w.loadLayout(saved)).not.toThrow();
    expect(w.state().panels['a']).toBeDefined();
    expect(changed).toBe(1);
  });
});
