/**
 * The window losing focus mid-drag ends the drag (1.3.1), ported from react-dockable-desktop
 * 7.4.1 (`DragBlur.test.tsx`). Before, the window pointermove/pointerup listeners, the armed drop
 * target and the body's `ndd-dragging-active` all stayed after an alt-tab, so the next click
 * anywhere ran the drop — docking the panel into the zone it had been over.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { LONG_PRESS_MS } from '../../src/lib/desktop/drag-dock';

@Component({ selector: 'ndd-test-drag-blur-panel', template: '' })
class P {}

const pointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...init });
const blur = () => window.dispatchEvent(new Event('blur'));

afterEach(() => {
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach((el) => el.remove());
  document.body.classList.remove('ndd-dragging-active');
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const ws: Workspace = createWorkspace({ panels: { p: { component: P } } });
  ws.openPanel('a', 'p');
  ws.openPanel('b', 'p');
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(NddDesktop);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const q = (sel: string) => el.querySelector<HTMLElement>(sel)!;
  const stable = () => fixture.whenStable();
  /** Press a tab, move past the threshold, and arm the leaf's right zone. */
  const dragTabToRight = async () => {
    q('[data-ndd-tab="b"]').dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));
    await stable();
    expect(ws.state().draggedPanelId).toBe('b');
    q('[data-ndd-drop-zone="right"]').dispatchEvent(new PointerEvent('pointerenter'));
    await stable();
  };
  /**
   * Float b, drag its title bar and arm the leaf's right zone. The title bar holds pointer
   * capture, so the drag arms its target by hit-testing: the first move starts the drag (the
   * zones render), the second finds the zone under the pointer.
   */
  const dragWindowToRight = async () => {
    ws.floatPanel('b', { x: 300, y: 300, width: 200, height: 150 });
    await stable();
    const bar = q('[data-ndd-titlebar="b"]');
    bar.setPointerCapture = vi.fn();
    bar.dispatchEvent(pointer('pointerdown', { clientX: 350, clientY: 310 }));
    bar.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 300 }));
    await stable();
    expect(ws.state().draggedPanelId).toBe('b');
    const zone = q('[data-ndd-drop-zone="right"]');
    document.elementsFromPoint = () => [zone];
    bar.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));
    await stable();
    return bar;
  };
  return { ws, q, stable, dragTabToRight, dragWindowToRight };
}

describe('window blur during a drag', () => {
  it('cancels a tab drag: no stale drop on the next click', async () => {
    const { ws, stable, dragTabToRight } = await setup();
    const before = JSON.stringify(ws.state().gridRoot);
    await dragTabToRight();

    blur();
    await stable();
    expect(ws.state().draggedPanelId).toBeNull();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);

    window.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 200 }));
    await stable();
    expect(JSON.stringify(ws.state().gridRoot)).toBe(before);
    expect(ws.state().panels['b']!.state).toBe('docked');
  });

  it('cancels a touch tab drag too', async () => {
    const { ws, q, stable } = await setup();
    const before = JSON.stringify(ws.state().gridRoot);
    vi.useFakeTimers();
    const tab = q('[data-ndd-tab="b"]');
    tab.setPointerCapture = vi.fn();
    tab.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    tab.dispatchEvent(pointer('pointermove', { pointerType: 'touch', clientX: 200, clientY: 200 }));
    vi.useRealTimers();
    expect(ws.state().draggedPanelId).toBe('b');

    blur();
    await stable();
    expect(ws.state().draggedPanelId).toBeNull();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
    tab.dispatchEvent(pointer('pointerup', { pointerType: 'touch', clientX: 200, clientY: 200 }));
    await stable();
    expect(JSON.stringify(ws.state().gridRoot)).toBe(before);
    expect(ws.state().panels['b']!.state).toBe('docked');
  });

  it('cancels a floating window drag: the next click does not dock it', async () => {
    const { ws, stable, dragWindowToRight } = await setup();
    const bar = await dragWindowToRight();
    const before = JSON.stringify(ws.state().gridRoot);

    blur();
    await stable();
    expect(ws.state().draggedPanelId).toBeNull();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
    bar.dispatchEvent(pointer('pointermove', { clientX: 220, clientY: 220 }));
    bar.dispatchEvent(pointer('pointerup', { clientX: 220, clientY: 220 }));
    await stable();
    expect(ws.state().panels['b']!.state).toBe('floating');
    expect(JSON.stringify(ws.state().gridRoot)).toBe(before);
  });

  it('a drag that is not interrupted still drops (the control)', async () => {
    const { ws, stable, dragTabToRight } = await setup();
    await dragTabToRight();
    window.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 200 }));
    await stable();
    expect(ws.state().gridRoot.type).toBe('branch');
  });

  it('a window drag that is not interrupted still docks (the control)', async () => {
    const { ws, stable, dragWindowToRight } = await setup();
    const bar = await dragWindowToRight();
    bar.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 200 }));
    await stable();
    expect(ws.state().panels['b']!.state).toBe('docked');
    expect(ws.state().gridRoot.type).toBe('branch');
  });
});
