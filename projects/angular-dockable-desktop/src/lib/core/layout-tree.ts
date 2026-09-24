/**
 * Pure operations on the layout tree.
 *
 * Every function here takes a tree and returns a new one — no mutation, no signals, no
 * Angular. Ported verbatim from vue-dockable-desktop (vdd). In react-dockable-desktop these lived as closures inside the provider and could
 * only be tested through the rendered component; extracting them means the tree maths is
 * directly testable, which is where the subtle bugs are (see `deriveActivePanelId`).
 */
import type {
  FloatingWindow,
  LayoutLeafNode,
  LayoutNode,
  PanelInfo,
  SplitDirection,
} from './types';

/** An empty workspace: one leaf, no panels. */
export const EMPTY_LEAF: LayoutLeafNode = {
  type: 'leaf',
  id: 'group-default',
  panels: [],
  activePanelId: null,
};

/** A fresh empty root, for when removing the last panel collapses the tree to nothing. */
export const emptyRoot = (): LayoutLeafNode => ({ ...EMPTY_LEAF, panels: [] });

/**
 * Remove a panel from the tree.
 *
 * Returns `null` when the node itself should disappear — an emptied leaf without
 * `keepOnEmpty`, or a branch left with no children. A branch left with one child collapses
 * to that child, and surviving `sizes` are re-normalised to sum to 1.
 *
 * When the removed panel was its leaf's selected tab, selection moves to the next tab, then
 * the previous, then the first — the order a user expects after closing a tab.
 */
export function removePanelFromTree(node: LayoutNode, id: string): LayoutNode | null {
  if (node.type === 'leaf') {
    const idx = node.panels.indexOf(id);
    if (idx === -1) return node;
    const panels = node.panels.filter((p) => p !== id);
    const activePanelId =
      node.activePanelId === id
        ? (panels[idx] ?? panels[idx - 1] ?? panels[0] ?? null)
        : node.activePanelId;
    if (panels.length === 0 && !node.keepOnEmpty) return null;
    return { ...node, panels, activePanelId };
  }

  const children = node.children
    .map((c) => removePanelFromTree(c, id))
    .filter((c): c is LayoutNode => c !== null);

  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;

  const sizes = node.sizes.slice(0, children.length);
  const sum = sizes.reduce((a, b) => a + b, 0);
  return { ...node, children, sizes: sizes.map((s) => s / sum) };
}

/**
 * Add a panel to a leaf. A panel already in that leaf is not duplicated.
 *
 * `select: false` adds it **without** making it the leaf's selected tab — what "open in the
 * background" has to mean. Selecting it anyway would make the newly added panel the visible
 * tab while some other panel stayed globally active, which is precisely the disagreement
 * between leaf selection and `activePanelId` that divergence D2 is about. (rdd's
 * `focus: false` did exactly that.)
 */
export function addPanelToLeaf(
  node: LayoutNode,
  leafId: string,
  panelId: string,
  options?: { select?: boolean },
): LayoutNode {
  const select = options?.select !== false;
  if (node.type === 'leaf') {
    if (node.id !== leafId) return node;
    const panels = node.panels.includes(panelId) ? node.panels : [...node.panels, panelId];
    const activePanelId = select ? panelId : (node.activePanelId ?? panelId);
    return { ...node, panels, activePanelId };
  }
  return {
    ...node,
    children: node.children.map((c) => addPanelToLeaf(c, leafId, panelId, options)),
  };
}

/** Insert a panel into a leaf at a specific tab index, and select it. */
export function insertPanelInLeaf(
  node: LayoutNode,
  leafId: string,
  panelId: string,
  index: number,
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.id !== leafId) return node;
    const remaining = node.panels.filter((p) => p !== panelId);
    const at = Math.max(0, Math.min(index, remaining.length));
    const panels = [...remaining];
    panels.splice(at, 0, panelId);
    return { ...node, panels, activePanelId: panelId };
  }
  return {
    ...node,
    children: node.children.map((c) => insertPanelInLeaf(c, leafId, panelId, index)),
  };
}

