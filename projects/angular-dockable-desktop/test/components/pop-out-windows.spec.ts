/**
 * Pop-out windows for panels (1.12.0): the windows registry, the frame and the menu item. A port of
 * vdd 1.14.0's `test/components/popOutWindows.test.ts`, the window halves of rdd 7.12.1's
 * `PopOut.test.tsx`, ids prefixed `X` (`PO` is taken here); the store halves are in
 * test/store/pop-out-store.spec.ts.
 *
 * The child window is an `<iframe>`'s window (its own document and DOM constructors, as a real
 * pop-out's), handed back by a stubbed `window.open`; closing it and its `pagehide` are simulated.
 *
 * XPO1:  disabled: no menu item (the window half)
 * XPO3:  refusals in order: not-open, not-allowed (type, hosted panel), no-gesture, blocked,
 *        no-window; each changes nothing
 * XPO4:  the window's name (an empty URL), title, lang and dir
 * XPO5:  the same element moves into the child's frame and back, never re-created, its state kept
 * XPO6:  the element is back on the page: in its group; floating, with a frame
 * XPO7:  return paths: the frame's button, the child's pagehide (element back inside the handler),
 *        the closed poll, the main page's pagehide; nothing left running
 * XPO8:  the windows follow the store: closePanel, loadLayout and dockPanel close them (window half)
 * XPO10: a second call is idempotent: one window, brought forward
 * XPO11: the child document is registered while open
 * XPO12: popoutUrl, resolved against the main page; the element moves in only once it has loaded;
 *        a page that never loads or can't be read sends the panel back
 * XPO13: the menu item: in the tab menu and the floating ⋮ menu, only with popOut and canPopOut
 * XPO14: a blocked pop-up shows a toast from the menu, nothing from code
 * XPO15: destroying the desktop brings every panel back and closes its window
 * XPO18: each window opened gets a name of its own
 * XPO19: the frame lays itself out without the stylesheet
 * XPO23: a page failing at once leaves no timer behind
 * XPO24: a return and a new pop-out of the same panel in one tick fill the new window
 * XPO25: no desktop rendered: 'no-window', and nothing opens
 * XPO26: the window's position is the panel's screen position, negative too
 * XPO32: popoutUrl: a page ready without a load event is found by the poll's check
 * vdd additions:
 * XPOE1: the four events, in order, with the element's document at each; a failed window sends returned
 * XPOE2: popped-out waits for the frame to be shown, returned for the shown element to leave the store
 * XPOM1: a context menu open in a pop-out closes when the window goes (P1's open item)
 * XPOR1: the panel's size observer is rebuilt from the window its element moves into, and back
 * ndd additions:
 * XPON1: a toolbar flyout and a search dropdown open in a pop-out close when the window goes
 *        (P1's open item)
 * XPON2: a registry bound without a panel host: 'no-window', nothing opens
 * XPON3: a widget's hosted panel pops out through the router its overlay registered (P5's hook)
 * XPON4: the registry's entries follow the windows: one while out, none after the return
 * XPON5: a hosted pop-out for a panel the store doesn't have: 'not-open', and its window closes
 * XPON5b: a hosted pop-out whose widget declines (prepare() false): 'not-allowed', its window closes
 * XPON6: the window opens over the panel: its place and size from the panel's box on the page
 * XPON7: a popped-out event still waiting when the panel comes back is never sent
 *
 * Not ported: PO10's StrictMode case (Angular has no double-invoked effects); the store halves (P2a).
 * Changed shape: XPOE1/XPOE2 run the page's animation frames on real timers (see `ownFrames`); the desktop is destroyed (`fixture.destroy()`) where vdd unmounts it; XPO23 lets
 * the 0 ms timer of Angular's zoneless scheduler run before it counts the timers left.
 */
import { Component, input, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddContextMenu } from '../../src/lib/context-menu/context-menu';
import { NddToolbar } from '../../src/lib/toolbar/toolbar';
import type { ToolbarItem } from '../../src/lib/core/toolbar-types';
import { NddToolbarSearch } from '../../src/lib/panel-overlay/toolbar-search';
import { findLeafForPanel } from '../../src/lib/core/layout-tree';
import { listenOnDocuments } from '../../src/lib/core/document-registry';
import { POPOUT_PLACED_TIMEOUT_MS, createPopOutWindows } from '../../src/lib/core/pop-out-windows';
import { toast } from '../../src/lib/toast/toast';
import type { PopOutResult } from '../../src/lib/core/types';

type AnyWindow = Window & typeof globalThis;

const mounts = vi.fn();
/** A panel with state, recording every creation. */
@Component({
  selector: 'ndd-test-po-counter',
  template: `<button class="po-count" [attr.data-id]="panelId()" (click)="n.set(n() + 1)">{{ n() }}</button>`,
})
class Counter implements OnInit {
  readonly panelId = input('');
  protected readonly n = signal(0);
  ngOnInit(): void {
    mounts(this.panelId());
  }
}

const groupItems: ToolbarItem[] = [
  { type: 'group', id: 'g', label: 'Shapes', defaultIcon: 'x', items: [{ id: 'r', label: 'Rect', icon: 'x' }] },
];
/** A panel with a toolbar flyout and a search field, for XPON1. */
@Component({
  selector: 'ndd-test-po-tools',
  imports: [NddToolbar, NddToolbarSearch],
  template: `<ndd-toolbar position="top" [items]="items" /><ndd-toolbar-search [search]="search" [debounce]="0" />`,
})
class Tools {
  protected readonly items = groupItems;
  protected readonly search = async () => [{ id: 'one', label: 'One' }];
}

let popoutUrl: string | undefined;
@Component({
  selector: 'ndd-test-po-shell',
  imports: [NddDesktop, NddContextMenu],
  template: `<ndd-desktop [popoutUrl]="url" /><ndd-context-menu />`,
})
class Shell {
  protected readonly url = popoutUrl;
}

let fixture: ComponentFixture<unknown> | null = null;
const frames: HTMLIFrameElement[] = [];
const cleanups: (() => void)[] = [];

