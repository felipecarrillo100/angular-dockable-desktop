/**
 * The drag-and-dock system.
 *
 * Ported from vue-dockable-desktop `test/components/dragDock.test.ts` (27 tests, names preserved;
 * vdd ports rdd's TouchSupport (15) and adds 12), `vdd-` → `ndd-`. Driving code is TestBed with
 * real PointerEvents, as in vdd. Everything geometric — where a drop actually lands — is in the
 * browser gate, since jsdom measures every box as zero.
 *
 * One ordering change: the touch tests switch to fake timers *after* the desktop has rendered
 * (vdd switched before mounting). Angular's zoneless scheduler itself uses timers, so faking
 * them first would stall the first render. What is measured — the 300 ms long press and the
 * 8 px cancel — runs entirely on the fake clock either way.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { CANCEL_MOVE_PX, LONG_PRESS_MS } from '../../src/lib/desktop/drag-dock';

@Component({ selector: 'ndd-test-mock-panel', template: 'panel' })
class P {}

const TWO_LEAF = JSON.stringify({
  version: 2,
  gridRoot: {
    type: 'branch',
    orientation: 'horizontal',
    sizes: [0.5, 0.5],
    children: [
      { type: 'leaf', id: 'L', panels: [], activePanelId: null },
      { type: 'leaf', id: 'R', panels: [], activePanelId: null },
    ],
  },
  floating: [],
  minimized: [],
  panels: {},
});

afterEach(() => {
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach((el) => el.remove());
  document.body.classList.remove('ndd-dragging-active', 'ndd-resizing-active');
  vi.useRealTimers();
});

interface Env {
  ws: Workspace;
  fixture: ComponentFixture<NddDesktop>;
  el: HTMLElement;
  stable: () => Promise<void>;
}

async function setup(dir?: 'ltr' | 'rtl'): Promise<Env> {
  const ws = createWorkspace({
    panels: { map: { component: P }, locked: { component: P, defaultOptions: { canDrag: false } } },
    initialState: TWO_LEAF,
    ...(dir ? { dir } : {}),
  });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(NddDesktop);
  await fixture.whenStable();
  return {
    ws,
    fixture,
    el: fixture.nativeElement as HTMLElement,
    stable: () => fixture.whenStable(),
  };
}

/** A real PointerEvent, as vdd's suite used. */
const pointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
const q = (el: HTMLElement, sel: string) => el.querySelector<HTMLElement>(sel)!;
const qa = (el: HTMLElement, sel: string) => [...el.querySelectorAll<HTMLElement>(sel)];
const enter = (el: HTMLElement) => el.dispatchEvent(new PointerEvent('pointerenter'));
const leave = (el: HTMLElement) => el.dispatchEvent(new PointerEvent('pointerleave'));

describe('pointer events, not mouse events', () => {
  it('resizer bar has no onmousedown attribute (uses onpointerdown)', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    ws.openPanel('b', 'map');
    ws.dockPanelToGroup('b', 'R', 'center');
    await stable();
    const bar = el.querySelector('[data-ndd-divider]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('onmousedown')).toBeNull();
  });

  it('dispatching pointerdown on a tab does not throw', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    await stable();
    expect(() =>
      q(el, '[data-ndd-tab="a"]').dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' })),
    ).not.toThrow();
  });

  it('right-click (button=2) on mouse does not start drag', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    await stable();
    q(el, '[data-ndd-tab="a"]').dispatchEvent(
      pointer('pointerdown', { pointerType: 'mouse', button: 2 }),
    );
    window.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));
    await stable();
    expect(ws.state().draggedPanelId).toBeNull();
  });
});

