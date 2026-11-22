/**
 * The window-change hooks (1.12.0, rdd 7.12.1's `PopoutWrapper.test.tsx` by way of vdd 1.14.0's
 * `popoutWrapper.test.ts`, ids prefixed `X`): `<ndd-desktop [popoutWrapper]>`,
 * `injectPanelWindow()`, `injectPanel().isPoppedOut`, and the `panel:popped-out` /
 * `panel:returned` events. The pop-out is an `<iframe>`'s window, handed back by a stubbed
 * `window.open`.
 *
 * XPW1: with a wrapper, nothing is re-created through pop-out and return: the content's state is
 *       kept, and the wrapper itself stays
 * XPW2: the wrapper gets the pop-out's document in the render that moves the element in, before
 *       any of the content's effects run, so they see it already
 * XPW3: back on the main window and document after the return
 * XPW4: no wrapper with popOut off; with popOut on, around every panel, canPopOut or not
 * XPW5: injectPanelWindow() and injectPanel().isPoppedOut through the cycle; the main window
 *       outside a panel and with popOut off
 * XPW6: panel:popped-out and panel:returned, once each with their payload, on every way back; no
 *       panel:returned for a panel closed while out. Both are sent once the panel is in its new
 *       place and a frame has passed, so each test waits for the layout.
 * ndd additions:
 * XPWN1: a lazy panel's component, once loaded, is created inside the wrapper too (its content
 *        element is replaced; the new one goes where the first one was)
 * XPWN2: closing a panel destroys its wrapper; the other panel's stays
 *
 * ndd: the wrapper is a component type (inputs `window`, `document`, an `<ng-content />`); the
 * library creates it with `createComponent`, projects the panel's content element into it and
 * makes its injector the panel's parent, so what it provides reaches the panel. XPW2 checks the
 * render with the wrapper's own effect and the content's: Angular checks the desktop's view (the
 * frame, whose slot moves the element), then the wrapper's, then the panel's.
 */
