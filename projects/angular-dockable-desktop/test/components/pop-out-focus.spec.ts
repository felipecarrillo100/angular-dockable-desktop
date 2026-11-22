/**
 * Focus across windows (1.12.0, rdd 7.12.1's `PopOutFocus.test.tsx`, PF1–PF5 and PF4b as
 * XPF1–XPF5 and XPF4b, by way of vdd 1.14.0's `popOutFocus.test.ts`):
 * `workspace.focusPanelWindow(id)`, `focusPanel` on a panel in its own window, activation from
 * inside a pop-out, Escape scoped per window, and the taskbar's entries for panels in their own
 * window. The pop-out is an `<iframe>`'s window, handed back by a stubbed `window.open`.
 *
 * XPF1:  focusPanelWindow: false for an unknown id; a popped-out panel's window, or the main
 *        window, is focused, and the panel becomes the active one; a widget's panel's window too
 * XPF2:  focusPanel on a popped-out panel brings its window forward; not on a panel in the page;
 *        openPanel on an open popped-out panel activates it without that (rdd's core focus)
 * XPF3:  a pointerdown or a focusin inside a pop-out activates its panel (a widget's too), and its
 *        frame shows it (data-ndd-focused); a focusin in the page doesn't change what it did before
 * XPF4:  Escape: a menu opened in a pop-out renders there and closes on Escape there, not on Escape
 *        in the page; a menu in the page stays open on Escape in a pop-out
 * XPF4b: a toolbar flyout in a popped-out panel closes on Escape there only
 * XPF5:  the taskbar lists a panel in its own window with a marker; a click brings its window
 *        forward; gone on return; shown in compact mode for such entries alone; none with popOut off
 * XPF6:  (as vdd, P5's open gap) a widget's title-icon menu in its owner's panel, opened from the
 *        keyboard while that panel is in its own window, opens in that window, below the icon
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import type { TaskbarVisibility } from '../../src/lib/desktop/taskbar';
import { NddContextMenu } from '../../src/lib/context-menu/context-menu';
import { NddPanelOverlay, injectFloatingWidgets } from '../../src/lib/panel-overlay/panel-overlay';
import type { FloatingWidgetsApi } from '../../src/lib/panel-overlay/panel-overlay';
import { injectPanel } from '../../src/lib/panel/panel-ref';
import { NddToolbar } from '../../src/lib/toolbar/toolbar';
import type { ToolbarItem } from '../../src/lib/core/toolbar-types';

type AnyWindow = Window & typeof globalThis;
const iframes: HTMLIFrameElement[] = [];

interface Popup {
  win: AnyWindow;
  doc: Document;
  focus: ReturnType<typeof vi.fn>;
}
function popup(): Popup {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  iframes.push(frame);
  const win = frame.contentWindow as AnyWindow;
  let closed = false;
  const focus = vi.fn();
  // jsdom tears an iframe's document down on close(); a real pop-out's document stays readable.
  Object.defineProperty(win, 'closed', { get: () => closed, configurable: true });
  Object.defineProperty(win, 'close', {
    value: () => {
      closed = true;
    },
    configurable: true,
  });
  Object.defineProperty(win, 'focus', { value: focus, configurable: true });
  return { win, doc: frame.contentDocument!, focus };
}

/** Each panel's widgets API; `api` is the last panel's. */
let api: FloatingWidgetsApi | null = null;
const apis: Record<string, FloatingWidgetsApi> = {};

@Component({ selector: 'ndd-test-xpf-grab', template: '' })
class Grab {
  constructor() {
    api = injectFloatingWidgets();
    apis[injectPanel().id] = api;
  }
}

@Component({ selector: 'ndd-test-xpf-icon', template: '<span class="pf-w">w</span>' })
class Icon {}

const groupItems: ToolbarItem[] = [
  { type: 'group', id: 'g', label: 'Group', defaultIcon: 'icon', items: [{ id: 'x', label: 'X', icon: 'icon-x' }] },
];

@Component({
  selector: 'ndd-test-xpf-panel',
  imports: [NddPanelOverlay, NddToolbar, Grab],
  template: `
    <div>
      <input class="pf-input" [attr.data-id]="id" />
      <ndd-toolbar [items]="items" position="top" />
      <ndd-panel-overlay><ndd-test-xpf-grab /></ndd-panel-overlay>
    </div>
  `,
})
class Panel {
  protected readonly id = injectPanel().id;
  protected readonly items = groupItems;
}