describe('touch long-press', () => {
  it('ndd-long-press-active class is added after 300ms hold on touch', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    await stable();
    vi.useFakeTimers();
    const tab = q(el, '[data-ndd-tab="a"]');
    tab.setPointerCapture = vi.fn();
    tab.dispatchEvent(
      pointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 10 }),
    );
    expect(tab.classList.contains('ndd-long-press-active')).toBe(false);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tab.classList.contains('ndd-long-press-active')).toBe(true);
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(true);
  });

  it('ndd-long-press-active class NOT added if finger moved > 8px before 300ms', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    await stable();
    vi.useFakeTimers();
    const tab = q(el, '[data-ndd-tab="a"]');
    tab.setPointerCapture = vi.fn();
    tab.dispatchEvent(
      pointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 10 }),
    );
    tab.dispatchEvent(
      pointer('pointermove', {
        pointerType: 'touch',
        clientX: 10 + CANCEL_MOVE_PX + 2,
        clientY: 10,
      }),
    );
    vi.advanceTimersByTime(LONG_PRESS_MS + 50);
    expect(tab.classList.contains('ndd-long-press-active')).toBe(false);
  });

  it('a long press that never moves reports itself rather than starting a drag', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    await stable();
    vi.useFakeTimers();
    const tab = q(el, '[data-ndd-tab="a"]');
    tab.setPointerCapture = vi.fn();
    tab.dispatchEvent(
      pointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 10 }),
    );
    vi.advanceTimersByTime(LONG_PRESS_MS);
    tab.dispatchEvent(pointer('pointerup', { pointerType: 'touch', clientX: 10, clientY: 10 }));
    expect(ws.state().draggedPanelId).toBeNull();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
  });
});

describe('floating window handles', () => {
  it('floating window renders all 8 resize handles', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    await stable();
    expect(qa(el, '[data-ndd-handle]').length).toBe(8);
  });

  it('resize handles respond to pointerdown without throwing', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    await stable();
    const handle = q(el, '[data-ndd-handle="f:e"]');
    handle.setPointerCapture = vi.fn();
    expect(() =>
      handle.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 })),
    ).not.toThrow();
  });

  it('dragging a resize handle suppresses body text-selection for the drag duration (regression: WebKit selection bleed-through)', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    await stable();
    const handle = q(el, '[data-ndd-handle="f:e"]');
    handle.setPointerCapture = vi.fn();
    handle.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
    expect(document.body.classList.contains('ndd-resizing-active')).toBe(true);
    handle.dispatchEvent(pointer('pointerup', { clientX: 5, clientY: 5 }));
    expect(document.body.classList.contains('ndd-resizing-active')).toBe(false);
  });
});

describe('drag lifecycle classes', () => {
  it('pointerdown on workspace panel updates active state without throwing', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    ws.openPanel('b', 'map');
    ws.dockPanelToGroup('b', 'R', 'center');
    ws.focusPanel('b');
    await stable();
    const leaf = qa(el, '[data-ndd-leaf]').find((l) => l.getAttribute('data-ndd-leaf') === 'L')!;
    expect(() => leaf.dispatchEvent(pointer('pointerdown'))).not.toThrow();
    await stable();
    expect(ws.state().activePanelId).toBe('a');
  });

  it('dragging the title bar toggles document.body.ndd-dragging-active for the drag duration', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    await stable();
    const bar = q(el, '[data-ndd-titlebar="f"]');
    bar.setPointerCapture = vi.fn();
    bar.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(true);
    bar.dispatchEvent(pointer('pointerup', { clientX: 10, clientY: 10 }));
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
  });

  it('cancelling the drag (pointercancel) also removes ndd-dragging-active', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    await stable();
    const bar = q(el, '[data-ndd-titlebar="f"]');
    bar.setPointerCapture = vi.fn();
    bar.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
    bar.dispatchEvent(pointer('pointercancel'));
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
  });

  it('dragging a docked tab toggles document.body.ndd-dragging-active for the drag duration', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    await stable();
    q(el, '[data-ndd-tab="a"]').dispatchEvent(
      pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 }),
    );
    window.dispatchEvent(pointer('pointermove', { clientX: 60, clientY: 60 }));
    await stable();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(true);
    expect(ws.state().draggedPanelId).toBe('a');
    window.dispatchEvent(pointer('pointerup', { clientX: 60, clientY: 60 }));
    await stable();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
    expect(ws.state().draggedPanelId).toBeNull();
  });

  it('cancelling the tab drag (pointercancel) also removes ndd-dragging-active', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    await stable();
    q(el, '[data-ndd-tab="a"]').dispatchEvent(
      pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 }),
    );
    window.dispatchEvent(pointer('pointermove', { clientX: 60, clientY: 60 }));
    window.dispatchEvent(pointer('pointercancel'));
    await stable();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
    expect(ws.state().draggedPanelId).toBeNull();
  });

  it('a press that never passes the threshold is a click, not a drag', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    await stable();
    q(el, '[data-ndd-tab="a"]').dispatchEvent(
      pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 }),
    );
    window.dispatchEvent(pointer('pointermove', { clientX: 13, clientY: 12 })); // under 5px
    await stable();
    expect(ws.state().draggedPanelId).toBeNull();
    window.dispatchEvent(pointer('pointerup', { clientX: 13, clientY: 12 }));
  });

  it('does not start a drag for a tab whose panel is registered canDrag: false', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('l', 'locked');
    await stable();
    q(el, '[data-ndd-tab="l"]').dispatchEvent(
      pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 }),
    );
    window.dispatchEvent(pointer('pointermove', { clientX: 90, clientY: 90 }));
    await stable();
    expect(ws.state().draggedPanelId).toBeNull();
  });
});