import { Component, ElementRef, InjectionToken, effect, inject, input, signal, untracked } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import type { Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { injectPanel } from '../../src/lib/panel/panel-ref';
import { injectPanelWindow } from '../../src/lib/panel/panel-window';
import type { PanelWindow } from '../../src/lib/panel/panel-window';

type AnyWindow = Window & typeof globalThis;
const frames: HTMLIFrameElement[] = [];

function popup(): { win: AnyWindow; doc: Document; closeByUser(silent?: boolean): void } {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const win = frame.contentWindow as AnyWindow;
  let closed = false;
  // jsdom tears an iframe's document down on close(); a real pop-out's document stays readable.
  Object.defineProperty(win, 'closed', { get: () => closed, configurable: true });
  Object.defineProperty(win, 'close', {
    value: () => {
      closed = true;
    },
    configurable: true,
  });
  Object.defineProperty(win, 'focus', { value: () => {}, configurable: true });
  return {
    win,
    doc: frame.contentDocument!,
    closeByUser(silent = false) {
      closed = true;
      if (!silent) win.dispatchEvent(new win.Event('pagehide'));
    },
  };
}

const log: string[] = [];
const mounts = vi.fn();
const wrapperMounts = vi.fn();
const wrapperDestroys = vi.fn();
let wrapperDoc: Document | null = null;
const seen: { doc: Document; poppedOut: boolean; wrapperDocThen: Document | null; elementIn: Document | null }[] = [];

/** What the wrapper provides: the document it was given, as a CSS-in-JS cache provider would. */
const WRAPPER_DOC = new InjectionToken<Signal<Document>>('pw-wrapper-doc');

/**
 * A wrapper as an app's CSS-in-JS one: records its creations and the document it gets. Only the
 * one around a panel's content records (the frame, menus and toasts in a pop-out get one too).
 */
@Component({
  selector: 'ndd-test-pw-wrapper',
  template: '<div class="pw-wrapper"><ng-content /></div>',
  providers: [{ provide: WRAPPER_DOC, useFactory: () => inject(PwWrapper).document }],
})
class PwWrapper implements OnInit, OnDestroy {
  readonly window = input.required<Window>();
  readonly document = input.required<Document>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly aroundPanel = () => !!this.host.closest('.ndd-panel-mount');

  constructor() {
    effect(() => {
      const doc = this.document();
      untracked(() => {
        if (!this.aroundPanel()) return;
        wrapperDoc = doc;
        const where = this.host.ownerDocument;
        log.push(`render ${doc === document ? 'main' : 'child'} element-in ${where === document ? 'main' : 'child'}`);
      });
    });
  }

  ngOnInit(): void {
    if (this.aroundPanel()) wrapperMounts();
  }

  ngOnDestroy(): void {
    wrapperDestroys();
  }
}

/** A panel with state, recording its creations and what injectPanelWindow / injectPanel say in its effect. */
@Component({
  selector: 'ndd-test-pw-probe',
  template: `<button class="pw-count" [attr.data-id]="panelId()" (click)="n.set(n() + 1)">{{ n() }}</button>`,
})
class Probe implements OnInit {
  readonly panelId = input('');
  protected readonly n = signal(0);
  private readonly pw = injectPanelWindow();
  private readonly panel = injectPanel();
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** What the wrapper provides, when there is one around this panel. */
  readonly provided = inject(WRAPPER_DOC, { optional: true });

  constructor() {
    // The content's own effect: the earliest app code that sees a change.
    effect(() => {
      const doc = this.pw().document;
      const out = this.panel.isPoppedOut();
      untracked(() => seen.push({ doc, poppedOut: out, wrapperDocThen: wrapperDoc, elementIn: this.el.ownerDocument }));
    });
  }

  ngOnInit(): void {
    mounts(this.panelId());
  }
}

let shellUrl: string | undefined;
let shellWrapper: typeof PwWrapper | undefined;
@Component({
  selector: 'ndd-test-pw-shell',
  imports: [NddDesktop],
  template: `<ndd-desktop [popoutUrl]="url" [popoutWrapper]="wrapper" />`,
})
class Shell {
  protected readonly url = shellUrl;
  protected readonly wrapper = shellWrapper;
}

let fixture: ComponentFixture<unknown> | null = null;

async function render(ws: Workspace, opts: { wrapper?: boolean; popoutUrl?: string }): Promise<void> {
  shellUrl = opts.popoutUrl;
  shellWrapper = opts.wrapper === false ? undefined : PwWrapper;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const f = TestBed.createComponent(Shell) as ComponentFixture<unknown>;
  document.body.appendChild(f.nativeElement as HTMLElement);
  fixture = f;
  await f.whenStable();
}

const settle = async () => {
  await fixture?.whenStable();
  await fixture?.whenStable();
};

async function setup(opts: { popOut?: boolean; wrapper?: boolean; popoutUrl?: string } = {}): Promise<Workspace> {
  const ws = createWorkspace({
    popOut: opts.popOut ?? true,
    panels: {
      probe: { component: Probe, defaultOptions: { canPopOut: true } },
      plain: { component: Probe },
      lazy: { loadComponent: () => Promise.resolve(Probe) },
    },
  }) as unknown as Workspace;
  await render(ws, opts);
  ws.openPanel('a', 'probe');
  await settle();
  return ws;
}

/** A few animation frames: panel:popped-out / panel:returned wait for the layout. */
const afterLayout = async () => {
  await new Promise(r => setTimeout(r, 100));
  await settle();
};

/**
 * The page's animation frames on real timers, as pop-out-windows.spec.ts's XPOE tests do: jsdom's
 * page rAF interval can be created under an earlier test's fake timers and never run.
 */
const ownFrames = () =>
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    cb => setTimeout(() => (typeof cb === 'function' ? cb(performance.now()) : undefined), 16) as unknown as number,
  );

const counter = (doc: Document = document) => doc.querySelector<HTMLButtonElement>('.pw-count[data-id="a"]');
const stubOpen = (p: { win: AnyWindow }) => vi.spyOn(window, 'open').mockImplementation(() => p.win);

afterEach(() => {
  fixture?.destroy();
  fixture = null;
  frames.splice(0).forEach(f => f.remove());
  log.length = 0;
  seen.length = 0;
  wrapperDoc = null;
  mounts.mockClear();
  wrapperMounts.mockClear();
  wrapperDestroys.mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('XPW1: nothing is re-created', () => {
  it('through pop-out and return, the content keeps its state and the wrapper stays', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    counter()!.click();
    counter()!.click();
    await settle();
    expect(wrapperMounts).toHaveBeenCalledTimes(1);
    mounts.mockClear();
    wrapperMounts.mockClear();
    ws.popOutPanel('a');
    await settle();
    expect(counter(p.doc)!.textContent).toBe('2');
    expect(counter(p.doc)!.closest('.pw-wrapper')).not.toBeNull();
    ws.returnPanel('a');
    await settle();
    expect(counter()!.textContent).toBe('2');
    expect(mounts).not.toHaveBeenCalled();
    expect(wrapperMounts).not.toHaveBeenCalled();
  });
});

describe('XPW2: the document switches in the render that moves the element', () => {
  it("the wrapper renders once with the pop-out's document, the element already there; the content's effect then sees it", async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    log.length = 0;
    seen.length = 0;
    ws.popOutPanel('a');
    // Nothing yet in the click: the store changed, Angular renders later.
    expect(log).toEqual([]);
    expect(seen).toEqual([]);
    await settle();
    expect(log).toEqual(['render child element-in child']);
    expect(counter(p.doc)).not.toBeNull();
    const inChild = seen.filter(s => s.doc === p.doc);
    expect(inChild).toHaveLength(1);
    expect(inChild[0]!.wrapperDocThen).toBe(p.doc);
    expect(inChild[0]!.elementIn).toBe(p.doc);
    expect(inChild[0]!.poppedOut).toBe(true);
    // No render in between saw the element in one document and the other one named.
    expect(seen.every(s => s.doc === s.elementIn)).toBe(true);
  });
});

