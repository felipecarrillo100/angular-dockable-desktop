/**
 * The 1.8.0 docking rules (parity with rdd 7.9.0, vdd 1.10.0), through the public API and real
 * gestures: `canFloat` / `canDock` per kind and the workspace's `canDrop` veto. They govern what the
 * user does; the app's own calls always work. Without them nothing changes.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace, WorkspaceConfig } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { startPointerDrag } from '../../src/lib/core/drag-resize';
import { buildPanelMenu, buildTaskbarMenu } from '../../src/lib/core/panel-menu';
import type { ContextMenuItem } from '../../src/lib/core/context-menu';
import type { LayoutNode, PanelDrop } from '../../src/lib/core/types';

@Component({ selector: 'ndd-test-b', template: `<div></div>` })
class P {}

const pointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse', ...init });

afterEach(() => {
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach(el => el.remove());
  document.body.className = '';
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
});

async function setup(config: Partial<WorkspaceConfig> = {}): Promise<{ ws: Workspace; fixture: ComponentFixture<NddDesktop>; el: HTMLElement }> {
  const ws = createWorkspace({ panels: { p: { component: P } }, ...config } as WorkspaceConfig);
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(NddDesktop);
  await fixture.whenStable();
  return { ws, fixture, el: fixture.nativeElement as HTMLElement };
}
const $$ = (el: HTMLElement, sel: string) => [...el.querySelectorAll(sel)];
const attrs = (el: HTMLElement, sel: string, attr: string) => $$(el, sel).map(e => e.getAttribute(attr)).sort();
async function startTabDrag(f: ComponentFixture<NddDesktop>, el: HTMLElement, id: string) {
  el.querySelector(`[data-ndd-tab="${id}"]`)!.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
  window.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));
  await f.whenStable();
}
async function release(f: ComponentFixture<NddDesktop>) { window.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 200 })); await f.whenStable(); }
const findLeaf = (n: LayoutNode, id: string): Extract<LayoutNode, { type: 'leaf' }> | null =>
  n.type === 'leaf' ? (n.id === id ? n : null) : n.children.map(c => findLeaf(c, id)).find(Boolean) ?? null;
const TWO_GROUPS = JSON.stringify({ version: 2, gridRoot: { type: 'branch', orientation: 'horizontal', sizes: [0.5, 0.5], children: [
  { type: 'leaf', id: 'L', panels: ['a', 'x'], activePanelId: 'a' }, { type: 'leaf', id: 'R', panels: ['b'], activePanelId: 'b' }] },
  floating: [], minimized: [], panels: { a: { id: 'a', title: 'a', component: 'p', state: 'docked' }, x: { id: 'x', title: 'x', component: 'p', state: 'docked' }, b: { id: 'b', title: 'b', component: 'p', state: 'docked' } } });

describe('canFloat: false', () => {
  it('a tab dropped on nothing stays docked, and no corner is offered', async () => {
    const { ws, fixture, el } = await setup({ panels: { p: { component: P }, pinned: { component: P, defaultOptions: { canFloat: false } } } });
    ws.openPanel('a', 'p'); ws.openPanel('k', 'pinned'); await fixture.whenStable();
    await startTabDrag(fixture, el, 'k');
    expect($$(el, '[data-ndd-corner]')).toHaveLength(0);
    expect($$(el, '[data-ndd-drop-zone]').length).toBeGreaterThan(0);
    await release(fixture);
    expect(ws.floating().map(f => f.id)).toEqual([]);
    expect(ws.panels()['k']!.state).toBe('docked');
  });

  it('its menus have no "Float Window" and, minimised from a group, no "Maximize"', async () => {
    const { ws } = await setup({ panels: { p: { component: P }, pinned: { component: P, defaultOptions: { canFloat: false } } } });
    ws.openPanel('a', 'p'); ws.openPanel('k', 'pinned');
    const noop = { float() {}, minimize() {}, close() {}, restore() {}, maximize() {} };
    const labels = (items: ContextMenuItem[]) => items.map(i => ('label' in i && i.label ? ws.format(i.label) : '|'));
    expect(labels(buildPanelMenu(ws, 'k', { canFloat: false }, noop))).not.toContain('Float Window');
    expect(labels(buildPanelMenu(ws, 'a', {}, noop))).toContain('Float Window');
    ws.minimizePanel('k');
    expect(labels(buildTaskbarMenu(ws, 'k', { canFloat: false }, noop))).not.toContain('Maximize Panel');
  });

  it("doesn't restrict the app: floatPanel still floats it", async () => {
    const { ws } = await setup({ panels: { pinned: { component: P, defaultOptions: { canFloat: false } } } });
    ws.openPanel('k', 'pinned'); ws.floatPanel('k');
    expect(ws.floating().map(f => f.id)).toEqual(['k']);
  });
});

describe('canDock: false', () => {
  it('a window drag offers no group or edge target, only corners, and the panel stays floating', async () => {
    const { ws, fixture, el } = await setup({ panels: { p: { component: P }, palette: { component: P, defaultOptions: { canDock: false, initialTarget: 'floating' } } } });
    ws.openPanel('a', 'p'); ws.openPanel('w', 'palette'); await fixture.whenStable();
    const bar = el.querySelector('[data-ndd-titlebar="w"]') as HTMLElement;
    bar.setPointerCapture = vi.fn();
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [document.body];
    bar.dispatchEvent(pointer('pointerdown', { clientX: 350, clientY: 310 }));
    bar.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));
    await fixture.whenStable();
    expect($$(el, '[data-ndd-drop-zone]')).toHaveLength(0);
    expect($$(el, '[data-ndd-edge]')).toHaveLength(0);
    expect($$(el, '[data-ndd-corner]')).toHaveLength(4);
    bar.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 200 }));
    await fixture.whenStable();
    expect(ws.panels()['w']!.state).toBe('floating');
  });
});

describe('canDrop', () => {
  it('is asked with { panelId, component, to }, and a vetoed target is not offered', async () => {
    const calls: PanelDrop[] = [];
    const { ws, fixture, el } = await setup({
      canDrop: (d: PanelDrop) => { calls.push(d); return !(d.to.kind === 'group' && d.to.position === 'left') && !(d.to.kind === 'edge' && d.to.side === 'top'); },
    });
    ws.openPanel('a', 'p'); ws.openPanel('b', 'p'); await fixture.whenStable();
    await startTabDrag(fixture, el, 'b');
    expect(attrs(el, '[data-ndd-drop-zone]', 'data-ndd-drop-zone')).toEqual(['bottom', 'center', 'right', 'top']);
    expect(attrs(el, '[data-ndd-edge]', 'data-ndd-edge')).toEqual(['bottom', 'left', 'right']);
    expect(calls.some(c => c.panelId === 'b' && c.component === 'p' && c.to.kind === 'group')).toBe(true);
    await release(fixture);
  });

  it('under RTL it sees the side the move applies: the zone drawn on the left splits to the right', async () => {
    const { ws, fixture, el } = await setup({ dir: 'rtl', canDrop: (d: PanelDrop) => !(d.to.kind === 'group' && d.to.position === 'right') });
    ws.openPanel('a', 'p'); ws.openPanel('b', 'p'); await fixture.whenStable();
    await startTabDrag(fixture, el, 'b');
    expect(attrs(el, '[data-ndd-drop-zone]', 'data-ndd-drop-zone')).toEqual(['bottom', 'center', 'right', 'top']);
    await release(fixture);
  });

  it('a vetoed group refuses tabs inserted among its tabs, with no insertion marker', async () => {
    const { ws, fixture, el } = await setup({ initialState: TWO_GROUPS, canDrop: (d: PanelDrop) => !(d.to.kind === 'group' && d.to.leafId === 'R') });
    await startTabDrag(fixture, el, 'a');
    el.querySelector('[data-ndd-tab="b"]')!.dispatchEvent(pointer('pointermove', { clientX: 210, clientY: 10 }));
    await fixture.whenStable();
    expect($$(el, '[data-ndd-tab].ndd-drag-hover-left, [data-ndd-tab].ndd-drag-hover-right')).toHaveLength(0);
    await release(fixture);
    expect(findLeaf(ws.gridRoot(), 'R')!.panels).toEqual(['b']);
  });

  it('a rule that changes during a drag is asked again at release, for a zone and for a tab insertion', async () => {
    let allowRight = true;
    const a = await setup({ canDrop: (d: PanelDrop) => allowRight || !(d.to.kind === 'group' && d.to.position === 'right') });
    a.ws.openPanel('a', 'p'); a.ws.openPanel('b', 'p'); await a.fixture.whenStable();
    await startTabDrag(a.fixture, a.el, 'b');
    a.el.querySelector('[data-ndd-drop-zone="right"]')!.dispatchEvent(new PointerEvent('pointerenter'));
    await a.fixture.whenStable();
    allowRight = false;
    await release(a.fixture);
    expect(a.ws.gridRoot().type).toBe('leaf');
  });

  it('a rule changed mid-drag holds for a tab insertion too', async () => {
    let allowR = true;
    const { ws, fixture, el } = await setup({ initialState: TWO_GROUPS, canDrop: (d: PanelDrop) => allowR || !(d.to.kind === 'group' && d.to.leafId === 'R') });
    await startTabDrag(fixture, el, 'a');
    el.querySelector('[data-ndd-tab="b"]')!.dispatchEvent(pointer('pointermove', { clientX: 210, clientY: 10 }));
    await fixture.whenStable();
    allowR = false;
    await release(fixture);
    expect(findLeaf(ws.gridRoot(), 'R')!.panels).toEqual(['b']);
  });

  it('a canDrop that throws allows the move, and says why', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { ws, fixture, el } = await setup({ canDrop: () => { throw new Error('boom'); } });
      ws.openPanel('a', 'p'); ws.openPanel('b', 'p'); await fixture.whenStable();
      await startTabDrag(fixture, el, 'b');
      expect($$(el, '[data-ndd-drop-zone]')).toHaveLength(5);
      expect(error.mock.calls.some(c => String(c[0]).includes('canDrop threw'))).toBe(true);
      await release(fixture);
    } finally {
      error.mockRestore();
    }
  });

  it('without rules, every target is offered as before', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'p'); ws.openPanel('b', 'p'); await fixture.whenStable();
    await startTabDrag(fixture, el, 'b');
    expect($$(el, '[data-ndd-drop-zone]')).toHaveLength(5);
    expect($$(el, '[data-ndd-edge]')).toHaveLength(4);
    expect($$(el, '[data-ndd-corner]')).toHaveLength(4);
    await release(fixture);
  });
});

describe('startPointerDrag ends on blur and on a lost capture (1.8.0)', () => {
  function drag(opts: { onCancel?: boolean } = {}) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.setPointerCapture = vi.fn();
    const log: string[] = [];
    startPointerDrag({
      element: el, pointerId: 7, startClientX: 0, startClientY: 0, captureStart: () => ({}),
      onMove: (dx) => log.push(`move ${dx}`), onEnd: () => log.push('end'),
      ...(opts.onCancel ? { onCancel: () => log.push('cancel') } : {}),
      activeClasses: [{ el: document.body, classes: ['probe-dragging'] }],
    });
    return { el, log };
  }

  it('a window blur cancels it: classes removed, onCancel once', () => {
    const { log } = drag({ onCancel: true });
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('blur'));
    expect(log).toEqual(['cancel']);
    expect(document.body.classList.contains('probe-dragging')).toBe(false);
  });

  it("a lost capture at the document (the element was removed) ends it; another pointer's does not", () => {
    const { el, log } = drag({ onCancel: true });
    document.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 99, bubbles: true }));
    expect(log).toEqual([]);
    el.remove();
    document.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 7, bubbles: true }));
    expect(log).toEqual(['cancel']);
  });

  it('without onCancel, a cut-short drag calls onEnd; a normal release calls onEnd once', () => {
    const a = drag();
    window.dispatchEvent(new Event('blur'));
    expect(a.log).toEqual(['end']);
    const b = drag();
    b.el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }));
    window.dispatchEvent(new Event('blur'));
    expect(b.log).toEqual(['end']);
  });
});
