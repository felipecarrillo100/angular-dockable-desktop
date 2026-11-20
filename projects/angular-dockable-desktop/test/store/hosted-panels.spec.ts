/** Ported from vue-dockable-desktop `test/store/hostedPanels.test.ts` (itself react-dockable-desktop 7.11.0 `HostedPanels.test.tsx`, HP1–HP7); names unchanged unless a comment says otherwise (ADR 0009). */
/**
 * Hosted panels: a workspace panel that shows a managed widget moved out of its owner panel. The
 * actions are `@internal` until the overlay uses them, so these drive the workspace directly,
 * nothing rendered.
 *
 * HP1: optionsFor: an ordinary panel gets its kind's options; a hosted panel gets the hosted base
 *      plus its own canFloat/canDock; a minimised entry falls back to its component
 * HP2: openHostedPanel docks beside its owner (split or tab), or floats exactly at its rect
 * HP3: ...and refuses, changing nothing, when the owner isn't docked or the id is taken
 * HP4: saveLayout never writes a hosted panel and never reports it as excluded
 * HP5: loadLayout and initialState drop a hosted panel found in a layout, with every reference,
 *      and strip a hand-made `owner`; a load tells each live hosted panel first (onDrop)
 * HP6: closePanel on a hosted panel calls its close handler; removeHostedPanel does not
 * HP7: setHostedOptions changes what the user may do (isDropAllowed)
 * HP8 (ndd): the standard panel menu reads a hosted panel's own options (no built-in Float since M4)
 */
import { Component } from '@angular/core';
import { describe, it, expect, vi } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace, WorkspaceState } from '../../src/lib/workspace/workspace';
import { PanelRegistry } from '../../src/lib/core/registry';
import { optionsFor, HOSTED_COMPONENT } from '../../src/lib/core/panel-options';
import { isDropAllowed } from '../../src/lib/core/dock-rules';
import { findLeafForPanel } from '../../src/lib/core/layout-tree';
import { panelMenu } from '../../src/lib/desktop/menus';
import type { PanelOwner } from '../../src/lib/core/types';

@Component({ selector: 'ndd-test-hosted-plain', template: '' })
class Plain {}

/** A workspace with a docked owner panel "map". */
function setup(initialState?: string): Workspace<never> {
  const ws = createWorkspace<never>({
    panels: { plain: { component: Plain }, pinned: { component: Plain, defaultOptions: { canClose: false } } },
    ...(initialState ? { initialState } : {}),
  });
  if (!initialState) ws.openPanel('map', 'plain');
  return ws;
}

const owner = (options?: PanelOwner['options']): PanelOwner => ({ panelId: 'map', widgetId: 'table', ...(options ? { options } : {}) });
const leafOf = (s: Readonly<WorkspaceState>, id: string): string | null => findLeafForPanel(s.gridRoot, id);
const snapshot = (s: Readonly<WorkspaceState>) => JSON.stringify(s);
const dockBelow = { kind: 'dock' as const, dockTo: { panel: 'map', position: 'bottom' as const } };