interface Popup {
  win: AnyWindow;
  doc: Document;
  /** The user closes the window: `closed` turns true; `pagehide` fires unless `silent`. */
  closeByUser(silent?: boolean): void;
  focus: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

/** A child window: an iframe's, with `closed`, `close()` and `focus()` under the test's control. */
function popup(): Popup {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const win = frame.contentWindow as AnyWindow;
  let closed = false;
  Object.defineProperty(win, 'closed', { get: () => closed, configurable: true });
  const close = vi.fn(() => {
    closed = true;
  });
  const focus = vi.fn();
  Object.defineProperty(win, 'close', { value: close, configurable: true });
  Object.defineProperty(win, 'focus', { value: focus, configurable: true });
  return {
    win,
    doc: frame.contentDocument!,
    close,
    focus,
    closeByUser(silent = false) {
      closed = true;
      if (!silent) win.dispatchEvent(new win.Event('pagehide'));
    },
  };
}

/** `window.open` hands back `p` (or null: a blocked pop-up). */
const stubOpen = (p: Popup | null) => vi.spyOn(window, 'open').mockImplementation(() => (p ? p.win : null));

const panels = {
  counter: { component: Counter, defaultOptions: { canPopOut: true } },
  fixed: { component: Counter, defaultOptions: { canPopOut: true, canFloat: false } },
  plain: { component: Counter },
  tools: { component: Tools, defaultOptions: { canPopOut: true } },
};

async function render(ws: Workspace, url?: string): Promise<ComponentFixture<unknown>> {
  popoutUrl = url;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const f = TestBed.createComponent(Shell) as ComponentFixture<unknown>;
  document.body.appendChild(f.nativeElement as HTMLElement);
  fixture = f;
  await f.whenStable();
  return f;
}

const settle = async () => {
  await fixture?.whenStable();
  await fixture?.whenStable();
};

/** rdd's `mount()`: panels a and b in one group, a shown. */
async function setup(opts: { popOut?: boolean; popoutUrl?: string } = {}): Promise<Workspace> {
  const ws = createWorkspace({ popOut: opts.popOut ?? true, panels }) as unknown as Workspace;
  await render(ws, opts.popoutUrl);
  ws.openPanel('a', 'counter', { title: 'Alpha' });
  ws.openPanel('b', 'counter', { title: 'Beta' });
  ws.focusPanel('a');
  await settle();
  return ws;
}

const counter = (id: string, doc: Document = document) => doc.querySelector<HTMLButtonElement>(`.po-count[data-id="${id}"]`);
const panelEl = (id: string, doc: Document = document) => counter(id, doc)?.closest('.ndd-panel-mount') as HTMLElement | null;
const popOut = async (ws: Workspace, id: string): Promise<PopOutResult> => {
  const r = ws.popOutPanel(id);
  await settle();
  return r;
};
const back = async (ws: Workspace, id: string) => {
  const r = ws.returnPanel(id);
  await settle();
  return r;
};
const act = async (fn: () => unknown) => {
  fn();
  await settle();
};
const leafOf = (ws: Workspace, id: string) => findLeafForPanel(ws.state().gridRoot, id);
const windowFrame = (id: string) => document.querySelector(`[data-ndd-window="${id}"]`);
const activation = (isActive: boolean) => {
  Object.defineProperty(navigator, 'userActivation', { value: { isActive }, configurable: true });
  cleanups.push(() => {
    delete (navigator as unknown as { userActivation?: unknown }).userActivation;
  });
};

/** The open menu's labels, and '---' for a separator. */
const menu = (doc: Document = document) => {
  const m = doc.querySelector('[data-ndd-menu]');
  return m
    ? [...m.children].map(c => (c.tagName === 'HR' ? '---' : (c.querySelector('.ndd-context-menu__label')?.textContent?.trim() ?? '?')))
    : null;
};
const menuItem = (label: string) => document.querySelector<HTMLElement>(`[data-ndd-menu-item="${label}"]`);
const rightClickTab = (id: string) =>
  act(() => {
    document.querySelector(`[data-ndd-tab="${id}"]`)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  });

afterEach(() => {
  fixture?.destroy();
  fixture = null;
  cleanups.splice(0).reverse().forEach(f => f());
  frames.splice(0).forEach(f => f.remove());
  mounts.mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('XPO1: disabled', () => {
  it('shows no menu item', async () => {
    await setup({ popOut: false });
    await rightClickTab('a');
    expect(menu()).not.toContain('Open in new window');
    expect(menu()).toContain('Float Window');
  });
});

describe('XPO3: refusals', () => {
  it('not-open: no such panel', async () => {
    const ws = await setup();
    const open = stubOpen(popup());
    expect(await popOut(ws, 'nope')).toEqual({ ok: false, reason: 'not-open' });
    expect(open).not.toHaveBeenCalled();
  });

  it("not-allowed: a type without canPopOut, and a widget's hosted panel", async () => {
    const ws = await setup();
    const open = stubOpen(popup());
    ws.openPanel('p', 'plain');
    expect(await popOut(ws, 'p')).toEqual({ ok: false, reason: 'not-allowed' });
    ws.openHostedPanel('a/w', { panelId: 'a', widgetId: 'w' }, 'W', { kind: 'float', rect: { x: 0, y: 0, width: 100, height: 100 } });
    expect(await popOut(ws, 'a/w')).toEqual({ ok: false, reason: 'not-allowed' });
    expect(open).not.toHaveBeenCalled();
  });

  it('no-gesture: not inside a user activation; a browser without the API counts as one', async () => {
    const ws = await setup();
    const open = stubOpen(popup());
    activation(false);
    const before = JSON.stringify(ws.state());
    expect(await popOut(ws, 'a')).toEqual({ ok: false, reason: 'no-gesture' });
    expect(open).not.toHaveBeenCalled();
    expect(JSON.stringify(ws.state())).toBe(before);
    activation(true);
    expect(await popOut(ws, 'a')).toEqual({ ok: true });
  });

  it('blocked: window.open returns null', async () => {
    const ws = await setup();
    stubOpen(null);
    const before = JSON.stringify(ws.state());
    expect(await popOut(ws, 'a')).toEqual({ ok: false, reason: 'blocked' });
    expect(JSON.stringify(ws.state())).toBe(before);
  });

  it('no-window: the window is closed already', async () => {
    const ws = await setup();
    const p = popup();
    p.closeByUser(true);
    stubOpen(p);
    const before = JSON.stringify(ws.state());
    expect(await popOut(ws, 'a')).toEqual({ ok: false, reason: 'no-window' });
    expect(JSON.stringify(ws.state())).toBe(before);
  });

  it('checks in order: not-allowed before no-gesture, no-gesture before opening', async () => {
    const ws = await setup();
    const open = stubOpen(null);
    ws.openPanel('p', 'plain');
    activation(false);
    expect(await popOut(ws, 'p')).toEqual({ ok: false, reason: 'not-allowed' });
    expect(await popOut(ws, 'a')).toEqual({ ok: false, reason: 'no-gesture' });
    expect(open).not.toHaveBeenCalled();
  });
});

describe('XPO4: the window', () => {
  it("opens with an empty URL, a name of its own and the panel's place, and no frame stays in the workspace", async () => {
    const ws = await setup();
    const open = stubOpen(popup());
    expect(await popOut(ws, 'a')).toEqual({ ok: true });
    expect(document.querySelector('.ndd-workspace [data-ndd-window="a"]')).toBeNull();
    // An empty URL: the window keeps its initial document (Firefox may replace an about:blank one).
    expect(open).toHaveBeenCalledWith('', expect.stringMatching(/^ndd-popout-a-/), expect.stringMatching(/^popup=yes,left=\d+,top=\d+,width=\d+,height=\d+$/));
  });

  it("its title follows the panel's; lang and dir are copied", async () => {
    document.documentElement.lang = 'nl';
    cleanups.push(() => {
      document.documentElement.removeAttribute('lang');
    });
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 'a');
    expect(p.doc.title).toBe('Alpha');
    expect(p.doc.documentElement.lang).toBe('nl');
    expect(p.doc.documentElement.dir).toBe('ltr');
    await act(() => ws.updatePanelTitle('a', 'Renamed'));
    expect(p.doc.title).toBe('Renamed');
    expect(p.doc.querySelector('.ndd-popout-frame__title')!.textContent).toBe('Renamed');
    await act(() => ws.setDirection('rtl'));
    expect(p.doc.documentElement.dir).toBe('rtl');
  });
});

describe('XPO5: the same element, never re-created', () => {
  it("moves the panel's element into the frame and back, keeping its state", async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    const el = panelEl('a')!;
    await act(() => {
      counter('a')!.click();
      counter('a')!.click();
    });
    mounts.mockClear();
    await popOut(ws, 'a');
    expect(panelEl('a', p.doc)).toBe(el);
    expect(el.ownerDocument).toBe(p.doc);
    expect(el.closest('.ndd-popout-frame')?.getAttribute('data-ndd-popout')).toBe('a');
    expect(el.closest('.ndd-popout-frame')?.getAttribute('data-ndd-popout-kind')).toBe('panel');
    expect(counter('a', p.doc)!.textContent).toBe('2');
    await act(() => counter('a', p.doc)!.click()); // Angular's listeners work in the child
    expect(counter('a', p.doc)!.textContent).toBe('3');
    await back(ws, 'a');
    expect(panelEl('a')).toBe(el);
    expect(el.ownerDocument).toBe(document);
    expect(el.closest('.ndd-workspace')).not.toBeNull();
    expect(counter('a')!.textContent).toBe('3');
    expect(mounts).not.toHaveBeenCalled();
  });
});

describe('XPO6: where it returns, on the page', () => {
  it("a docked panel goes back into its group, its element in the group's slot", async () => {
    const ws = await setup();
    stubOpen(popup());
    const leaf = leafOf(ws, 'a');
    await popOut(ws, 'a');
    expect(await back(ws, 'a')).toEqual({ ok: true });
    expect(leafOf(ws, 'a')).toBe(leaf);
    expect(panelEl('a')!.closest(`[data-ndd-leaf="${leaf}"]`)).not.toBeNull();
  });

  it('a floating panel stays floating, with a frame', async () => {
    const ws = await setup();
    stubOpen(popup());
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    await settle();
    await popOut(ws, 'f');
    expect(windowFrame('f')).toBeNull();
    await back(ws, 'f');
    expect(windowFrame('f')).not.toBeNull();
    expect(windowFrame('f')!.contains(counter('f'))).toBe(true);
  });
});

describe('XPO7: return paths', () => {
  it('the frame\'s "Return to desktop" button', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 'a');
    const button = p.doc.querySelector<HTMLButtonElement>('.ndd-popout-frame__return')!;
    // A title-bar button in the skin: its label is the tooltip and the accessible name.
    expect(button.classList.contains('ndd-custom-tab-btn')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Return to desktop');
    expect(button.title).toBe('Return to desktop');
    expect(button.querySelector('svg')).not.toBeNull();
    await act(() => button.click());
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(p.close).toHaveBeenCalled();
    expect(counter('a')).not.toBeNull();
  });

  it("the child's pagehide: the element is back in the main document inside the handler", async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 'a');
    const el = panelEl('a', p.doc)!;
    let docInHandler: Document | null = null;
    // Runs after the library's own listener, still inside the same event.
    p.win.addEventListener('pagehide', () => {
      docInHandler = el.ownerDocument;
    });
    p.closeByUser();
    expect(docInHandler).toBe(document);
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
  });

  it('the closed poll, when no pagehide comes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 'a');
    vi.advanceTimersByTime(600);
    expect(ws.state().panels['a']!.poppedOut).toBe(true);
    p.closeByUser(true);
    vi.advanceTimersByTime(600);
    await settle();
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    expect(counter('a')).not.toBeNull();
  });

  it("the main page's pagehide closes every child window", async () => {
    const ws = await setup();
    const p1 = popup();
    const p2 = popup();
    const open = vi
      .spyOn(window, 'open')
      .mockImplementationOnce(() => p1.win)
      .mockImplementationOnce(() => p2.win);
    await popOut(ws, 'a');
    await popOut(ws, 'b');
    expect(open).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('pagehide'));
    expect(p1.close).toHaveBeenCalled();
    expect(p2.close).toHaveBeenCalled();
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    expect(ws.state().panels['b']!.poppedOut).toBeUndefined();
    // Back where they were, so whatever the page saves on its way out is that layout.
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(ws.state().panels['b']!.state).toBe('docked');
  });

  it('nothing is left listening or polling after a return', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    const remove = vi.spyOn(p.win, 'removeEventListener');
    const mainRemove = vi.spyOn(window, 'removeEventListener');
    await popOut(ws, 'a');
    await back(ws, 'a');
    // jsdom's animation frames may run on its setInterval: panel:returned's two frames pass first.
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(mainRemove).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });
});

