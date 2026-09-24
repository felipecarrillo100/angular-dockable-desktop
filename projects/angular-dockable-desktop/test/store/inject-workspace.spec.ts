/**
 * The Angular-facing half of the store: dependency injection.
 *
 * Rewrites vue-dockable-desktop `test/composables/useWorkspace.test.ts` (9 tests). vdd's cases
 * asserted what rdd's `useSyncExternalStore` machinery existed to provide — destructuring stays
 * reactive, a component re-renders on change, subscriptions clean themselves up — through
 * `app.use()` and `useWorkspace()`. Here the same properties are asserted through
 * `provideDockableDesktop()` and `inject(Workspace)`, one test per vdd test, same order:
 *
 *   vdd                                                     ndd
 *   throws a directed error when no workspace is installed  → injectWorkspace() without a provider
 *   is available through app.use(workspace)                 → through provideDockableDesktop(w)
 *   destructured state stays reactive                       → destructured signals stay live
 *   supports computed() over the state …                    → computed() over the signals
 *   re-renders a component when the state it reads changes  → an OnPush, zoneless component re-renders
 *   disposes a subscription made in setup …                 → made in a constructor, disposed on destroy
 *   still returns an unsubscribe function …                 → same
 *   outside a component scope, behaves like the workspace   → same
 *   exposes actions that mutate the shared store            → same
 *
 * Then the Angular-only additions: per-injector creation and disposal, and two independent
 * workspaces in two component subtrees.
 */
import { Component, DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Workspace, createWorkspace } from '../../src/lib/workspace/workspace';
import { injectWorkspace, provideDockableDesktop } from '../../src/lib/workspace/provide';

@Component({ selector: 'ndd-test-mock-panel', template: '' })
class P {}

const ws = () => createWorkspace({ panels: { map: { component: P } } });

