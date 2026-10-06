/**
 * The 1.7.0 additions (parity with rdd 7.8.0, vdd 1.9.0), through the public API: each is opt-in,
 * and without it nothing changes.
 */
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddEmptyWorkspaceTemplate } from '../../src/lib/desktop/empty-workspace';
import { injectPanel } from '../../src/lib/panel/panel-ref';
import type { PanelDefaultOptions } from '../../src/lib/core/registry';
import type { LayoutNode } from '../../src/lib/core/types';

@Component({ selector: 'ndd-test-plain', template: `<div data-plain></div>` })
class PlainPanel {}

let mounts = 0;
let unmounts = 0;
/** Counts its own creation and destruction, and keeps a counter so a fresh creation is visible. */
@Component({
  selector: 'ndd-test-heavy',
  template: `<button [attr.data-heavy]="panel.id" (click)="clicks.set(clicks() + 1)">{{ clicks() }}</button>`,
})
class HeavyPanel {
  protected readonly panel = injectPanel();
  protected readonly clicks = signal(0);
  constructor() {
    mounts++;
    inject(DestroyRef).onDestroy(() => { unmounts++; });
  }
}

/** A desktop with the app's empty-workspace template, as an app writes it. */
@Component({
  selector: 'ndd-test-host',
  imports: [NddDesktop, NddEmptyWorkspaceTemplate],
  template: `<ndd-desktop><ng-template nddEmptyWorkspace><p data-welcome>Open a file to start</p></ng-template></ndd-desktop>`,
})
class HostWithEmptyView {}

afterEach(() => {
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach(el => el.remove());
});

async function setup(opts: { heavy?: PanelDefaultOptions; chart?: PanelDefaultOptions; initialState?: string; withEmptyView?: boolean } = {}):
  Promise<{ ws: Workspace; fixture: ComponentFixture<unknown>; el: HTMLElement }> {
  mounts = 0; unmounts = 0;
  const ws = createWorkspace({
    panels: {
      plain: { component: PlainPanel },
      heavy: { component: HeavyPanel, defaultOptions: opts.heavy ?? {} },
      chart: { component: PlainPanel, defaultOptions: opts.chart ?? {} },
    },
    ...(opts.initialState ? { initialState: opts.initialState } : {}),
  });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture: ComponentFixture<unknown> = opts.withEmptyView ? TestBed.createComponent(HostWithEmptyView) : TestBed.createComponent(NddDesktop);
  await fixture.whenStable();
  return { ws, fixture, el: fixture.nativeElement as HTMLElement };
}
type Leaf = Extract<LayoutNode, { type: 'leaf' }>;
const leafOf = (node: LayoutNode, id: string): Leaf | null =>
  node.type === 'leaf' ? (node.panels.includes(id) ? node : null) : node.children.map(c => leafOf(c, id)).find(Boolean) ?? null;
const has = (el: HTMLElement, sel: string, attr: string) => el.querySelector(sel)?.hasAttribute(attr) ?? false;

describe('nddEmptyWorkspace', () => {
  it('shows the app view while no panel is docked, and the panel once one opens', async () => {
    const { ws, fixture, el } = await setup({ withEmptyView: true });
    expect(el.querySelector('[data-welcome]')?.textContent).toBe('Open a file to start');
    expect(el.querySelector('.ndd-empty-leaf-placeholder')).toBeNull();
    ws.openPanel('a', 'plain'); await fixture.whenStable();
    expect(el.querySelector('[data-welcome]')).toBeNull();
    ws.closePanel('a'); await fixture.whenStable();
    expect(el.querySelector('[data-welcome]')).not.toBeNull();
  });

  it('without the template, the built-in message shows as before', async () => {
    const { el } = await setup();
    expect(el.querySelector('.ndd-empty-leaf-placeholder')).not.toBeNull();
    expect(el.querySelector('.ndd-empty-workspace')).toBeNull();
  });

  it('empty groups inside a split keep the built-in message: only the root group shows the view', async () => {
    const split = JSON.stringify({
      version: 2,
      gridRoot: { type: 'branch', orientation: 'horizontal', sizes: [0.5, 0.5], children: [
        { type: 'leaf', id: 'L', panels: [], activePanelId: null },
        { type: 'leaf', id: 'R', panels: [], activePanelId: null }] },
      floating: [], minimized: [], panels: {},
    });
    const { el } = await setup({ withEmptyView: true, initialState: split });
    expect(el.querySelectorAll('.ndd-empty-leaf-placeholder').length).toBe(2);
    expect(el.querySelector('[data-welcome]')).toBeNull();
  });
});