describe('XPW3: back on the main document', () => {
  it('after the return, the wrapper and injectPanelWindow give the main ones again', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    ws.popOutPanel('a');
    await settle();
    expect(wrapperDoc).toBe(p.doc);
    ws.returnPanel('a');
    await settle();
    expect(wrapperDoc).toBe(document);
    expect(seen.at(-1)!.doc).toBe(document);
    expect(document.querySelector('.ndd-workspace .pw-wrapper .pw-count')).not.toBeNull();
    expect(log.at(-1)).toBe('render main element-in main');
  });
});

describe('XPW4: where the wrapper is rendered', () => {
  it('none with popOut off', async () => {
    await setup({ popOut: false });
    expect(document.querySelector('.pw-wrapper')).toBeNull();
    expect(counter()).not.toBeNull();
  });

  it('around every panel with popOut on, canPopOut or not; what it provides reaches the panel', async () => {
    const ws = await setup();
    ws.openPanel('b', 'plain', { initialTarget: 'floating' });
    await settle();
    expect(document.querySelectorAll('.pw-wrapper .pw-count').length).toBe(2);
    // The host is library-marked and in the panel's own element, the content inside its <ng-content />.
    const content = counter()!.closest('.ndd-panel-content')!;
    expect(content.parentElement!.classList.contains('pw-wrapper')).toBe(true);
    expect(content.closest('.ndd-popout-wrapper')!.parentElement!.classList.contains('ndd-panel-mount')).toBe(true);
    const host = (fixture!.debugElement.query(By.directive(NddDesktop)).componentInstance as NddDesktop).panelHost;
    const probe = host.instance('b') as Probe;
    expect(probe.provided?.()).toBe(document);
  });
});

describe('XPW5: injectPanelWindow and isPoppedOut', () => {
  it('through pop-out and return', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    expect(seen.at(-1)).toMatchObject({ doc: document, poppedOut: false });
    ws.popOutPanel('a');
    await settle();
    expect(seen.at(-1)).toMatchObject({ doc: p.doc, poppedOut: true });
    ws.returnPanel('a');
    await settle();
    expect(seen.at(-1)).toMatchObject({ doc: document, poppedOut: false });
  });

  it('the main window outside a panel, and with popOut off', async () => {
    let outside: PanelWindow | null = null;
    TestBed.runInInjectionContext(() => {
      outside = injectPanelWindow()();
    });
    expect(outside).toEqual({ window, document });
    TestBed.resetTestingModule();
    await setup({ popOut: false });
    expect(seen.at(-1)).toMatchObject({ doc: document, poppedOut: false });
  });
});

