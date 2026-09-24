/**
 * Ported verbatim from vue-dockable-desktop `test/core/layoutTree.test.ts` — framework-free logic, so only
 * the import paths changed. Test names and IDs are preserved (ADR 0009).
 */
/**
 * The layout tree maths.
 *
 * New in vdd: in react-dockable-desktop these were closures inside the provider, reachable
 * only through a mounted component, so the tree logic could only be tested indirectly. They
 * are pure functions here, which matters most for `deriveActivePanelId` — the depth-first
 * ordering is the exact detail that caused a restored workspace to activate the wrong panel.
 */
import { describe, it, expect } from 'vitest';
import {
  addPanelToLeaf,
  deriveActivePanelId,
  dockToEdge,
  emptyRoot,
  findFirstLeafId,
  findLeaf,
  findLeafForPanel,
  insertPanelInLeaf,
  isLoneOccupant,
  isVisibleActiveTarget,
  leafExists,
  removeLeafFromTree,
  removePanelFromTree,
  repairLayoutTree,
  selectPanelInTree,
  splitLeafInTree,
  updateSizesAtPath,
} from '../../src/lib/core/layout-tree';
import type { LayoutLeafNode, LayoutNode, PanelInfo } from '../../src/lib/core/types';

const leaf = (
  id: string,
  panels: string[] = [],
  extra: Partial<LayoutLeafNode> = {},
): LayoutLeafNode => ({
  type: 'leaf',
  id,
  panels,
  activePanelId: panels[0] ?? null,
  ...extra,
});
const panel = (id: string, state: PanelInfo['state'] = 'docked'): PanelInfo => ({
  id,
  title: id,
  component: 'map',
  state,
  serializable: true,
});
const panels = (...ids: [string, PanelInfo['state']?][]): Record<string, PanelInfo> =>
  Object.fromEntries(ids.map(([id, s]) => [id, panel(id, s)]));

