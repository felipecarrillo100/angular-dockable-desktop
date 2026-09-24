/**
 * Floating windows.
 *
 * Ported from vue-dockable-desktop `test/components/floatingWindows.test.ts` (25 tests, names
 * preserved; vdd ports rdd's FloatingWindows (18) and adds 7). Driving code converted to TestBed:
 * `setup()` is async, `nextTick` is `fixture.whenStable()`, wrapper queries are DOM queries,
 * `vdd-` is `ndd-`. Geometry that needs layout — drag distances, handle hit areas, stacking in
 * pixels — is asserted in the browser gate (scripts/gates/browser/m5.mjs).
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { PanelDefinition, Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';

@Component({ selector: 'ndd-test-mock-panel', template: 'panel' })
class P {}

afterEach(() => {
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach((e) => e.remove());
});

const q = (root: HTMLElement, sel: string) => root.querySelector<HTMLElement>(sel)!;
const qa = (root: HTMLElement, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];

async function setup(
  dir?: 'ltr' | 'rtl',
  panels: Record<string, PanelDefinition> = {
    map: { component: P },
    locked: { component: P, defaultOptions: { canDrag: false } },
  },
): Promise<{ ws: Workspace; fixture: ComponentFixture<NddDesktop>; el: HTMLElement }> {
  const ws = createWorkspace({ panels, ...(dir ? { dir } : {}) });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(NddDesktop);
  await fixture.whenStable();
  return { ws, fixture, el: fixture.nativeElement as HTMLElement };
}
const win = (ws: Workspace, id: string) => ws.state().floating.find((w) => w.id === id)!;

describe('Floating Windows', () => {
  it('should open a panel directly as a floating window', async () => {
    const { ws } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    expect(ws.state().panels['f']!.state).toBe('floating');
    expect(ws.state().floating.map((w) => w.id)).toEqual(['f']);
  });

  it('should float a previously docked panel', async () => {
    const { ws } = await setup();
    ws.openPanel('d', 'map');
    expect(ws.state().panels['d']!.state).toBe('docked');
    ws.floatPanel('d');
    expect(ws.state().panels['d']!.state).toBe('floating');
    expect(JSON.stringify(ws.state().gridRoot)).not.toContain('"d"');
  });

  it('should float a panel at a specified position and size', async () => {
    const { ws } = await setup();
    ws.openPanel('d', 'map');
    ws.floatPanel('d', { x: 120, y: 90, width: 420, height: 300 });
    expect(win(ws, 'd')).toMatchObject({ x: 120, y: 90, width: 420, height: 300 });
  });

  it('should update floating window position via updateFloatingPosition', async () => {
    const { ws } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    ws.updateFloatingPosition('f', { x: 10, y: 20, width: 300, height: 200 });
    expect(win(ws, 'f')).toMatchObject({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('should set anchor on a floating window', async () => {
    const { ws } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    ws.updateFloatingPosition('f', { anchor: 'bottom-right' });
    expect(win(ws, 'f').anchor).toBe('bottom-right');
  });

  it('should open a floating window pre-anchored to a corner', async () => {
    const { ws } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating', anchor: 'top-right' });
    expect(win(ws, 'f').anchor).toBe('top-right');
  });

  it('should maximize a floating window', async () => {
    const { ws } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    ws.maximizePanel('f');
    expect(win(ws, 'f').maximized).toBe(true);
  });

  it('should restore (toggle off maximize) a maximized floating window', async () => {
    const { ws } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    ws.maximizePanel('f');
    ws.maximizePanel('f');
    expect(win(ws, 'f').maximized).toBe(false);
  });

  it('should focus a floating window (highest z-index)', async () => {
    const { ws } = await setup();
    ws.openPanel('a', 'map', { initialTarget: 'floating' });
    ws.openPanel('b', 'map', { initialTarget: 'floating' });
    expect(win(ws, 'b').z).toBeGreaterThan(win(ws, 'a').z);
    ws.focusPanel('a');
    expect(win(ws, 'a').z).toBeGreaterThan(win(ws, 'b').z);
    expect(ws.state().activePanelId).toBe('a');
  });

  it('does not churn z-order when focusing the window that is already on top', async () => {
    const { ws } = await setup();
    ws.openPanel('a', 'map', { initialTarget: 'floating' });
    const z = win(ws, 'a').z;
    ws.focusPanel('a');
    ws.focusPanel('a');
    expect(win(ws, 'a').z).toBe(z);
  });

  it('should dock a floating window back to the grid', async () => {
    const { ws } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    ws.dockPanel('f');
    expect(ws.state().panels['f']!.state).toBe('docked');
    expect(ws.state().floating).toEqual([]);
    expect(JSON.stringify(ws.state().gridRoot)).toContain('"f"');
  });

  it('should remove floating window record when panel is closed', async () => {
    const { ws } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    ws.closePanel('f');
    expect(ws.state().floating).toEqual([]);
    expect(ws.isOpen('f')).toBe(false);
  });

  it('should cascade multiple floating windows so they do not overlap exactly', async () => {
    const { ws } = await setup();
    ws.openPanel('a', 'map', { initialTarget: 'floating' });
    ws.openPanel('b', 'map', { initialTarget: 'floating' });
    ws.openPanel('c', 'map', { initialTarget: 'floating' });
    const positions = ws.state().floating.map((w) => `${w.x},${w.y}`);
    expect(new Set(positions).size).toBe(3);
  });

  it('should render floating window in DOM when the desktop is mounted', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    await fixture.whenStable();
    expect(el.querySelector('[data-ndd-window="f"]')).not.toBeNull();
    expect(q(el, '[data-ndd-titlebar="f"]')).not.toBeNull();
  });

  it('positions a top-right anchored window with insetInlineEnd under LTR (no manual physical flip)', async () => {
    const { ws, fixture, el } = await setup('ltr');
    ws.openPanel('f', 'map', { initialTarget: 'floating', anchor: 'top-right' });
    await fixture.whenStable();
    const style = q(el, '[data-ndd-window="f"]').getAttribute('style')!;
    expect(style).toContain('inset-inline-end');
    expect(style).not.toContain('inset-inline-start');
  });

  it('positions a top-right anchored window with insetInlineEnd under RTL too (dir handles the mirroring, not JS)', async () => {
    const { ws, fixture, el } = await setup('rtl');
    ws.openPanel('f', 'map', { initialTarget: 'floating', anchor: 'top-right' });
    await fixture.whenStable();
    const winEl = q(el, '[data-ndd-window="f"]');
    expect(winEl.getAttribute('style')).toContain('inset-inline-end');
    expect(winEl.getAttribute('dir')).toBe('rtl');
  });

  it('re-mirrors an already-anchored window when direction is switched live, with no other action taken', async () => {
    const { ws, fixture, el } = await setup('ltr');
    ws.openPanel('f', 'map', { initialTarget: 'floating', anchor: 'top-right' });
    await fixture.whenStable();
    expect(q(el, '[data-ndd-window="f"]').getAttribute('dir')).toBe('ltr');
    ws.setDirection('rtl');
    await fixture.whenStable();
    // Nothing about the window changed — only `dir`. The logical inset does the mirroring.
    expect(q(el, '[data-ndd-window="f"]').getAttribute('dir')).toBe('rtl');
    expect(q(el, '[data-ndd-window="f"]').getAttribute('style')).toContain('inset-inline-end');
    expect(win(ws, 'f').anchor).toBe('top-right');
  });

  it('stacks two windows anchored to the same corner with an offset, in both LTR and RTL', async () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      const { ws, fixture, el } = await setup(dir);
      ws.openPanel('a', 'map', { initialTarget: 'floating', anchor: 'top-left' });
      ws.updateFloatingPosition('a', { height: 120 });
      ws.openPanel('b', 'map', { initialTarget: 'floating', anchor: 'top-left' });
      await fixture.whenStable();
      const first = q(el, '[data-ndd-window="a"]').getAttribute('style')!;
      const second = q(el, '[data-ndd-window="b"]').getAttribute('style')!;
      expect(first).toContain('top: 8px'); // CORNER_INSET
      expect(second).toContain('top: 136px'); // 8 + 120 + CORNER_GAP
      TestBed.resetTestingModule();
    }
  });

  it('clamps width/height (but not position) of an anchored window when the workspace shrinks', async () => {
    const { ws, fixture } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating', anchor: 'top-right' });
    ws.updateFloatingPosition('f', { x: 5000, y: 5000, width: 4000, height: 3000 });
    // The clamp is a watcher, so it lands on the next tick rather than inside the setter.
    // jsdom has no ResizeObserver, so the workspace keeps its 1024x768 fallback — enough to
    // assert the shape: size is clamped, while an anchored window's x/y are left alone,
    // because they do not affect where an anchored window appears.
    await fixture.whenStable();
    expect(win(ws, 'f').width).toBeLessThan(4000);
    expect(win(ws, 'f').height).toBeLessThan(3000);
    expect(win(ws, 'f').x).toBe(5000);
    expect(win(ws, 'f').y).toBe(5000);
  });

  it('clamps a free-floating window back into reach, position included', async () => {
    const { ws, fixture } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    ws.updateFloatingPosition('f', { x: 5000, y: 5000, width: 300, height: 200 });
    await fixture.whenStable();
    expect(win(ws, 'f').x).toBeLessThan(5000); // enough title bar stays grabbable
    expect(win(ws, 'f').y).toBeLessThan(5000);
  });

  it('does not drag a window whose panel is registered canDrag: false', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('l', 'locked', { initialTarget: 'floating' });
    await fixture.whenStable();
    const before = { ...win(ws, 'l') };
    const bar = q(el, '[data-ndd-titlebar="l"]')!;
    expect(bar.getAttribute('style') ?? '').toContain('cursor: default');

    // A real PointerEvent, because @vue/test-utils cannot assign `button` on a MouseEvent
    // here — and `button` is what the handler checks.
    bar.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true }),
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 200, clientY: 200, bubbles: true }),
    );
    await fixture.whenStable();
    expect(win(ws, 'l')).toMatchObject({ x: before.x, y: before.y });
  });

  it('hides the minimize button for a panel registered canMinimize: false', async () => {
    const { ws, fixture, el } = await setup(undefined, {
      locked: { component: P, defaultOptions: { canMinimize: false } },
    });
    ws.openPanel('l', 'locked', { initialTarget: 'floating' });
    await fixture.whenStable();
    expect(q(el, '[data-ndd-minimize="l"]')).toBeNull();
    expect(q(el, '[data-ndd-maximize="l"]')).not.toBeNull();
  });

  it('renders focused chrome on the active window and not on the others (D2)', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'map', { initialTarget: 'floating' });
    ws.openPanel('b', 'map', { initialTarget: 'floating' });
    await fixture.whenStable();
    expect(q(el, '[data-ndd-window="b"]').classList).toContain('ndd-window-focused');
    expect(q(el, '[data-ndd-window="a"]').classList).not.toContain('ndd-window-focused');
    // A docked panel floated by a placement action must come back focused, which is the
    // rdd defect: its floatPanel left activePanelId behind, so the new window rendered
    // unfocused despite being frontmost.
    ws.openPanel('c', 'map');
    ws.focusPanel('b');
    ws.floatPanel('c');
    await fixture.whenStable();
    expect(ws.state().activePanelId).toBe('c');
    expect(q(el, '[data-ndd-window="c"]').classList).toContain('ndd-window-focused');
  });

  it('squares off a maximized window, matching the class the component renders (D9)', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    ws.maximizePanel('f');
    await fixture.whenStable();
    // rdd's rule said `.maximized` while its component rendered `rdd-maximized`, so a
    // maximized window kept its rounded corners and shadow. The class and the selector must
    // agree — the stylesheet half is asserted in stylesheet.test.ts.
    expect(q(el, '[data-ndd-window="f"]').classList).toContain('ndd-maximized');
  });

  it('hides the resize handles while maximized', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    await fixture.whenStable();
    expect(qa(el, '[data-ndd-handle]').length).toBe(8);
    ws.maximizePanel('f');
    await fixture.whenStable();
    expect(qa(el, '[data-ndd-handle]').length).toBe(0);
  });
});