describe('HP1: optionsFor', () => {
  const registry = new PanelRegistry();
  registry.register('plain', Plain, { canFloat: false, title: 'Plain' });

  it("an ordinary panel gets its kind's options", () => {
    expect(optionsFor(registry, { id: 'a', title: 'A', component: 'plain', state: 'docked', serializable: true }))
      .toEqual({ canFloat: false, title: 'Plain' });
  });

  it('a hosted panel gets the hosted base, and its own canFloat/canDock (false unless allowed)', () => {
    const base = { id: 'h', title: 'H', component: HOSTED_COMPONENT, state: 'docked' as const, serializable: false };
    expect(optionsFor(registry, { ...base, owner: owner() }))
      .toEqual({ canDrag: true, canClose: true, canMinimize: true, keepAlive: true, canFloat: false, canDock: false });
    expect(optionsFor(registry, { ...base, owner: owner({ canFloat: true, canDock: true }) }))
      .toMatchObject({ canFloat: true, canDock: true });
  });

  it("an id no longer open falls back to its component (a minimised entry's own copy)", () => {
    expect(optionsFor(registry, undefined, 'plain')).toEqual({ canFloat: false, title: 'Plain' });
    expect(optionsFor(registry, undefined)).toBeUndefined();
  });

  it('a hosted panel can always close, minimise and float when allowed, through the workspace', () => {
    const ws = setup();
    ws.openHostedPanel('map/table', owner({ canFloat: true }), 'Table', dockBelow);
    ws.minimizePanel('map/table');
    expect(ws.state().panels['map/table']?.state).toBe('minimized');
    ws.restorePanel('map/table');
    ws.closePanel('map/table');
    expect(ws.state().panels['map/table']).toBeUndefined();
  });

  // ndd: the reserved key is never looked up in the registry, so registering it changes nothing.
  it("a registration under the reserved key doesn't reach a hosted panel", () => {
    const ws = createWorkspace<never>({
      panels: { plain: { component: Plain }, [HOSTED_COMPONENT]: { component: Plain, defaultOptions: { canClose: false, canMinimize: false } } },
    });
    ws.openPanel('map', 'plain');
    ws.openHostedPanel('map/table', owner(), 'Table', dockBelow);
    ws.minimizePanel('map/table');
    expect(ws.state().panels['map/table']?.state).toBe('minimized');
    ws.closePanel('map/table');
    expect(ws.state().panels['map/table']).toBeUndefined();
  });
});

describe('HP2–HP3: openHostedPanel', () => {
  it('docks below its owner, and publishes panel:opened with the reserved component', () => {
    const ws = setup();
    const opened = vi.fn();
    const changed = vi.fn();
    ws.subscribe('panel:opened', opened);
    ws.subscribe('layout:changed', changed);
    expect(ws.openHostedPanel('map/table', owner(), 'Table', dockBelow)).toBe(true);
    const s = ws.state();
    expect(s.panels['map/table']).toMatchObject({ component: HOSTED_COMPONENT, state: 'docked', serializable: false, owner: owner() });
    expect(leafOf(s, 'map/table')).not.toBeNull();
    expect(leafOf(s, 'map/table')).not.toBe(leafOf(s, 'map')); // a split, not a tab
    expect(s.activePanelId).toBe('map/table');
    expect(opened).toHaveBeenCalledWith({ id: 'map/table', component: HOSTED_COMPONENT });
    expect(changed).toHaveBeenCalled();
  });

  it(`"center" opens it as a tab in its owner's group`, () => {
    const ws = setup();
    ws.openHostedPanel('map/table', owner(), 'Table', { kind: 'dock', dockTo: { panel: 'map', position: 'center' } });
    expect(leafOf(ws.state(), 'map/table')).toBe(leafOf(ws.state(), 'map'));
  });

  it('floats exactly at its rect, not cascaded off a window already there', () => {
    const ws = setup();
    ws.openPanel('f', 'plain', { initialTarget: 'floating' });
    const taken = ws.state().floating.find(w => w.id === 'f')!;
    const rect = { x: taken.x as number, y: taken.y as number, width: 300, height: 200 };
    ws.openHostedPanel('map/table', owner(), 'Table', { kind: 'float', rect });
    expect(ws.state().floating.find(w => w.id === 'map/table')).toMatchObject(rect);
    expect(ws.state().panels['map/table']?.state).toBe('floating');
    expect(ws.state().activePanelId).toBe('map/table');
  });

  it("refuses, changing nothing, when the owner isn't docked or the id is taken", () => {
    const ws = setup();
    ws.openPanel('f', 'plain', { initialTarget: 'floating' });
    const before = snapshot(ws.state());
    const opened = vi.fn();
    ws.subscribe('panel:opened', opened);
    expect(ws.openHostedPanel('f/w', { panelId: 'f', widgetId: 'w' }, 'W', { kind: 'dock', dockTo: { panel: 'f', position: 'bottom' } })).toBe(false);
    expect(ws.openHostedPanel('map', owner(), 'Taken', { kind: 'float', rect: { x: 0, y: 0, width: 10, height: 10 } })).toBe(false);
    expect(snapshot(ws.state())).toBe(before);
    expect(opened).not.toHaveBeenCalled();
  });
});

