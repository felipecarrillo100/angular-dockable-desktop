/**
 * rdd 7.11.0, M7: focusPanel(id, { restore }), updatePanelProps, and preserveEmbeds. A port of
 * rdd's `FocusPropsEmbeds.test.tsx` (names kept, after vdd's `focusPropsEmbeds.test.ts`).
 *
 * FE1: focusPanel leaves a minimised panel minimised, as before; { restore: true } restores it
 * FE2: updatePanelProps replaces or derives the props, re-applies them as inputs, re-checks
 *      serializable, emits layout:changed; nothing for a panel that isn't open or a hosted one
 * FE3: moveInto uses moveBefore only for a marked element it applies to; moveIntoWhenConnected
 *      waits for the slot to be connected
 * FE4: a panel type's preserveEmbeds, and a widget's, move their element with moveBefore; an
 *      iframe stand-in never detaches across a dock move, out of the panel and back, and as the
 *      grid changes around it, though Angular removes a destroyed slot's DOM before any destroy
 *      hook runs (the panels are parked before the render: `PanelHost`)
 *
 * The iframe stand-in is a custom element whose `disconnectedCallback` counts real detaches (a
 * MutationObserver is too late, and a detach-and-reattach in one task looks connected); jsdom has
 * no `moveBefore`, so a stub moves like `appendChild` without counting, as the real one keeps an
 * iframe alive.
 */
import { ApplicationRef, Component, ElementRef, EnvironmentInjector, Injector, createComponent, effect, inject, input, signal } from '@angular/core';
import type { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { PanelDefinition, Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddPanelOverlay, injectFloatingWidgets } from '../../src/lib/panel-overlay/panel-overlay';
import type { FloatingWidgetsApi } from '../../src/lib/panel-overlay/panel-overlay';
import type { WidgetTarget } from '../../src/lib/panel-overlay/overlay-store';
import { NddPanelSlot } from '../../src/lib/panel/panel-slot';
import { moveInto, moveIntoWhenConnected, setPreserveEmbeds } from '../../src/lib/core/dom-move';

let api: FloatingWidgetsApi | null = null;

/** Shows its inputs, so a re-applied prop is visible in the DOM. */
@Component({
  selector: 'ndd-test-fe-plain',
  template: `<div class="plain" [attr.data-line]="line()" [attr.data-zoom]="zoom()" [attr.data-id]="panelId()"></div>`,
})
class Plain {
  readonly line = input<number | undefined>(undefined);
  readonly zoom = input<number | undefined>(undefined);
  readonly onPick = input<unknown>(undefined);
  readonly panelId = input('');
}

@Component({ selector: 'ndd-test-fe-grab', template: '' })
class Grab {
  constructor() {
    api = injectFloatingWidgets();
  }
}

@Component({
  selector: 'ndd-test-fe-owner',
  imports: [NddPanelOverlay, Grab],
  template: `<ndd-panel-overlay><ndd-test-fe-grab /></ndd-panel-overlay>`,
})
class Owner {}

/**
 * A moveBefore for jsdom, which has none: records its calls and moves like appendChild, but, as
 * the real one, without "disconnecting" what it moves (see the probe below).
 */
let movingBefore = false;
interface MB { moveBefore?: (n: Node, c: Node | null) => void }
function stubMoveBefore(): Node[] {
  const calls: Node[] = [];
  (Element.prototype as MB).moveBefore = function (this: Element, node: Node) {
    calls.push(node);
    movingBefore = true;
    try {
      this.appendChild(node);
    } finally {
      movingBefore = false;
    }
  };
  return calls;
}
/** Stands in for an iframe: counts every real detach, which is when an iframe would reload. */
let reloads = 0;
if (!customElements.get('ndd-test-probe')) {
  customElements.define(
    'ndd-test-probe',
    class extends HTMLElement {
      disconnectedCallback() {
        if (!movingBefore) reloads += 1;
      }
    },
  );
}
/** Content with an iframe stand-in in it, created imperatively (no custom-elements schema). */
@Component({ selector: 'ndd-test-fe-embed', template: '' })
class Embed {
  constructor() {
    const probe = document.createElement('ndd-test-probe');
    probe.id = 't-content';
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.appendChild(probe);
  }
}

/** A slot for panel 'e' in a box that is never in the document, while `strayShown` is true. */
const strayShown = signal(false);
@Component({ selector: 'ndd-test-fe-stray-slot', imports: [NddPanelSlot], template: `<div [nddPanelSlot]="'e'"></div>` })
class StraySlot {}
@Component({ selector: 'ndd-test-fe-stray', template: '' })
class Stray {
  constructor() {
    const env = inject(EnvironmentInjector);
    const elementInjector = inject(Injector);
    const appRef = inject(ApplicationRef);
    let ref: ComponentRef<StraySlot> | null = null;
    effect(() => {
      const shown = strayShown();
      if (shown && !ref) {
        ref = createComponent(StraySlot, { environmentInjector: env, elementInjector, hostElement: document.createElement('div') });
        appRef.attachView(ref.hostView);
      } else if (!shown && ref) {
        ref.destroy();
        ref = null;
      }
    });
  }
}

let fixture: ComponentFixture<unknown> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.body.innerHTML = '';
  api = null;
  strayShown.set(false);
  delete (Element.prototype as MB).moveBefore;
});

