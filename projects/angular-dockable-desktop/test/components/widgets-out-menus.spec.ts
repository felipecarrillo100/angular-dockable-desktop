/**
 * Widgets out of the panel (rdd 7.11.0), M4 and M5 plus their next.1 / 7.11.0 fixes: the widget's
 * capabilities and `titleMenu`, `injectWidget()` and the move callbacks, through the public API in
 * a real desktop. A port of rdd's `WidgetsOut.test.tsx` WO9–WO16, WO20, WO22 and WO23 (names
 * kept), after vdd's `widgetsOutMenus.test.ts`.
 *
 * WO9:  canDock / canFloat are the hosted panel's user rules; a re-open changes them
 * WO10: titleMenu in the panel: the title icon becomes a button opening the app's items
 * WO11: the hosted tab's menu: the app's items, then Minimize and Close; no built-in Float
 * WO12: a floating hosted panel's ⋮ menu: the app's items, then Close
 * WO13: injectWidget(): null outside a widget; id, owner, a reactive location
 * WO14: the order of the callbacks (incl. floating to floating and tabbed to tabbed, rdd 7.11.0)
 * WO15: the user's own moves of the hosted panel call both; two in one tick are one move (ndd)
 * WO16: a no-op, a refusal and a close call nothing; a layout load is a move; unsubscribing
 * WO20: a widget's panel brings its owner's contribution (rdd next.1)
 * WO22: injectWidget().panelId (rdd next.1)
 * WO23: the title icon opens the menu out of the panel (rdd next.1)
 *
 * jsdom has no ResizeObserver, so `onMoved` comes from its two-frame fallback: `frames()` waits.
 */
import { Component } from '@angular/core';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { PanelDefinition, Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddTabContentTemplate } from '../../src/lib/desktop/tab-content';
import { NddModals } from '../../src/lib/overlays/modals';
import { NddContextMenu } from '../../src/lib/context-menu/context-menu';
import { NddPanelOverlay, injectFloatingWidgets } from '../../src/lib/panel-overlay/panel-overlay';
import type { FloatingWidgetsApi } from '../../src/lib/panel-overlay/panel-overlay';
import type { ManagedWidget, WidgetMenuContext } from '../../src/lib/panel-overlay/overlay-store';
import { injectWidget } from '../../src/lib/panel-overlay/widget-handle';
import type { WidgetHandle } from '../../src/lib/panel-overlay/widget-handle';
import { injectActiveContribution, injectPanelContribution } from '../../src/lib/contributions/inject-contributions';
import { isDropAllowed } from '../../src/lib/core/dock-rules';
import type { PanelDropTarget } from '../../src/lib/core/types';

let api: FloatingWidgetsApi | null = null;

@Component({ selector: 'ndd-test-wm-table', template: `<button id="wo-count" type="button">0</button>` })
class Table {}

@Component({ selector: 'ndd-test-wm-grab', template: '' })
class Grab {
  constructor() {
    api = injectFloatingWidgets();
  }
}

@Component({
  selector: 'ndd-test-wm-owner',
  imports: [NddPanelOverlay, Grab],
  template: `<ndd-panel-overlay><ndd-test-wm-grab /></ndd-panel-overlay>`,
})
class Owner {}

@Component({ selector: 'ndd-test-wm-plain', template: '<div></div>' })
class Plain {}

@Component({ selector: 'ndd-test-wm-icon', template: '<i class="t-icon"></i>' })
class TIcon {}

@Component({
  selector: 'ndd-test-wm-shell',
  imports: [NddDesktop, NddContextMenu],
  template: `<ndd-desktop /><ndd-context-menu />`,
})
class Shell {}

const table: ManagedWidget = { title: 'Table', component: Table, anchor: 'bottom-left', width: 240, height: 160 };

let fixture: ComponentFixture<unknown> | null = null;
let widget: WidgetHandle | null = null;
const calls: string[] = [];
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.body.innerHTML = '';
  api = null;
  widget = null;
  calls.length = 0;
});

const stable = () => fixture!.whenStable();
const act = async (fn: () => unknown) => {
  fn();
  await stable();
};
/** onMoved's fallback is two frames; jsdom's are timers. */
const frames = async () => {
  await new Promise(r => setTimeout(r, 80));
  await stable();
};