describe('HP4: saveLayout', () => {
  it('never writes a hosted panel, and never reports it as excluded', () => {
    const ws = setup();
    ws.openHostedPanel('map/table', owner(), 'Table', dockBelow);
    ws.openHostedPanel('map/chart', { panelId: 'map', widgetId: 'chart' }, 'Chart', { kind: 'float', rect: { x: 10, y: 10, width: 200, height: 100 } });
    ws.openHostedPanel('map/list', { panelId: 'map', widgetId: 'list' }, 'List', { kind: 'float', rect: { x: 50, y: 50, width: 200, height: 100 } });
    ws.minimizePanel('map/list');
    const excluded = vi.fn();
    ws.subscribe('layout:panels-excluded', excluded);
    const saved = ws.saveLayout();
    expect(saved).not.toContain('map/table');
    expect(saved).not.toContain('map/chart');
    expect(saved).not.toContain('map/list');
    expect(saved).not.toContain(HOSTED_COMPONENT);
    expect(saved).not.toContain('owner');
    expect(excluded).not.toHaveBeenCalled();
    expect(JSON.parse(saved).panels).toHaveProperty('map');
    // The live workspace is untouched.
    expect(ws.state().panels['map/table']).toBeDefined();
  });
});

describe('HP5: loading a layout that names a hosted panel', () => {
  /** What saveLayout would have written without its guard: the hosted panels and their places. */
  const crafted = () => {
    const ws = setup();
    ws.openPanel('f', 'plain', { initialTarget: 'floating' });
    ws.openHostedPanel('map/table', owner(), 'Table', { kind: 'dock', dockTo: { panel: 'map', position: 'center' } });
    ws.openHostedPanel('map/chart', { panelId: 'map', widgetId: 'chart' }, 'Chart', { kind: 'float', rect: { x: 10, y: 10, width: 200, height: 100 } });
    ws.openHostedPanel('map/list', { panelId: 'map', widgetId: 'list' }, 'List', { kind: 'float', rect: { x: 50, y: 50, width: 200, height: 100 } });
    ws.minimizePanel('map/list');
    const s = JSON.parse(snapshot(ws.state())) as WorkspaceState;
    const panels = Object.fromEntries(Object.entries(s.panels).map(([id, p]) => {
      const { owner: _o, ...rest } = p;
      return [id, rest];
    })) as Record<string, unknown>;
    panels['map'] = { ...(panels['map'] as object), owner: { panelId: 'x', widgetId: 'y' } }; // a hand-made owner on an ordinary panel
    return JSON.stringify({ version: 2, gridRoot: s.gridRoot, floating: s.floating, minimized: s.minimized, panels, activePanelId: 'map/table' });
  };

  it('loadLayout drops it from panels, the tree, the floating windows and the taskbar, and strips a hand-made owner', () => {
    const json = crafted();
    expect(json).toContain(HOSTED_COMPONENT);
    const ws = setup();
    expect(ws.loadLayout(json)).toBe(true);
    const s = ws.state();
    expect(Object.keys(s.panels).sort()).toEqual(['f', 'map']);
    expect(leafOf(s, 'map/table')).toBeNull();
    expect(s.floating.map(w => w.id)).toEqual(['f']);
    expect(s.minimized).toEqual([]);
    expect(s.panels['map']!.owner).toBeUndefined();
    expect(s.activePanelId).not.toBe('map/table');
    expect(s.activePanelId).not.toBeNull();
  });

  it('initialState drops it the same way', () => {
    const ws = setup(crafted());
    const s = ws.state();
    expect(Object.keys(s.panels).sort()).toEqual(['f', 'map']);
    expect(leafOf(s, 'map/table')).toBeNull();
    expect(s.floating.map(w => w.id)).toEqual(['f']);
    expect(s.minimized).toEqual([]);
    expect(s.panels['map']!.owner).toBeUndefined();
    expect(s.activePanelId).not.toBe('map/table');
  });

  // ndd: a taskbar entry naming the reserved component with no panel record is dropped too.
  it('a minimised entry of the reserved component is dropped even without its panel record', () => {
    const json = JSON.stringify({
      version: 2,
      gridRoot: { type: 'leaf', id: 'g', panels: ['map'], activePanelId: 'map' },
      floating: [],
      minimized: [{ id: 'map/table', title: 'Table', component: HOSTED_COMPONENT }],
      panels: { map: { id: 'map', title: 'Map', component: 'plain', state: 'docked', serializable: true } },
    });
    const ws = setup();
    expect(ws.loadLayout(json)).toBe(true);
    expect(ws.state().minimized).toEqual([]);
  });

  it('a live hosted panel is not in a loaded layout: the load tells its owner first, then removes it', () => {
    const ws = setup();
    const layout = ws.saveLayout();
    ws.openHostedPanel('map/table', owner(), 'Table', dockBelow);
    let presentAtDrop: boolean | undefined;
    const onDrop = vi.fn(() => {
      presentAtDrop = 'map/table' in ws.state().panels;
    });
    const onClose = vi.fn();
    ws.registerHostedCloseHandler('map/table', onClose, onDrop);
    ws.loadLayout(layout);
    expect(ws.state().panels['map/table']).toBeUndefined();
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(presentAtDrop).toBe(true); // called before the state is replaced
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a layout load that is refused tells no one', () => {
    const ws = setup();
    ws.openHostedPanel('map/table', owner(), 'Table', dockBelow);
    const onDrop = vi.fn();
    ws.registerHostedCloseHandler('map/table', () => {}, onDrop);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ws.loadLayout('{"not":"a layout"}')).toBe(false);
    expect(ws.loadLayout('not json')).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    expect(ws.state().panels['map/table']).toBeDefined();
    warn.mockRestore();
  });
});