describe('XPO8: the windows follow the store', () => {
  it('closePanel on a popped-out panel closes its window and its frame', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 'a');
    await act(() => ws.closePanel('a'));
    expect(p.close).toHaveBeenCalled();
    expect(ws.isOpen('a')).toBe(false);
    expect(p.doc.querySelector('.ndd-popout-frame')).toBeNull();
  });

  it('loadLayout closes every window, the element back on the page', async () => {
    const ws = await setup();
    const saved = ws.saveLayout();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 'a');
    await act(() => ws.loadLayout(saved));
    expect(p.close).toHaveBeenCalled();
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    expect(counter('a')).not.toBeNull();
    expect(p.doc.querySelector('.ndd-popout-frame')).toBeNull();
  });

  it('dockPanel from code closes the window, the element back on the page', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 'a');
    await act(() => ws.dockPanel('a'));
    expect(p.close).toHaveBeenCalled();
    expect(ws.state().panels['a']).toMatchObject({ state: 'docked' });
    expect(counter('a')).not.toBeNull();
  });
});

describe('XPO10: idempotent', () => {
  it('a second call opens no second window and brings the first forward', async () => {
    const ws = await setup();
    const p = popup();
    const open = stubOpen(p);
    expect(await popOut(ws, 'a')).toEqual({ ok: true });
    expect(await popOut(ws, 'a')).toEqual({ ok: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(p.focus).toHaveBeenCalledTimes(1);
    expect(p.doc.querySelectorAll('.ndd-popout-frame')).toHaveLength(1);
  });
});

describe('XPO11: the child document is registered while open', () => {
  it('a document-wide listener reaches it, and stops after the return', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    const seen = vi.fn();
    cleanups.push(listenOnDocuments('keydown', e => seen(e.target)));
    await popOut(ws, 'a');
    p.doc.body.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(seen).toHaveBeenCalledTimes(1);
    await back(ws, 'a');
    p.doc.body.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

/** A child window under the test's control, whose document can turn unreadable (another origin). */
function fakeWindow(doc: Document) {
  const target = new EventTarget() as EventTarget & Record<string, unknown>;
  let current: Document | 'cross-origin' = doc;
  let closed = false;
  Object.assign(target, {
    focus: vi.fn(),
    close: vi.fn(() => {
      closed = true;
    }),
  });
  Object.defineProperty(target, 'closed', { get: () => closed });
  Object.defineProperty(target, 'document', {
    configurable: true,
    get: () => {
      if (current === 'cross-origin') throw new DOMException('Blocked', 'SecurityError');
      return current;
    },
  });
  return {
    win: target as unknown as Window,
    goCrossOrigin() {
      current = 'cross-origin';
    },
    close: target['close'] as ReturnType<typeof vi.fn>,
  };
}

describe('XPO12: popoutUrl', () => {
  it("opens the app's page, resolved against the main page, and moves the element in on its load, not before", async () => {
    const ws = await setup({ popoutUrl: '/popout.html' });
    const p = popup();
    const open = stubOpen(p);
    // The child shows its initial blank document, already complete, until the page replaces it.
    let url = 'about:blank';
    let readyState: DocumentReadyState = 'complete';
    Object.defineProperty(p.doc, 'URL', { get: () => url, configurable: true });
    Object.defineProperty(p.doc, 'readyState', { get: () => readyState, configurable: true });
    const el = panelEl('a')!;
    expect(await popOut(ws, 'a')).toEqual({ ok: true });
    // Resolved against the main page (rdd 7.12.1): the same page whichever window opens it.
    expect(open).toHaveBeenCalledWith(new URL('/popout.html', document.baseURI).href, expect.stringMatching(/^ndd-popout-a-/), expect.any(String));
    expect(ws.state().panels['a']!.poppedOut).toBe(true);
    expect(p.doc.querySelector('.ndd-popout-frame')).toBeNull(); // still the initial blank document
    await act(() => p.win.dispatchEvent(new p.win.Event('load'))); // a load of the blank one: not yet
    expect(p.doc.querySelector('.ndd-popout-frame')).toBeNull();
    url = 'http://localhost/popout.html';
    readyState = 'loading';
    await act(() => p.win.dispatchEvent(new p.win.Event('load'))); // the app's page, not loaded yet
    expect(p.doc.querySelector('.ndd-popout-frame')).toBeNull();
    readyState = 'complete';
    await act(() => p.win.dispatchEvent(new p.win.Event('load')));
    expect(panelEl('a', p.doc)).toBe(el);
  });

  it('a page that never loads: after the time limit the panel comes back and the window closes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = await setup({ popoutUrl: '/popout.html' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const p = popup();
    stubOpen(p);
    Object.defineProperty(p.doc, 'URL', { get: () => 'about:blank', configurable: true });
    expect(ws.popOutPanel('a')).toEqual({ ok: true });
    vi.advanceTimersByTime(9_000);
    expect(ws.state().panels['a']!.poppedOut).toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(p.close).toHaveBeenCalled();
    expect(warn.mock.calls.some(c => String(c[0]).includes('did not load'))).toBe(true);
    // Its panel:returned waits for the layout: at most this long, then nothing of it is left.
    vi.advanceTimersByTime(POPOUT_PLACED_TIMEOUT_MS);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    await settle();
    expect(counter('a')).not.toBeNull();
  });

  it('a page of another origin: on its load the panel comes back and the window closes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = await setup({ popoutUrl: 'https://elsewhere.example/popout.html' });
    const f = fakeWindow(document.implementation.createHTMLDocument(''));
    vi.spyOn(window, 'open').mockImplementation(() => f.win);
    expect(await popOut(ws, 'a')).toEqual({ ok: true });
    expect(ws.state().panels['a']!.poppedOut).toBe(true);
    f.goCrossOrigin();
    await act(() => f.win.dispatchEvent(new Event('load')));
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(f.close).toHaveBeenCalled();
  });

  it('a window that can\'t be read at once is "no-window"', async () => {
    const ws = await setup({ popoutUrl: '/popout.html' });
    const f = fakeWindow(document.implementation.createHTMLDocument(''));
    f.goCrossOrigin();
    vi.spyOn(window, 'open').mockImplementation(() => f.win);
    expect(await popOut(ws, 'a')).toEqual({ ok: false, reason: 'no-window' });
    expect(f.close).toHaveBeenCalled();
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
  });

  it('...also when it turns unreadable while being set up, leaving no flag behind', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = await setup();
    const f = fakeWindow(document.implementation.createHTMLDocument(''));
    let reads = 0;
    const doc = Object.getOwnPropertyDescriptor(f.win, 'document')!.get!;
    Object.defineProperty(f.win, 'document', {
      get: () => {
        if (++reads > 1) f.goCrossOrigin();
        return doc();
      },
    });
    vi.spyOn(window, 'open').mockImplementation(() => f.win);
    expect(await popOut(ws, 'a')).toEqual({ ok: false, reason: 'no-window' });
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    expect(ws.state().panels['a']!.state).toBe('docked');
  });
});

describe('XPO13: the menu item', () => {
  it('is in the tab menu of a canPopOut type, and pops the panel out', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await rightClickTab('a');
    expect(menu()).toEqual(['Float Window', 'Open in new window', 'Minimize Panel', '---', 'Close Tab']);
    await act(() => menuItem('Open in new window')!.click());
    expect(ws.state().panels['a']!.poppedOut).toBe(true);
    expect(panelEl('a', p.doc)).not.toBeNull();
  });

  it('is not there for a type without canPopOut', async () => {
    const ws = await setup();
    ws.openPanel('p', 'plain');
    await settle();
    await rightClickTab('p');
    expect(menu()).toEqual(['Float Window', 'Minimize Panel', '---', 'Close Tab']);
  });

  it("is in a floating window's ⋮ menu, which it brings", async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    ws.openPanel('f', 'counter', { initialTarget: 'floating' });
    ws.openPanel('g', 'plain', { initialTarget: 'floating' });
    await settle();
    expect(document.querySelector('[data-ndd-window="g"] .ndd-btn-more-actions')).toBeNull();
    const more = document.querySelector<HTMLElement>('[data-ndd-window="f"] .ndd-btn-more-actions')!;
    expect(more).not.toBeNull();
    await act(() => more.click());
    expect(menu()).toEqual(['Open in new window']);
    await act(() => menuItem('Open in new window')!.click());
    expect(ws.state().panels['f']!.poppedOut).toBe(true);
    expect(windowFrame('f')).toBeNull();
  });
});

