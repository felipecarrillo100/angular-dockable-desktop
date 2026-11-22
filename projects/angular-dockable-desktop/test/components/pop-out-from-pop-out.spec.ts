/**
 * A pop-out from a click inside a pop-out window (1.12.0, rdd 7.12.1 `PopOutFromPopOut.test.tsx`,
 * PF1–PF7 as XFP1–XFP7, by way of vdd 1.14.0's `popOutFromPopOut.test.ts`). A click there activates
 * that window, not the main page, and a browser blocks a window opened from a window the user
 * didn't click: so the window in a click opens the new one. The pop-outs are iframes' windows,
 * handed back by stubbed `open`s; each window's `navigator.userActivation` is stubbed on its own.
 *
 * XFP1: active only in a pop-out: opened through that pop-out's open, { ok: true }
 * XFP2: active only in the main page: opened through the main window's open, as before
 * XFP3: active nowhere: 'no-gesture', nothing opened
 * XFP4: no API in the main page: the main window, as before
 * XFP5: a pop-out whose navigator can't be read is skipped
 * XFP6: a rect measured in a pop-out (a widget whose owner is out): left/top from that window's
 *       screen origin, through the registry's hosted path. XFP6b (P5): through a managed widget's
 *       own `popOut()`, from a click in its owner's window: that window opens it, over the widget's
 *       frame there, and the widget lands in it.
 * XFP7: a relative popoutUrl opened from a pop-out is resolved against the main page
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { createPopOutWindows } from '../../src/lib/core/pop-out-windows';
import { NddPanelOverlay, injectFloatingWidgets } from '../../src/lib/panel-overlay/panel-overlay';
import type { FloatingWidgetsApi } from '../../src/lib/panel-overlay/panel-overlay';

type AnyWindow = Window & typeof globalThis;
const frames: HTMLIFrameElement[] = [];
const cleanups: (() => void)[] = [];
let fixture: ComponentFixture<unknown> | null = null;

interface Popup {
  win: AnyWindow;
  doc: Document;
}
/** A child window: an iframe's, with `closed`, `close()` and `focus()` under the test's control. */
function popup(): Popup {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const win = frame.contentWindow as AnyWindow;
  let closed = false;
  Object.defineProperty(win, 'closed', { get: () => closed, configurable: true });
  Object.defineProperty(win, 'close', {
    value: () => {
      closed = true;
    },
    configurable: true,
  });
  Object.defineProperty(win, 'focus', { value: () => {}, configurable: true });
  return { win, doc: frame.contentDocument! };
}

/** The window's `navigator.userActivation.isActive`; undefined removes the API. */
function activate(win: Window, isActive: boolean | undefined): void {
  const nav = win.navigator as unknown as { userActivation?: unknown };
  if (isActive === undefined) delete nav.userActivation;
  else Object.defineProperty(nav, 'userActivation', { value: { isActive }, configurable: true });
  cleanups.push(() => {
    delete nav.userActivation;
  });
}
/** `win.open` hands back `next`. */
const stubOpen = (win: Window, next: Popup) => vi.spyOn(win, 'open').mockImplementation(() => next.win);

@Component({ selector: 'ndd-test-pf-plain', template: `<div class="pf-plain">plain</div>` })
class Plain {}

let popoutUrl: string | undefined;
@Component({ selector: 'ndd-test-pf-shell', imports: [NddDesktop], template: `<ndd-desktop [popoutUrl]="url" />` })
class Shell {
  protected readonly url = popoutUrl;
}

const settle = async () => {
  await fixture!.whenStable();
  await fixture!.whenStable();
};

const panels = { plain: { component: Plain, defaultOptions: { canPopOut: true } } };

async function setup(opts: { popoutUrl?: string } = {}): Promise<Workspace> {
  const ws = createWorkspace({ popOut: true, panels }) as unknown as Workspace;
  popoutUrl = opts.popoutUrl;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  fixture = TestBed.createComponent(Shell) as ComponentFixture<unknown>;
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  ws.openPanel('a', 'plain', { title: 'Alpha' });
  ws.openPanel('b', 'plain', { title: 'Beta', initialTarget: 'floating' });
  await settle();
  return ws;
}

/** Pops `a` out from a click in the main page, into a first window; returns it. */
async function firstOut(ws: Workspace): Promise<Popup> {
  const p1 = popup();
  const mainOpen = stubOpen(window, p1);
  activate(window, true);
  expect(ws.popOutPanel('a')).toEqual({ ok: true });
  await settle();
  mainOpen.mockClear();
  return p1;
}