describe('state attributes', () => {
  it('a tab carries data-ndd-selected, -focused and -dirty only while each is true', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'plain'); ws.openPanel('b', 'plain'); await fixture.whenStable();
    expect([has(el, '[data-ndd-tab="b"]', 'data-ndd-selected'), has(el, '[data-ndd-tab="b"]', 'data-ndd-focused')]).toEqual([true, true]);
    expect([has(el, '[data-ndd-tab="a"]', 'data-ndd-selected'), has(el, '[data-ndd-tab="a"]', 'data-ndd-focused')]).toEqual([false, false]);
    ws.setPanelDirty('a', true); await fixture.whenStable();
    expect(has(el, '[data-ndd-tab="a"]', 'data-ndd-dirty')).toBe(true);
    expect(has(el, '[data-ndd-tab="b"]', 'data-ndd-dirty')).toBe(false);
    ws.setPanelDirty('a', false); await fixture.whenStable();
    expect(has(el, '[data-ndd-tab="a"]', 'data-ndd-dirty')).toBe(false);
    // Floating b away: a becomes its group's selected tab, but b stays the focused panel.
    ws.floatPanel('b'); await fixture.whenStable();
    expect(has(el, '[data-ndd-tab="a"]', 'data-ndd-selected')).toBe(true);
    expect(has(el, '[data-ndd-tab="a"]', 'data-ndd-focused')).toBe(false);
  });

  it('a floating window carries data-ndd-focused and -maximized only while each is true', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'plain', { initialTarget: 'floating' }); ws.openPanel('b', 'plain', { initialTarget: 'floating' });
    await fixture.whenStable();
    expect(has(el, '[data-ndd-window="b"]', 'data-ndd-focused')).toBe(true);
    expect(has(el, '[data-ndd-window="a"]', 'data-ndd-focused')).toBe(false);
    expect(has(el, '[data-ndd-window="b"]', 'data-ndd-maximized')).toBe(false);
    ws.maximizePanel('b'); await fixture.whenStable();
    expect(has(el, '[data-ndd-window="b"]', 'data-ndd-maximized')).toBe(true);
    ws.maximizePanel('b'); await fixture.whenStable();
    expect(has(el, '[data-ndd-window="b"]', 'data-ndd-maximized')).toBe(false);
  });
});