async function desktop(panels: Record<string, PanelDefinition>, root: Type<unknown> = Shell): Promise<Workspace> {
  const ws = createWorkspace({ panels }) as unknown as Workspace;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  fixture = TestBed.createComponent(root) as ComponentFixture<unknown>;
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await stable();
  return ws;
}

async function setup(extra: Record<string, PanelDefinition> = {}, root: Type<unknown> = Shell): Promise<Workspace> {
  const ws = await desktop({ map: { component: Owner }, plain: { component: Plain }, ...extra }, root);
  await act(() => ws.openPanel('map', 'map', { title: 'Map' }));
  await act(() => api!.open('table', table));
  return ws;
}

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const content = () => $('.ndd-panel-float__content');
/** The open menu, top level: each item's label, and '---' for a separator. */
const menu = () => {
  const m = document.querySelector('[data-ndd-menu]');
  return m
    ? [...m.children].map(c => (c.tagName === 'HR' ? '---' : (c.querySelector('.ndd-context-menu__label')?.textContent?.trim() ?? '?')))
    : null;
};
const menuItem = (label: string) => $(`[data-ndd-menu-item="${label}"]`)!;
const rightClick = (sel: string) =>
  act(() => $(sel)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })));
/** Dismisses an open menu, as a click elsewhere does. */
const dismiss = () => act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
const allowed = (ws: Workspace, to: PanelDropTarget) => isDropAllowed(ws as never, 'map/table', to);

// ─── M4: capabilities and titleMenu ───────────────────────────────────────────

describe('WO9: canDock / canFloat', () => {
  it('are false by default, and a re-open changes them while out', async () => {
    const ws = await setup();
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    expect(allowed(ws, { kind: 'float', anchor: null })).toBe(false);
    expect(allowed(ws, { kind: 'edge', side: 'left' })).toBe(false);
    await act(() => api!.open('table', { ...table, canFloat: true }));
    expect(allowed(ws, { kind: 'float', anchor: null })).toBe(true);
    expect(allowed(ws, { kind: 'edge', side: 'left' })).toBe(false);
    await act(() => api!.open('table', { ...table, canFloat: true, canDock: true }));
    expect(allowed(ws, { kind: 'edge', side: 'left' })).toBe(true);
  });

  it('a widget opened with them carries them out', async () => {
    const ws = await setup();
    await act(() => api!.close('table'));
    await act(() => api!.open('table', { ...table, canDock: true }));
    await act(() => api!.move('table', { to: 'tabbed' }));
    expect(allowed(ws, { kind: 'edge', side: 'left' })).toBe(true);
    expect(allowed(ws, { kind: 'float', anchor: null })).toBe(false);
  });
});

describe('WO10: titleMenu in the panel', () => {
  it("turns the title icon into a button that opens the app's items, given where the widget is", async () => {
    await setup();
    let seen: WidgetMenuContext | null = null;
    await act(() =>
      api!.open('table', {
        ...table,
        canDock: true,
        icon: TIcon,
        titleMenu: w => {
          seen = w;
          return [
            { label: 'Dock below', action: () => w.move({ to: 'docked', position: 'bottom' }) },
            { label: 'Close it', action: () => w.close() },
          ];
        },
      }),
    );
    const button = $('[data-ndd-widget="table"] button.ndd-panel-float__menu')!;
    expect(button).not.toBeNull();
    expect(button.querySelector('.t-icon')).not.toBeNull();
    await act(() => button.click());
    expect(menu()).toEqual(['Dock below', 'Close it']);
    expect(seen).toMatchObject({ id: 'table', location: 'panel', canDock: true, canFloat: false });
    await act(() => menuItem('Dock below').click());
    expect(api!.location('table')).toBe('docked');
  });

  it('a "Close" item closes the widget for real', async () => {
    await setup();
    await act(() => api!.open('table', { ...table, titleMenu: w => [{ label: 'Close it', action: () => w.close() }] }));
    await act(() => $('button.ndd-panel-float__menu')!.click());
    await act(() => menuItem('Close it').click());
    expect(api!.isOpen('table')).toBe(false);
  });

  it('without titleMenu the icon stays plain, and with no icon there is no button', async () => {
    await setup();
    expect($('.ndd-panel-float__menu')).toBeNull();
    await act(() => api!.open('table', { ...table, icon: TIcon }));
    expect($('span.ndd-panel-float__icon .t-icon')).not.toBeNull();
    expect($('.ndd-panel-float__menu')).toBeNull();
  });

  it('with titleMenu and no icon, the button shows a menu glyph', async () => {
    await setup();
    await act(() => api!.open('table', { ...table, titleMenu: () => [{ label: 'x' }] }));
    expect($('button.ndd-panel-float__menu svg')).not.toBeNull();
  });

  it('a click on the button neither starts a drag nor reaches the frame; from the keyboard it opens on the first item', async () => {
    await setup();
    await act(() => api!.open('table', { ...table, titleMenu: () => [{ label: 'A' }, { label: 'B' }] }));
    const button = $('button.ndd-panel-float__menu')!;
    const reached = vi.fn();
    $('[data-ndd-widget-header]')!.addEventListener('pointerdown', reached);
    $('[data-ndd-widget-header]')!.addEventListener('click', reached);
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    // A click from the keyboard: detail 0.
    await act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    await stable();
    expect(reached).not.toHaveBeenCalled();
    expect(menu()).toEqual(['A', 'B']);
    expect(document.activeElement?.getAttribute('data-ndd-menu-item')).toBe('A');
  });
});