describe('XPO14: a blocked pop-up', () => {
  it('shows a toast from the menu', async () => {
    const ws = await setup();
    stubOpen(null);
    const warning = vi.spyOn(toast, 'warning').mockImplementation(() => 't');
    await rightClickTab('a');
    await act(() => menuItem('Open in new window')!.click());
    expect(warning).toHaveBeenCalledTimes(1);
    expect(String(warning.mock.calls[0]![0])).toContain('blocked');
    expect(ws.state().panels['a']!.state).toBe('docked');
  });

  it('shows nothing from code', async () => {
    const ws = await setup();
    stubOpen(null);
    const warning = vi.spyOn(toast, 'warning').mockImplementation(() => 't');
    expect(await popOut(ws, 'a')).toEqual({ ok: false, reason: 'blocked' });
    expect(warning).not.toHaveBeenCalled();
  });
});

describe('XPO15: destroying the desktop', () => {
  it('brings every panel back and closes its window; nothing is left running', async () => {
    const ws = await setup();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const p = popup();
    stubOpen(p);
    const seen = vi.fn();
    cleanups.push(listenOnDocuments('keydown', () => seen()));
    await popOut(ws, 'a');
    fixture!.destroy();
    fixture = null;
    expect(p.close).toHaveBeenCalled();
    expect(ws.state().panels['a']!.poppedOut).toBeUndefined();
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(p.doc.querySelector('.ndd-popout-frame')).toBeNull();
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(0);
    p.doc.body.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('XPO18: window names', () => {
  it('each window opened has a name of its own, also for the same panel id in another workspace', async () => {
    const ws = await setup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => popup().win);
    await popOut(ws, 'a');
    await back(ws, 'a');
    await popOut(ws, 'a');
    fixture!.destroy();
    TestBed.resetTestingModule();
    const other = createWorkspace({ popOut: true, panels: { counter: { component: Counter, defaultOptions: { canPopOut: true } } } }) as unknown as Workspace;
    await render(other);
    other.openPanel('a', 'counter');
    await settle();
    await popOut(other, 'a');
    const names = open.mock.calls.map(c => c[1]);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    names.forEach(n => expect(n).toMatch(/^ndd-popout-a-/));
  });
});

describe('XPO19: the frame without the stylesheet', () => {
  it("fills the window, and the panel's elements fill its body while out", async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 'a');
    expect(p.doc.body.style.margin).toBe('0px');
    expect(p.doc.body.style.height).toBe('100%');
    expect(p.doc.documentElement.style.height).toBe('100%');
    const frame = p.doc.querySelector<HTMLElement>('.ndd-popout-frame')!;
    expect(frame.style).toMatchObject({ position: 'fixed', display: 'flex', flexDirection: 'column' });
    const body = p.doc.querySelector<HTMLElement>('.ndd-popout-frame__body')!;
    expect(body.style.minHeight).toBe('0px');
    const el = panelEl('a', p.doc)!;
    const chain = [el.parentElement!, el, el.querySelector<HTMLElement>('.ndd-panel-content')!];
    expect(chain[0]!.classList.contains('ndd-panel-slot')).toBe(true);
    chain.forEach(e => expect(e.style.height).toBe('100%'));
    await back(ws, 'a');
    chain.forEach(e => expect(e.style.height).toBe(''));
  });
});

describe('XPO23: a page failing at once', () => {
  it('leaves no timer behind that could close a later window', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const f = fakeWindow(document.implementation.createHTMLDocument(''));
    let reads = 0;
    const doc = Object.getOwnPropertyDescriptor(f.win, 'document')!.get!;
    Object.defineProperty(f.win, 'document', {
      get: () => {
        if (++reads > 1) f.goCrossOrigin();
        return doc();
      },
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => f.win);
    expect(ws.popOutPanel('a')).toEqual({ ok: false, reason: 'no-window' });
    // Angular's zoneless scheduler queues its render on a 0 ms timer: let that one run first.
    vi.advanceTimersByTime(1);
    expect(vi.getTimerCount()).toBe(0);
    // A new window for the same panel is not closed by anything left over.
    const p = popup();
    open.mockImplementation(() => p.win);
    expect(ws.popOutPanel('a')).toEqual({ ok: true });
    vi.advanceTimersByTime(2000);
    expect(ws.state().panels['a']!.poppedOut).toBe(true);
  });
});

describe('XPO24: return and pop out again in one tick', () => {
  it('the new window gets the element, laid out', async () => {
    const ws = await setup();
    const p1 = popup();
    const p2 = popup();
    vi.spyOn(window, 'open')
      .mockImplementationOnce(() => p1.win)
      .mockImplementationOnce(() => p2.win);
    await popOut(ws, 'a');
    ws.returnPanel('a');
    ws.popOutPanel('a');
    await settle();
    const el = panelEl('a', p2.doc)!;
    expect(el).not.toBeNull();
    expect(el.style.height).toBe('100%');
    expect(el.parentElement!.style.height).toBe('100%');
    expect(p1.doc.querySelector('.ndd-popout-frame')).toBeNull();
  });
});

describe('XPO25: no desktop', () => {
  it('before any desktop is rendered, and after it is destroyed: no-window, and nothing opens', async () => {
    const open = stubOpen(popup());
    const ws = createWorkspace({ popOut: true, panels }) as unknown as Workspace;
    ws.openPanel('a', 'counter');
    expect(ws.popOutPanel('a')).toEqual({ ok: false, reason: 'no-window' });
    const rendered = await setup();
    fixture!.destroy();
    fixture = null;
    expect(rendered.popOutPanel('a')).toEqual({ ok: false, reason: 'no-window' });
    expect(open).not.toHaveBeenCalled();
  });
});

describe('XPO26: screen position', () => {
  it('a second monitor left of and above the primary: negative coordinates are kept', async () => {
    Object.defineProperty(window, 'screenX', { value: -1920, configurable: true });
    Object.defineProperty(window, 'screenY', { value: -1080, configurable: true });
    cleanups.push(() => {
      delete (window as unknown as { screenX?: number }).screenX;
      delete (window as unknown as { screenY?: number }).screenY;
    });
    const ws = await setup();
    const open = stubOpen(popup());
    await popOut(ws, 'a');
    const features = String(open.mock.calls[0]![2]);
    expect(features).toMatch(/left=-\d+/);
    expect(features).toMatch(/top=-\d+/);
  });
});

describe('XPO32: popoutUrl without a load event', () => {
  it('the poll finds the page ready and moves the panel in', async () => {
    const ws = await setup({ popoutUrl: '/popout.html' });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const p = popup();
    stubOpen(p);
    let url = 'about:blank';
    Object.defineProperty(p.doc, 'URL', { get: () => url, configurable: true });
    Object.defineProperty(p.doc, 'readyState', { get: () => 'complete', configurable: true });
    const el = panelEl('a')!;
    expect(ws.popOutPanel('a')).toEqual({ ok: true });
    vi.advanceTimersByTime(600);
    await settle();
    expect(p.doc.querySelector('.ndd-popout-frame')).toBeNull();
    url = 'http://localhost/popout.html'; // loaded, and no load event reached us
    vi.advanceTimersByTime(600);
    await settle();
    expect(panelEl('a', p.doc)).toBe(el);
    vi.advanceTimersByTime(15_000); // the poll goes on; the time limit no longer applies
    expect(ws.state().panels['a']!.poppedOut).toBe(true);
  });
});

// ─── vdd additions ───────────────────────────────────────────────────────────

const until = (cond: () => boolean) =>
  vi.waitFor(
    () => {
      if (!cond()) throw new Error('not yet');
    },
    { timeout: 2000, interval: 10 },
  );

/**
 * jsdom runs the page's animation frames on an interval it creates on the first frame asked for;
 * created during an earlier test's fake timers, it never runs again. The event tests wait on those
 * frames, so they get frames of their own for their duration (real timers, a frame's length).
 */
const ownFrames = () =>
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    cb => setTimeout(() => (typeof cb === 'function' ? cb(performance.now()) : undefined), 16) as unknown as number,
  );