describe('HP6: closing', () => {
  it('closePanel on a hosted panel removes it and calls its close handler once, after panel:closed', () => {
    const ws = setup();
    ws.openHostedPanel('map/table', owner(), 'Table', dockBelow);
    const order: string[] = [];
    const onClose = vi.fn(() => {
      order.push('handler');
    });
    ws.registerHostedCloseHandler('map/table', onClose);
    ws.subscribe('panel:closed', ({ id }) => {
      order.push(`closed:${id}`);
    });
    ws.closePanel('map/table');
    expect(ws.state().panels['map/table']).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['closed:map/table', 'handler']);
    expect(ws.state().activePanelId).toBe('map');
  });

  it('removeHostedPanel removes it without calling the handler (the widget is going back)', () => {
    const ws = setup();
    ws.openHostedPanel('map/table', owner(), 'Table', dockBelow);
    const onClose = vi.fn();
    ws.registerHostedCloseHandler('map/table', onClose);
    const closed = vi.fn();
    const changed = vi.fn();
    ws.subscribe('panel:closed', closed);
    ws.subscribe('layout:changed', changed);
    ws.removeHostedPanel('map/table');
    expect(ws.state().panels['map/table']).toBeUndefined();
    expect(leafOf(ws.state(), 'map/table')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith({ id: 'map/table' });
    expect(changed).toHaveBeenCalled();
    expect(ws.state().activePanelId).toBe('map');
  });

  it('removeHostedPanel leaves an ordinary panel alone; an unregistered handler is not called', () => {
    const ws = setup();
    const closed = vi.fn();
    ws.subscribe('panel:closed', closed);
    ws.removeHostedPanel('map');
    expect(ws.state().panels['map']).toBeDefined();
    expect(closed).not.toHaveBeenCalled();
    ws.openHostedPanel('map/table', owner(), 'Table', dockBelow);
    const onClose = vi.fn();
    const unregister = ws.registerHostedCloseHandler('map/table', onClose);
    unregister();
    ws.closePanel('map/table');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closing an ordinary panel calls no hosted handler registered under its id', () => {
    const ws = setup();
    const onClose = vi.fn();
    ws.registerHostedCloseHandler('map', onClose);
    ws.closePanel('map');
    expect(onClose).not.toHaveBeenCalled();
  });

  // ndd: closePanel returns before publishing when canClose: false refuses it (rdd publishes anyway).
  it('a refused close of an ordinary panel publishes nothing', () => {
    const ws = setup();
    ws.openPanel('p', 'pinned');
    const closed = vi.fn();
    ws.subscribe('panel:closed', closed);
    ws.closePanel('p');
    expect(ws.state().panels['p']).toBeDefined();
    expect(closed).not.toHaveBeenCalled();
  });
});