describe("WO11: the hosted tab's menu", () => {
  it("leads with the app's items, then Minimize and Close; no built-in Float", async () => {
    const ws = await setup();
    let seen: WidgetMenuContext | null = null;
    await act(() =>
      api!.open('table', {
        ...table,
        canFloat: true,
        titleMenu: w => {
          seen = w;
          return [{ label: 'Back into the map', action: () => w.move({ to: 'panel' }) }];
        },
      }),
    );
    await act(() => api!.move('table', { to: 'tabbed' }));
    await rightClick('[data-ndd-tab="map/table"]');
    expect(menu()).toEqual(['Back into the map', '---', 'Minimize Panel', '---', 'Close Tab']);
    expect(seen).toMatchObject({ location: 'tabbed', canFloat: true });
    await act(() => menuItem('Back into the map').click());
    expect(api!.location('table')).toBe('panel');
    expect(ws.isOpen('map/table')).toBe(false);
    // Back home, nothing is left registered under the hosted panel's id.
    expect(ws.panelMenuItems('map/table')).toEqual([]);
  });

  it('without titleMenu it is the built-in items only, still without Float', async () => {
    await setup();
    await act(() => api!.open('table', { ...table, canFloat: true }));
    await act(() => api!.move('table', { to: 'tabbed' }));
    await rightClick('[data-ndd-tab="map/table"]');
    expect(menu()).toEqual(['Minimize Panel', '---', 'Close Tab']);
  });

  it("an ordinary panel's menu is unchanged: Float first", async () => {
    await setup();
    await rightClick('[data-ndd-tab="map"]');
    expect(menu()![0]).toBe('Float Window');
  });
});

describe("WO12: a floating hosted panel's title-bar menu", () => {
  it("is the app's items, then Close, which closes the widget", async () => {
    await setup();
    await act(() => api!.open('table', { ...table, titleMenu: () => [{ label: 'Back into the map' }] }));
    await act(() => api!.move('table', { to: 'floating', rect: { x: 10, y: 10, width: 200, height: 150 } }));
    await act(() => $('[data-ndd-window="map/table"] .ndd-btn-more-actions')!.click());
    expect(menu()).toEqual(['Back into the map', '---', 'Close Panel']);
    await act(() => menuItem('Close Panel').click());
    expect(api!.isOpen('table')).toBe(false);
  });

  it('without titleMenu there is no menu button', async () => {
    await setup();
    await act(() => api!.move('table', { to: 'floating' }));
    expect($('[data-ndd-window="map/table"]')).not.toBeNull();
    expect($('[data-ndd-window="map/table"] .ndd-btn-more-actions')).toBeNull();
  });

  it('a re-open that adds a titleMenu while floating shows the button and the icon menu at once', async () => {
    await setup();
    await act(() => api!.move('table', { to: 'floating' }));
    await act(() => api!.open('table', { ...table, titleMenu: () => [{ label: 'x' }] }));
    expect($('[data-ndd-window="map/table"] .ndd-btn-more-actions')).not.toBeNull();
    expect($('[data-ndd-window="map/table"] .ndd-window-title-icon--menu')).not.toBeNull();
  });
});