afterEach(() => {
  fixture?.destroy();
  fixture = null;
  cleanups.splice(0).reverse().forEach(f => f());
  frames.splice(0).forEach(f => f.remove());
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('XFP1-XFP5: which window opens it', () => {
  it('XFP1: active only in a pop-out: that pop-out opens the new window', async () => {
    const ws = await setup();
    const p1 = await firstOut(ws);
    expect(p1.win.navigator).not.toBe(navigator); // each window has its own activation
    const p2 = popup();
    const mainOpen = vi.mocked(window.open);
    const fromPopup = stubOpen(p1.win, p2);
    activate(window, false);
    activate(p1.win, true);
    expect(ws.popOutPanel('b')).toEqual({ ok: true });
    expect(fromPopup).toHaveBeenCalledTimes(1);
    expect(fromPopup).toHaveBeenCalledWith('', expect.stringMatching(/^ndd-popout-b-/), expect.stringMatching(/^popup=yes,/));
    expect(mainOpen).not.toHaveBeenCalled();
  });

  it('XFP2: active only in the main page: the main window opens it', async () => {
    const ws = await setup();
    const p1 = await firstOut(ws);
    const mainOpen = vi.mocked(window.open).mockImplementation(() => popup().win);
    const fromPopup = vi.spyOn(p1.win, 'open');
    activate(p1.win, false);
    expect(ws.popOutPanel('b')).toEqual({ ok: true });
    expect(mainOpen).toHaveBeenCalledTimes(1);
    expect(fromPopup).not.toHaveBeenCalled();
  });

  it("XFP3: active nowhere: 'no-gesture', and nothing is opened", async () => {
    const ws = await setup();
    const p1 = await firstOut(ws);
    const mainOpen = vi.mocked(window.open);
    const fromPopup = vi.spyOn(p1.win, 'open');
    activate(window, false);
    activate(p1.win, false);
    expect(ws.popOutPanel('b')).toEqual({ ok: false, reason: 'no-gesture' });
    expect(mainOpen).not.toHaveBeenCalled();
    expect(fromPopup).not.toHaveBeenCalled();
  });

  it('XFP4: no API in the main page: the main window, as before', async () => {
    const ws = await setup();
    const p1 = await firstOut(ws);
    const mainOpen = vi.mocked(window.open).mockImplementation(() => popup().win);
    const fromPopup = vi.spyOn(p1.win, 'open');
    activate(window, undefined);
    activate(p1.win, true);
    expect(ws.popOutPanel('b')).toEqual({ ok: true });
    expect(mainOpen).toHaveBeenCalledTimes(1);
    expect(fromPopup).not.toHaveBeenCalled();
  });

  it("XFP5: a pop-out whose navigator can't be read is skipped", async () => {
    const ws = await setup();
    const p1 = await firstOut(ws);
    Object.defineProperty(p1.win, 'navigator', {
      get: () => {
        throw new Error('gone');
      },
      configurable: true,
    });
    activate(window, false);
    expect(ws.popOutPanel('b')).toEqual({ ok: false, reason: 'no-gesture' });
  });
});

describe('XFP6: a rect measured in a pop-out', () => {
  it("left/top use that window's screen origin, not the main page's", () => {
    const ws = createWorkspace({ popOut: true, panels }) as unknown as Workspace;
    ws.openPanel('b', 'plain');
    const windows = createPopOutWindows(ws as unknown as Workspace<never>);
    cleanups.push(windows.bindHost({ park() {}, rectOf: () => null, element: () => null, isParked: () => false }));
    const p1 = popup();
    // Screens: the main page at 3000,2000; the owner's window at 100,200 with 30px of chrome.
    const place = (w: Window, x: number, y: number, chrome: number) => {
      for (const [k, v] of [['screenX', x], ['screenY', y], ['outerHeight', 800 + chrome], ['innerHeight', 800]] as const) {
        Object.defineProperty(w, k, { value: v, configurable: true });
        cleanups.push(() => {
          delete (w as unknown as Record<string, unknown>)[k];
        });
      }
    };
    // The owner's window is one of the registry's open pop-outs: popped out from the page first.
    stubOpen(window, p1);
    activate(window, true);
    expect(windows.popOut('b')).toEqual({ ok: true });
    place(window, 3000, 2000, 80);
    place(p1.win, 100, 200, 30);
    // A click in the owner's window: the hosted path (a widget's popOut) with a rect measured there.
    activate(window, false);
    activate(p1.win, true);
    const fromOwner = stubOpen(p1.win, popup());
    windows.popOut('w', { prepare: () => true, rect: { left: 50, top: 60, width: 400, height: 300 }, view: p1.win });
    expect(fromOwner).toHaveBeenCalledTimes(1);
    expect(String(fromOwner.mock.calls[0]![2])).toBe('popup=yes,left=150,top=290,width=400,height=300');
  });
});

let widgetsApi: FloatingWidgetsApi | null = null;
@Component({ selector: 'ndd-test-pf-grab', template: '' })
class Grab {
  constructor() {
    widgetsApi = injectFloatingWidgets();
  }
}
@Component({
  selector: 'ndd-test-pf-owner',
  imports: [NddPanelOverlay, Grab],
  template: `<ndd-panel-overlay><ndd-test-pf-grab /></ndd-panel-overlay>`,
})
class Owner {}
@Component({ selector: 'ndd-test-pf-table', template: `<div class="pf-table">table</div>` })
class PfTable {}

describe("XFP6b: a widget popped out from its owner's window", () => {
  it("its owner's window opens it, at that window's screen origin, and the widget lands in it", async () => {
    const ws = createWorkspace({ popOut: true, panels: { map: { component: Owner, defaultOptions: { canPopOut: true } } } }) as unknown as Workspace;
    popoutUrl = undefined;
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
    fixture = TestBed.createComponent(Shell) as ComponentFixture<unknown>;
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    await settle();
    ws.openPanel('map', 'map');
    await settle();
    widgetsApi!.open('w', { title: 'W', component: PfTable, canPopOut: true, width: 200, height: 100 });
    await settle();
    // The owner into its window, from the page.
    const p1 = popup();
    stubOpen(window, p1);
    activate(window, true);
    expect(ws.popOutPanel('map')).toEqual({ ok: true });
    await settle();
    expect(p1.doc.querySelector('[data-ndd-widget="w"]')).not.toBeNull();
    const place = (w: Window, x: number, y: number, chrome: number) => {
      for (const [k, v] of [['screenX', x], ['screenY', y], ['outerHeight', 800 + chrome], ['innerHeight', 800]] as const) {
        Object.defineProperty(w, k, { value: v, configurable: true });
        cleanups.push(() => {
          delete (w as unknown as Record<string, unknown>)[k];
        });
      }
    };
    place(window, 3000, 2000, 80);
    place(p1.win, 100, 200, 30);
    const frame = p1.doc.querySelector<HTMLElement>('[data-ndd-widget="w"]')!;
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ left: 50, top: 60, right: 450, bottom: 360, width: 400, height: 300, x: 50, y: 60, toJSON() {} } as DOMRect);
    // A click in the owner's window.
    activate(window, false);
    activate(p1.win, true);
    const p2 = popup();
    const mainOpen = vi.mocked(window.open);
    mainOpen.mockClear();
    const fromOwner = stubOpen(p1.win, p2);
    expect(widgetsApi!.popOut('w')).toEqual({ ok: true });
    await settle();
    expect(fromOwner).toHaveBeenCalledTimes(1);
    expect(mainOpen).not.toHaveBeenCalled();
    expect(String(fromOwner.mock.calls[0]![2])).toBe('popup=yes,left=150,top=290,width=400,height=300');
    expect(p2.doc.querySelector('.pf-table')).not.toBeNull();
    expect(p1.doc.querySelector('.pf-table')).toBeNull();
    widgetsApi = null;
  });
});

describe('XFP7: popoutUrl', () => {
  it('a relative popoutUrl opened from a pop-out is resolved against the main page', async () => {
    const ws = await setup({ popoutUrl: '/popout.html' });
    const p1 = popup();
    stubOpen(window, p1);
    activate(window, true);
    // The first window's page is the app's: give it one that has loaded.
    Object.defineProperty(p1.doc, 'URL', { get: () => 'http://localhost/popout.html', configurable: true });
    expect(ws.popOutPanel('a')).toEqual({ ok: true });
    await settle();
    const fromPopup = stubOpen(p1.win, popup());
    activate(window, false);
    activate(p1.win, true);
    ws.popOutPanel('b');
    expect(fromPopup).toHaveBeenCalledWith(new URL('/popout.html', document.baseURI).href, expect.any(String), expect.any(String));
    expect(String(fromPopup.mock.calls[0]![0])).toMatch(/^https?:\/\/[^/]+\/popout\.html$/);
  });
});