describe('HP7: setHostedOptions', () => {
  it('changes what the user may do with the hosted panel', () => {
    const ws = setup();
    ws.openHostedPanel('map/table', owner(), 'Table', dockBelow);
    expect(isDropAllowed(ws, 'map/table', { kind: 'float', anchor: null })).toBe(false);
    ws.setHostedOptions('map/table', { canFloat: true, canDock: false });
    expect(isDropAllowed(ws, 'map/table', { kind: 'float', anchor: null })).toBe(true);
    expect(isDropAllowed(ws, 'map/table', { kind: 'edge', side: 'left' })).toBe(false);
    ws.setHostedOptions('map/table', { canFloat: true, canDock: true });
    expect(isDropAllowed(ws, 'map/table', { kind: 'edge', side: 'left' })).toBe(true);
  });

  it('is a no-op when unchanged, and on an ordinary panel', () => {
    const ws = setup();
    ws.openHostedPanel('map/table', owner({ canFloat: true, canDock: false }), 'Table', dockBelow);
    const panels = ws.state().panels;
    ws.setHostedOptions('map/table', { canFloat: true, canDock: false });
    expect(ws.state().panels).toBe(panels);
    ws.setHostedOptions('map', { canFloat: true });
    expect(ws.state().panels).toBe(panels);
    expect(ws.state().panels['map']!.owner).toBeUndefined();
  });
});

describe('HP8 (ndd): the panel menu reads a hosted panel’s own options', () => {
  const labels = (ws: Workspace<never>, id: string) =>
    panelMenu(ws, id).flatMap(i => ('label' in i && i.label ? [ws.format(i.label)] : []));

  // Since M4 a hosted panel's menu never has the built-in Float, whatever the widget allows: its
  // titleMenu items are what move it (rdd 7.11.0). The rest still comes from the hosted base.
  it('never offers Float, even when the widget allows it, and always Minimize and Close', () => {
    // A registration under the reserved key must not reach the menu: the hosted base decides.
    const ws = createWorkspace<never>({
      panels: { plain: { component: Plain }, [HOSTED_COMPONENT]: { component: Plain, defaultOptions: { canClose: false, canMinimize: false } } },
    });
    ws.openPanel('map', 'plain');
    ws.openHostedPanel('map/table', owner(), 'Table', dockBelow);
    const float = ws.format(ws.messages.floatWindow);
    expect(labels(ws, 'map/table')).not.toContain(float);
    expect(labels(ws, 'map/table')).toEqual(expect.arrayContaining([ws.format(ws.messages.minimizePanel), ws.format(ws.messages.closeTab)]));
    ws.setHostedOptions('map/table', { canFloat: true });
    expect(isDropAllowed(ws, 'map/table', { kind: 'float', anchor: null })).toBe(true);
    expect(labels(ws, 'map/table')).not.toContain(float);
  });
});