// ─── M5: injectWidget() and the move callbacks ────────────────────────────────

/** Where the content element is: what each callback saw at that moment. */
const where = () => {
  const parent = content()?.parentElement;
  if (!parent) return 'nowhere';
  if (parent.classList.contains('ndd-panel-float__body')) return 'body';
  if (parent.classList.contains('ndd-hosted-widget')) return 'hosted';
  if (parent.classList.contains('ndd-widget-store')) return 'store';
  return parent.className;
};

/** Records its handle, and what each callback saw. */
@Component({ selector: 'ndd-test-wm-probe', template: `<span id="wo-loc">{{ w?.location() ?? 'none' }}</span>` })
class Probe {
  protected readonly w = injectWidget();
  constructor() {
    widget = this.w;
    this.w?.onWillMove(() => calls.push(`will@${where()}`));
    this.w?.onMoved(() => calls.push(`moved@${where()}`));
  }
}
const probed: ManagedWidget = { ...table, component: Probe };
const loc = () => $('#wo-loc')?.textContent?.trim();
async function setupProbe(): Promise<Workspace> {
  const ws = await setup();
  await act(() => api!.close('table'));
  await act(() => api!.open('table', probed));
  calls.length = 0;
  return ws;
}

describe('WO13: injectWidget()', () => {
  it('is null outside a managed widget', async () => {
    await desktop({ probe: { component: Probe } });
    expect(widget).toBeNull();
  });

  it('is null in a workspace panel, which is not a widget', async () => {
    const ws = await desktop({ probe: { component: Probe } });
    await act(() => ws.openPanel('p', 'probe'));
    expect($('#wo-loc')?.textContent?.trim()).toBe('none');
    expect(widget).toBeNull();
  });

  it('gives the id, the owner panel, and a location that re-renders when it changes', async () => {
    const ws = await setupProbe();
    expect(widget).toMatchObject({ id: 'table', ownerPanelId: 'map' });
    expect(widget!.location()).toBe('panel');
    expect(loc()).toBe('panel');
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    expect(loc()).toBe('docked');
    await act(() => api!.move('table', { to: 'tabbed' }));
    expect(loc()).toBe('tabbed');
    await act(() => ws.minimizePanel('map/table'));
    expect(loc()).toBe('minimized');
    await act(() => api!.move('table', { to: 'panel' }));
    expect(loc()).toBe('panel');
  });

  it('has no owner panel outside a workspace panel', async () => {
    @Component({ selector: 'ndd-test-wm-root', imports: [Owner], template: '<ndd-test-wm-owner />' })
    class Root {}
    await desktop({}, Root);
    await act(() => api!.open('table', probed));
    expect(widget).toMatchObject({ id: 'table', ownerPanelId: null });
    expect(widget!.location()).toBe('panel');
  });

  it('has no owner panel in a modal, which has a panel context but no place in the layout', async () => {
    @Component({ selector: 'ndd-test-wm-root', imports: [NddDesktop, NddModals], template: '<ndd-desktop /><ndd-modals />' })
    class Root {}
    const ws = await desktop({}, Root);
    ws.overlays.openModal(Owner, {}, { title: 'Modal' });
    await stable();
    await stable();
    await act(() => api!.open('table', probed));
    expect(widget).toMatchObject({ id: 'table', ownerPanelId: null });
  });
});

