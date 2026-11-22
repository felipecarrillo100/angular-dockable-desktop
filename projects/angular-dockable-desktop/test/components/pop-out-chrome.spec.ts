/**
 * What the library renders into a pop-out besides the panel (1.12.0, rdd 7.12.1's
 * `PopOutChrome.test.tsx` by way of vdd 1.14.0's `popOutChrome.test.ts`, ids prefixed `X`): the
 * app's popoutWrapper around the frame, a menu and toasts shown there; toasts in the window the
 * user is in; and when the four events arrive. The pop-out is an `<iframe>`'s window, handed back
 * by a stubbed `window.open`.
 *
 * XPC1: the wrapper is around the frame and a menu shown in the pop-out, with that window, and what
 *       it provides reaches the frame's icon and the menu item's; not around a menu in the page;
 *       none without a wrapper
 * XPC2: a toast raised while the pop-out has focus shows there (inside the wrapper); otherwise in
 *       the page; the same id updates in place, in its window; the window closing removes it; a
 *       queued toast whose window closed shows in the page; maxVisible counts every window
 * XPC3: when the four events arrive: panel:popping-out in the click, with the element still in
 *       the page (with popoutUrl too, before the page loads); panel:popped-out once it is in the
 *       window and a frame has passed; panel:returning with it still in the window,
 *       panel:returned once it is back in the page and laid out; a window that fails sends
 *       popping-out then returned; none for a refused pop-out, a panel closed while out, or with
 *       popOut off; an event for a replaced pop-out or return is dropped; sent anyway after the
 *       limit
 * XPC4: a toolbar flyout opened in a popped-out panel is in the panel's own tree: what the wrapper
 *       provides (the pop-out's document) reaches its items' icons, with nothing added for it
 * XPC5: data-ndd-popout-kind="panel" on a panel's frame (a widget's: P5)
 * ndd additions:
 * XPCN1: the page's toast container is there with no toast at all; a pop-out's comes with its first
 *        toast, and a toast dismissed there leaves that window
 * XPCN2: with a toast adapter, a toast raised in a pop-out goes to the adapter, as before: no
 *        container in either window, and the window closing leaves it to the adapter
 *
 * ndd: `<ndd-context-menu>` and `<ndd-toasts>` are mounted beside `<ndd-desktop>`, as an app does,
 * so the wrapper reaches them by their document, not by injection (rdd moved its provider outside
 * the menu's). The wrapper's host is the library's `.ndd-popout-wrapper`, put in the pop-out's
 * `<body>`; what it is around goes into the element it projects (`.ndd-popout-wrapper__content`).
 */
import { Component, ElementRef, InjectionToken, inject, input } from '@angular/core';
import type { Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddContextMenu } from '../../src/lib/context-menu/context-menu';
import { NddToasts } from '../../src/lib/toast/toasts';
import { NddToolbar } from '../../src/lib/toolbar/toolbar';
import type { ToolbarItem } from '../../src/lib/core/toolbar-types';
import { resetToasts, toast } from '../../src/lib/toast/toast';
import { POPOUT_PLACED_TIMEOUT_MS } from '../../src/lib/core/pop-out-windows';

type AnyWindow = Window & typeof globalThis;
const frames: HTMLIFrameElement[] = [];

interface Popup {
  win: AnyWindow;
  doc: Document;
  /** Whether the user is in this window, as the browser reports it. */
  focused(on: boolean): void;
}

function popup(): Popup {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const win = frame.contentWindow as AnyWindow;
  const doc = frame.contentDocument!;
  let closed = false;
  let focused = false;
  // jsdom tears an iframe's document down on close(); a real pop-out's document stays readable.
  Object.defineProperty(win, 'closed', { get: () => closed, configurable: true });
  Object.defineProperty(win, 'close', {
    value: () => {
      closed = true;
    },
    configurable: true,
  });
  Object.defineProperty(win, 'focus', { value: () => {}, configurable: true });
  Object.defineProperty(doc, 'hasFocus', { value: () => focused, configurable: true });
  return {
    win,
    doc,
    focused(on) {
      focused = on;
    },
  };
}