async function setup(): Promise<Workspace> {
  const panels: Record<string, PanelDefinition> = {
    plain: { component: Plain },
    embed: { component: Plain, defaultOptions: { preserveEmbeds: true } },
    frame: { component: Embed, defaultOptions: { preserveEmbeds: true } },
    bare: { component: Embed },
    map: { component: Owner },
    stray: { component: Stray },
  };
  const ws = createWorkspace({ panels }) as unknown as Workspace;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  fixture = TestBed.createComponent(NddDesktop) as ComponentFixture<unknown>;
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  return ws;
}
/** A render, then the microtask and a few frames moveIntoWhenConnected may wait for. */
const settle = async () => {
  await fixture!.whenStable();
  await new Promise(r => setTimeout(r, 80));
  await fixture!.whenStable();
};
const step = async (fn: () => unknown) => {
  fn();
  await settle();
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

describe('FE1: focusPanel and a minimised panel', () => {
  it('leaves it minimised without restore, and restores it with', async () => {
    const ws = await setup();
    await step(() => {
      ws.openPanel('a', 'plain');
      ws.openPanel('b', 'plain');
    });
    await step(() => ws.minimizePanel('a'));
    await step(() => ws.focusPanel('a'));
    expect(ws.state().panels['a']!.state).toBe('minimized');
    const restored = vi.fn();
    ws.subscribe('panel:restored', restored);
    await step(() => ws.focusPanel('a', { restore: true }));
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(ws.state().activePanelId).toBe('a');
    expect(restored).toHaveBeenCalledWith({ id: 'a' });
  });

  it('on an open panel, restore changes nothing', async () => {
    const ws = await setup();
    await step(() => {
      ws.openPanel('a', 'plain');
      ws.openPanel('b', 'plain');
    });
    const restored = vi.fn();
    ws.subscribe('panel:restored', restored);
    await step(() => ws.focusPanel('a', { restore: true }));
    expect(ws.state().activePanelId).toBe('a');
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(restored).not.toHaveBeenCalled();
  });
});

describe('FE2: updatePanelProps', () => {
  const shown = (id: string) => $(`[data-ndd-panel="${id}"] .plain`)!;

  it('replaces the props, re-applies them as inputs, and emits layout:changed', async () => {
    const ws = await setup();
    await step(() => ws.openPanel('a', 'plain', { inputs: { line: 1 } }));
    expect(shown('a').getAttribute('data-line')).toBe('1');
    const changed = vi.fn();
    ws.subscribe('layout:changed', changed);
    await step(() => ws.updatePanelProps('a', { line: 2 }));
    expect(ws.state().panels['a']!.props).toEqual({ line: 2 });
    expect(shown('a').getAttribute('data-line')).toBe('2');
    expect(shown('a').getAttribute('data-id')).toBe('a'); // the injected id is kept
    expect(changed).toHaveBeenCalled();
    await step(() => ws.updatePanelProps('a', prev => ({ ...prev, zoom: 3 })));
    expect(ws.state().panels['a']!.props).toEqual({ line: 2, zoom: 3 });
    expect(shown('a').getAttribute('data-line')).toBe('2');
    expect(shown('a').getAttribute('data-zoom')).toBe('3');
  });

  it('re-checks serializable, which decides saveLayout', async () => {
    const ws = await setup();
    await step(() => ws.openPanel('a', 'plain', { inputs: { line: 1 } }));
    expect(ws.state().panels['a']!.serializable).toBe(true);
    await step(() => ws.updatePanelProps('a', { onPick: () => undefined }));
    expect(ws.state().panels['a']!.serializable).toBe(false);
    expect(ws.saveLayout()).not.toContain('"a"');
    await step(() => ws.updatePanelProps('a', { line: 5 }));
    expect(ws.state().panels['a']!.serializable).toBe(true);
    expect(JSON.parse(ws.saveLayout()).panels.a.props).toEqual({ line: 5 });
  });

  it("does nothing for a panel that isn't open, or a hosted one", async () => {
    const ws = await setup();
    await step(() => ws.openPanel('map', 'map'));
    await step(() => api!.open('t', { title: 'T', component: Plain }));
    await step(() => api!.move('t', { to: 'tabbed' }));
    const before = ws.state().panels;
    const changed = vi.fn();
    ws.subscribe('layout:changed', changed);
    ws.updatePanelProps('nope', { x: 1 });
    ws.updatePanelProps('map/t', { x: 1 });
    expect(ws.state().panels).toBe(before);
    expect(ws.state().panels['map/t']!.props).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('FE3: moveInto and moveIntoWhenConnected', () => {
  const connected = () => {
    const d = document.createElement('div');
    document.body.appendChild(d);
    return d;
  };

  it('uses moveBefore only for a marked, connected element in the same document', () => {
    const calls = stubMoveBefore();
    const from = connected();
    const to = connected();
    const el = document.createElement('div');
    from.appendChild(el);
    moveInto(to, el);
    expect(calls).toEqual([]); // not marked
    setPreserveEmbeds(el, true);
    moveInto(from, el);
    expect(calls).toEqual([el]);
    expect(el.parentElement).toBe(from);
    const loose = document.createElement('div');
    setPreserveEmbeds(loose, true);
    moveInto(to, loose); // its first insertion: not connected yet
    expect(calls).toHaveLength(1);
    const detachedSlot = document.createElement('div');
    moveInto(detachedSlot, el); // the slot isn't in the document
    expect(calls).toHaveLength(1);
    from.appendChild(el);
    const other = document.implementation.createHTMLDocument('x');
    const foreign = other.createElement('div');
    other.body.appendChild(foreign);
    moveInto(foreign, el); // another document
    expect(calls).toHaveLength(1);
  });

  it('falls back to appendChild where there is no moveBefore, or it throws', () => {
    const to = connected();
    const from = connected();
    const el = document.createElement('div');
    from.appendChild(el);
    setPreserveEmbeds(el, true);
    moveInto(to, el);
    expect(el.parentElement).toBe(to);
    (Element.prototype as MB).moveBefore = () => {
      throw new Error('nope');
    };
    moveInto(from, el);
    expect(el.parentElement).toBe(from);
  });

  it('a marked element waits for its slot to be connected; any other moves at once', async () => {
    const calls = stubMoveBefore();
    const from = connected();
    const el = document.createElement('div');
    const plain = document.createElement('div');
    from.append(el, plain);
    setPreserveEmbeds(el, true);
    const slot = document.createElement('div');
    moveIntoWhenConnected(slot, plain);
    expect(plain.parentElement).toBe(slot);
    moveIntoWhenConnected(slot, el);
    expect(el.parentElement).toBe(from); // still where it was, connected
    document.body.appendChild(slot);
    await Promise.resolve();
    expect(el.parentElement).toBe(slot);
    expect(calls).toEqual([el]);
    // Cancelled before the slot connects: it stays.
    const late = document.createElement('div');
    const cancel = moveIntoWhenConnected(late, el);
    cancel();
    document.body.appendChild(late);
    await new Promise(r => setTimeout(r, 40));
    expect(el.parentElement).toBe(slot);
  });
});

describe('FE4: preserveEmbeds on a panel type and on a widget', () => {
  it('a panel type with it moves its element with moveBefore; one without does not', async () => {
    const calls = stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('e', 'embed'));
    await step(() => ws.openPanel('p', 'plain', { dockTo: { panel: 'e', position: 'right' } }));
    const embedEl = $('[data-ndd-panel="e"]')!;
    const plainEl = $('[data-ndd-panel="p"]')!;
    calls.length = 0;
    await step(() => {
      ws.floatPanel('e');
      ws.floatPanel('p');
    });
    expect(embedEl.closest('[data-ndd-window="e"]')).not.toBeNull();
    expect(calls).toContain(embedEl);
    expect(calls).not.toContain(plainEl);
  });

  it('a panel type with it: an iframe in it never reloads as the grid changes around it', async () => {
    stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('e', 'frame'));
    reloads = 0;
    const steps: [string, () => void][] = [
      ['split beside it', () => ws.openPanel('p', 'plain', { dockTo: { panel: 'e', position: 'bottom' } })],
      ['a drag to the other group', () => ws.dockPanelToGroup('e', leafOf(ws, 'p'), 'center')],
      ['back beside it', () => ws.dockPanelToGroup('e', leafOf(ws, 'p'), 'left')],
      ['float', () => ws.floatPanel('e')],
      ['minimize its window', () => ws.minimizePanel('e')],
      ['restore its window', () => ws.restorePanel('e')],
      ['dock', () => ws.dockPanel('e')],
      ['minimize', () => ws.minimizePanel('e')],
      ['restore', () => ws.restorePanel('e')],
      ['the other closes', () => ws.closePanel('p')],
    ];
    for (const [name, fn] of steps) {
      await step(fn);
      expect(reloads, name).toBe(0);
    }
    expect($('ndd-test-probe')!.closest('[data-ndd-leaf]')).not.toBeNull();
  });

  it('a change elsewhere in the grid: parked for the render and back in its own slot right after it', async () => {
    stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('e', 'frame'));
    await step(() => ws.openPanel('p', 'plain', { dockTo: { panel: 'e', position: 'right' } }));
    const el = $('[data-ndd-panel="e"]')!;
    const slot = el.parentElement!;
    reloads = 0;
    // A tab added to the other group: the grid's shape changes, this panel's slot survives.
    ws.openPanel('q', 'plain', { dockTo: { panel: 'p', position: 'center' } });
    await Promise.resolve();
    expect(el.parentElement!.classList.contains('ndd-panel-store')).toBe(true); // parked before the render
    await fixture!.whenStable();
    expect(el.parentElement).toBe(slot); // after it, not frames later
    expect(reloads).toBe(0);
  });

  it('...its taskbar preview, shown and dismissed, never reloads it either', async () => {
    stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('e', 'frame'));
    await step(() => ws.minimizePanel('e'));
    reloads = 0;
    const icon = $('[data-ndd-taskbar-item="e"]');
    expect(icon).not.toBeNull();
    icon!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => null }) as DOMRect;
    await step(() => icon!.dispatchEvent(new PointerEvent('pointerenter', { clientX: 10, clientY: 10, pointerType: 'mouse' })));
    expect($('ndd-test-probe')!.closest('.ndd-taskbar-item-preview-host')).not.toBeNull();
    await step(() => icon!.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })));
    await new Promise(r => setTimeout(r, 200));
    await settle();
    expect($('.ndd-taskbar-item-preview-host')).toBeNull();
    expect(reloads).toBe(0);
    expect($('ndd-test-probe')!.isConnected).toBe(true);
  });

  it('a slot that goes before it is ever connected leaves the panel where it is', async () => {
    stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('e', 'frame'));
    await step(() => ws.openPanel('s', 'stray', { dockTo: { panel: 'e', position: 'right' } }));
    const el = $('[data-ndd-panel="e"]')!;
    strayShown.set(true);
    await fixture!.whenStable();
    expect(el.closest('[data-ndd-leaf]')).not.toBeNull(); // waiting, still shown where it was
    strayShown.set(false);
    await fixture!.whenStable();
    await new Promise(r => setTimeout(r, 1300)); // past the wait's bound
    expect(el.isConnected).toBe(true);
    expect(el.closest('[data-ndd-leaf]')).not.toBeNull();
  });

  it('...and a panel type without it reloads, as before', async () => {
    stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('e', 'bare'));
    reloads = 0;
    await step(() => ws.floatPanel('e'));
    expect(reloads).toBeGreaterThan(0);
  });

  it('a widget with it moves its content element with moveBefore, out and back', async () => {
    const calls = stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('map', 'map'));
    await step(() => api!.open('t', { title: 'T', component: Embed, preserveEmbeds: true }));
    const el = document.getElementById('t-content')!.parentElement!;
    calls.length = 0;
    await step(() => api!.move('t', { to: 'docked', position: 'bottom' }));
    expect(el.parentElement!.classList.contains('ndd-hosted-widget')).toBe(true);
    expect(calls).toContain(el);
    calls.length = 0;
    await step(() => api!.move('t', { to: 'panel' }));
    expect(calls).toContain(el);
    expect(el.parentElement!.classList.contains('ndd-panel-float__body')).toBe(true);
  });

  it("a widget with it marks its owner panel's element and its hosted panel's", async () => {
    const calls = stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('map', 'map'));
    await step(() => api!.open('t', { title: 'T', component: Embed, preserveEmbeds: true }));
    await step(() => api!.move('t', { to: 'docked', position: 'bottom' }));
    const owner = $('[data-ndd-panel="map"]')!;
    const hosted = $('[data-ndd-panel="map/t"]')!;
    calls.length = 0;
    await step(() => {
      ws.floatPanel('map/t');
      ws.floatPanel('map');
    });
    expect(calls).toContain(hosted);
    expect(calls).toContain(owner);
  });

  it('a widget with it: an iframe in it never reloads, out, between places, and back', async () => {
    stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('map', 'map'));
    await step(() => api!.open('t', { title: 'T', component: Embed, preserveEmbeds: true }));
    reloads = 0;
    const steps: WidgetTarget[] = [
      { to: 'docked', position: 'bottom' },
      { to: 'floating', rect: { x: 0, y: 0, width: 200, height: 120 } },
      { to: 'tabbed' },
      { to: 'docked', position: 'right' },
      { to: 'panel' },
    ];
    for (const to of steps) {
      await step(() => api!.move('t', to));
      expect(reloads, JSON.stringify(to)).toBe(0);
    }
    // ...and the user's own moves of its panel, and the grid changing around its owner.
    await step(() => api!.move('t', { to: 'docked', position: 'bottom' }));
    await step(() => ws.minimizePanel('map/t'));
    await step(() => ws.restorePanel('map/t'));
    await step(() => ws.floatPanel('map/t'));
    await step(() => ws.dockPanel('map/t'));
    await step(() => ws.openPanel('p', 'plain', { dockTo: { panel: 'map', position: 'left' } }));
    await step(() => api!.move('t', { to: 'panel' }));
    expect(reloads).toBe(0);
    expect($('ndd-test-probe')!.closest('.ndd-panel-float__body')).not.toBeNull();
  });

  it('...and without it, it does (the probe sees real detaches)', async () => {
    stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('map', 'map'));
    await step(() => api!.open('t', { title: 'T', component: Embed }));
    reloads = 0;
    await step(() => api!.move('t', { to: 'docked', position: 'bottom' }));
    expect(reloads).toBeGreaterThan(0);
  });

  it('a widget without it never does', async () => {
    const calls = stubMoveBefore();
    const ws = await setup();
    await step(() => ws.openPanel('map', 'map'));
    await step(() => api!.open('t', { title: 'T', component: Embed }));
    const el = document.getElementById('t-content')!.parentElement!;
    await step(() => api!.move('t', { to: 'docked', position: 'bottom' }));
    await step(() => api!.move('t', { to: 'panel' }));
    expect(calls).not.toContain(el);
  });
});

/** The group a docked panel is in. */
function leafOf(ws: Workspace, id: string): string {
  const find = (n: ReturnType<Workspace['gridRoot']>): string | null =>
    n.type === 'leaf' ? (n.panels.includes(id) ? n.id : null) : n.children.reduce<string | null>((f, c) => f ?? find(c), null);
  return find(ws.state().gridRoot) ?? '';
}