let taskbarMode: TaskbarVisibility = 'always';
@Component({
  selector: 'ndd-test-xpf-shell',
  imports: [NddDesktop, NddContextMenu],
  template: `<ndd-desktop [taskbar]="taskbar" /><ndd-context-menu />`,
})
class Shell {
  protected readonly taskbar = taskbarMode;
}

let fixture: ComponentFixture<unknown> | null = null;
const settle = async () => {
  await fixture!.whenStable();
  await fixture!.whenStable();
};
const act = async (fn: () => unknown) => {
  fn();
  await settle();
};

async function mount(popOut = true, mode: TaskbarVisibility = 'always'): Promise<Workspace> {
  taskbarMode = mode;
  const ws = createWorkspace({ popOut, panels: { p: { component: Panel, defaultOptions: { canPopOut: true } } } }) as unknown as Workspace;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  fixture = TestBed.createComponent(Shell) as ComponentFixture<unknown>;
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await settle();
  return ws;
}
async function setup(popOut = true): Promise<Workspace> {
  const ws = await mount(popOut);
  ws.openPanel('a', 'p');
  ws.openPanel('b', 'p', { dockTo: { panel: 'a', position: 'right' } });
  await settle();
  return ws;
}
const popOutA = async (ws: Workspace): Promise<Popup> => {
  const p = popup();
  vi.spyOn(window, 'open').mockImplementation(() => p.win);
  expect(ws.popOutPanel('a')).toEqual({ ok: true });
  await settle();
  return p;
};
const active = (ws: Workspace) => ws.state().activePanelId;
const menuIn = (doc: Document) => doc.querySelector('.ndd-context-menu');
const hostedId = (ws: Workspace) => Object.keys(ws.state().panels).find(id => ws.state().panels[id]!.owner)!;
const rect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} }) as DOMRect;

afterEach(() => {
  fixture?.destroy();
  fixture = null;
  TestBed.resetTestingModule();
  iframes.splice(0).forEach(f => f.remove());
  api = null;
  for (const k of Object.keys(apis)) delete apis[k];
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('XPF1: focusPanelWindow', () => {
  it('false for an unknown id', async () => {
    const ws = await setup();
    expect(ws.focusPanelWindow('nope')).toEqual({ ok: false });
  });

  it('a popped-out panel: its window is focused and it becomes the active one', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    await act(() => ws.focusPanel('b'));
    p.focus.mockClear();
    const main = vi.spyOn(window, 'focus').mockImplementation(() => {});
    let r: unknown;
    await act(() => {
      r = ws.focusPanelWindow('a');
    });
    expect(r).toEqual({ ok: true });
    expect(p.focus).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalled();
    expect(active(ws)).toBe('a');
  });

  it('a panel in the page: the main window is focused, and it becomes the active one', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    p.focus.mockClear();
    const main = vi.spyOn(window, 'focus').mockImplementation(() => {});
    await act(() => ws.focusPanelWindow('b'));
    expect(main).toHaveBeenCalledTimes(1);
    expect(p.focus).not.toHaveBeenCalled();
    expect(active(ws)).toBe('b');
  });

  it('a refused focus() is no error', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    p.focus.mockImplementation(() => {
      throw new Error('refused');
    });
    expect(ws.focusPanelWindow('a')).toEqual({ ok: true });
    expect(() => ws.focusPanel('a')).not.toThrow();
    vi.spyOn(window, 'focus').mockImplementation(() => {
      throw new Error('refused');
    });
    expect(ws.focusPanelWindow('b')).toEqual({ ok: true });
  });

  it("a widget's panel in its own window", async () => {
    const ws = await setup();
    api!.open('w', { title: 'W', component: Icon, canPopOut: true });
    await settle();
    const p = popup();
    vi.spyOn(window, 'open').mockImplementation(() => p.win);
    expect(api!.popOut('w')).toEqual({ ok: true });
    await settle();
    p.focus.mockClear();
    const hosted = hostedId(ws);
    await act(() => ws.focusPanelWindow(hosted));
    expect(p.focus).toHaveBeenCalledTimes(1);
    expect(active(ws)).toBe(hosted);
  });
});