/** The document the wrapper got, as a CSS-in-JS cache provider would pass its cache down. */
const WRAPPER_DOC = new InjectionToken<Signal<Document>>('pc-wrapper-doc');

/** A wrapper as an app's CSS-in-JS one, marking what it is around and the document it got. */
@Component({
  selector: 'ndd-test-pc-wrapper',
  template: `<div class="pc-wrapper" [attr.data-doc-ok]="document() === window().document ? '' : null"><ng-content /></div>`,
  providers: [{ provide: WRAPPER_DOC, useFactory: () => inject(PcWrapper).document }],
})
class PcWrapper {
  readonly window = input.required<Window>();
  readonly document = input.required<Document>();
}

/** An icon that keeps the document the wrapper gave it, to compare with the one it is shown in. */
@Component({ selector: 'ndd-test-pc-icon', template: '<svg class="pc-icon"></svg>' })
class CtxIcon {
  constructor() {
    const doc = inject(WRAPPER_DOC, { optional: true });
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement as HTMLElement & { wrapperDoc?: Document | null };
    el.wrapperDoc = doc ? doc() : null;
  }
}

const flyoutItems: ToolbarItem[] = [{ type: 'group', id: 'g', label: 'Group', defaultIcon: 'x', items: [{ id: 'x', label: 'X', icon: CtxIcon }] }];
@Component({
  selector: 'ndd-test-pc-content',
  imports: [NddToolbar],
  template: `<div class="pc-content">content<ndd-toolbar position="top" [items]="items" /></div>`,
})
class Content {
  readonly panelId = input('');
  protected readonly items = flyoutItems;
}

let shellUrl: string | undefined;
let shellWrapper: typeof PcWrapper | undefined;
let shellMax = 3;
@Component({
  selector: 'ndd-test-pc-shell',
  imports: [NddDesktop, NddContextMenu, NddToasts],
  template: `
    <ndd-desktop [popoutUrl]="url" [popoutWrapper]="wrapper" />
    <ndd-context-menu />
    <ndd-toasts animation="none" [defaultDuration]="0" [maxVisible]="max" />
  `,
})
class Shell {
  protected readonly url = shellUrl;
  protected readonly wrapper = shellWrapper;
  protected readonly max = shellMax;
}

let fixture: ComponentFixture<unknown> | null = null;

const settle = async () => {
  await fixture?.whenStable();
  await fixture?.whenStable();
};

async function setup(opts: { popOut?: boolean; wrapper?: boolean; popoutUrl?: string; maxVisible?: number } = {}): Promise<Workspace> {
  const ws = createWorkspace({
    popOut: opts.popOut ?? true,
    panels: { c: { component: Content, defaultOptions: { canPopOut: true, icon: CtxIcon } }, plain: { component: Content } },
  }) as unknown as Workspace;
  shellUrl = opts.popoutUrl;
  shellWrapper = opts.wrapper === false ? undefined : PcWrapper;
  shellMax = opts.maxVisible ?? 3;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const f = TestBed.createComponent(Shell) as ComponentFixture<unknown>;
  document.body.appendChild(f.nativeElement as HTMLElement);
  fixture = f;
  await f.whenStable();
  ws.openPanel('a', 'c');
  ws.openPanel('b', 'plain', { initialTarget: 'floating' });
  await settle();
  return ws;
}

/** Destroys the desktop and its test module, for a test that sets up twice. */
const teardown = () => {
  fixture?.destroy();
  fixture = null;
  TestBed.resetTestingModule();
  resetToasts();
};

const stubOpen = (p: Popup | null) => vi.spyOn(window, 'open').mockImplementation(() => (p ? p.win : null));
const popOutA = async (ws: Workspace): Promise<Popup> => {
  const p = popup();
  stubOpen(p);
  ws.popOutPanel('a');
  await settle();
  return p;
};
const showMenuIn = async (ws: Workspace, doc: Document) => {
  ws.showContextMenu({
    event: { target: doc.body, clientX: 5, clientY: 5 } as unknown as MouseEvent,
    items: [{ label: 'One', icon: CtxIcon, action: () => {} }],
  });
  await settle();
};
/** A few animation frames: panel:popped-out / panel:returned wait for the layout. */
const afterLayout = async () => {
  await new Promise(r => setTimeout(r, 100));
  await settle();
};
/** The page's animation frames on real timers, as pop-out-windows.spec.ts's XPOE tests do. */
const ownFrames = () =>
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    cb => setTimeout(() => (typeof cb === 'function' ? cb(performance.now()) : undefined), 16) as unknown as number,
  );