/** Default id scheme for leaves created by a split. Any string is valid; this one is legible. */
export const defaultLeafId = (kind: 'split' | 'edge'): string =>
  `group-${kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/**
 * Split a leaf, putting `panelId` in a new leaf on the given side.
 *
 * `newLeafId` is injectable so tests can assert tree shape without a timestamp in it.
 */
export function splitLeafInTree(
  node: LayoutNode,
  leafId: string,
  panelId: string,
  position: SplitDirection,
  splitRatio: number,
  newLeafId: string = defaultLeafId('split'),
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.id !== leafId) return node;
    const newLeaf: LayoutLeafNode = {
      type: 'leaf',
      id: newLeafId,
      panels: [panelId],
      activePanelId: panelId,
    };
    const first = position === 'left' || position === 'top';
    return {
      type: 'branch',
      orientation: position === 'left' || position === 'right' ? 'horizontal' : 'vertical',
      sizes: first ? [splitRatio, 1 - splitRatio] : [1 - splitRatio, splitRatio],
      children: first ? [newLeaf, node] : [node, newLeaf],
    };
  }
  return {
    ...node,
    children: node.children.map((c) =>
      splitLeafInTree(c, leafId, panelId, position, splitRatio, newLeafId),
    ),
  };
}

/** Wrap the whole tree in a branch, docking `panelId` as a full-width/height edge row. */
export function dockToEdge(
  root: LayoutNode,
  panelId: string,
  position: SplitDirection,
  edgeRatio: number,
  newLeafId: string = defaultLeafId('edge'),
): LayoutNode {
  const newLeaf: LayoutLeafNode = {
    type: 'leaf',
    id: newLeafId,
    panels: [panelId],
    activePanelId: panelId,
  };
  const first = position === 'left' || position === 'top';
  return {
    type: 'branch',
    orientation: position === 'left' || position === 'right' ? 'horizontal' : 'vertical',
    sizes: first ? [edgeRatio, 1 - edgeRatio] : [1 - edgeRatio, edgeRatio],
    children: first ? [newLeaf, root] : [root, newLeaf],
  };
}

/** Remove a leaf entirely, honouring its `canClose`. Collapses and re-normalises like removal. */
export function removeLeafFromTree(node: LayoutNode, leafId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.id === leafId && node.canClose !== false ? null : node;
  const children = node.children
    .map((c) => removeLeafFromTree(c, leafId))
    .filter((c): c is LayoutNode => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  const sizes = node.sizes.slice(0, children.length);
  const sum = sizes.reduce((a, b) => a + b, 0);
  return { ...node, children, sizes: sizes.map((s) => s / sum) };
}

/** Select a panel as its leaf's active tab, wherever it is. */
export function selectPanelInTree(node: LayoutNode, id: string): LayoutNode {
  if (node.type === 'leaf') return node.panels.includes(id) ? { ...node, activePanelId: id } : node;
  return { ...node, children: node.children.map((c) => selectPanelInTree(c, id)) };
}

/** The first leaf in document order, depth-first. */
export function findFirstLeafId(node: LayoutNode): string | null {
  if (node.type === 'leaf') return node.id;
  for (const child of node.children) {
    const id = findFirstLeafId(child);
    if (id) return id;
  }
  return null;
}

/** The leaf containing a panel, or `null`. */
export function findLeafForPanel(node: LayoutNode, id: string): string | null {
  if (node.type === 'leaf') return node.panels.includes(id) ? node.id : null;
  for (const child of node.children) {
    const found = findLeafForPanel(child, id);
    if (found) return found;
  }
  return null;
}

/** A leaf by id, or `null`. */
export function findLeaf(node: LayoutNode | null, leafId: string): LayoutLeafNode | null {
  if (!node) return null;
  if (node.type === 'leaf') return node.id === leafId ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, leafId);
    if (found) return found;
  }
  return null;
}

/**
 * Is `panelId` the only panel in `leafId`?
 *
 * The question every dock action has to ask *before* it detaches anything. Detaching a panel
 * deletes its leaf once that leaf is empty, so a drop onto the dragged panel's own leaf
 * destroys the very target it names, and the placement that follows has nowhere to go.
 * Dropping a lone panel onto itself is a no-op by definition: the result is the layout it
 * already has.
 */
export function isLoneOccupant(node: LayoutNode, leafId: string, panelId: string): boolean {
  const leaf = findLeaf(node, leafId);
  return leaf !== null && leaf.panels.length === 1 && leaf.panels[0] === panelId;
}

/**
 * Heal a tree that lists a panel twice, or lists none of a docked panel.
 *
 * Both are states this library once produced and then *saved*: a lone docked panel dropped
 * on its own group left rdd with the panel in two leaves and vdd with it in none, and
 * `saveLayout()` wrote the result out, so the fault returned on every reload. Repairing on
 * read means a layout stored by an affected version loads clean with nothing asked of the
 * application. It changes only what is read; `saveLayout()`'s output is untouched, which is
 * what keeps the format compatible (docs/decisions/0008-layout-json-compatibility.md).
 *
 * `repairs` is empty and the input object is returned unchanged when there is nothing wrong,
 * so a healthy layout costs one walk and no allocation.
 */
export function repairLayoutTree(
  gridRoot: LayoutNode,
  panels: Record<string, { id: string; state: PanelInfo['state'] }>,
): { gridRoot: LayoutNode; repairs: string[] } {
  const repairs: string[] = [];
  const seen = new Set<string>();

  const walk = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'leaf') {
      const kept = node.panels.filter((id) => {
        if (seen.has(id)) {
          repairs.push(`panel "${id}" was listed in more than one group`);
          return false;
        }
        seen.add(id);
        return true;
      });
      if (kept.length === node.panels.length) return node;
      if (kept.length === 0 && !node.keepOnEmpty) return null;
      const activePanelId =
        node.activePanelId && kept.includes(node.activePanelId)
          ? node.activePanelId
          : (kept[0] ?? null);
      return { ...node, panels: kept, activePanelId };
    }

    const children = node.children.map(walk).filter((c): c is LayoutNode => c !== null);
    // Identity, not count: a child can survive the walk and still have been repaired inside.
    // Comparing lengths alone returned the original branch and threw those repairs away.
    if (
      children.length === node.children.length &&
      children.every((c, i) => c === node.children[i])
    ) {
      return node;
    }
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]!;
    const sizes = node.sizes.slice(0, children.length);
    const sum = sizes.reduce((a, b) => a + b, 0) || 1;
    return { ...node, children, sizes: sizes.map((s) => s / sum) };
  };

  let root = walk(gridRoot) ?? emptyRoot();

  // A panel the layout calls docked but that no leaf lists renders nowhere and cannot be
  // reached from the workspace at all — not by clicking, and not by re-opening it.
  const orphans = Object.values(panels).filter((p) => p.state === 'docked' && !seen.has(p.id));
  if (orphans.length > 0) {
    for (const orphan of orphans)
      repairs.push(`panel "${orphan.id}" is docked but was in no group`);
    const ids = orphans.map((o) => o.id);
    const attach = (node: LayoutNode): LayoutNode =>
      node.type === 'leaf'
        ? {
            ...node,
            panels: [...node.panels, ...ids],
            activePanelId: node.activePanelId ?? ids[0]!,
          }
        : { ...node, children: [attach(node.children[0]!), ...node.children.slice(1)] };
    root = attach(root);
  }

  return { gridRoot: root, repairs };
}

/** Whether a leaf exists in the tree. */
export function leafExists(node: LayoutNode, leafId: string): boolean {
  return findLeaf(node, leafId) !== null;
}

/** Update the sizes of the branch at `path` (a list of child indices from the root). */
export function updateSizesAtPath(node: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  const walk = (n: LayoutNode, depth: number): LayoutNode => {
    if (n.type === 'leaf') return n;
    if (depth === path.length) return { ...n, sizes };
    const idx = path[depth]!;
    return { ...n, children: n.children.map((c, i) => (i === idx ? walk(c, depth + 1) : c)) };
  };
  return walk(node, 0);
}

// ── Which panel is active ────────────────────────────────────────────────────

/** The subset of a layout needed to reason about visibility. */
export interface ActiveTargetScope {
  gridRoot: LayoutNode | null;
  floating: FloatingWindow[];
  panels: Record<string, PanelInfo>;
}

/**
 * Whether `id` names a panel the user can actually see, and which may therefore be the
 * globally active one: the selected tab of some leaf, or a floating window.
 *
 * A minimised panel never qualifies. It stays mounted, so leaving it active would keep
 * routing contributed controls to a panel that is not on screen — the defect family that
 * cost react-dockable-desktop two releases.
 *
 * Used both to validate a persisted `activePanelId` on load and to guard the one written on
 * save, so the two directions cannot disagree about what "active" is allowed to mean.
 */
export function isVisibleActiveTarget(id: string, scope: ActiveTargetScope): boolean {
  const info = scope.panels[id];
  if (!info || info.state === 'minimized') return false;
  if (scope.floating.some((w) => w.id === id)) return true;
  const isLeafSelection = (node: LayoutNode): boolean =>
    node.type === 'leaf' ? node.activePanelId === id : node.children.some(isLeafSelection);
  return scope.gridRoot ? isLeafSelection(scope.gridRoot) : false;
}

/**
 * Derive the globally active panel, in order:
 *
 *   1. the first leaf in document order whose own selected tab is a valid target;
 *   2. otherwise the frontmost (highest `z`) floating window, so a float-only layout does
 *      not come back with nothing active;
 *   3. otherwise `null`.
 *
 * **Depth-first, not breadth-first.** For a grid whose first child is itself a split, a
 * level-by-level walk reaches the *second* child's leaf before the first child's own
 * children, and picks the wrong tab. Mirrors `findFirstLeafId`'s traversal for that reason.
 *
 * Never an arbitrary entry in `panels`: that seed is what made a restored workspace come
 * back with one panel visible and a different, invisible one marked active.
 */
export function deriveActivePanelId(scope: ActiveTargetScope): string | null {
  const isCandidate = (id: string | null): boolean =>
    id !== null && !!scope.panels[id] && scope.panels[id]!.state !== 'minimized';

  const fromLeaves = (node: LayoutNode): string | null => {
    if (node.type === 'leaf') return isCandidate(node.activePanelId) ? node.activePanelId : null;
    for (const child of node.children) {
      const found = fromLeaves(child);
      if (found) return found;
    }
    return null;
  };

  const selected = scope.gridRoot ? fromLeaves(scope.gridRoot) : null;
  if (selected) return selected;

  let frontmost: FloatingWindow | null = null;
  for (const w of scope.floating) {
    if (!isCandidate(w.id)) continue;
    if (!frontmost || w.z > frontmost.z) frontmost = w;
  }
  return frontmost?.id ?? null;
}
