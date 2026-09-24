/**
 * Reading a saved layout.
 *
 * The format is byte-compatible with react-dockable-desktop 6.2.0 in both directions at
 * `version: 2` — a hard requirement, see docs/decisions/0008-layout-json-compatibility.md.
 * Anything in this file that changes what is read or written is a compatibility change.
 */
import type { FloatAnchor, FloatingWindow, LayoutNode, PanelInfo, SerializedLayout } from './types';
import {
  deriveActivePanelId,
  isVisibleActiveTarget,
  repairLayoutTree,
  EMPTY_LEAF,
} from './layout-tree';
import type { ActiveTargetScope } from './layout-tree';

/** A validated payload, with `activePanelId` already resolved. */
export interface ParsedLayout {
  gridRoot: LayoutNode;
  floating: FloatingWindow[];
  minimized: { id: string; title: PanelInfo['title']; component: string }[];
  panels: Record<string, PanelInfo>;
  activePanelId: string | null;
}

/**
 * Pre-`anchor` layouts stored two booleans instead of a corner. Carried over verbatim from
 * rdd, including its quirk that `stickyBottom` alone maps to `'bottom-left'`.
 */
function migrateFloating(floating: unknown[]): FloatingWindow[] {
  return floating.map((raw) => {
    const fw = raw as Record<string, unknown>;
    if (!('stickyRight' in fw) && !('stickyBottom' in fw)) return fw as unknown as FloatingWindow;
    const anchor: FloatAnchor | null =
      fw['stickyRight'] && fw['stickyBottom']
        ? 'bottom-right'
        : fw['stickyRight']
          ? 'top-right'
          : fw['stickyBottom']
            ? 'bottom-left'
            : null;
    const { stickyRight: _sr, stickyBottom: _sb, ...rest } = fw;
    return { ...rest, anchor } as unknown as FloatingWindow;
  });
}

/**
 * Validate and normalise a parsed JSON payload, or return `null` if it is not a layout.
 *
 * Both entry points — a workspace's `initialState` and `loadLayout()` — go through here, so
 * the shape check, the migration and the `activePanelId` resolution cannot drift apart
 * between them. In rdd they once did: only one of the two ran the migration.
 */
export function parseLayoutPayload(
  parsed: unknown,
  onWarn?: (msg: string) => void,
): ParsedLayout | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (!p['gridRoot'] || !Array.isArray(p['floating']) || !Array.isArray(p['minimized']) || !p['panels'])
    return null;

  const floating = migrateFloating(p['floating']);
  const panels = p['panels'] as Record<string, PanelInfo>;

  // Repair before anything reads the tree: `activePanelId` resolution below asks which panels
  // are visible, and a layout that lists a panel twice — or lists none of a docked one — has
  // no honest answer. Layouts saved by earlier versions can contain both.
  const repaired = repairLayoutTree(p['gridRoot'] as LayoutNode, panels);
  if (repaired.repairs.length > 0) {
    if (typeof ngDevMode === 'undefined' || ngDevMode) onWarn?.(
      `Repaired the saved layout on load: ${repaired.repairs.join('; ')}. Layouts written ` +
        `before this version could contain it — dropping a lone docked panel onto its own group ` +
        `left the panel in no group — and the repair runs every time the layout is read, so ` +
        `saving again from this session stores the corrected layout.`,
    );
  }
  const gridRoot = repaired.gridRoot;
  const scope: ActiveTargetScope = { gridRoot, floating, panels };

  // A persisted value wins while it still names a visible panel. Anything stale — the panel
  // was closed, minimised, or pruned from this snapshot — falls back to deriving from the
  // grid, which is also the path every pre-`activePanelId` layout takes.
  const persisted = typeof p['activePanelId'] === 'string' ? p['activePanelId'] : null;
  let activePanelId: string | null = null;
  if (persisted !== null) {
    if (isVisibleActiveTarget(persisted, scope)) activePanelId = persisted;
    else
      if (typeof ngDevMode === 'undefined' || ngDevMode) onWarn?.(
        `Ignoring the saved layout's activePanelId ("${persisted}") — it does not name a ` +
          `currently visible panel (it may have been closed, minimised, or excluded from the ` +
          `snapshot as non-serialisable). Falling back to the selected tab of the first leaf.`,
      );
  }
  if (activePanelId === null) activePanelId = deriveActivePanelId(scope);

  return {
    gridRoot,
    floating,
    minimized: p['minimized'] as ParsedLayout['minimized'],
    panels,
    activePanelId,
  };
}

/** Parse a layout string, falling back to an empty workspace. Never throws. */
export function parseInitialState(
  json: string | null | undefined,
  onWarn?: (msg: string) => void,
): ParsedLayout {
  if (json) {
    try {
      const payload = parseLayoutPayload(JSON.parse(json), onWarn);
      if (payload) return payload;
    } catch {
      if (typeof ngDevMode === 'undefined' || ngDevMode) onWarn?.('initialState is not valid JSON; starting from an empty workspace.');
    }
  }
  return {
    gridRoot: { ...EMPTY_LEAF, panels: [] },
    floating: [],
    minimized: [],
    panels: {},
    activePanelId: null,
  };
}

/** The schema version this library writes. Changing it is a breaking change for both libraries. */
export const LAYOUT_VERSION = 2 satisfies NonNullable<SerializedLayout['version']>;
