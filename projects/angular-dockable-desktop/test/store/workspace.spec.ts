/** Ported from vue-dockable-desktop `test/store/workspace.test.ts` — driving code converted to Angular by scripts/port/convert.py, then reviewed; assertions and test names unchanged unless a comment says otherwise (ADR 0009). */
/**
 * The workspace store.
 *
 * Ports `SpawnLifecycle.test.tsx` (5) and the portable half of `V2Features.test.tsx`
 * (`isOpen`/`getOpenPanelIds`, the unregistered-key warning), names preserved. V2Features'
 * pending-call-queue tests are **moot**: the queue does not exist, because the store is live
 * before any component (docs/decisions/0004-store-outside-components.md, PARITY.md §3).
 */
import { Component } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';

@Component({ selector: 'ndd-test-map-panel', template: '' })
class MapPanel {}
@Component({ selector: 'ndd-test-locked-panel', template: '' })
class Locked {}

const NESTED = JSON.stringify({
  version: 2,
  gridRoot: {
    type: 'branch',
    orientation: 'horizontal',
    sizes: [0.5, 0.5],
    children: [
      { type: 'leaf', id: 'L', panels: [], activePanelId: null },
      { type: 'leaf', id: 'R', panels: [], activePanelId: null, keepOnEmpty: true },
    ],
  },
  floating: [],
  minimized: [],
  panels: {},
});

const ws = (initialState?: string) =>
  createWorkspace({
    panels: {
      map: { component: MapPanel },
      locked: {
        component: Locked,
        defaultOptions: { canClose: false, canMinimize: false, canDrag: false },
      },
      titled: {
        component: MapPanel,
        defaultOptions: { title: { id: 'panel.titled', defaultMessage: 'Titled Panel' } },
      },
      floaty: { component: MapPanel, defaultOptions: { initialTarget: 'floating' } },
    },
    ...(initialState ? { initialState } : {}),
  });

describe('the workspace is live before any component exists', () => {
  it('openPanel works with no app created and nothing mounted', () => {
    // The whole reason rdd needed a pending-call queue, a _connect handshake, an isConnected
    // flag and a never-connected warning. None of that exists here.
    const w = ws();
    w.openPanel('p1', 'map');
    expect(w.isOpen('p1')).toBe(true);
    expect(w.state().activePanelId).toBe('p1');
    expect(w.saveLayout()).toContain('p1');
  });

  it('two workspaces are fully independent', () => {
    const a = ws();
    const b = ws();
    a.openPanel('only-in-a', 'map');
    expect(b.isOpen('only-in-a')).toBe(false);
    expect(b.getOpenPanelIds()).toEqual([]);
  });
});

describe('WindowManager Panel Spawning & Lifecycle', () => {
  it('should spawn a new panel into the grid layout', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    expect(w.state().panels['p1']!.state).toBe('docked');
    expect(JSON.stringify(w.state().gridRoot)).toContain('p1');
  });

  it('should spawn a new panel in floating state', () => {
    const w = ws();
    w.openPanel('f1', 'map', { initialTarget: 'floating' });
    expect(w.state().panels['f1']!.state).toBe('floating');
    expect(w.state().floating.map((x) => x.id)).toEqual(['f1']);
  });

  it('should honour initialTarget from the registry', () => {
    const w = ws();
    w.openPanel('f1', 'floaty');
    expect(w.state().panels['f1']!.state).toBe('floating');
  });

  it('should prevent closing panels that are marked canClose: false', () => {
    const w = ws();
    w.openPanel('l', 'locked');
    w.closePanel('l');
    expect(w.isOpen('l')).toBe(true);
  });

  it('should prevent minimizing panels that are marked canMinimize: false', () => {
    const w = ws();
    w.openPanel('l', 'locked');
    w.minimizePanel('l');
    expect(w.state().panels['l']!.state).toBe('docked');
  });

  it('should correctly format object titles using defaultMessage fallbacks', () => {
    const w = ws();
    w.openPanel('t', 'titled');
    expect(w.format(w.state().panels['t']!.title)).toBe('Titled Panel');
  });

  it('should use a configured formatter for message descriptors', () => {
    const w = createWorkspace({
      panels: {
        titled: {
          component: MapPanel,
          defaultOptions: { title: { id: 'panel.titled', defaultMessage: 'Titled Panel' } },
        },
      },
      formatMessage: (m) => `[${m.id}]`,
    });
    w.openPanel('t', 'titled');
    expect(w.format(w.state().panels['t']!.title)).toBe('[panel.titled]');
  });

  it('should interpolate values when no formatter is configured', () => {
    const w = ws();
    expect(w.format({ id: 'x', defaultMessage: 'Hello {name}', values: { name: 'world' } })).toBe(
      'Hello world',
    );
  });

  it('should support closing empty groups', () => {
    const w = ws(NESTED);
    w.openPanel('k', 'map');
    w.dockPanelToGroup('k', 'R', 'center');
    w.closePanel('k');
    expect(JSON.stringify(w.state().gridRoot)).toContain('"R"'); // kept: keepOnEmpty
    w.closeLeafGroup('R');
    expect(JSON.stringify(w.state().gridRoot)).not.toContain('"R"');
  });
});

