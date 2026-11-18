/**
 * The 1.10.0 runtime panel icon (parity with rdd's `setPanelIcon`, vdd 1.12.0).
 * `workspace.setPanelIcon(id, icon)` — or `injectPanel().setIcon(icon)` from inside a workspace
 * panel — replaces the registered `defaultOptions.icon` on the tab, the floating title bar, the
 * taskbar button and the icon the `nddTabContent` template receives; `null` restores the
 * registered one. It lives only in memory: `saveLayout()` never writes it, and `loadLayout()`
 * keeps it for a panel that stays open.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddTabContentTemplate } from '../../src/lib/desktop/tab-content';
import { injectPanel } from '../../src/lib/panel/panel-ref';
import type { PanelRef } from '../../src/lib/panel/panel-ref';
import type { TabContentProps } from '../../src/lib/core/types';

@Component({ selector: 'ndd-test-icon-p', template: `<div></div>` })
class P {}
@Component({ selector: 'ndd-test-icon-registered', template: `<i class="registered-icon"></i>` })
class Registered {}
@Component({ selector: 'ndd-test-icon-runtime', template: `<i class="runtime-icon"></i>` })
class Runtime {}

let panelFromInside: PanelRef | undefined;
@Component({ selector: 'ndd-test-icon-setter', template: `<div></div>` })
class Setter {
  constructor() {
    panelFromInside = injectPanel();
  }
}

/** Records the latest props each tab was rendered with. */
@Component({
  selector: 'ndd-test-icon-host',
  imports: [NddDesktop, NddTabContentTemplate],
  template: `
    <ndd-desktop>
      <ng-template nddTabContent let-tab>
        <b>{{ record(tab) }}</b>
      </ng-template>
    </ndd-desktop>
  `,
})
class TabContentHost {
  readonly last: Record<string, TabContentProps> = {};
  record(tab: TabContentProps): string {
    this.last[tab.panelId] = tab;
    return tab.title;
  }
}

afterEach(() => {
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach(el => el.remove());
  document.body.className = '';
  panelFromInside = undefined;
  vi.restoreAllMocks();
});

async function setup<T = NddDesktop>(host: new () => T = NddDesktop as unknown as new () => T): Promise<{ ws: Workspace; fixture: ComponentFixture<T>; el: HTMLElement; stable: () => Promise<void> }> {
  const ws = createWorkspace({
    panels: {
      plain: { component: P },
      other: { component: P, defaultOptions: { icon: Registered } },
      setter: { component: Setter, defaultOptions: { icon: Registered } },
    },
  });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(host);
  await fixture.whenStable();
  return { ws, fixture, el: fixture.nativeElement as HTMLElement, stable: () => fixture.whenStable() };
}
const tabIcon = (el: HTMLElement, id: string) => el.querySelector(`[data-ndd-tab="${id}"] .ndd-workspace-tab-icon`);
const windowIcon = (el: HTMLElement, id: string) => el.querySelector(`[data-ndd-titlebar="${id}"] .ndd-window-title-icon`);
const taskbarIcon = (el: HTMLElement, id: string) => el.querySelector(`[data-ndd-taskbar-item="${id}"] .ndd-taskbar-item-icon`);

