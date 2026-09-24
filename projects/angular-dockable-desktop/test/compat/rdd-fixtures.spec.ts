/**
 * Cross-implementation compatibility: layouts saved by react-dockable-desktop load here.
 *
 * A hard requirement, not a nicety — docs/decisions/0008-layout-json-compatibility.md. A
 * team migrating a React or Vue app to Angular rewrites call sites; their users should not
 * lose the workspaces they arranged.
 *
 * Ported verbatim from vue-dockable-desktop `test/compat/rdd-fixtures.test.ts` (30 tests,
 * names preserved); only paths changed. Lands at M2 rather than M3 because it needs nothing
 * but the pure parser.
 *
 * The fixtures in `test/fixtures/rdd-6.2.0/` were **produced by rdd 6.2.0 itself** by
 * driving its own actions and calling its own `saveLayout()` — not hand-written to match
 * what we expect. The two exceptions are labelled below: legacy shapes rdd can no longer
 * produce but must still be able to read.
 *
 * This milestone proves *reading* is faithful. The full save → load → save round-trip
 * lands with `saveLayout()` in M6 and is gated again at M13.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLayoutPayload } from '../../src/lib/core/serialize';
import { findLeafForPanel } from '../../src/lib/core/layout-tree';
import type { LayoutLeafNode } from '../../src/lib/core/types';

const DIR = resolve(process.cwd(), 'projects/angular-dockable-desktop/test/fixtures/rdd-6.2.0');
const load = (name: string) => JSON.parse(readFileSync(resolve(DIR, `${name}.json`), 'utf8'));
const parse = (name: string) => {
  const raw = load(name);
  const parsed = parseLayoutPayload(raw);
  expect(parsed, `${name}.json failed to parse`).not.toBeNull();
  return { raw, parsed: parsed! };
};

describe('every rdd 6.2.0 fixture parses', () => {
  const names = readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));

  it('has fixtures to test against', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it.each(names)(
    '%s parses and preserves its tree, floating, minimized and panels verbatim',
    (name) => {
      const { raw, parsed } = parse(name);
      expect(parsed.gridRoot).toEqual(raw.gridRoot);
      expect(parsed.minimized).toEqual(raw.minimized);
      expect(parsed.panels).toEqual(raw.panels);
      // `floating` is only rewritten for pre-`anchor` layouts, which is the migration below.
      if (!JSON.stringify(raw.floating).includes('sticky'))
        expect(parsed.floating).toEqual(raw.floating);
    },
  );
});

describe('the shapes rdd writes are read as rdd means them', () => {
  it('two-tabs: both panels in one leaf, the saved active panel honoured', () => {
    const { raw, parsed } = parse('two-tabs');
    expect(parsed.activePanelId).toBe(raw.activePanelId);
    expect(findLeafForPanel(parsed.gridRoot, 'p1')).toBe(findLeafForPanel(parsed.gridRoot, 'p2'));
  });

  it('nested-splits: a nested branch survives, and the active panel is the saved one', () => {
    const { raw, parsed } = parse('nested-splits');
    expect(parsed.gridRoot.type).toBe('branch');
    expect(parsed.activePanelId).toBe(raw.activePanelId);
  });

  it('floating-anchored: anchor and maximized survive, and z-order is preserved', () => {
    const { parsed } = parse('floating-anchored');
    expect(parsed.floating.some((w) => w.anchor === 'bottom-right')).toBe(true);
    expect(parsed.floating.some((w) => w.maximized === true)).toBe(true);
    expect(parsed.floating.every((w) => typeof w.z === 'number')).toBe(true);
  });

  it('minimized: previousState, lastLeafId and lastFloatingRect all survive', () => {
    const { parsed } = parse('minimized');
    expect(parsed.minimized.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
    expect(parsed.panels['m1']!.previousState).toBe('docked');
    expect(parsed.panels['m1']!.lastLeafId).toBeTruthy();
    expect(parsed.panels['m2']!.previousState).toBe('floating');
    expect(parsed.panels['m2']!.lastFloatingRect).toBeTruthy();
    // and a minimized panel is never chosen as active, even though it stays mounted
    expect(parsed.panels[parsed.activePanelId!]!.state).not.toBe('minimized');
  });

  it('with-props: per-instance props, dedupeKey and the serializable flag survive', () => {
    const { parsed } = parse('with-props');
    expect(parsed.panels['d1']!.props).toEqual({ path: '/a.md', scrollTop: 120, tags: ['x'] });
    expect(parsed.panels['d1']!.dedupeKey).toBe('/a.md');
    expect(parsed.panels['d1']!.serializable).toBe(true);
  });

  it('non-serializable-pruned: rdd already removed the excluded panel, and we do not resurrect it', () => {
    const { parsed } = parse('non-serializable-pruned');
    expect(parsed.panels['bad']).toBeUndefined();
    expect(parsed.panels['ok']).toBeDefined();
    expect(JSON.stringify(parsed.gridRoot)).not.toContain('bad');
  });

  it('keep-on-empty: an emptied leaf that asked to survive is still there', () => {
    const { parsed } = parse('keep-on-empty');
    const find = (n: LayoutLeafNode | null): boolean => !!n;
    const walk = (node: typeof parsed.gridRoot): LayoutLeafNode | null =>
      node.type === 'leaf'
        ? node.keepOnEmpty
          ? node
          : null
        : node.children.reduce<LayoutLeafNode | null>((a, c) => a ?? walk(c), null);
    expect(find(walk(parsed.gridRoot))).toBe(true);
  });

  it('empty: an empty workspace is a valid layout, not a parse failure', () => {
    const { parsed } = parse('empty');
    expect(parsed.activePanelId).toBeNull();
    expect(parsed.panels).toEqual({});
  });
});

describe('legacy shapes rdd can no longer produce but must still read', () => {
  it('pre-activePanelId: derives the active panel from the grid instead', () => {
    const { raw, parsed } = parse('pre-activepanelid');
    expect(raw.activePanelId).toBeUndefined();
    expect(parsed.activePanelId).toBe('p2'); // the first leaf's own selected tab
  });

  it('legacy sticky flags migrate to a logical anchor, and the booleans are dropped', () => {
    const { parsed } = parse('legacy-sticky-no-version');
    const w = parsed.floating.find((f) => f.id === 'legacy1')!;
    expect(w.anchor).toBe('bottom-right'); // stickyRight + stickyBottom
    expect('stickyRight' in w).toBe(false);
    expect('stickyBottom' in w).toBe(false);
  });

  it('a missing version field is treated as readable, not rejected', () => {
    const { raw, parsed } = parse('legacy-sticky-no-version');
    expect(raw.version).toBeUndefined();
    expect(parsed.gridRoot).toBeTruthy();
  });
});

describe('malformed input is rejected rather than half-applied', () => {
  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an empty object', {}],
    ['missing gridRoot', { floating: [], minimized: [], panels: {} }],
    ['floating not an array', { gridRoot: {}, floating: {}, minimized: [], panels: {} }],
    ['minimized not an array', { gridRoot: {}, floating: [], minimized: {}, panels: {} }],
    ['missing panels', { gridRoot: {}, floating: [], minimized: [] }],
  ])('rejects %s', (_label, input) => {
    expect(parseLayoutPayload(input)).toBeNull();
  });

  it('warns, rather than throwing, when a saved activePanelId is no longer visible', () => {
    const raw = load('minimized');
    const warnings: string[] = [];
    const parsed = parseLayoutPayload({ ...raw, activePanelId: 'm1' }, (m) => warnings.push(m))!;
    expect(parsed.activePanelId).not.toBe('m1'); // m1 is minimized
    expect(warnings.join(' ')).toContain('m1');
  });
});
