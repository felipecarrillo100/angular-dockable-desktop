/**
 * `injectPanel()` — what a panel sees of itself.
 *
 * Ported from vue-dockable-desktop `test/composables/usePanel.test.ts` (14 tests, names kept,
 * `usePanel` → `injectPanel`). rdd's FormContainerContract callbacks became vdd refs and are
 * signals here, so vdd's `watch(ref, …)` is `effect(() => …)`, flushed with `TestBed.tick()`,
 * and `await nextTick()` is a tick too. vdd's two-component container (provide in the parent,
 * inject in the child) is the same shape in Angular: a container component providing
 * PANEL_CONTEXT to its content child.
 */
import { Component, effect, signal } from '@angular/core';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { PANEL_CONTEXT, injectPanel } from '../../src/lib/panel/panel-ref';
import type { PanelRef } from '../../src/lib/panel/panel-ref';
import type { ContainerType } from '../../src/lib/core/types';

@Component({ selector: 'ndd-test-mock', template: '' })
class Mock {}

const ws = () => createWorkspace({ panels: { map: { component: Mock } } });

/** Run `setup` in the constructor of a panel's content, inside a container for panel `id`. */
function mountIn(w: Workspace, id: string, type: ContainerType, setup: () => void) {
  @Component({ selector: 'ndd-test-content', template: 'content' })
  class Content {
    constructor() {
      setup();
    }
  }
  @Component({
    selector: 'ndd-test-container',
    imports: [Content],
    providers: [{ provide: PANEL_CONTEXT, useValue: { id, containerType: signal(type) } }],
    template: `<ndd-test-content />`,
  })
  class Container {}
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
  const fixture = TestBed.createComponent(Container as Type<unknown>);
  fixture.detectChanges();
  return fixture;
}