describe('XPF2: focusPanel', () => {
  it("on a popped-out panel brings its window forward; on a panel in the page it doesn't", async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    p.focus.mockClear();
    await act(() => ws.focusPanel('a'));
    expect(p.focus).toHaveBeenCalledTimes(1);
    await act(() => ws.focusPanel('b'));
    expect(p.focus).toHaveBeenCalledTimes(1);
  });

  it("openPanel on a popped-out panel activates it without bringing its window forward (rdd's core focus)", async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    await act(() => ws.focusPanel('b'));
    p.focus.mockClear();
    await act(() => ws.openPanel('a', 'p'));
    expect(active(ws)).toBe('a');
    expect(p.focus).not.toHaveBeenCalled();
  });

  it('still brings the window forward after an activation that did not', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    await act(() => ws.focusPanel('b'));
    // An activation from inside the window, then a re-open: neither focuses it...
    await act(() => p.doc.querySelector('.pf-input')!.dispatchEvent(new p.win.PointerEvent('pointerdown', { bubbles: true, button: 0 })));
    await act(() => ws.openPanel('a', 'p'));
    await act(() => ws.focusPanel('b'));
    p.focus.mockClear();
    // ...and focusPanel afterwards still does.
    await act(() => ws.focusPanel('a'));
    expect(p.focus).toHaveBeenCalledTimes(1);
  });
});

describe('XPF3: activation from inside a pop-out', () => {
  it('a pointerdown activates its panel, and its frame shows it', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    await act(() => ws.focusPanel('b'));
    const frame = p.doc.querySelector<HTMLElement>('.ndd-popout-frame')!;
    expect(frame).not.toBeNull();
    expect(frame.hasAttribute('data-ndd-focused')).toBe(false);
    p.focus.mockClear();
    await act(() => p.doc.querySelector('.pf-input')!.dispatchEvent(new p.win.PointerEvent('pointerdown', { bubbles: true, button: 0 })));
    expect(active(ws)).toBe('a');
    expect(frame.hasAttribute('data-ndd-focused')).toBe(true);
    // Its window is already in front: not focused again.
    expect(p.focus).not.toHaveBeenCalled();
  });

  it('a focusin activates its panel', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    await act(() => ws.focusPanel('b'));
    p.focus.mockClear();
    await act(() => p.doc.querySelector('.pf-input')!.dispatchEvent(new p.win.FocusEvent('focusin', { bubbles: true })));
    expect(active(ws)).toBe('a');
    expect(p.focus).not.toHaveBeenCalled();
  });

  it("in a widget's window, its panel", async () => {
    const ws = await setup();
    api!.open('w', { title: 'W', component: Icon, canPopOut: true });
    await settle();
    const p = popup();
    vi.spyOn(window, 'open').mockImplementation(() => p.win);
    api!.popOut('w');
    await settle();
    await act(() => ws.focusPanel('b'));
    await act(() => p.doc.querySelector('.pf-w')!.dispatchEvent(new p.win.PointerEvent('pointerdown', { bubbles: true, button: 0 })));
    expect(ws.state().panels[active(ws)!]!.owner).toBeDefined();
  });

  it("a focusin in the page changes nothing it didn't before", async () => {
    const ws = await setup();
    await act(() => ws.focusPanel('b'));
    await act(() => document.querySelector('.pf-input[data-id="a"]')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(active(ws)).toBe('b');
  });
});

describe('XPF4: Escape, per window', () => {
  const showIn = (ws: Workspace, doc: Document) =>
    act(() => {
      ws.showContextMenu({ event: { target: doc.body, clientX: 5, clientY: 5 } as unknown as MouseEvent, items: [{ label: 'One', action: () => {} }] });
    });
  const escape = (doc: Document) =>
    act(() => {
      const view = doc.defaultView as AnyWindow;
      doc.body.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

  it('a menu opened in a pop-out renders there; Escape in the page leaves it, Escape there closes it', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    await showIn(ws, p.doc);
    expect(menuIn(p.doc)).not.toBeNull();
    expect(menuIn(document)).toBeNull();
    await escape(document);
    expect(menuIn(p.doc)).not.toBeNull();
    await escape(p.doc);
    expect(menuIn(p.doc)).toBeNull();
  });

  it('a menu in the page stays open on Escape in a pop-out', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    await showIn(ws, document);
    expect(menuIn(document)).not.toBeNull();
    await escape(p.doc);
    expect(menuIn(document)).not.toBeNull();
    await escape(document);
    expect(menuIn(document)).toBeNull();
  });
});