describe('removePanelFromTree', () => {
  it('removes the panel and keeps the leaf when others remain', () => {
    const r = removePanelFromTree(leaf('L', ['a', 'b']), 'a') as LayoutLeafNode;
    expect(r.panels).toEqual(['b']);
  });

  it('returns null for a leaf emptied without keepOnEmpty', () => {
    expect(removePanelFromTree(leaf('L', ['a']), 'a')).toBeNull();
  });

  it('keeps an emptied leaf when keepOnEmpty is set, with no selection', () => {
    const r = removePanelFromTree(leaf('L', ['a'], { keepOnEmpty: true }), 'a') as LayoutLeafNode;
    expect(r.panels).toEqual([]);
    expect(r.activePanelId).toBeNull();
  });

  it('promotes the next tab, then the previous, then the first', () => {
    const mid = removePanelFromTree(
      leaf('L', ['a', 'b', 'c'], { activePanelId: 'b' }),
      'b',
    ) as LayoutLeafNode;
    expect(mid.activePanelId).toBe('c'); // next
    const last = removePanelFromTree(
      leaf('L', ['a', 'b'], { activePanelId: 'b' }),
      'b',
    ) as LayoutLeafNode;
    expect(last.activePanelId).toBe('a'); // previous
  });

  it("leaves another leaf's selection alone", () => {
    const tree: LayoutNode = {
      type: 'branch',
      orientation: 'horizontal',
      sizes: [0.5, 0.5],
      children: [leaf('L', ['a']), leaf('R', ['b'])],
    };
    const r = removePanelFromTree(tree, 'a') as LayoutLeafNode;
    expect(r.id).toBe('R'); // branch collapsed to its one child
    expect(r.activePanelId).toBe('b');
  });

  it('collapses a branch left with one child, and re-normalises sizes to sum to 1', () => {
    const tree: LayoutNode = {
      type: 'branch',
      orientation: 'vertical',
      sizes: [0.2, 0.3, 0.5],
      children: [leaf('A', ['a']), leaf('B', ['b']), leaf('C', ['c'])],
    };
    const r = removePanelFromTree(tree, 'a');
    expect(r!.type).toBe('branch');
    const sizes = (r as { sizes: number[] }).sizes;
    expect(sizes.length).toBe(2);
    expect(sizes.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
  });

  it('returns null when the last panel of the last leaf goes', () => {
    expect(removePanelFromTree(leaf('L', ['a']), 'a')).toBeNull();
    expect(emptyRoot().panels).toEqual([]);
  });
});

describe('addPanelToLeaf / insertPanelInLeaf', () => {
  it('appends and selects', () => {
    const r = addPanelToLeaf(leaf('L', ['a']), 'L', 'b') as LayoutLeafNode;
    expect(r.panels).toEqual(['a', 'b']);
    expect(r.activePanelId).toBe('b');
  });

  it('only selects a panel already in the leaf, never duplicating it', () => {
    const r = addPanelToLeaf(
      leaf('L', ['a', 'b'], { activePanelId: 'a' }),
      'L',
      'b',
    ) as LayoutLeafNode;
    expect(r.panels).toEqual(['a', 'b']);
    expect(r.activePanelId).toBe('b');
  });

  it('inserts at an index, clamping out-of-range values', () => {
    expect(
      (insertPanelInLeaf(leaf('L', ['a', 'b']), 'L', 'c', 1) as LayoutLeafNode).panels,
    ).toEqual(['a', 'c', 'b']);
    expect(
      (insertPanelInLeaf(leaf('L', ['a', 'b']), 'L', 'c', 99) as LayoutLeafNode).panels,
    ).toEqual(['a', 'b', 'c']);
    expect(
      (insertPanelInLeaf(leaf('L', ['a', 'b']), 'L', 'c', -5) as LayoutLeafNode).panels,
    ).toEqual(['c', 'a', 'b']);
  });

  it('re-orders within the same leaf rather than duplicating', () => {
    const r = insertPanelInLeaf(leaf('L', ['a', 'b', 'c']), 'L', 'c', 0) as LayoutLeafNode;
    expect(r.panels).toEqual(['c', 'a', 'b']);
  });
});

describe('splitLeafInTree / dockToEdge', () => {
  it('splits horizontally for left/right and vertically for top/bottom', () => {
    expect(
      (splitLeafInTree(leaf('L', ['a']), 'L', 'b', 'right', 0.5, 'N') as { orientation: string })
        .orientation,
    ).toBe('horizontal');
    expect(
      (splitLeafInTree(leaf('L', ['a']), 'L', 'b', 'top', 0.5, 'N') as { orientation: string })
        .orientation,
    ).toBe('vertical');
  });

  it('puts the new leaf first for left/top and second for right/bottom, with matching sizes', () => {
    const left = splitLeafInTree(leaf('L', ['a']), 'L', 'b', 'left', 0.3, 'N') as {
      children: LayoutNode[];
      sizes: number[];
    };
    expect((left.children[0] as LayoutLeafNode).id).toBe('N');
    expect(left.sizes).toEqual([0.3, 0.7]);
    const right = splitLeafInTree(leaf('L', ['a']), 'L', 'b', 'right', 0.3, 'N') as {
      children: LayoutNode[];
      sizes: number[];
    };
    expect((right.children[1] as LayoutLeafNode).id).toBe('N');
    expect(right.sizes).toEqual([0.7, 0.3]);
  });

  it('docks to a workspace edge by wrapping the whole tree', () => {
    const root = leaf('L', ['a']);
    const r = dockToEdge(root, 'b', 'bottom', 0.2, 'E') as {
      children: LayoutNode[];
      sizes: number[];
    };
    expect(r.sizes).toEqual([0.8, 0.2]);
    expect((r.children[1] as LayoutLeafNode).panels).toEqual(['b']);
    expect((r.children[0] as LayoutLeafNode).id).toBe('L');
  });
});

describe('lookup helpers', () => {
  const tree: LayoutNode = {
    type: 'branch',
    orientation: 'horizontal',
    sizes: [0.5, 0.5],
    children: [
      {
        type: 'branch',
        orientation: 'vertical',
        sizes: [0.5, 0.5],
        children: [leaf('deep', ['x']), leaf('deeper', ['y'])],
      },
      leaf('side', ['z']),
    ],
  };

  it('findFirstLeafId walks depth-first', () => expect(findFirstLeafId(tree)).toBe('deep'));
  it('findLeafForPanel finds the owning leaf at any depth', () => {
    expect(findLeafForPanel(tree, 'y')).toBe('deeper');
    expect(findLeafForPanel(tree, 'absent')).toBeNull();
  });
  it('findLeaf and leafExists agree', () => {
    expect(findLeaf(tree, 'side')?.panels).toEqual(['z']);
    expect(leafExists(tree, 'side')).toBe(true);
    expect(leafExists(tree, 'nope')).toBe(false);
  });
  it('selectPanelInTree selects only in the owning leaf', () => {
    const r = selectPanelInTree(tree, 'y') as { children: LayoutNode[] };
    const inner = r.children[0] as { children: LayoutNode[] };
    expect((inner.children[1] as LayoutLeafNode).activePanelId).toBe('y');
    expect((r.children[1] as LayoutLeafNode).activePanelId).toBe('z');
  });
  it('updateSizesAtPath updates the addressed branch only', () => {
    const r = updateSizesAtPath(tree, [0], [0.9, 0.1]) as {
      children: LayoutNode[];
      sizes: number[];
    };
    expect((r.children[0] as { sizes: number[] }).sizes).toEqual([0.9, 0.1]);
    expect(r.sizes).toEqual([0.5, 0.5]);
  });
  it('removeLeafFromTree honours canClose: false', () => {
    expect(removeLeafFromTree(leaf('L', [], { canClose: false }), 'L')).not.toBeNull();
    expect(removeLeafFromTree(leaf('L', []), 'L')).toBeNull();
  });
});

describe('isVisibleActiveTarget', () => {
  it("accepts a leaf's selected tab", () => {
    expect(
      isVisibleActiveTarget('a', {
        gridRoot: leaf('L', ['a', 'b']),
        floating: [],
        panels: panels(['a'], ['b']),
      }),
    ).toBe(true);
  });
  it('rejects a tab that is not selected', () => {
    expect(
      isVisibleActiveTarget('b', {
        gridRoot: leaf('L', ['a', 'b']),
        floating: [],
        panels: panels(['a'], ['b']),
      }),
    ).toBe(false);
  });
  it('accepts a floating window', () => {
    expect(
      isVisibleActiveTarget('f', {
        gridRoot: emptyRoot(),
        floating: [{ id: 'f', x: 0, y: 0, width: 1, height: 1, z: 1 }],
        panels: panels(['f', 'floating']),
      }),
    ).toBe(true);
  });
  it('never accepts a minimized panel, even though it is still mounted', () => {
    expect(
      isVisibleActiveTarget('m', {
        gridRoot: leaf('L', ['m']),
        floating: [],
        panels: panels(['m', 'minimized']),
      }),
    ).toBe(false);
  });
  it('rejects an unknown id', () => {
    expect(
      isVisibleActiveTarget('ghost', { gridRoot: emptyRoot(), floating: [], panels: {} }),
    ).toBe(false);
  });
});

describe('deriveActivePanelId', () => {
  it("picks the first leaf's selected tab, depth-first — not breadth-first", () => {
    // A breadth-first walk reaches `side` before the first child's own leaves and answers
    // 'z'. Object key order is deliberately c,b,a so a keys[0]-style seed would answer 'z'
    // too: only a depth-first walk gives 'x'.
    const tree: LayoutNode = {
      type: 'branch',
      orientation: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        {
          type: 'branch',
          orientation: 'vertical',
          sizes: [0.5, 0.5],
          children: [leaf('deep', ['x']), leaf('deeper', ['y'])],
        },
        leaf('side', ['z']),
      ],
    };
    const scope = { gridRoot: tree, floating: [], panels: panels(['z'], ['y'], ['x']) };
    expect(deriveActivePanelId(scope)).toBe('x');
  });

  it('skips a leaf whose selection is minimized and continues the walk', () => {
    const tree: LayoutNode = {
      type: 'branch',
      orientation: 'horizontal',
      sizes: [0.5, 0.5],
      children: [leaf('L', ['m']), leaf('R', ['ok'])],
    };
    expect(
      deriveActivePanelId({
        gridRoot: tree,
        floating: [],
        panels: panels(['m', 'minimized'], ['ok']),
      }),
    ).toBe('ok');
  });

  it('falls back to the frontmost floating window when no leaf qualifies', () => {
    expect(
      deriveActivePanelId({
        gridRoot: emptyRoot(),
        floating: [
          { id: 'back', x: 0, y: 0, width: 1, height: 1, z: 5 },
          { id: 'front', x: 0, y: 0, width: 1, height: 1, z: 9 },
        ],
        panels: panels(['back', 'floating'], ['front', 'floating']),
      }),
    ).toBe('front');
  });

  it('returns null when nothing is visible', () => {
    expect(deriveActivePanelId({ gridRoot: emptyRoot(), floating: [], panels: {} })).toBeNull();
    expect(
      deriveActivePanelId({
        gridRoot: leaf('L', ['m']),
        floating: [],
        panels: panels(['m', 'minimized']),
      }),
    ).toBeNull();
  });

  it('never returns a panel absent from panels, however the tree names it', () => {
    expect(
      deriveActivePanelId({ gridRoot: leaf('L', ['ghost']), floating: [], panels: {} }),
    ).toBeNull();
  });
});