describe('openPanel dockTo', () => {
  it('splits beside the target panel, giving the new group the requested share', async () => {
    const { ws } = await setup();
    ws.openPanel('chart', 'plain');
    ws.openPanel('legend', 'plain', { dockTo: { panel: 'chart', position: 'right', size: 0.25 } });
    const root = ws.gridRoot();
    if (root.type !== 'branch') throw new Error('expected a split');
    expect(root.orientation).toBe('horizontal');
    expect(root.children.map(c => (c.type === 'leaf' ? c.panels : []))).toEqual([['chart'], ['legend']]);
    expect(root.sizes).toEqual([0.75, 0.25]);
  });

  it("'center' adds it as a tab in the target's group, even a second group", async () => {
    const { ws } = await setup();
    ws.openPanel('a', 'plain');
    ws.openPanel('c', 'plain', { dockTo: { panel: 'a', position: 'right' } });
    ws.openPanel('b', 'plain', { dockTo: { panel: 'c', position: 'center' } });
    expect(leafOf(ws.gridRoot(), 'b')?.panels).toEqual(['c', 'b']);
    expect(leafOf(ws.gridRoot(), 'a')?.panels).toEqual(['a']);
  });

  it('wins over initialTarget, and clamps size to 0.1–0.9', async () => {
    const { ws } = await setup();
    ws.openPanel('a', 'plain');
    ws.openPanel('b', 'plain', { initialTarget: 'floating', dockTo: { panel: 'a', position: 'left', size: 5 } });
    expect(ws.floating().map(f => f.id)).toEqual([]);
    const root = ws.gridRoot();
    if (root.type !== 'branch') throw new Error('expected a split');
    expect(root.sizes[0]).toBe(0.9);
    expect(root.sizes[1]).toBeCloseTo(0.1);
  });

  it('falls back to the usual placement, with a warning, when the target is not docked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { ws } = await setup();
      ws.openPanel('f', 'plain', { initialTarget: 'floating' });
      ws.openPanel('b', 'plain', { dockTo: { panel: 'f', position: 'right' } });
      expect(ws.gridRoot().type).toBe('leaf');
      expect(leafOf(ws.gridRoot(), 'b')).not.toBeNull();
      expect(warn.mock.calls.some(c => String(c[0]).includes('could not dock beside "f"'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('does nothing for a panel that is already open', async () => {
    const { ws } = await setup();
    ws.openPanel('a', 'plain'); ws.openPanel('b', 'plain');
    const before = JSON.stringify(ws.gridRoot());
    ws.openPanel('b', 'plain', { dockTo: { panel: 'a', position: 'right' } });
    expect(JSON.stringify(ws.gridRoot())).toBe(before);
  });
});

describe('className and tabClassName per panel kind', () => {
  it("adds them to that kind's content element and tab only", async () => {
    const { ws, fixture, el } = await setup({ chart: { className: 'app-chart', tabClassName: 'app-chart-tab' } });
    // The content shown in the group body is the selected panel's own element.
    const shownContent = () => el.querySelector('.ndd-panel-body .ndd-panel-content');
    ws.openPanel('p', 'plain'); ws.openPanel('c', 'chart'); await fixture.whenStable();
    expect(shownContent()?.className).toBe('ndd-panel-content app-chart');
    ws.focusPanel('p'); await fixture.whenStable();
    expect(shownContent()?.className).toBe('ndd-panel-content');
    expect(el.querySelector('[data-ndd-tab="c"]')!.classList.contains('app-chart-tab')).toBe(true);
    expect(el.querySelector('[data-ndd-tab="c"]')!.classList.contains('ndd-workspace-tab')).toBe(true);
    expect(el.querySelector('[data-ndd-tab="p"]')!.classList.contains('app-chart-tab')).toBe(false);
    // The class travels with the panel: still there once it floats.
    ws.floatPanel('c'); await fixture.whenStable();
    expect(el.querySelector('[data-ndd-window="c"] .ndd-panel-content')?.className).toBe('ndd-panel-content app-chart');
  });
});

describe('keepAlive: false', () => {
  const heavy = (id: string) => document.querySelector(`[data-heavy="${id}"]`) as HTMLButtonElement | null;

  it('destroys the component while it is an unselected tab, and creates it afresh when shown', async () => {
    const { ws, fixture } = await setup({ heavy: { keepAlive: false } });
    ws.openPanel('h', 'heavy'); await fixture.whenStable();
    heavy('h')!.click(); await fixture.whenStable();
    expect(heavy('h')!.textContent).toBe('1');
    ws.openPanel('p', 'plain'); await fixture.whenStable();     // p's tab is selected: h is hidden
    expect(unmounts).toBe(1);
    ws.focusPanel('h'); await fixture.whenStable();            // shown again: a fresh component
    expect(mounts).toBe(2);
    expect(heavy('h')!.textContent).toBe('0');
    expect(ws.isOpen('h')).toBe(true);                         // hiding is not closing
  });

  it('is destroyed while minimised, and created again when restored', async () => {
    const { ws, fixture } = await setup({ heavy: { keepAlive: false } });
    ws.openPanel('h', 'heavy', { initialTarget: 'floating' }); await fixture.whenStable();
    ws.minimizePanel('h'); await fixture.whenStable();
    expect(unmounts).toBe(1);
    ws.restorePanel('h'); await fixture.whenStable();
    expect(mounts).toBe(2);
  });

  it('by default, a hidden panel stays alive and keeps its state, as before', async () => {
    const { ws, fixture } = await setup();
    ws.openPanel('h', 'heavy'); await fixture.whenStable();
    heavy('h')!.click(); await fixture.whenStable();
    ws.openPanel('p', 'plain'); await fixture.whenStable();
    ws.focusPanel('h'); await fixture.whenStable();
    expect([mounts, unmounts]).toEqual([1, 0]);
    expect(heavy('h')!.textContent).toBe('1');
  });

  it('leaks nothing across many hide/show cycles', async () => {
    const { ws, fixture } = await setup({ heavy: { keepAlive: false } });
    ws.openPanel('h', 'heavy'); ws.openPanel('p', 'plain'); await fixture.whenStable();
    // One full cycle first (two separate renders), so first-show work isn't counted as a leak.
    ws.focusPanel('h'); await fixture.whenStable();
    ws.focusPanel('p'); await fixture.whenStable();
    const nodesAfterWarmup = document.querySelectorAll('*').length;
    for (let i = 0; i < 50; i++) {
      ws.focusPanel('h'); await fixture.whenStable();
      ws.focusPanel('p'); await fixture.whenStable();
    }
    expect(mounts - unmounts).toBe(0);                         // hidden now: no live instance
    expect(document.querySelectorAll('*').length).toBe(nodesAfterWarmup);
    expect(heavy('h')).toBeNull();
  });
});