describe('inject(Workspace)', () => {
  it('throws a directed error when no workspace is provided', () => {
    TestBed.configureTestingModule({});
    expect(() => TestBed.runInInjectionContext(() => injectWorkspace())).toThrow(
      /provideDockableDesktop\(/,
    );
  });

  it('is available through provideDockableDesktop(workspace)', () => {
    const w = ws();
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    expect(TestBed.inject(Workspace)).toBe(w);
    expect(TestBed.runInInjectionContext(() => injectWorkspace().isOpen('x'))).toBe(false);
  });

  it('destructured signals stay live', () => {
    const w = ws();
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    const { activePanelId } = TestBed.inject(Workspace);
    expect(activePanelId()).toBeNull();
    w.openPanel('p1', 'map');
    expect(activePanelId()).toBe('p1');
  });

  it("supports computed() over the signals, replacing rdd's selector argument", () => {
    const w = ws();
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    const tabCount: Signal<number> = TestBed.runInInjectionContext(() => {
      const { panels } = inject(Workspace);
      return computed(() => Object.keys(panels()).length);
    });
    expect(tabCount()).toBe(0);
    w.openPanel('a', 'map');
    w.openPanel('b', 'map');
    expect(tabCount()).toBe(2);
  });

  it('re-renders an OnPush, zoneless component when the state it reads changes', async () => {
    const w = ws();
    @Component({ selector: 'ndd-test-reader', template: `{{ ids() }}` })
    class Reader {
      private readonly workspace = inject(Workspace);
      protected readonly ids = computed(() => Object.keys(this.workspace.panels()).join(','));
    }
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    const fixture = TestBed.createComponent(Reader);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
    w.openPanel('a', 'map');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim()).toBe('a');
  });

  it('disposes a subscription made in a constructor when the component is destroyed', () => {
    const w = ws();
    const fn = vi.fn();
    @Component({ selector: 'ndd-test-listener', template: '' })
    class Listener {
      constructor() {
        inject(Workspace).subscribe('e', fn);
      }
    }
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    const fixture = TestBed.createComponent(Listener);
    w.publish('e', 1);
    expect(fn).toHaveBeenCalledTimes(1);
    fixture.destroy();
    w.publish('e', 2);
    expect(fn).toHaveBeenCalledTimes(1); // nothing to unsubscribe by hand
  });

  it('still returns an unsubscribe function, for a subscription that should end sooner', () => {
    const w = ws();
    const fn = vi.fn();
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    const off = TestBed.runInInjectionContext(() => inject(Workspace).subscribe('e', fn));
    off();
    w.publish('e', 1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('outside an injection context, behaves exactly like the workspace itself', () => {
    const w = ws();
    const fn = vi.fn();
    w.subscribe('e', fn);
    w.publish('e', 1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('exposes actions that mutate the shared store', () => {
    const w = ws();
    @Component({ selector: 'ndd-test-opener', template: '' })
    class Opener {
      constructor() {
        inject(Workspace).openPanel('from-component', 'map');
      }
    }
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    TestBed.createComponent(Opener);
    expect(w.isOpen('from-component')).toBe(true);
  });

  // ── Angular-only ─────────────────────────────────────────────────────────

  it('provideDockableDesktop(config) creates a workspace per injector and disposes it with the injector', () => {
    TestBed.configureTestingModule({
      providers: [provideDockableDesktop({ panels: { map: { component: P } } })],
    });
    const w = TestBed.inject(Workspace);
    expect(w).toBeInstanceOf(Workspace);
    w.openPanel('a', 'map');
    const fn = vi.fn();
    w.subscribe('e', fn);
    TestBed.resetTestingModule(); // destroys the environment injector
    w.publish('e', 1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a provided instance is not disposed by the injector — its creator owns it', () => {
    const w = ws();
    const fn = vi.fn();
    w.subscribe('e', fn);
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    TestBed.inject(Workspace);
    TestBed.resetTestingModule();
    w.publish('e', 1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('two component subtrees can each provide their own, independent workspace', async () => {
    @Component({ selector: 'ndd-test-child', template: `{{ ws.getOpenPanelIds().join(',') }}` })
    class Child {
      readonly ws = inject(Workspace);
    }
    @Component({
      selector: 'ndd-test-left',
      imports: [Child],
      providers: [provideDockableDesktop({ panels: { map: { component: P } } })],
      template: `<ndd-test-child />`,
    })
    class Left {
      readonly ws = inject(Workspace);
    }
    @Component({
      selector: 'ndd-test-right',
      imports: [Child],
      providers: [provideDockableDesktop({ panels: { map: { component: P } } })],
      template: `<ndd-test-child />`,
    })
    class Right {
      readonly ws = inject(Workspace);
    }
    @Component({
      selector: 'ndd-test-host',
      imports: [Left, Right],
      template: `<ndd-test-left /><ndd-test-right />`,
    })
    class Host {}

    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const left = fixture.debugElement.children[0]!.injector.get(Left).ws;
    const right = fixture.debugElement.children[1]!.injector.get(Right).ws;
    expect(left).not.toBe(right);
    left.openPanel('only-left', 'map');
    expect(left.isOpen('only-left')).toBe(true);
    expect(right.isOpen('only-left')).toBe(false);
    // Descendants see their own subtree's workspace.
    const leftChild = fixture.debugElement.children[0]!.children[0]!.injector.get(Child).ws;
    expect(leftChild).toBe(left);
  });

  it('an action called inside an effect() does not make the effect depend on the store', async () => {
    // Actions read state with untracked(). If they did not, this effect would subscribe to the
    // whole store through openPanel's reads, and its own write would re-trigger it forever.
    const w = ws();
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    const trigger = signal(0);
    let runs = 0;
    TestBed.runInInjectionContext(() =>
      effect(() => {
        runs++;
        w.openPanel(`p${trigger()}`, 'map');
      }),
    );
    TestBed.tick();
    expect(runs).toBe(1);
    expect(w.isOpen('p0')).toBe(true);
    w.openPanel('unrelated', 'map'); // a store change the effect must not see
    TestBed.tick();
    expect(runs).toBe(1);
    trigger.set(1); // its own dependency still works
    TestBed.tick();
    expect(runs).toBe(2);
    expect(w.isOpen('p1')).toBe(true);
  });

  it('a service can drive the workspace — no component needed', () => {
    @Injectable({ providedIn: 'root' })
    class Shortcuts {
      private readonly workspace = inject(Workspace);
      private readonly destroyRef = inject(DestroyRef);
      openMap() {
        this.workspace.openPanel('m', 'map');
        return this.destroyRef;
      }
    }
    const w = ws();
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
    TestBed.inject(Shortcuts).openMap();
    expect(w.isOpen('m')).toBe(true);
  });
});