describe('WO14: the order of the callbacks', () => {
  it('floating to floating, and tabbed to tabbed, are moves too: one will, one moved', async () => {
    await setupProbe();
    await act(() => api!.move('table', { to: 'floating', rect: { x: 0, y: 0, width: 200, height: 100 } }));
    await frames();
    calls.length = 0;
    await act(() => api!.move('table', { to: 'floating', rect: { x: 50, y: 40, width: 320, height: 200 } }));
    await frames();
    expect(calls.map(c => c.split('@')[0])).toEqual(['will', 'moved']);
    await act(() => api!.move('table', { to: 'tabbed' }));
    await frames();
    calls.length = 0;
    await act(() => api!.move('table', { to: 'tabbed' }));
    await frames();
    expect(calls.map(c => c.split('@')[0])).toEqual(['will', 'moved']);
  });

  it('onWillMove before the element moves, onMoved after it landed', async () => {
    await setupProbe();
    api!.move('table', { to: 'docked', position: 'bottom' });
    expect(calls).toEqual(['will@body']);
    await frames();
    expect(calls).toEqual(['will@body', 'moved@hosted']);
    api!.move('table', { to: 'panel' });
    expect(calls.slice(2)).toEqual(['will@hosted']);
    await frames();
    expect(calls.slice(2)).toEqual(['will@hosted', 'moved@body']);
  });

  it('out to out is one move: one will, one moved', async () => {
    await setupProbe();
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    await frames();
    calls.length = 0;
    api!.move('table', { to: 'floating', rect: { x: 0, y: 0, width: 200, height: 100 } });
    await frames();
    expect(calls).toEqual(['will@hosted', 'moved@hosted']);
  });
});

describe("WO15: the user's own moves", () => {
  it('minimising and restoring the hosted panel call both', async () => {
    const ws = await setupProbe();
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    await frames();
    calls.length = 0;
    // Synchronously, inside the workspace's own call: before anything re-renders.
    ws.minimizePanel('map/table');
    expect(calls).toEqual(['will@hosted']);
    await frames();
    expect(calls).toHaveLength(2);
    ws.restorePanel('map/table');
    expect(calls[2]).toMatch(/^will@/);
    await frames();
    expect(calls).toHaveLength(4);
    expect(calls[3]).toBe('moved@hosted');
  });

  it('floating it from the grid calls both', async () => {
    const ws = await setupProbe();
    await act(() => api!.move('table', { to: 'tabbed' }));
    await frames();
    calls.length = 0;
    ws.floatPanel('map/table');
    expect(calls).toEqual(['will@hosted']);
    await frames();
    expect(calls).toEqual(['will@hosted', 'moved@hosted']);
    expect(loc()).toBe('floating');
  });

  it('docking it from a float into another group calls both, once', async () => {
    const ws = await setupProbe();
    await act(() => api!.move('table', { to: 'floating', rect: { x: 0, y: 0, width: 200, height: 100 } }));
    await frames();
    calls.length = 0;
    ws.dockPanel('map/table');
    await frames();
    expect(calls).toEqual(['will@hosted', 'moved@hosted']);
    expect(['docked', 'tabbed']).toContain(loc());
  });
});

describe("WO15 (ndd): the user's moves in one tick", () => {
  it('two moves in one tick are one move: one will, one moved', async () => {
    const ws = await setupProbe();
    await act(() => api!.move('table', { to: 'tabbed' }));
    await frames();
    calls.length = 0;
    ws.floatPanel('map/table');
    ws.minimizePanel('map/table');
    expect(calls).toEqual(['will@hosted']);
    await frames();
    expect(calls.map(c => c.split('@')[0])).toEqual(['will', 'moved']);
  });
});

