/**
 * The 1.9.0 tab content and typed registry (parity with rdd 7.10.0, vdd 1.11.0), through the public
 * API. An `<ng-template nddTabContent let-tab>` replaces what's inside each grid tab; the tab itself
 * stays the library's. `definePanels` is a type-level marker: at runtime it returns its argument.
 * Without either, nothing changes. The type checks below are compiled with the spec (an unused
 * `@ts-expect-error` is itself an error); the runtime assertions keep the run honest.
 */
import { Component, input, model } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace, definePanels } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { injectWorkspace, provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddTabContentTemplate } from '../../src/lib/desktop/tab-content';
import type { TabContentProps } from '../../src/lib/core/types';

@Component({ selector: 'ndd-test-c', template: `<div></div>` })
class P {}
@Component({ selector: 'ndd-test-c-icon', template: `<i class="other-icon"></i>` })
class Icon {}

/** Records the latest props each tab was rendered with, and renders them as text. */
@Component({
  selector: 'ndd-test-c-host',
  imports: [NddDesktop, NddTabContentTemplate],
  template: `
    <ndd-desktop>
      <ng-template nddTabContent let-tab>
        <b class="mine" [attr.data-id]="tab.panelId">{{ record(tab) }}</b>
      </ng-template>
    </ndd-desktop>
  `,
})
class Host {
  readonly last: Record<string, TabContentProps> = {};
  record(tab: TabContentProps): string {
    this.last[tab.panelId] = tab;
    return `${tab.component}:${tab.title}${tab.dirty ? '!' : ''}`;
  }
}

/** Shows the icon it is given, to check `icon` is the registration's. */
@Component({
  selector: 'ndd-test-c-icon-host',
  imports: [NddDesktop, NddTabContentTemplate],
  template: `
    <ndd-desktop>
      <ng-template nddTabContent let-tab>
        <span class="icon-probe">{{ tab.icon === icon ? 'registered' : tab.icon === undefined ? 'none' : 'other' }}</span>
      </ng-template>
    </ndd-desktop>
  `,
})
class IconHost {
  readonly icon = Icon;
}

const pointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse', ...init });

afterEach(() => {
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach(el => el.remove());
  document.body.className = '';
});

async function setup<T>(host: new () => T): Promise<{ ws: Workspace; fixture: ComponentFixture<T>; el: HTMLElement }> {
  const ws = createWorkspace({ panels: { plain: { component: P }, other: { component: P, defaultOptions: { icon: Icon } } } });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(host);
  await fixture.whenStable();
  return { ws, fixture, el: fixture.nativeElement as HTMLElement };
}
const $$ = (el: HTMLElement, sel: string) => [...el.querySelectorAll(sel)];

describe('nddTabContent', () => {
  it('without it, the built-in icon, title and dirty marker are shown', async () => {
    const { ws, fixture, el } = await setup(NddDesktop);
    ws.openPanel('a', 'other', { title: 'Alpha' }); ws.setPanelDirty('a', true); await fixture.whenStable();
    const tab = el.querySelector('[data-ndd-tab="a"]')!;
    expect(tab.querySelector('.ndd-workspace-tab-icon .other-icon')).not.toBeNull();
    expect(tab.querySelector('.ndd-text-truncate')!.textContent).toContain('Alpha *');
  });

  it("replaces the tab's content, and the tab keeps its role, attributes and close button", async () => {
    const { ws, fixture, el } = await setup(Host);
    ws.openPanel('a', 'other', { title: 'Alpha' }); await fixture.whenStable();
    const tab = el.querySelector('[data-ndd-tab="a"]')!;
    expect(tab.querySelector('.ndd-workspace-tab-icon')).toBeNull();
    expect(tab.querySelector('.ndd-text-truncate .mine')!.textContent).toBe('other:Alpha');
    expect(tab.getAttribute('role')).toBe('tab');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    (tab.querySelector('.ndd-close-tab-x') as HTMLElement).click();
    await fixture.whenStable();
    expect(ws.isOpen('a')).toBe(false);
  });

  it('receives the formatted title, and the dirty, selected and focused state', async () => {
    const { ws, fixture } = await setup(Host);
    ws.openPanel('a', 'plain', { title: 'Alpha' }); ws.openPanel('b', 'other', { title: () => 'Beta', initialTarget: 'tabbed' });
    await fixture.whenStable();
    const last = fixture.componentInstance.last;
    expect(last['b']).toMatchObject({ panelId: 'b', component: 'other', title: 'Beta', dirty: false, selected: true, focused: true });
    expect(last['a']).toMatchObject({ selected: false, focused: false });
  });

  it("receives the registration's icon, or undefined", async () => {
    const { ws, fixture, el } = await setup(IconHost);
    ws.openPanel('a', 'plain'); ws.openPanel('b', 'other', { initialTarget: 'tabbed' }); await fixture.whenStable();
    expect(el.querySelector('[data-ndd-tab="a"] .icon-probe')!.textContent).toBe('none');
    expect(el.querySelector('[data-ndd-tab="b"] .icon-probe')!.textContent).toBe('registered');
  });

  it('re-renders as the state changes', async () => {
    const { ws, fixture, el } = await setup(Host);
    ws.openPanel('a', 'plain', { title: 'Alpha' }); ws.openPanel('b', 'plain', { title: 'Beta', initialTarget: 'tabbed' });
    await fixture.whenStable();
    ws.setPanelDirty('a', true); ws.updatePanelTitle('a', 'Alpha 2'); ws.focusPanel('a'); await fixture.whenStable();
    const last = fixture.componentInstance.last;
    expect(last['a']).toMatchObject({ title: 'Alpha 2', dirty: true, selected: true, focused: true });
    expect(last['b']).toMatchObject({ selected: false, focused: false });
    expect(el.querySelector('[data-ndd-tab="a"] .mine')!.textContent).toBe('plain:Alpha 2!');
  });

  it('applies to every group of a split, and focused tells the groups apart', async () => {
    const { ws, fixture, el } = await setup(Host);
    ws.openPanel('a', 'plain'); ws.openPanel('b', 'plain', { dockTo: { panel: 'a', position: 'right' } }); await fixture.whenStable();
    expect(new Set($$(el, '[data-ndd-tab]').map(t => t.getAttribute('data-ndd-tab-leaf'))).size).toBe(2);
    expect($$(el, '.mine').map(e => e.getAttribute('data-id')).sort()).toEqual(['a', 'b']);
    const last = fixture.componentInstance.last;
    expect(last['a']!.selected && last['b']!.selected).toBe(true);
    expect([last['a']!.focused, last['b']!.focused].filter(Boolean)).toHaveLength(1);
  });

  it('a tab is still dragged by its content', async () => {
    const { ws, fixture, el } = await setup(Host);
    ws.openPanel('a', 'plain'); ws.openPanel('b', 'plain', { initialTarget: 'tabbed' }); await fixture.whenStable();
    el.querySelector('[data-ndd-tab="a"] .mine')!.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));
    await fixture.whenStable();
    expect($$(el, '[data-ndd-drop-zone]').length).toBeGreaterThan(0);
    window.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 200 }));
    await fixture.whenStable();
  });

  it('floating windows keep their built-in title bar', async () => {
    const { ws, fixture, el } = await setup(Host);
    ws.openPanel('f', 'plain', { title: 'Floaty', initialTarget: 'floating' }); await fixture.whenStable();
    expect(el.querySelector('[data-ndd-titlebar="f"]')!.textContent).toContain('Floaty');
    expect($$(el, '.mine')).toHaveLength(0);
  });
});