describe('injectPanel inside a container', () => {
  it('reports its own id and container type', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    let seen: { id: string; type: string } | undefined;
    mountIn(w, 'p1', 'dockable-panel', () => {
      const { id, containerType } = injectPanel();
      seen = { id, type: containerType() };
    });
    expect(seen).toEqual({ id: 'p1', type: 'dockable-panel' });
  });

  it('isActive tracks the globally active panel, and an effect sees the change', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    w.openPanel('p2', 'map');
    const seen: boolean[] = [];
    mountIn(w, 'p1', 'dockable-panel', () => {
      const { isActive } = injectPanel();
      effect(() => seen.push(isActive()));
    });
    TestBed.tick();
    expect(seen).toEqual([false]); // p2 is active
    w.focusPanel('p1');
    TestBed.tick();
    expect(seen).toEqual([false, true]);
  });

  it('isMinimized and isFloating track placement', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    let refs: PanelRef | undefined;
    mountIn(w, 'p1', 'dockable-panel', () => {
      refs = injectPanel();
    });
    expect([refs!.isMinimized(), refs!.isFloating()]).toEqual([false, false]);
    w.floatPanel('p1');
    expect([refs!.isMinimized(), refs!.isFloating()]).toEqual([false, true]);
    w.minimizePanel('p1');
    expect([refs!.isMinimized(), refs!.isFloating()]).toEqual([true, false]);
  });

  it('a minimized panel keeps running — the effect fires rather than the panel unmounting', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    const events: string[] = [];
    mountIn(w, 'p1', 'dockable-panel', () => {
      const { isMinimized } = injectPanel();
      let first = true;
      effect(() => {
        const min = isMinimized();
        if (first) {
          first = false;
          return;
        }
        events.push(min ? 'minimized' : 'restored');
      });
    });
    TestBed.tick();
    w.minimizePanel('p1');
    TestBed.tick();
    w.restorePanel('p1');
    TestBed.tick();
    expect(events).toEqual(['minimized', 'restored']);
  });

  it('title and dirty are live', () => {
    const w = ws();
    w.openPanel('p1', 'map', { title: 'First' });
    let refs: PanelRef | undefined;
    mountIn(w, 'p1', 'dockable-panel', () => {
      refs = injectPanel();
    });
    expect(refs!.title()).toBe('First');
    expect(refs!.dirty()).toBe(false);
    refs!.setTitle('Second');
    refs!.setDirty(true);
    expect(refs!.title()).toBe('Second');
    expect(refs!.dirty()).toBe(true);
  });

  it('setDirty carries dialog options through to the panel', () => {
    const w = ws();
    w.openPanel('p1', 'map');
    mountIn(w, 'p1', 'dockable-panel', () => {
      injectPanel().setDirty(true, { title: 'Discard?', alertType: 'warning' });
    });
    expect(w.state().panels['p1']!.dirtyOptions).toEqual({
      title: 'Discard?',
      alertType: 'warning',
    });
  });

  it('minimize() and close() drive the workspace', async () => {
    const w = ws();
    w.openPanel('p1', 'map');
    let refs: PanelRef | undefined;
    mountIn(w, 'p1', 'dockable-panel', () => {
      refs = injectPanel();
    });
    refs!.minimize();
    expect(w.state().panels['p1']!.state).toBe('minimized');
    w.restorePanel('p1');
    await refs!.close();
    expect(w.isOpen('p1')).toBe(false);
  });

  it('onBeforeClose blocks a close, and is disposed with the component', async () => {
    const w = ws();
    w.openPanel('p1', 'map');
    const fixture = mountIn(w, 'p1', 'dockable-panel', () => {
      injectPanel().onBeforeClose(() => false);
    });
    await w.requestClosePanel('p1');
    expect(w.isOpen('p1')).toBe(true); // vetoed
    fixture.destroy();
    await w.requestClosePanel('p1');
    expect(w.isOpen('p1')).toBe(false); // guard went with the component
  });

  it('onBeforeClose may veto asynchronously', async () => {
    const w = ws();
    w.openPanel('p1', 'map');
    mountIn(w, 'p1', 'dockable-panel', () => {
      injectPanel().onBeforeClose(async () => {
        await Promise.resolve();
        return false;
      });
    });
    await w.requestClosePanel('p1');
    expect(w.isOpen('p1')).toBe(true);
  });

  it('onSaveState contributes live state to a saved layout, and is disposed with the component', () => {
    const w = ws();
    w.openPanel('p1', 'map', { inputs: { scrollTop: 0 } });
    const scrollTop = signal(0);
    const fixture = mountIn(w, 'p1', 'dockable-panel', () => {
      injectPanel().onSaveState(() => ({ scrollTop: scrollTop() }));
    });
    scrollTop.set(320);
    expect(JSON.parse(w.saveLayout()).panels.p1.props).toEqual({ scrollTop: 320 });
    fixture.destroy();
    expect(JSON.parse(w.saveLayout()).panels.p1.props).toEqual({ scrollTop: 0 });
  });

  it('a dirty panel refuses to close when there is no way to confirm', async () => {
    const w = ws();
    w.openPanel('p1', 'map');
    mountIn(w, 'p1', 'dockable-panel', () => {
      injectPanel().setDirty(true);
    });
    await w.requestClosePanel('p1');
    expect(w.isOpen('p1')).toBe(true);
    await w.requestClosePanel('p1', { force: true });
    expect(w.isOpen('p1')).toBe(false);
  });

  it('a dirty panel closes when the confirmation is accepted', async () => {
    const w = ws();
    w.openPanel('p1', 'map');
    mountIn(w, 'p1', 'dockable-panel', () => {
      injectPanel().setDirty(true);
    });
    await w.requestClosePanel('p1', { onConfirm: async () => true });
    expect(w.isOpen('p1')).toBe(false);
  });
});

describe('injectPanel outside any container', () => {
  it('reports a standalone panel rather than throwing', () => {
    let refs: PanelRef | undefined;
    TestBed.runInInjectionContext(() => {
      refs = injectPanel();
    });
    expect(refs!.id).toBe('standalone');
    expect(refs!.containerType()).toBe('standalone');
    expect(refs!.isActive()).toBe(false);
    expect(refs!.size()).toBeNull();
  });

  it('makes its actions no-ops with a development warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let refs: PanelRef | undefined;
    TestBed.runInInjectionContext(() => {
      refs = injectPanel();
    });
    refs!.setDirty(true);
    refs!.minimize();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