const toastsIn = (doc: Document) =>
  Array.from(doc.querySelectorAll('.ndd-toast')).map(t => t.querySelector('.ndd-toast__body')?.textContent?.trim() ?? t.textContent?.trim());
const wrapperDocOf = (el: Element | null) => (el as (Element & { wrapperDoc?: Document | null }) | null)?.wrapperDoc;

afterEach(() => {
  fixture?.destroy();
  fixture = null;
  resetToasts();
  frames.splice(0).forEach(f => f.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe("XPC1: the app's wrapper around what the library renders in a pop-out", () => {
  it("around the whole frame, with the pop-out's window and document; the frame's icon gets what it provides", async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    const frame = p.doc.querySelector('.ndd-popout-frame')!;
    expect(frame).not.toBeNull();
    const wrapper = frame.closest('.pc-wrapper')!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.hasAttribute('data-doc-ok')).toBe(true);
    expect(frame.parentElement!.parentElement).toBe(wrapper);
    expect(wrapper.closest('.ndd-popout-wrapper')!.parentElement).toBe(p.doc.body);
    // The frame's icon and title are inside it, and the icon was given the pop-out's document.
    expect(wrapper.querySelector('.ndd-popout-frame__icon')).not.toBeNull();
    expect(wrapperDocOf(p.doc.querySelector('.ndd-popout-frame__icon ndd-test-pc-icon'))).toBe(p.doc);
    // The panel's content is still where it was: in its own wrapper, inside the frame's slot.
    expect(p.doc.querySelector('.ndd-popout-frame__body .pc-content')).not.toBeNull();
  });

  it('around a menu shown in the pop-out, its item icon given that document; not around a menu in the page', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    await showMenuIn(ws, p.doc);
    const menu = p.doc.querySelector('.ndd-context-menu')!;
    expect(menu).not.toBeNull();
    expect(menu.closest('.pc-wrapper')).not.toBeNull();
    expect(menu.closest('.pc-wrapper')!.hasAttribute('data-doc-ok')).toBe(true);
    expect(wrapperDocOf(menu.querySelector('ndd-test-pc-icon'))).toBe(p.doc);
    ws.closeContextMenu();
    await settle();
    expect(p.doc.querySelector('.ndd-context-menu')).toBeNull();
    // Only the frame's wrapper is left in the window's <body>: the menu's went with it.
    expect(p.doc.body.querySelectorAll(':scope > .ndd-popout-wrapper').length).toBe(1);

    await showMenuIn(ws, document);
    const inPage = document.querySelector('.ndd-context-menu')!;
    expect(inPage).not.toBeNull();
    expect(inPage.closest('.pc-wrapper')).toBeNull();
    expect(wrapperDocOf(inPage.querySelector('ndd-test-pc-icon'))).toBeNull();
  });

  it('without a wrapper, the frame and a menu render as before', async () => {
    const ws = await setup({ wrapper: false });
    const p = await popOutA(ws);
    expect(p.doc.querySelector('.ndd-popout-frame')!.parentElement).toBe(p.doc.body);
    await showMenuIn(ws, p.doc);
    expect(p.doc.querySelector('.ndd-context-menu')!.parentElement).toBe(p.doc.body);
  });
});