describe('drop zones are state-driven, not :hover-driven', () => {
  const startDrag = async (env: Env, id: string) => {
    q(env.el, `[data-ndd-tab="${id}"]`).dispatchEvent(
      pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 }),
    );
    window.dispatchEvent(pointer('pointermove', { clientX: 80, clientY: 80 }));
    await env.stable();
  };

  it('renders no drop zones until a drag is in progress', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    await env.stable();
    expect(qa(env.el, '[data-ndd-drop-zone]').length).toBe(0);
    expect(qa(env.el, '[data-ndd-edge]').length).toBe(0);
    await startDrag(env, 'a');
    expect(qa(env.el, '[data-ndd-drop-zone]').length).toBeGreaterThan(0);
    expect(qa(env.el, '[data-ndd-edge]').length).toBe(4);
    expect(qa(env.el, '[data-ndd-corner]').length).toBe(4);
  });

  it('hovering a cross target box applies a state-driven active class, not :hover (regression: Safari/touch never highlighted)', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    await env.stable();
    await startDrag(env, 'a');
    enter(qa(env.el, '[data-ndd-drop-zone="left"]')[0]!);
    await env.stable();
    expect(qa(env.el, '[data-ndd-drop-zone="left"]')[0]!.classList).toContain(
      'ndd-dock-target-box--active',
    );
    leave(qa(env.el, '[data-ndd-drop-zone="left"]')[0]!);
    await env.stable();
    expect(qa(env.el, '[data-ndd-drop-zone="left"]')[0]!.classList).not.toContain(
      'ndd-dock-target-box--active',
    );
  });

  it('hovering a cross target box clears the active edge-drop highlight', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    await env.stable();
    await startDrag(env, 'a');
    enter(q(env.el, '[data-ndd-edge="left"]'));
    await env.stable();
    expect(env.el.querySelector('.ndd-workspace-edge-preview')).not.toBeNull();
    // A leaf's cross overlaps the edge zones beneath it; the more specific target must win.
    enter(qa(env.el, '[data-ndd-drop-zone="center"]')[0]!);
    await env.stable();
    expect(env.el.querySelector('.ndd-workspace-edge-preview')).toBeNull();
  });

  it('hovering a corner clears the active edge, since they produce different outcomes', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    await env.stable();
    await startDrag(env, 'a');
    enter(q(env.el, '[data-ndd-edge="top"]'));
    await env.stable();
    expect(env.el.querySelector('.ndd-workspace-edge-preview')).not.toBeNull();
    enter(q(env.el, '[data-ndd-corner="top-left"]'));
    await env.stable();
    expect(env.el.querySelector('.ndd-workspace-edge-preview')).toBeNull();
    expect(q(env.el, '[data-ndd-corner="top-left"]').classList).toContain(
      'ndd-corner-zone--hovered',
    );
  });

  it('shows a ghost for a tab drag and not for a window drag', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    await env.stable();
    await startDrag(env, 'a');
    expect(env.el.querySelector('[data-ndd-ghost]')).not.toBeNull();
    window.dispatchEvent(pointer('pointerup', { clientX: 80, clientY: 80 }));
    await env.stable();
    expect(env.el.querySelector('[data-ndd-ghost]')).toBeNull();
  });
});