describe('XPOE1: the events', () => {
  beforeEach(ownFrames);
  it('popping-out in the page, popped-out once laid out in the window; returning there, returned back in the page', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    const el = panelEl('a')!;
    const seen: { type: string; doc: Document }[] = [];
    for (const type of ['panel:popping-out', 'panel:popped-out', 'panel:returning', 'panel:returned'] as const) {
      ws.subscribe(type, () => {
        seen.push({ type, doc: el.ownerDocument });
      });
    }
    ws.popOutPanel('a');
    // In the click, before Angular renders: the element is still in the page.
    expect(seen).toEqual([{ type: 'panel:popping-out', doc: document }]);
    await until(() => seen.length === 2);
    expect(seen[1]).toEqual({ type: 'panel:popped-out', doc: p.doc });
    ws.returnPanel('a');
    expect(seen[2]).toEqual({ type: 'panel:returning', doc: p.doc });
    await until(() => seen.length === 4);
    expect(seen[3]).toEqual({ type: 'panel:returned', doc: document });
  });

  it('a window that fails after popping-out sends returned, and no returning', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = await setup({ popoutUrl: 'https://elsewhere.example/popout.html' });
    const f = fakeWindow(document.implementation.createHTMLDocument(''));
    vi.spyOn(window, 'open').mockImplementation(() => f.win);
    const seen: string[] = [];
    for (const type of ['panel:popping-out', 'panel:popped-out', 'panel:returning', 'panel:returned'] as const)
      ws.subscribe(type, () => {
        seen.push(type);
      });
    expect(await popOut(ws, 'a')).toEqual({ ok: true });
    f.goCrossOrigin();
    await act(() => f.win.dispatchEvent(new Event('load')));
    await until(() => seen.length === 2);
    expect(seen).toEqual(['panel:popping-out', 'panel:returned']);
  });
});