// ─── Typed registry ────────────────────────────────────────────────────────────

@Component({ selector: 'ndd-test-c-map', template: `` })
class MapPanel {
  readonly panelId = input<string>();
  readonly center = input<[number, number]>();
  readonly zoom = model(3);
}
@Component({ selector: 'ndd-test-c-chart', template: `` })
class ChartPanel {
  readonly panelId = input.required<string>();
  readonly series = input.required<number>();
  readonly label = input('', { transform: (v: string | number) => String(v) });
}
interface AppEvents extends Record<string, unknown> { 'layer:select': { layerId: string } }

describe('definePanels', () => {
  it('returns its argument, and a workspace created from it works as usual', () => {
    const map = { plain: { component: P } };
    const panels = definePanels(map);
    expect(panels).toBe(map);
    const ws = createWorkspace({ panels });
    ws.openPanel('a', 'plain');
    expect(ws.isOpen('a')).toBe(true);
  });

  it('types openPanel from the registry, and leaves plain maps untyped', () => {
    const panels = definePanels({
      map: { component: MapPanel, defaultOptions: { title: 'Map' } },
      chart: { component: ChartPanel },
      lazy: { loadComponent: () => Promise.resolve(ChartPanel) },
    });
    const ws = createWorkspace({ panels });
    ws.openPanel('m1', 'map');
    ws.openPanel('m2', 'map', { inputs: { center: [0, 0], zoom: 5 }, initialTarget: 'floating' });
    ws.openPanel('c1', 'chart', { inputs: { series: 3, label: 7 } });
    ws.openPanel('l1', 'lazy', { inputs: { series: 1 } });
    // @ts-expect-error not a registered panel
    ws.openPanel('m3', 'mpa');
    // @ts-expect-error inputs checked against ChartPanel's
    ws.openPanel('c2', 'chart', { inputs: { series: 'three' } });
    // @ts-expect-error an unknown input
    ws.openPanel('c3', 'chart', { inputs: { series: 1, colour: 'red' } });
    // @ts-expect-error panelId is the library's to set
    ws.openPanel('c4', 'chart', { inputs: { panelId: 'x', series: 1 } });
    // @ts-expect-error a model() input is typed too
    ws.openPanel('m4', 'map', { inputs: { zoom: 'far' } });
    // @ts-expect-error a loadComponent's inputs are typed too
    ws.openPanel('l2', 'lazy', { inputs: { series: 'one' } });

    // Still a Workspace: it goes to the provider, and the rest of the API is unchanged.
    const asWorkspace: Workspace = ws;
    asWorkspace.closePanel('m1');

    // Typed events too, by passing both type arguments.
    const ws2 = createWorkspace<typeof panels, AppEvents>({ panels });
    ws2.publish('layer:select', { layerId: 'roads' });
    // @ts-expect-error the events are typed
    ws2.publish('layer:select', { wrong: true });
    // @ts-expect-error and so are the panels
    ws2.openPanel('x', 'mpa');

    // Plain maps are unchanged: any name, any inputs.
    const plain = createWorkspace({ panels: { map: { component: MapPanel } } });
    plain.openPanel('m1', 'anything', { inputs: { whatever: 1 } });
    createWorkspace<AppEvents>({ panels: { map: { component: MapPanel } } }).openPanel('m1', 'anything');
    createWorkspace().openPanel('m1', 'anything');
    // A component with no signal inputs (only @Input(), invisible to types) stays untyped.
    const legacy = createWorkspace({ panels: definePanels({ old: { component: P } }) });
    legacy.openPanel('o1', 'old', { inputs: { anything: 1 } });
    // injectWorkspace() stays untyped.
    const inside = (): void => { injectWorkspace().openPanel('x', 'anything'); };

    expect(ws.getOpenPanelIds()).toEqual(['m2', 'c1', 'l1', 'm3', 'c2', 'c3', 'c4', 'm4', 'l2']);
    expect(typeof inside).toBe('function');
  });
});
