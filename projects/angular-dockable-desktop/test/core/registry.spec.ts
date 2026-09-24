/** Ported from vue-dockable-desktop `test/core/registry.test.ts` — driving code converted to Angular by scripts/port/convert.py, then reviewed; assertions and test names unchanged unless a comment says otherwise (ADR 0009). */
/**
 * Ported from react-dockable-desktop `PanelRegistry.test.ts` (7 tests), names preserved.
 * Adapted: the registry is per-workspace here, not a module singleton
 * (docs/decisions/0004-store-outside-components.md), and components are `markRaw`-ed.
 */
import { Component } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { PanelRegistry } from '../../src/lib/core/registry';

@Component({ selector: 'ndd-test-map-panel', template: '' })
class MapPanel {}
@Component({ selector: 'ndd-test-editor-panel', template: '' })
class EditorPanel {}

describe('PanelRegistry', () => {
  let registry: PanelRegistry;
  beforeEach(() => {
    registry = new PanelRegistry();
  });

  it('should register a component and retrieve it by key', () => {
    registry.register('map', MapPanel);
    expect(registry.get('map')?.component).toBe(MapPanel);
  });

  it('should return undefined for an unregistered key', () => {
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.has('nope')).toBe(false);
  });

  it('should store all defaultOptions alongside the component', () => {
    registry.register('map', MapPanel, {
      title: 'Map',
      initialTarget: 'floating',
      canClose: false,
      canMinimize: false,
      canDrag: false,
      defaultAnchor: 'top-right',
      favoritePosition: { x: 10, y: 20, width: 300, height: 200 },
    });
    const o = registry.get('map')!.defaultOptions!;
    expect(o.title).toBe('Map');
    expect(o.initialTarget).toBe('floating');
    expect(o.canClose).toBe(false);
    expect(o.canMinimize).toBe(false);
    expect(o.canDrag).toBe(false);
    expect(o.defaultAnchor).toBe('top-right');
    expect(o.favoritePosition).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('should overwrite an existing registration', () => {
    registry.register('slot', MapPanel);
    registry.register('slot', EditorPanel, { title: 'Second' });
    expect(registry.get('slot')?.component).toBe(EditorPanel);
    expect(registry.get('slot')?.defaultOptions?.title).toBe('Second');
  });

  it('should accept an i18n descriptor object as title', () => {
    registry.register('map', MapPanel, { title: { id: 'panel.map', defaultMessage: 'Map' } });
    expect(registry.get('map')?.defaultOptions?.title).toEqual({
      id: 'panel.map',
      defaultMessage: 'Map',
    });
  });

  it('should register without options and still be retrievable', () => {
    registry.register('bare', MapPanel);
    expect(registry.get('bare')).toBeDefined();
    expect(registry.get('bare')?.defaultOptions).toBeUndefined();
  });

  it('should store disableLivePreview flag', () => {
    registry.register('map', MapPanel, { disableLivePreview: true });
    expect(registry.get('map')?.defaultOptions?.disableLivePreview).toBe(true);
  });

  // ── additions ─────────────────────────────────────────────────────────────
  // vdd's markRaw case (a component in reactive state must not be proxied) has no Angular
  // equivalent: signals never wrap their values. It is replaced by the lazy-panel cases, which
  // are the registry's Angular-only capability.

  it("keeps registries independent, so two workspaces cannot see each other's panels", () => {
    const other = new PanelRegistry();
    registry.register('map', MapPanel);
    expect(other.has('map')).toBe(false);
    expect(registry.keys()).toEqual(['map']);
    expect(other.keys()).toEqual([]);
  });

  it('registers a lazy panel whose component is loaded on first resolve()', async () => {
    let loads = 0;
    registry.registerLazy(
      'lazy',
      () => {
        loads++;
        return Promise.resolve(MapPanel);
      },
      { title: 'Lazy' },
    );
    expect(registry.has('lazy')).toBe(true);
    expect(registry.get('lazy')?.component).toBeUndefined();
    expect(registry.get('lazy')?.defaultOptions?.title).toBe('Lazy');
    expect(loads).toBe(0);
    await expect(registry.resolve('lazy')).resolves.toBe(MapPanel);
    expect(registry.get('lazy')?.component).toBe(MapPanel);
    await registry.resolve('lazy');
    expect(loads).toBe(1);
  });

  it('shares one load between concurrent resolve() calls', async () => {
    let loads = 0;
    registry.registerLazy('lazy', () => {
      loads++;
      return Promise.resolve(MapPanel);
    });
    const [a, b] = await Promise.all([registry.resolve('lazy'), registry.resolve('lazy')]);
    expect(a).toBe(MapPanel);
    expect(b).toBe(MapPanel);
    expect(loads).toBe(1);
  });

  it('unwraps a module default export, as the router does', async () => {
    registry.registerLazy('lazy', () => Promise.resolve({ default: EditorPanel }));
    await expect(registry.resolve('lazy')).resolves.toBe(EditorPanel);
  });

  it('resolve() of an eager entry is immediate, and of an unknown key rejects', async () => {
    registry.register('map', MapPanel);
    await expect(registry.resolve('map')).resolves.toBe(MapPanel);
    await expect(registry.resolve('nope')).rejects.toThrow(/nope/);
  });
});