describe('XPOE2: the events wait for the layout', () => {
  beforeEach(ownFrames);
  const afterFrames = (n: number) => new Promise(r => setTimeout(r, n * 20));

  it('popped-out waits while the frame is hidden; returned waits while the shown element is parked', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    const seen: string[] = [];
    for (const type of ['panel:popped-out', 'panel:returned'] as const)
      ws.subscribe(type, () => {
        seen.push(type);
      });
    ws.popOutPanel('a');
    await settle();
    // As P3's styles will: the frame is hidden until they are ready.
    const frame = p.doc.querySelector<HTMLElement>('.ndd-popout-frame')!;
    frame.style.visibility = 'hidden';
    await afterFrames(6);
    expect(seen).toEqual([]);
    frame.style.visibility = '';
    await vi.waitFor(() => expect(seen).toEqual(['panel:popped-out']), { timeout: 2000, interval: 10 });

    // Back on the page, shown, but held in the cache's hidden store: not yet in its place.
    ws.returnPanel('a');
    await settle();
    const el = panelEl('a')!;
    const slot = el.parentElement!;
    document.querySelector('.ndd-panel-store')!.appendChild(el);
    await afterFrames(6);
    expect(seen).toEqual(['panel:popped-out']);
    slot.appendChild(el);
    await vi.waitFor(() => expect(seen).toEqual(['panel:popped-out', 'panel:returned']), { timeout: 2000, interval: 10 });
  });
});