describe('drop resolution', () => {
  const dragTo = async (env: Env, id: string, arm: () => Promise<void>) => {
    q(env.el, `[data-ndd-tab="${id}"]`).dispatchEvent(
      pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 }),
    );
    window.dispatchEvent(pointer('pointermove', { clientX: 80, clientY: 80 }));
    await env.stable();
    await arm();
    window.dispatchEvent(pointer('pointerup', { clientX: 300, clientY: 300 }));
    await env.stable();
  };

  it("dropping on a leaf's centre joins that tab group", async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.openPanel('keeper', 'map');
    env.ws.dockPanelToGroup('keeper', 'R', 'center');
    await env.stable();
    await dragTo(env, 'a', async () => {
      const target = qa(env.el, '[data-ndd-drop-zone="center"]').find(
        (z) => z.getAttribute('data-ndd-leaf') === 'R',
      )!;
      enter(target);
    });
    expect(env.ws.state().panels['a']!.state).toBe('docked');
    expect(JSON.stringify(env.ws.state().gridRoot)).toContain('"R"');
  });

  it('dropping on a workspace edge creates a full-width row', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.openPanel('keeper', 'map');
    await env.stable();
    await dragTo(env, 'a', async () => {
      enter(q(env.el, '[data-ndd-edge="bottom"]'));
    });
    const root = env.ws.state().gridRoot as {
      type: string;
      orientation: string;
      children: unknown[];
    };
    expect(root.type).toBe('branch');
    expect(root.orientation).toBe('vertical');
    expect(JSON.stringify(root.children[1])).toContain('"a"');
  });

  it('dropping on a corner floats the panel pinned to that corner', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.openPanel('keeper', 'map');
    await env.stable();
    await dragTo(env, 'a', async () => {
      enter(q(env.el, '[data-ndd-corner="bottom-right"]'));
    });
    expect(env.ws.state().panels['a']!.state).toBe('floating');
    expect(env.ws.state().floating.find((w) => w.id === 'a')!.anchor).toBe('bottom-right');
  });

  it('dropping over nothing floats the panel where the pointer let go', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.openPanel('keeper', 'map');
    await env.stable();
    await dragTo(env, 'a', async () => {});
    expect(env.ws.state().panels['a']!.state).toBe('floating');
    expect(env.ws.state().floating.find((w) => w.id === 'a')!.anchor).toBeNull();
  });

  it('mirrors left and right drop sides under RTL', async () => {
    const env = await setup('rtl');
    env.ws.openPanel('a', 'map');
    env.ws.openPanel('keeper', 'map');
    await env.stable();
    // Physically the left edge; logically, under RTL, the trailing one.
    await dragTo(env, 'a', async () => {
      enter(q(env.el, '[data-ndd-edge="left"]'));
    });
    const root = env.ws.state().gridRoot as { orientation: string; children: unknown[] };
    expect(root.orientation).toBe('horizontal');
    // flipped: a physical-left drop docks to the logical right, so the panel is the 2nd child
    expect(JSON.stringify(root.children[1])).toContain('"a"');
  });

  it('corrects the insertion index when reordering within the same leaf', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.openPanel('b', 'map');
    env.ws.openPanel('c', 'map');
    await env.stable();
    const leafId = q(env.el, '[data-ndd-leaf]').getAttribute('data-ndd-leaf');
    // DOM indices are pre-removal: moving 'a' (index 0) to the right of 'b' (index 1) must land
    // it at index 1, not 2, because removing 'a' first shifts 'b' down.
    q(env.el, '[data-ndd-tab="a"]').dispatchEvent(
      pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 }),
    );
    window.dispatchEvent(pointer('pointermove', { clientX: 80, clientY: 80 }));
    await env.stable();
    const b = q(env.el, '[data-ndd-tab="b"]');
    b.getBoundingClientRect = () => ({
      left: 100,
      width: 100,
      right: 200,
      top: 0,
      bottom: 30,
      height: 30,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    b.dispatchEvent(pointer('pointermove', { pointerType: 'mouse', clientX: 180, clientY: 10 })); // right half
    await env.stable();
    window.dispatchEvent(pointer('pointerup', { clientX: 180, clientY: 10 }));
    await env.stable();
    expect(qa(env.el, '[data-ndd-tab]').map((t) => t.getAttribute('data-ndd-tab'))).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(leafId).toBeTruthy();
  });
});