describe('XPC2: toasts in the window the user is in', () => {
  it('in the page with no pop-out', async () => {
    await setup();
    toast('hello');
    await settle();
    expect(toastsIn(document)).toEqual(['hello']);
  });

  it("in the pop-out while it has focus, inside the wrapper; in the page when it hasn't", async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    p.focused(true);
    toast('there');
    await settle();
    expect(toastsIn(p.doc)).toEqual(['there']);
    expect(toastsIn(document)).toEqual([]);
    expect(p.doc.querySelector('.ndd-toast-container')!.closest('.pc-wrapper')).not.toBeNull();
    p.focused(false);
    toast('here');
    await settle();
    expect(toastsIn(document)).toEqual(['here']);
    expect(toastsIn(p.doc)).toEqual(['there']);
    // The page's container is not wrapped.
    expect(document.querySelector('.ndd-toast-container')!.closest('.pc-wrapper')).toBeNull();
  });

  it('the same id updates in place, in the window it was shown in', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    p.focused(true);
    toast('first', { id: 'x' });
    await settle();
    p.focused(false);
    toast('second', { id: 'x' });
    await settle();
    expect(toastsIn(p.doc)).toEqual(['second']);
    expect(toastsIn(document)).toEqual([]);
  });

  it("its window closing removes it (onClose runs); the page's toasts stay", async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    const onClose = vi.fn();
    p.focused(true);
    toast('there', { onClose });
    p.focused(false);
    toast('here');
    await settle();
    ws.returnPanel('a');
    await settle();
    expect(toastsIn(p.doc)).toEqual([]);
    expect(toastsIn(document)).toEqual(['here']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('maxVisible counts every window; one waiting whose window closed shows in the page', async () => {
    const ws = await setup({ maxVisible: 2 });
    const p = await popOutA(ws);
    toast('page 1');
    p.focused(true);
    toast('there 1');
    toast('there 2');
    await settle();
    // Two shown in all: one in each window; 'there 2' waits.
    expect(toastsIn(document)).toEqual(['page 1']);
    expect(toastsIn(p.doc)).toEqual(['there 1']);
    p.focused(false);
    ws.returnPanel('a');
    await settle();
    // 'there 1' went with its window; 'there 2' takes its place, in the page.
    expect(toastsIn(document)).toEqual(['page 1', 'there 2']);
    expect(toastsIn(p.doc)).toEqual([]);
  });
});