describe('C4: isOpen() and getOpenPanelIds()', () => {
  it('isOpen returns false before panel is opened and true after', () => {
    const w = ws();
    expect(w.isOpen('p1')).toBe(false);
    w.openPanel('p1', 'map');
    expect(w.isOpen('p1')).toBe(true);
  });

  it('isOpen returns false after panel is closed', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    w.closePanel('p1');
    expect(w.isOpen('p1')).toBe(false);
  });

  it('getOpenPanelIds returns empty array on a fresh workspace', () => {
    expect(ws().getOpenPanelIds()).toEqual([]);
  });

  it('getOpenPanelIds returns correct IDs after opening several panels', () => {
    const w = ws();
    w.openPanel('a', 'map');
    w.openPanel('b', 'map');
    w.openPanel('c', 'map');
    expect(w.getOpenPanelIds()).toEqual(['a', 'b', 'c']);
  });

  it('getOpenPanelIds excludes closed panels', () => {
    const w = ws();
    w.openPanel('a', 'map');
    w.openPanel('b', 'map');
    w.closePanel('a');
    expect(w.getOpenPanelIds()).toEqual(['b']);
  });

  it('isOpen includes a minimized panel, which is still open', () => {
    const w = ws();
    w.openPanel('a', 'map');
    w.minimizePanel('a');
    expect(w.isOpen('a')).toBe(true);
  });
});

describe('C1: console.warn for unregistered component key', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('emits console.warn when a panel references an unregistered component key', () => {
    ws().openPanel('p', 'nope');
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toContain('nope');
  });

  it('does NOT warn for registered component keys', () => {
    ws().openPanel('p', 'map');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('dedupe', () => {
  it('focuses the existing panel instead of opening a second one', () => {
    const w = ws();
    w.openPanel('doc-1', 'map', { inputs: { path: '/a.md' }, dedupeKey: '/a.md' });
    w.openPanel('doc-2', 'map', { inputs: { path: '/a.md' }, dedupeKey: '/a.md' });
    expect(w.getOpenPanelIds()).toEqual(['doc-1']);
    expect(w.state().activePanelId).toBe('doc-1');
  });

  it('findPanelId locates an open panel by component and key', () => {
    const w = ws();
    w.openPanel('doc-1', 'map', { dedupeKey: '/a.md' });
    expect(w.findPanelId('map', '/a.md')).toBe('doc-1');
    expect(w.findPanelId('map', '/missing.md')).toBeNull();
  });
});

describe('props and serialisability', () => {
  it('classifies serialisable props as serialisable', () => {
    const w = ws();
    w.openPanel('p', 'map', { inputs: { path: '/a.md', n: 1 } });
    expect(w.state().panels['p']!.serializable).toBe(true);
  });

  it('classifies props containing a function as non-serialisable, but still opens the panel', () => {
    const w = ws();
    w.openPanel('p', 'map', { inputs: { onSave: () => {} } });
    expect(w.state().panels['p']!.serializable).toBe(false);
    expect(w.isOpen('p')).toBe(true); // it works on screen; it just will not be saved
  });

  it('treats a panel with no props as serialisable', () => {
    const w = ws();
    w.openPanel('p', 'map');
    expect(w.state().panels['p']!.serializable).toBe(true);
  });
});

describe('direction', () => {
  it('defaults to ltr and reflects isRtl', () => {
    const w = ws();
    expect(w.state().dir).toBe('ltr');
    expect(w.state().isRtl).toBe(false);
  });

  it('setDirection updates both dir and isRtl', () => {
    const w = ws();
    w.setDirection('rtl');
    expect(w.state().dir).toBe('rtl');
    expect(w.state().isRtl).toBe(true);
  });

  it('honours dir from config', () => {
    expect(createWorkspace({ dir: 'rtl' }).state().isRtl).toBe(true);
  });
});

describe('split ratios are clamped', () => {
  it('clamps out-of-range configuration to 0.1–0.9', () => {
    expect(
      createWorkspace({ defaultSplitRatio: 5, defaultEdgeSplitRatio: -1 }).state(),
    ).toMatchObject({ splitRatio: 0.9, edgeSplitRatio: 0.1 });
  });

  it('uses 0.5 and 0.2 by default', () => {
    expect(createWorkspace().state()).toMatchObject({ splitRatio: 0.5, edgeSplitRatio: 0.2 });
  });
});

describe('state is read-only from the outside', () => {
  it('rejects a direct write to state', () => {
    const w = ws();
    w.openPanel('p', 'map');
    // Mutating through the public handle must not work: actions are the only way in.
    // Shape change from vdd, which *ignored* the set on a readonly proxy: ndd's state is a
    // signal of a dev-mode frozen object, so the set throws — and the state is still unchanged.
    expect(() => {
      (w.state() as { activePanelId: string | null }).activePanelId = 'hacked';
    }).toThrow(TypeError);
    expect(w.state().activePanelId).toBe('p');
  });
});