// ─── The self-drop guard and the layout repair ────────────────────────────────

describe('isLoneOccupant', () => {
  const tree = {
    type: 'branch' as const,
    orientation: 'horizontal' as const,
    sizes: [0.5, 0.5],
    children: [leaf('solo', ['alpha']), leaf('pair', ['beta', 'gamma'])],
  };

  it('is true only for the one panel that is alone in that leaf', () => {
    expect(isLoneOccupant(tree, 'solo', 'alpha')).toBe(true);
    expect(isLoneOccupant(tree, 'pair', 'beta')).toBe(false);
    expect(isLoneOccupant(tree, 'pair', 'gamma')).toBe(false);
  });

  it('is false for a panel that is not in the named leaf, and for a leaf that is not there', () => {
    expect(isLoneOccupant(tree, 'solo', 'beta')).toBe(false);
    expect(isLoneOccupant(tree, 'ghost', 'alpha')).toBe(false);
  });

  it('is false for an empty leaf', () => {
    expect(isLoneOccupant(leaf('empty', []), 'empty', 'alpha')).toBe(false);
  });
});

describe('repairLayoutTree', () => {
  const docked = (...ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { id, state: 'docked' as const }]));

  it('returns the very same tree when there is nothing to repair', () => {
    const tree = leaf('L', ['alpha', 'beta']);
    const result = repairLayoutTree(tree, docked('alpha', 'beta'));
    expect(result.gridRoot).toBe(tree);
    expect(result.repairs).toEqual([]);
  });

  it('keeps a duplicated panel in the first leaf that lists it, and collapses what is left', () => {
    const result = repairLayoutTree(
      {
        type: 'branch',
        orientation: 'horizontal',
        sizes: [0.5, 0.5],
        children: [leaf('first', ['alpha']), leaf('second', ['alpha'])],
      },
      docked('alpha'),
    );
    expect(result.gridRoot).toEqual(leaf('first', ['alpha']));
    expect(result.repairs).toEqual(['panel "alpha" was listed in more than one group']);
  });

  it('keeps an emptied leaf that asked to stay', () => {
    const result = repairLayoutTree(
      {
        type: 'branch',
        orientation: 'horizontal',
        sizes: [0.5, 0.5],
        children: [leaf('first', ['alpha']), { ...leaf('second', ['alpha']), keepOnEmpty: true }],
      },
      docked('alpha'),
    );
    expect(result.gridRoot.type).toBe('branch');
    expect((result.gridRoot as { children: unknown[] }).children).toHaveLength(2);
  });

  it('re-normalises sizes when a branch loses a child', () => {
    const result = repairLayoutTree(
      {
        type: 'branch',
        orientation: 'horizontal',
        sizes: [0.2, 0.3, 0.5],
        children: [leaf('a', ['alpha']), leaf('b', ['alpha']), leaf('c', ['beta'])],
      },
      docked('alpha', 'beta'),
    );
    const root = result.gridRoot as { sizes: number[] };
    expect(root.sizes.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
  });

  it('puts a docked panel that no leaf lists into the first leaf, and selects it', () => {
    const result = repairLayoutTree(leaf('L', []), docked('alpha'));
    expect(result.gridRoot).toEqual({
      type: 'leaf',
      id: 'L',
      panels: ['alpha'],
      activePanelId: 'alpha',
    });
    expect(result.repairs).toEqual(['panel "alpha" is docked but was in no group']);
  });

  it('leaves floating and minimised panels out of the tree, where they belong', () => {
    const result = repairLayoutTree(leaf('L', []), {
      floater: { id: 'floater', state: 'floating' },
      tucked: { id: 'tucked', state: 'minimized' },
    });
    expect(result.gridRoot).toEqual(leaf('L', []));
    expect(result.repairs).toEqual([]);
  });

  it("moves a duplicated panel's selection with it", () => {
    const result = repairLayoutTree(
      {
        type: 'branch',
        orientation: 'horizontal',
        sizes: [0.5, 0.5],
        children: [
          leaf('first', ['alpha']),
          { type: 'leaf', id: 'second', panels: ['alpha', 'beta'], activePanelId: 'alpha' },
        ],
      },
      docked('alpha', 'beta'),
    );
    const second = (
      result.gridRoot as {
        children: { id: string; panels: string[]; activePanelId: string | null }[];
      }
    ).children.find((c) => c.id === 'second')!;
    expect(second.panels).toEqual(['beta']);
    expect(second.activePanelId).toBe('beta');
  });
});