describe('XPW6: the events', () => {
  beforeEach(ownFrames);
  type Popup = ReturnType<typeof popup>;
  const paths: [string, (ws: Workspace, p: Popup) => void][] = [
    ['returnPanel', ws => void ws.returnPanel('a')],
    ["the frame's button", (_ws, p) => p.doc.querySelector<HTMLButtonElement>('.ndd-popout-frame__return')!.click()],
    ["the window's pagehide", (_ws, p) => p.closeByUser()],
    ["the main page's pagehide", () => window.dispatchEvent(new Event('pagehide'))],
    ['minimizing from code', ws => ws.minimizePanel('a')],
    ['docking from code', ws => ws.dockPanel('a')],
    [
      'a layout load that keeps it',
      ws =>
        ws.loadLayout(
          JSON.stringify({
            version: 2,
            gridRoot: { type: 'leaf', id: 'g', panels: ['a'], activePanelId: 'a' },
            floating: [],
            minimized: [],
            panels: { a: { id: 'a', title: 'a', component: 'probe', state: 'docked' } },
          }),
        ),
    ],
  ];
  for (const [name, back] of paths) {
    it(`popped-out once with its window; returned once, by ${name}`, async () => {
      const ws = await setup();
      const p = popup();
      stubOpen(p);
      const out = vi.fn();
      const returned = vi.fn();
      ws.subscribe('panel:popped-out', out);
      ws.subscribe('panel:returned', returned);
      ws.popOutPanel('a');
      await settle();
      await afterLayout();
      expect(out).toHaveBeenCalledTimes(1);
      expect(out).toHaveBeenCalledWith({ id: 'a', window: p.win });
      expect(returned).not.toHaveBeenCalled();
      back(ws, p);
      await settle();
      await afterLayout();
      expect(ws.isOpen('a')).toBe(true);
      expect(returned).toHaveBeenCalledTimes(1);
      expect(returned).toHaveBeenCalledWith({ id: 'a' });
      expect(out).toHaveBeenCalledTimes(1);
    });
  }

  it('returned once by the closed poll, and by destroying the desktop', async () => {
    for (const how of ['poll', 'destroy'] as const) {
      const ws = await setup();
      const p = popup();
      stubOpen(p);
      const returned = vi.fn();
      ws.subscribe('panel:returned', returned);
      ws.popOutPanel('a');
      await settle();
      await afterLayout();
      if (how === 'poll') {
        p.closeByUser(true);
        await new Promise(r => setTimeout(r, 600));
        await settle();
        await afterLayout();
      } else {
        fixture!.destroy();
        fixture = null;
        await afterLayout();
      }
      expect(returned, how).toHaveBeenCalledTimes(1);
      fixture?.destroy();
      fixture = null;
      TestBed.resetTestingModule();
      vi.mocked(window.open).mockRestore();
    }
  });

  it('no panel:returned for a panel closed while out (panel:closed is sent)', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    const returned = vi.fn();
    const closed = vi.fn();
    ws.subscribe('panel:returned', returned);
    ws.subscribe('panel:closed', closed);
    ws.popOutPanel('a');
    await settle();
    await afterLayout();
    ws.closePanel('a');
    await settle();
    await afterLayout();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(returned).not.toHaveBeenCalled();
  });

  it('with popoutUrl, popped-out is sent once the page is ready, not before; the wrapper switches then', async () => {
    const ws = await setup({ popoutUrl: '/popout.html' });
    const p = popup();
    let url = 'about:blank';
    Object.defineProperty(p.doc, 'URL', { get: () => url, configurable: true });
    Object.defineProperty(p.doc, 'readyState', { get: () => 'complete', configurable: true });
    stubOpen(p);
    const out = vi.fn();
    ws.subscribe('panel:popped-out', out);
    ws.popOutPanel('a');
    await settle();
    await afterLayout();
    expect(out).not.toHaveBeenCalled();
    expect(wrapperDoc).toBe(document);
    url = 'http://localhost/popout.html';
    p.win.dispatchEvent(new p.win.Event('load'));
    await settle();
    await afterLayout();
    expect(out).toHaveBeenCalledTimes(1);
    expect(wrapperDoc).toBe(p.doc);
  });
});

describe('XPWN1: a lazy panel', () => {
  it("once loaded, its component is inside the wrapper, and gets what it provides", async () => {
    const ws = await setup();
    ws.openPanel('l', 'lazy', { initialTarget: 'floating' });
    await settle();
    await new Promise(r => setTimeout(r, 20));
    await settle();
    const btn = document.querySelector('.pw-count[data-id="l"]')!;
    expect(btn).not.toBeNull();
    expect(btn.closest('.ndd-panel-content')!.parentElement!.classList.contains('pw-wrapper')).toBe(true);
    const host = (fixture!.debugElement.query(By.directive(NddDesktop)).componentInstance as NddDesktop).panelHost;
    expect((host.instance('l') as Probe).provided?.()).toBe(document);
  });
});

describe('XPWN2: a closed panel', () => {
  it('takes its wrapper with it; the other panel keeps its own', async () => {
    const ws = await setup();
    ws.openPanel('b', 'plain', { initialTarget: 'floating' });
    await settle();
    expect(document.querySelectorAll('.pw-wrapper').length).toBe(2);
    wrapperDestroys.mockClear();
    ws.closePanel('b');
    await settle();
    expect(wrapperDestroys).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.pw-wrapper').length).toBe(1);
    expect(counter()!.closest('.pw-wrapper')).not.toBeNull();
  });
});