describe('XPOM1: a context menu in a closing window', () => {
  it('closes with its window, whichever way it goes', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 'a');
    // An event whose target is in the pop-out: the menu renders in that window.
    const target = counter('a', p.doc)!;
    const ev = new p.win.MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 });
    target.addEventListener('contextmenu', e => ws.showContextMenu({ event: e as MouseEvent, items: [{ label: 'There', action: () => {} }] }), { once: true });
    await act(() => target.dispatchEvent(ev));
    expect(menu(p.doc)).toEqual(['There']);
    p.closeByUser();
    await settle();
    expect(ws.contextMenu()).toBeNull();
    expect(menu(p.doc)).toBeNull();
    // A menu in the page stays through a pop-out's return.
    stubOpen(popup());
    await popOut(ws, 'b');
    await act(() =>
      ws.showContextMenu({ event: new MouseEvent('contextmenu', { clientX: 5, clientY: 5 }), items: [{ label: 'There', action: () => {} }] }),
    );
    expect(menu()).toEqual(['There']);
    await back(ws, 'b');
    expect(menu()).toEqual(['There']);
  });
});

describe("XPOR1: the size observer follows the element's window", () => {
  it("is rebuilt from the pop-out's ResizeObserver when the element moves in, and from the page's when it comes back", async () => {
    const made: { realm: string; observed: Element[]; disconnected: boolean }[] = [];
    const fake = (realm: string) =>
      class {
        record = { realm, observed: [] as Element[], disconnected: false };
        constructor() {
          made.push(this.record);
        }
        observe(el: Element) {
          this.record.observed.push(el);
        }
        unobserve() {}
        disconnect() {
          this.record.disconnected = true;
        }
      };
    vi.stubGlobal('ResizeObserver', fake('main'));
    cleanups.push(() => vi.unstubAllGlobals());
    const ws = await setup();
    const p = popup();
    Object.defineProperty(p.win, 'ResizeObserver', { value: fake('popup'), configurable: true });
    stubOpen(p);
    const el = panelEl('a')!;
    const ofA = () => made.filter(m => m.observed.includes(el));
    expect(ofA().map(m => m.realm)).toEqual(['main']);
    await popOut(ws, 'a');
    expect(ofA().map(m => m.realm)).toEqual(['main', 'popup']);
    expect(ofA()[0]!.disconnected).toBe(true);
    await back(ws, 'a');
    expect(ofA().map(m => m.realm)).toEqual(['main', 'popup', 'main']);
    expect(ofA()[1]!.disconnected).toBe(true);
    expect(ofA()[2]!.disconnected).toBe(false);
  });
});

// ─── ndd additions ───────────────────────────────────────────────────────────