describe('setPanelIcon', () => {
  it('changes the tab icon, and null restores the registered one', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'other'); await stable();
    expect(tabIcon(el, 'a')!.querySelector('.registered-icon')).not.toBeNull();
    ws.setPanelIcon('a', Runtime); await stable();
    expect(tabIcon(el, 'a')!.querySelector('.runtime-icon')).not.toBeNull();
    expect(tabIcon(el, 'a')!.querySelector('.registered-icon')).toBeNull();
    ws.setPanelIcon('a', null); await stable();
    expect(tabIcon(el, 'a')!.querySelector('.registered-icon')).not.toBeNull();
    expect(ws.state().panels['a']!.icon).toBeUndefined();
  });

  it('gives an icon to a panel that registers none', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'plain'); await stable();
    expect(tabIcon(el, 'a')).toBeNull();
    ws.setPanelIcon('a', Runtime); await stable();
    expect(tabIcon(el, 'a')!.querySelector('.runtime-icon')).not.toBeNull();
  });

  it('changes the floating title bar icon', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('f', 'other', { initialTarget: 'floating' }); await stable();
    expect(windowIcon(el, 'f')!.querySelector('.registered-icon')).not.toBeNull();
    ws.setPanelIcon('f', Runtime); await stable();
    expect(windowIcon(el, 'f')!.querySelector('.runtime-icon')).not.toBeNull();
    expect(windowIcon(el, 'f')!.querySelector('.registered-icon')).toBeNull();
  });

  it('changes the taskbar icon', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('m', 'other'); ws.minimizePanel('m'); await stable();
    expect(taskbarIcon(el, 'm')!.querySelector('.registered-icon')).not.toBeNull();
    ws.setPanelIcon('m', Runtime); await stable();
    expect(taskbarIcon(el, 'm')!.querySelector('.runtime-icon')).not.toBeNull();
    expect(taskbarIcon(el, 'm')!.querySelector('.registered-icon')).toBeNull();
  });

  it('the nddTabContent template receives the runtime icon', async () => {
    const { ws, fixture, stable } = await setup(TabContentHost);
    const last = fixture.componentInstance.last;
    ws.openPanel('a', 'other'); await stable();
    expect(last['a']!.icon).toBe(Registered);
    ws.setPanelIcon('a', Runtime); await stable();
    expect(last['a']!.icon).toBe(Runtime);
    ws.setPanelIcon('a', null); await stable();
    expect(last['a']!.icon).toBe(Registered);
  });

  it('an unknown id does nothing, and the same icon changes no state', async () => {
    const { ws } = await setup();
    ws.openPanel('a', 'other');
    const before = ws.state().panels;
    ws.setPanelIcon('nope', Runtime);
    expect(ws.state().panels).toBe(before);
    expect('nope' in ws.state().panels).toBe(false);
    ws.setPanelIcon('a', Runtime);
    const withIcon = ws.state().panels;
    expect(withIcon).not.toBe(before);
    ws.setPanelIcon('a', Runtime);
    expect(ws.state().panels).toBe(withIcon);
  });
});

describe('injectPanel().setIcon in a workspace panel', () => {
  it('updates the panel icon, with no standalone warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ws, el, stable } = await setup();
    ws.openPanel('s', 'setter'); await stable();
    expect(panelFromInside).toBeDefined();
    panelFromInside!.setIcon(Runtime); await stable();
    expect(ws.state().panels['s']!.icon).toBe(Runtime);
    expect(tabIcon(el, 's')!.querySelector('.runtime-icon')).not.toBeNull();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('outside a panel container');
  });
});

describe('persistence', () => {
  it('saveLayout writes no icon, byte for byte the same as without one', async () => {
    const { ws } = await setup();
    ws.openPanel('a', 'other'); ws.openPanel('f', 'plain', { initialTarget: 'floating' });
    ws.openPanel('m', 'other'); ws.minimizePanel('m');
    const without = ws.saveLayout();
    ws.setPanelIcon('a', Runtime); ws.setPanelIcon('f', 'bi bi-map'); ws.setPanelIcon('m', Runtime);
    const withIcons = ws.saveLayout();
    expect(withIcons).not.toContain('icon');
    expect(withIcons).toBe(without);
  });

  it('loadLayout keeps the icon of a panel that stays open with the same component', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'other'); ws.openPanel('b', 'other', { initialTarget: 'tabbed' });
    const saved = ws.saveLayout();
    ws.setPanelIcon('a', Runtime); ws.setPanelIcon('b', Runtime);
    // `b` comes back as a different component: its runtime icon belonged to the old one.
    const swapped = JSON.parse(saved);
    swapped.panels.b.component = 'plain';
    expect(ws.loadLayout(JSON.stringify(swapped))).toBe(true);
    await stable();
    expect(ws.state().panels['a']!.icon).toBe(Runtime);
    expect(ws.state().panels['b']!.icon).toBeUndefined();
    ws.focusPanel('a'); await stable();
    expect(tabIcon(el, 'a')!.querySelector('.runtime-icon')).not.toBeNull();
  });

  it('an icon in a hand-made layout is dropped, on load and at start', async () => {
    const { ws } = await setup();
    ws.openPanel('a', 'other');
    const layout = JSON.parse(ws.saveLayout());
    layout.panels.a.icon = 'bi bi-map';
    const json = JSON.stringify(layout);
    const fresh = createWorkspace({ panels: { other: { component: P } } });
    expect(fresh.loadLayout(json)).toBe(true);
    expect(fresh.state().panels['a']!.icon).toBeUndefined();
    const started = createWorkspace({ panels: { other: { component: P } }, initialState: json });
    expect(started.state().panels['a']!.icon).toBeUndefined();
  });
});