describe('XPF4b: a toolbar flyout in a pop-out', () => {
  it('closes on Escape there, not on Escape in the page', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    const btn = p.doc.querySelector<HTMLButtonElement>('button.ndd-toolbar-btn-group')!;
    expect(btn).not.toBeNull();
    await act(() => btn.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true })));
    const flyout = () => p.doc.body.querySelector('.ndd-toolbar-group-flyout');
    expect(flyout()).not.toBeNull();
    expect(document.body.querySelector('.ndd-toolbar-group-flyout')).toBeNull();
    await act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(flyout()).not.toBeNull();
    await act(() => p.doc.body.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(flyout()).toBeNull();
    expect(active(ws)).not.toBeNull();
  });
});

describe('XPF5: the taskbar', () => {
  const entry = (id: string) => document.querySelector<HTMLButtonElement>(`[data-ndd-taskbar-popout="${id}"]`);

  it('lists a panel in its own window with a marker; a click brings its window forward; gone on return', async () => {
    const ws = await setup();
    expect(entry('a')).toBeNull();
    const p = await popOutA(ws);
    const item = entry('a')!;
    expect(item).not.toBeNull();
    expect(item.tagName).toBe('BUTTON');
    expect(item.querySelector('.ndd-taskbar-item-popout-marker')).not.toBeNull();
    expect(item.getAttribute('aria-label')).toMatch(/in its own window$/);
    await act(() => ws.focusPanel('b'));
    p.focus.mockClear();
    await act(() => item.click());
    expect(p.focus).toHaveBeenCalledTimes(1);
    expect(active(ws)).toBe('a');
    await act(() => ws.returnPanel('a'));
    expect(entry('a')).toBeNull();
  });

  it('shows in compact mode when only such entries exist', async () => {
    const ws = await mount(true, 'compact');
    ws.openPanel('a', 'p');
    await settle();
    expect(document.querySelector('[data-ndd-taskbar]')).toBeNull();
    await popOutA(ws);
    expect(document.querySelector('[data-ndd-taskbar]')).not.toBeNull();
    expect(entry('a')).not.toBeNull();
  });

  it('none with popOut off', async () => {
    const ws = await setup(false);
    await act(() => ws.minimizePanel('b'));
    expect(document.querySelector('[data-ndd-taskbar-popout]')).toBeNull();
    expect(document.querySelector('[data-ndd-taskbar-item="b"]')).not.toBeNull(); // minimised as before
  });
});

describe("XPF6: a widget's title-icon menu in its owner's window", () => {
  it('from the keyboard (a click with detail 0), it opens in that window, below the icon, on its first item', async () => {
    const ws = await setup();
    apis['a']!.open('w', {
      title: 'W',
      component: Icon,
      anchor: 'top-left',
      titleMenu: () => [
        { label: 'First', action: () => {} },
        { label: 'Second', action: () => {} },
      ],
    });
    await settle();
    const p = await popOutA(ws);
    const icon = p.doc.querySelector<HTMLButtonElement>('[data-ndd-widget-menu]')!;
    expect(icon).not.toBeNull();
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(rect(12, 4, 28, 20));
    await act(() => icon.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, detail: 0 })));
    const menu = p.doc.querySelector<HTMLElement>('.ndd-context-menu');
    expect(menu).not.toBeNull();
    expect(document.querySelector('.ndd-context-menu')).toBeNull();
    expect(menu!.style.left).toBe('12px');
    expect(menu!.style.top).toBe('20px');
    expect(p.doc.activeElement?.getAttribute('role')).toBe('menuitem');
    expect(p.doc.activeElement?.textContent).toContain('First');
  });

  it('in the page, it still opens below the icon there', async () => {
    await setup();
    apis['a']!.open('w', { title: 'W', component: Icon, anchor: 'top-left', titleMenu: () => [{ label: 'First', action: () => {} }] });
    await settle();
    const icon = document.querySelector<HTMLButtonElement>('[data-ndd-widget-menu]')!;
    expect(icon).not.toBeNull();
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(rect(30, 4, 46, 40));
    await act(() => icon.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    const menu = document.querySelector<HTMLElement>('.ndd-context-menu');
    expect(menu).not.toBeNull();
    expect(menu!.style.left).toBe('30px');
    expect(menu!.style.top).toBe('40px');
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    expect(document.activeElement?.textContent).toContain('First');
  });
});