describe('XPC3: when the four events arrive', () => {
  beforeEach(ownFrames);

  /**
   * Records the events in order, with the document the panel's element is in when each arrives
   * (the very node, kept from the start).
   */
  function record(ws: Workspace) {
    const log: string[] = [];
    const el = document.querySelector('.pc-content')?.closest('.ndd-panel-mount') ?? null;
    const where = () => (!el ? 'nowhere' : el.ownerDocument === document ? 'page' : 'window');
    for (const type of ['panel:popping-out', 'panel:popped-out', 'panel:returning', 'panel:returned'] as const) {
      ws.subscribe(type, (e: { id: string }) => {
        log.push(`${type} ${e.id} ${where()}`);
      });
    }
    return log;
  }

  it('popping-out in the click, in the page; popped-out once it is in the window and a frame has passed; the same on the way back', async () => {
    const ws = await setup();
    const log = record(ws);
    const p = popup();
    stubOpen(p);
    ws.popOutPanel('a');
    // In the click: popping-out only, the element still in the page.
    expect(log).toEqual(['panel:popping-out a page']);
    await afterLayout();
    expect(log).toEqual(['panel:popping-out a page', 'panel:popped-out a window']);
    expect(p.doc.querySelector('.pc-content')).not.toBeNull();
    log.length = 0;
    ws.returnPanel('a');
    expect(log).toEqual(['panel:returning a window']);
    await afterLayout();
    expect(log).toEqual(['panel:returning a window', 'panel:returned a page']);
  });

  it("returning, then returned once laid out, on every way back: the frame's button, the window closing", async () => {
    for (const how of ['button', 'pagehide'] as const) {
      const ws = await setup();
      const log = record(ws);
      const p = await popOutA(ws);
      await afterLayout();
      log.length = 0;
      if (how === 'button') p.doc.querySelector<HTMLButtonElement>('.ndd-popout-frame__return')!.click();
      else p.win.dispatchEvent(new p.win.Event('pagehide'));
      await afterLayout();
      expect(log, how).toEqual(['panel:returning a window', 'panel:returned a page']);
      teardown();
      vi.mocked(window.open).mockRestore();
    }
  });

  it('none for a refused pop-out, a panel closed while out, or with popOut off', async () => {
    const ws = await setup();
    const log = record(ws);
    expect(ws.popOutPanel('b')).toEqual({ ok: false, reason: 'not-allowed' }); // no canPopOut
    expect(ws.popOutPanel('nope').ok).toBe(false);
    stubOpen(null); // a blocked pop-up
    expect(ws.popOutPanel('a')).toEqual({ ok: false, reason: 'blocked' });
    await afterLayout();
    expect(log).toEqual([]);
    vi.mocked(window.open).mockRestore();
    await popOutA(ws);
    await afterLayout();
    log.length = 0;
    ws.closePanel('a');
    await afterLayout();
    expect(log).toEqual([]);
    teardown();

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const off = await setup({ popOut: false });
    const offLog = record(off);
    expect(off.popOutPanel('a')).toEqual({ ok: false, reason: 'disabled' });
    await afterLayout();
    expect(offLog).toEqual([]);
  });

  /** A pop-out window whose app page (popoutUrl) has not loaded yet; `load()` makes it ready. */
  function pagePopup() {
    const p = popup();
    let url = 'about:blank';
    Object.defineProperty(p.doc, 'URL', { get: () => url, configurable: true });
    Object.defineProperty(p.doc, 'readyState', { get: () => 'complete', configurable: true });
    stubOpen(p);
    return {
      ...p,
      load() {
        url = 'http://localhost/popout.html';
        p.win.dispatchEvent(new p.win.Event('load'));
      },
    };
  }

  it('with popoutUrl, popping-out comes in the click, before the page loads; popped-out once it is laid out there', async () => {
    const ws = await setup({ popoutUrl: '/popout.html' });
    const log = record(ws);
    const p = pagePopup();
    ws.popOutPanel('a');
    expect(log).toEqual(['panel:popping-out a page']);
    await afterLayout();
    expect(log).toEqual(['panel:popping-out a page']);
    p.load();
    await afterLayout();
    expect(log).toEqual(['panel:popping-out a page', 'panel:popped-out a window']);
  });

  it('a window that fails before its page loads (closed early): popping-out, then returned; no popped-out, no returning', async () => {
    const ws = await setup({ popoutUrl: '/popout.html' });
    const log = record(ws);
    const p = pagePopup();
    ws.popOutPanel('a');
    p.win.close();
    // The closed poll (every 500 ms) brings it back.
    await new Promise(r => setTimeout(r, 700));
    await afterLayout();
    expect(log).toEqual(['panel:popping-out a page', 'panel:returned a page']);
  });

  it('a pop-out replaced before it was laid out: its popped-out is dropped; returned follows', async () => {
    const ws = await setup();
    const log = record(ws);
    await popOutA(ws);
    ws.returnPanel('a');
    await afterLayout();
    expect(log).toEqual(['panel:popping-out a page', 'panel:returned a page']);
    // ...and a return replaced by a new pop-out: its returned is dropped.
    log.length = 0;
    vi.mocked(window.open).mockRestore();
    await popOutA(ws);
    await afterLayout();
    ws.returnPanel('a');
    vi.mocked(window.open).mockRestore();
    await popOutA(ws);
    await afterLayout();
    expect(log.map(l => l.split(' ')[0])).toEqual(['panel:popping-out', 'panel:popped-out', 'panel:returning', 'panel:popping-out', 'panel:popped-out']);
  });

  it('sent anyway after the limit when the panel never shows in its window', async () => {
    const ws = await setup();
    const log = record(ws);
    const p = popup();
    stubOpen(p);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ws.popOutPanel('a');
    vi.advanceTimersByTime(20);
    await settle();
    // Its frame stays hidden, as while its styles load.
    p.doc.querySelector<HTMLElement>('.ndd-popout-frame')!.style.visibility = 'hidden';
    // Real frames pass (the window's animation frames are not faked).
    for (let i = 0; i < 5; i++) await new Promise(r => p.win.requestAnimationFrame(() => r(null)));
    expect(log).toEqual(['panel:popping-out a page']);
    vi.advanceTimersByTime(POPOUT_PLACED_TIMEOUT_MS - 60);
    expect(log).toEqual(['panel:popping-out a page']);
    vi.advanceTimersByTime(80);
    expect(log).toEqual(['panel:popping-out a page', 'panel:popped-out a window']);
  });

  it('a return replaced by a new pop-out: its returned is not sent, not even at the limit', async () => {
    const ws = await setup();
    const log = record(ws);
    await popOutA(ws);
    await afterLayout();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ws.returnPanel('a');
    vi.mocked(window.open).mockRestore();
    const p = popup();
    stubOpen(p);
    ws.popOutPanel('a');
    vi.advanceTimersByTime(20);
    await settle();
    for (let i = 0; i < 5; i++) await new Promise(r => p.win.requestAnimationFrame(() => r(null)));
    vi.advanceTimersByTime(POPOUT_PLACED_TIMEOUT_MS + 100);
    expect(log.map(l => l.split(' ')[0])).toEqual(['panel:popping-out', 'panel:popped-out', 'panel:returning', 'panel:popping-out', 'panel:popped-out']);
  });
});