describe('XPON1: chrome open in a closing window', () => {
  it('a toolbar flyout and a search dropdown open in a pop-out close when the window goes', async () => {
    const ws = createWorkspace({ popOut: true, panels }) as unknown as Workspace;
    await render(ws);
    ws.openPanel('t', 'tools');
    await settle();
    const p = popup();
    stubOpen(p);
    await popOut(ws, 't');
    // The flyout, from its button in the pop-out.
    await act(() => p.doc.querySelector<HTMLElement>('[data-ndd-toolbar-item="g"]')!.click());
    expect(p.doc.querySelector('.ndd-toolbar-group-flyout')).not.toBeNull();
    // The search dropdown, from its field there.
    await act(() => p.doc.querySelector<HTMLElement>('[data-ndd-search-toggle]')!.click());
    const field = p.doc.querySelector<HTMLInputElement>('[data-ndd-search-input]')!;
    field.value = 'o';
    await act(() => field.dispatchEvent(new Event('input', { bubbles: true })));
    await until(() => !!p.doc.querySelector('[data-ndd-search-results]'));
    p.closeByUser();
    await settle();
    expect(p.doc.querySelector('.ndd-toolbar-group-flyout')).toBeNull();
    expect(p.doc.querySelector('[data-ndd-search-results]')).toBeNull();
  });
});

describe('XPON2-XPON5: the registry on its own', () => {
  const bare = () => {
    const ws = createWorkspace({ popOut: true, panels }) as unknown as Workspace;
    ws.openPanel('a', 'counter');
    const windows = createPopOutWindows(ws as unknown as Workspace<never>);
    cleanups.push(windows.bind());
    return { ws, windows };
  };
  const host = { park() {}, rectOf: () => null, element: () => null, isParked: () => false };

  it('XPON2: bound to the workspace, with no panel host lent: no-window, and nothing opens', () => {
    const { ws } = bare();
    const open = stubOpen(popup());
    expect(ws.popOutPanel('a')).toEqual({ ok: false, reason: 'no-window' });
    expect(open).not.toHaveBeenCalled();
  });

  it("XPON3: a widget's hosted panel pops out through the router its overlay registered", () => {
    const { ws, windows } = bare();
    cleanups.push(windows.bindHost(host));
    ws.openHostedPanel('a/w', { panelId: 'a', widgetId: 'w' }, 'W', { kind: 'float', rect: { x: 0, y: 0, width: 100, height: 100 } });
    const routed = vi.fn((): PopOutResult => ({ ok: true }));
    cleanups.push(windows.registerHosted('a/w', { popOut: routed, returning() {}, returned() {} }));
    expect(ws.popOutPanel('a/w')).toEqual({ ok: true });
    expect(routed).toHaveBeenCalledTimes(1);
  });

  it('XPON4: one entry while the window is open, none after the return', () => {
    const { ws, windows } = bare();
    cleanups.push(windows.bindHost(host));
    const p = popup();
    stubOpen(p);
    expect(ws.popOutPanel('a')).toEqual({ ok: true });
    expect(windows.getSnapshot().map(e => [e.id, e.doc === p.doc])).toEqual([['a', true]]);
    expect(windows.entries()).toBe(windows.getSnapshot());
    ws.returnPanel('a');
    expect(windows.getSnapshot()).toEqual([]);
  });

  it("XPON5: a hosted pop-out for a panel the store doesn't have: not-open, and its window closes", () => {
    const { windows } = bare();
    cleanups.push(windows.bindHost(host));
    const p = popup();
    stubOpen(p);
    expect(windows.popOut('gone', { prepare: () => true })).toEqual({ ok: false, reason: 'not-open' });
    expect(p.close).toHaveBeenCalled();
    expect(windows.getSnapshot()).toEqual([]);
  });
});

describe('XPON5b: a widget that declines', () => {
  it("a hosted pop-out whose prepare() refuses: not-allowed, its window closes, nothing changes", () => {
    const ws = createWorkspace({ popOut: true, panels }) as unknown as Workspace;
    ws.openPanel('a', 'counter');
    const windows = createPopOutWindows(ws as unknown as Workspace<never>);
    cleanups.push(windows.bind());
    cleanups.push(windows.bindHost({ park() {}, rectOf: () => null, element: () => null, isParked: () => false }));
    const p = popup();
    stubOpen(p);
    const before = JSON.stringify(ws.state());
    expect(windows.popOut('a', { prepare: () => false })).toEqual({ ok: false, reason: 'not-allowed' });
    expect(p.close).toHaveBeenCalled();
    expect(windows.getSnapshot()).toEqual([]);
    expect(JSON.stringify(ws.state())).toBe(before);
  });
});

describe('XPON6: the window opens over the panel', () => {
  it("its place and size are the panel's box on the page, in screen coordinates", async () => {
    const ws = await setup();
    const open = stubOpen(popup());
    const el = panelEl('a')!;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 30, top: 40, width: 500, height: 400, right: 530, bottom: 440, x: 30, y: 40, toJSON() {} } as DOMRect);
    for (const [k, v] of [['screenX', 1000], ['screenY', 200], ['outerHeight', 850], ['innerHeight', 800]] as const) {
      Object.defineProperty(window, k, { value: v, configurable: true });
      cleanups.push(() => {
        delete (window as unknown as Record<string, unknown>)[k];
      });
    }
    await popOut(ws, 'a');
    expect(String(open.mock.calls[0]![2])).toBe('popup=yes,left=1030,top=290,width=500,height=400');
  });
});

describe('XPON7: a stale event', () => {
  it('popped-out still waiting (its window gone, its frames with it) is dropped when the panel comes back', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    const seen: string[] = [];
    ws.subscribe('panel:popped-out', () => {
      seen.push('panel:popped-out');
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ws.popOutPanel('a');
    vi.advanceTimersByTime(20);
    await settle();
    // Hidden, as P3's styles will keep it: popped-out waits on the window's frames, then its limit.
    p.doc.querySelector<HTMLElement>('.ndd-popout-frame')!.style.visibility = 'hidden';
    // The window goes without its frames running again: only the limit is left to send it.
    frames.splice(frames.indexOf(p.win.frameElement as HTMLIFrameElement), 1)[0]!.remove();
    ws.returnPanel('a');
    vi.advanceTimersByTime(POPOUT_PLACED_TIMEOUT_MS + 50);
    expect(seen).toEqual([]);
  });
});