describe('WO16: when nothing is called, and the rest', () => {
  it('a no-op, a refusal and a close call nothing', async () => {
    const ws = await setupProbe();
    await act(() => api!.move('table', { to: 'panel' }));
    await act(() => ws.floatPanel('map'));
    await act(() => api!.move('table', { to: 'tabbed' })); // refused: owner floating
    await frames();
    expect(calls).toEqual([]);
    await act(() => ws.dockPanel('map'));
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    await frames();
    calls.length = 0;
    await act(() => ws.closePanel('map/table'));
    await frames();
    expect(calls).toEqual([]);
  });

  it('a layout load sending it home is a move', async () => {
    const ws = await setupProbe();
    const layout = ws.saveLayout();
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    await frames();
    calls.length = 0;
    await act(() => ws.loadLayout(layout));
    await frames();
    expect(calls).toEqual(['will@hosted', 'moved@body']);
  });

  it('unsubscribing stops the calls', async () => {
    await setupProbe();
    const extra = vi.fn();
    const off = widget!.onWillMove(extra);
    off();
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    await frames();
    expect(extra).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it('a subscription goes with the component that made it', async () => {
    await setupProbe();
    await act(() => api!.open('table', table)); // another component: the probe is destroyed
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    await frames();
    expect(calls).toEqual([]);
  });
});

describe("WO20: a widget's panel brings its owner's contribution", () => {
  @Component({
    selector: 'ndd-test-wm-tools',
    imports: [NddPanelOverlay, Grab],
    template: `<ndd-panel-overlay><ndd-test-wm-grab /></ndd-panel-overlay>`,
  })
  class OwnerWithTools {
    constructor() {
      injectPanelContribution(() => ({ sidebarSections: [{ id: 'tools', label: 'Tools', component: Plain }] }));
    }
  }
  @Component({ selector: 'ndd-test-wm-own', template: '<div></div>' })
  class PlainWithOwn {
    constructor() {
      injectPanelContribution(() => ({ sidebarSections: [{ id: 'own', label: 'Own', component: Plain }] }));
    }
  }
  @Component({
    selector: 'ndd-test-wm-contrib-shell',
    imports: [NddDesktop],
    template: `<ndd-desktop /><span id="wo-contrib">{{ ids() }}</span>`,
  })
  class ContribShell {
    private readonly active = injectActiveContribution();
    protected readonly ids = () => this.active()?.sidebarSections?.map(s => s.id).join(',') ?? 'none';
  }
  const contrib = () => $('#wo-contrib')?.textContent?.trim();

  it("the active widget panel shows the owner's; an ordinary panel shows its own", async () => {
    const ws = await setup({ map: { component: OwnerWithTools }, other: { component: PlainWithOwn } }, ContribShell);
    await act(() => ws.focusPanel('map'));
    expect(contrib()).toBe('tools');
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    await act(() => ws.focusPanel('map/table'));
    expect(ws.state().activePanelId).toBe('map/table');
    expect(contrib()).toBe('tools');
    await act(() => ws.openPanel('other', 'other', { title: 'Other' }));
    await act(() => ws.focusPanel('other'));
    expect(contrib()).toBe('own');
    await act(() => api!.move('table', { to: 'floating' }));
    await act(() => ws.focusPanel('map/table'));
    expect(contrib()).toBe('tools');
  });
});

describe('WO22: injectWidget().panelId', () => {
  it("is null in the panel, the widget panel's id out of it, and null again back home", async () => {
    const ws = await setupProbe();
    expect(widget!.panelId()).toBeNull();
    await act(() => api!.move('table', { to: 'docked', position: 'bottom' }));
    expect(widget!.panelId()).toBe('map/table');
    await act(() => api!.move('table', { to: 'floating' }));
    expect(widget!.panelId()).toBe('map/table');
    await act(() => ws.minimizePanel('map/table'));
    expect(widget!.panelId()).toBe('map/table');
    await act(() => api!.move('table', { to: 'panel' }));
    expect(widget!.panelId()).toBeNull();
  });
});

describe('WO23: the title icon opens the menu out of the panel', () => {
  // An ordinary panel shows a tab or title-bar icon only when it has one; a widget's panel always
  // does on its tab (the menu glyph without an icon), as rdd always shows one.
  const withMenu: ManagedWidget = { ...table, icon: TIcon, titleMenu: () => [{ label: 'Back into the map' }] };

  it('the tab icon of a widget panel opens the same menu as a right-click on its tab', async () => {
    await setup();
    await act(() => api!.open('table', withMenu));
    await act(() => api!.move('table', { to: 'tabbed' }));
    const icon = $('[data-ndd-tab="map/table"] .ndd-workspace-tab-icon')!;
    expect(icon.classList.contains('ndd-workspace-tab-icon--menu')).toBe(true);
    expect(icon.querySelector('.t-icon')).not.toBeNull();
    const reached = vi.fn();
    $('[data-ndd-tab="map/table"]')!.addEventListener('pointerdown', reached);
    icon.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(reached).not.toHaveBeenCalled(); // not a tab drag
    await act(() => icon.click());
    expect(menu()).toEqual(['Back into the map', '---', 'Minimize Panel', '---', 'Close Tab']);
  });

  it("an ordinary panel's tab icon opens nothing", async () => {
    const ws = await setup();
    await act(() => ws.setPanelIcon('map', TIcon));
    const icon = $('[data-ndd-tab="map"] .ndd-workspace-tab-icon')!;
    expect(icon.classList.contains('ndd-workspace-tab-icon--menu')).toBe(false);
    await act(() => icon.click());
    expect(menu()).toBeNull();
  });

  it('the floating title-bar icon opens the ⋮ menu; without a titleMenu it is plain', async () => {
    await setup();
    await act(() => api!.open('table', { ...table, icon: TIcon }));
    await act(() => api!.move('table', { to: 'floating' }));
    const plain = $('[data-ndd-window="map/table"] .ndd-window-title-icon')!;
    expect(plain.classList.contains('ndd-window-title-icon--menu')).toBe(false);
    await act(() => plain.click());
    expect(menu()).toBeNull();
    await act(() => api!.move('table', { to: 'panel' }));
    await act(() => api!.open('table', withMenu));
    await act(() => api!.move('table', { to: 'floating' }));
    const icon = $('[data-ndd-window="map/table"] .ndd-window-title-icon')!;
    expect(icon.classList.contains('ndd-window-title-icon--menu')).toBe(true);
    const reached = vi.fn();
    $('[data-ndd-titlebar="map/table"]')!.addEventListener('pointerdown', reached);
    $('[data-ndd-titlebar="map/table"]')!.addEventListener('dblclick', reached);
    icon.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    icon.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(reached).not.toHaveBeenCalled(); // neither a window drag nor a maximise
    await act(() => icon.click());
    expect(menu()).toEqual(['Back into the map', '---', 'Close Panel']);
  });

  it('a widget without an icon still gets one there: the menu glyph, opening the same menus', async () => {
    await setup();
    await act(() => api!.open('table', { ...table, titleMenu: () => [{ label: 'Back into the map' }] }));
    await act(() => api!.move('table', { to: 'tabbed' }));
    const tabIcon = $('[data-ndd-tab="map/table"] .ndd-workspace-tab-icon--menu')!;
    expect(tabIcon.querySelector('svg')).not.toBeNull();
    await act(() => tabIcon.click());
    expect(menu()).toEqual(['Back into the map', '---', 'Minimize Panel', '---', 'Close Tab']);
    await dismiss();
    await act(() => api!.move('table', { to: 'floating' }));
    const winIcon = $('[data-ndd-window="map/table"] .ndd-window-title-icon')!;
    expect(winIcon.classList.contains('ndd-window-title-icon--menu')).toBe(true);
    expect(winIcon.querySelector('svg')).not.toBeNull();
    await act(() => winIcon.click());
    expect(menu()).toEqual(['Back into the map', '---', 'Close Panel']);
  });

  it('...even without a titleMenu, its tab gets the glyph (not its title bar); an ordinary panel gets none', async () => {
    await setup();
    await act(() => api!.move('table', { to: 'tabbed' }));
    const tabIcon = $('[data-ndd-tab="map/table"] .ndd-workspace-tab-icon--menu')!;
    await act(() => tabIcon.click());
    expect(menu()).toEqual(['Minimize Panel', '---', 'Close Tab']);
    expect($('[data-ndd-tab="map"] .ndd-workspace-tab-icon')).toBeNull();
    // Floating, its ⋮ is the only menu (Close): no glyph in the title bar.
    await dismiss();
    await act(() => api!.move('table', { to: 'floating' }));
    expect($('[data-ndd-window="map/table"]')).not.toBeNull();
    expect($('[data-ndd-window="map/table"] .ndd-window-title-icon')).toBeNull();
  });

  it("with the app's own tab content, the icon is the app's and opens nothing; the right-click still does", async () => {
    @Component({
      selector: 'ndd-test-wm-tabshell',
      imports: [NddDesktop, NddContextMenu, NddTabContentTemplate],
      template: `<ndd-desktop><ng-template nddTabContent let-tab><b class="app-tab">{{ tab.title }}</b></ng-template></ndd-desktop><ndd-context-menu />`,
    })
    class TabShell {}
    await setup({}, TabShell);
    await act(() => api!.open('table', withMenu));
    await act(() => api!.move('table', { to: 'tabbed' }));
    expect($('[data-ndd-tab="map/table"] .app-tab')).not.toBeNull();
    expect($('[data-ndd-tab="map/table"] .ndd-workspace-tab-icon--menu')).toBeNull();
    await rightClick('[data-ndd-tab="map/table"]');
    expect(menu()![0]).toBe('Back into the map');
  });
});