describe("XPC4: a toolbar flyout in a popped-out panel", () => {
  it("gets what the wrapper provides, with the pop-out's document", async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    const btn = p.doc.querySelector<HTMLButtonElement>('button.ndd-toolbar-btn-group')!;
    btn.click();
    await settle();
    const icon = p.doc.querySelector('.ndd-toolbar-group-flyout ndd-test-pc-icon')!;
    expect(icon).not.toBeNull();
    expect(wrapperDocOf(icon)).toBe(p.doc);
    expect(icon.ownerDocument).toBe(p.doc);
  });
});

describe("XPC5: the window's kind on its frame", () => {
  it('data-ndd-popout-kind="panel" on a panel\'s frame', async () => {
    const ws = await setup();
    const p = await popOutA(ws);
    expect(p.doc.querySelector('.ndd-popout-frame')!.getAttribute('data-ndd-popout-kind')).toBe('panel');
  });
});

describe('XPCN1: one container per window', () => {
  it("the page's always; a pop-out's with its toasts, which leave it when dismissed", async () => {
    const ws = await setup();
    expect(document.querySelectorAll('.ndd-toast-container').length).toBe(1);
    const p = await popOutA(ws);
    expect(p.doc.querySelector('.ndd-toast-container')).toBeNull();
    p.focused(true);
    toast('there', { id: 't' });
    await settle();
    expect(toastsIn(p.doc)).toEqual(['there']);
    toast.dismiss('t');
    await settle();
    expect(toastsIn(p.doc)).toEqual([]);
    expect(toastsIn(document)).toEqual([]);
    expect(document.querySelectorAll('.ndd-toast-container').length).toBe(1);
  });
});

describe('XPCN2: a toast adapter', () => {
  it('gets a toast raised in a pop-out; no container renders in either window', async () => {
    const shown = vi.fn();
    @Component({
      selector: 'ndd-test-pc-adapter-shell',
      imports: [NddDesktop, NddToasts],
      template: `<ndd-desktop [popoutWrapper]="wrapper" /><ndd-toasts [adapter]="adapter" />`,
    })
    class AdapterShell {
      protected readonly wrapper = PcWrapper;
      protected readonly adapter = { show: shown, update: () => {}, dismiss: () => {}, component: null };
    }
    const ws = createWorkspace({ popOut: true, panels: { c: { component: Content, defaultOptions: { canPopOut: true } } } }) as unknown as Workspace;
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
    const f = TestBed.createComponent(AdapterShell) as ComponentFixture<unknown>;
    document.body.appendChild(f.nativeElement as HTMLElement);
    fixture = f;
    await f.whenStable();
    ws.openPanel('a', 'c');
    await settle();
    const p = await popOutA(ws);
    p.focused(true);
    const onClose = vi.fn();
    toast('there', { onClose });
    await settle();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown.mock.calls[0]![1]).toBe('there');
    expect(p.doc.querySelector('.ndd-toast-container')).toBeNull();
    expect(document.querySelector('.ndd-toast-container')).toBeNull();
    // The window closing leaves the adapter's toasts to the adapter.
    ws.returnPanel('a');
    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });
});
