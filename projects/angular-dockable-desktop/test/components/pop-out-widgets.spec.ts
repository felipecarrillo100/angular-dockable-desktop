/**
 * Managed widgets in their own browser window (1.12.0, rdd 7.12.1's `PopOutWidgets.test.tsx`,
 * WG1–WG14 as XWG1–XWG14, the `b` variants kept, by way of vdd 1.14.0's `popOutWidgets.test.ts`):
 * `injectFloatingWidgets().popOut()`, `ManagedWidget.canPopOut`, `injectWidget().isPoppedOut`,
 * `WidgetMenuContext.canPopOut / isPoppedOut / popOut()`, and the way back. The pop-out is an
 * `<iframe>`'s window, handed back by a stubbed `window.open`.
 *
 * XWG1:  refusals, in order: disabled (with a development warning), not-open, not-allowed (no
 *        canPopOut; an owner type with keepAlive: false), no-gesture, blocked, no-window; each
 *        leaves the widget where it was, with no callback
 * XWG2:  from the panel: out of the panel and into the window in one step; the same element, its
 *        state kept, nothing re-created; location 'floating', isPoppedOut, its panel id
 * XWG2b: the window opens over the widget's frame in the panel, at its size
 * XWG3:  from docked, tabbed, floating and minimised: its panel pops out
 * XWG4:  one onWillMove / onMoved pair around the pop-out, and around every return
 * XWG5:  closing the window, the frame's "Back into the panel" button, returnPanel: back into its
 *        panel, where it was
 * XWG6:  move() from the window to the panel, docked, tabbed and floating: one move, one pair
 * XWG7:  workspace.popOutPanel(hostedId) goes through the widget's rules; returnPanel(hostedId) is
 *        the window closing
 * XWG8:  placement() while out reopens it floating at its rect before the window
 * XWG9:  the owner closing closes the window and the widget; the owner minimised leaves it out
 * XWG9b: its panel minimised from code while out: minimised, not sent into its panel
 * XWG10: the menu context: canPopOut, isPoppedOut, popOut(); the frame's title icon opens the menu,
 *        in the window, by a click and from the keyboard, and the click doesn't reach the window
 * XWG11: panel:popped-out / panel:returned for its panel
 * XWG12: a widget's content gets its window from injectPanelWindow(), and the app's popoutWrapper
 *        (what it provides) with that window; injectPanel() stays the owner's
 * XWG13: canPopOut on a workspace without popOut warns in development, once per widget
 * XWG14: data-ndd-popout-kind="widget" on its window's frame
 * ndd additions:
 * XWGN1: onMoved for a move into the window comes once its element is in the window
 * XWGN2: a widget's panel has no built-in "Open in new window" item (its own titleMenu decides)
 * XWGN3: the frame's icon is a plain icon without a titleMenu
 * XWGN4: a widget in its panel whose owner is out gets its owner's window (and wrapper)
 * XWGN5: the widget's own wrapper lives as long as its content
 * XWGN6: a widget already out of its panel pops out with its own panel, not a new one
 *
 * jsdom has no ResizeObserver, so `onMoved` comes from its two-frame fallback: tests wait.
 */
import { Component, ElementRef, InjectionToken, inject, input, signal } from '@angular/core';
import type { OnDestroy, OnInit, Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddContextMenu } from '../../src/lib/context-menu/context-menu';
import { NddPanelOverlay, injectFloatingWidgets } from '../../src/lib/panel-overlay/panel-overlay';
import type { FloatingWidgetsApi } from '../../src/lib/panel-overlay/panel-overlay';
import type { ManagedWidget, WidgetMenuContext, WidgetTarget } from '../../src/lib/panel-overlay/overlay-store';
import { injectWidget } from '../../src/lib/panel-overlay/widget-handle';
import type { WidgetHandle } from '../../src/lib/panel-overlay/widget-handle';
import { injectPanelWindow } from '../../src/lib/panel/panel-window';
import { injectPanel } from '../../src/lib/panel/panel-ref';
import type { PopOutResult } from '../../src/lib/core/types';

type AnyWindow = Window & typeof globalThis;
const iframes: HTMLIFrameElement[] = [];

interface Popup {
  win: AnyWindow;
  doc: Document;
  closeByUser(silent?: boolean): void;
  closed(): boolean;
}
function popup(): Popup {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  iframes.push(frame);
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
    closed: () => closed,
    closeByUser(silent = false) {
      closed = true;
      if (!silent) win.dispatchEvent(new win.Event('pagehide'));
    },
  };
}
const stubOpen = (p: Popup | null) => vi.spyOn(window, 'open').mockImplementation(() => (p ? p.win : null));

let api: FloatingWidgetsApi | null = null;
let widget: WidgetHandle | null = null;
let menuSeen: WidgetMenuContext | null = null;
const mounts = vi.fn();
const calls: string[] = [];
let docSeen: () => Document | null = () => null;
let providedSeen: () => Document | null = () => null;
let ownerSeen: () => string | null = () => null;
const sizes: string[] = [];

/** What the app's wrapper provides: the document it was given, as a CSS-in-JS cache provider would. */
const WRAPPER_DOC = new InjectionToken<Signal<Document>>('wg-wrapper-doc');

/** The app's popoutWrapper. */
@Component({
  selector: 'ndd-test-wg-wrapper',
  template: '<ng-content />',
  providers: [{ provide: WRAPPER_DOC, useFactory: () => inject(WgWrapper).document }],
})
class WgWrapper implements OnInit, OnDestroy {
  readonly window = input.required<Window>();
  readonly document = input.required<Document>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  ngOnInit(): void {
    // The one around a widget's content is placed nowhere (the frame's, menus' and panels' are).
    if (!this.host.isConnected) widgetWrappers.push(this);
  }
  ngOnDestroy(): void {
    destroyedWrappers.add(this);
  }
}
const widgetWrappers: WgWrapper[] = [];
const destroyedWrappers = new Set<WgWrapper>();

/** Widget content with state; records creations, its handle, its callbacks and its window. */
@Component({
  selector: 'ndd-test-wg-table',
  template: `<button class="wg-count" type="button" (click)="n.set(n() + 1)">{{ n() }}</button>`,
})
class Table implements OnInit {
  protected readonly n = signal(0);
  private readonly pw = injectPanelWindow();
  private readonly provided = inject(WRAPPER_DOC, { optional: true });
  private readonly panel = injectPanel();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  constructor() {
    const w = injectWidget();
    widget = w;
    docSeen = () => this.pw().document;
    providedSeen = () => this.provided?.() ?? null;
    ownerSeen = () => this.panel.id;
    w?.onWillMove(() => calls.push('will'));
    w?.onMoved(() => {
      calls.push('moved');
      sizes.push(this.host.ownerDocument === document ? 'page' : 'window');
    });
  }
  ngOnInit(): void {
    mounts();
  }
}

@Component({ selector: 'ndd-test-wg-grab', template: '' })
class Grab {
  constructor() {
    api = injectFloatingWidgets();
  }
}

@Component({
  selector: 'ndd-test-wg-owner',
  imports: [NddPanelOverlay, Grab],
  template: `<ndd-panel-overlay><ndd-test-wg-grab /></ndd-panel-overlay>`,
})
class Owner {}

@Component({
  selector: 'ndd-test-wg-shell',
  imports: [NddDesktop, NddContextMenu],
  template: `<ndd-desktop [popoutWrapper]="wrapper" /><ndd-context-menu />`,
})
class Shell {
  protected readonly wrapper = WgWrapper;
}

const table: ManagedWidget = {
  title: 'Table',
  component: Table,
  anchor: 'bottom-left',
  width: 240,
  height: 160,
  canPopOut: true,
  canDock: true,
  canFloat: true,
  titleMenu: w => {
    menuSeen = w;
    return [
      {
        label: 'Pop it',
        action: () => {
          w.popOut();
        },
      },
    ];
  },
};

let fixture: ComponentFixture<unknown> | null = null;
const settle = async () => {
  await fixture!.whenStable();
  await fixture!.whenStable();
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/** onMoved's fallback is two frames, after the window's panel:popped-out for a move into it. */
const frames = async () => {
  await wait(150);
  await settle();
};

async function setup(opts: { popOut?: boolean; config?: Partial<ManagedWidget>; lazy?: boolean } = {}): Promise<Workspace> {
  const ws = createWorkspace({
    popOut: opts.popOut ?? true,
    panels: { map: { component: Owner }, lazy: { component: Owner, defaultOptions: { keepAlive: false } } },
  }) as unknown as Workspace;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  fixture = TestBed.createComponent(Shell) as ComponentFixture<unknown>;
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await settle();
  ws.openPanel('map', opts.lazy ? 'lazy' : 'map', { title: 'Map' });
  await settle();
  api!.open('table', { ...table, ...opts.config });
  await settle();
  calls.length = 0;
  sizes.length = 0;
  mounts.mockClear();
  return ws;
}
const teardown = () => {
  fixture?.destroy();
  fixture = null;
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
};

const content = (doc: Document = document) => doc.querySelector<HTMLElement>('.ndd-panel-float__content');
const count = (doc: Document = document) => doc.querySelector('.wg-count')?.textContent?.trim();
const frameIn = () => document.querySelector<HTMLElement>('[data-ndd-widget="table"]');
const popOut = async (): Promise<PopOutResult> => {
  const r = api!.popOut('table');
  await settle();
  return r;
};
const go = async (to: WidgetTarget) => {
  const r = api!.move('table', to);
  await settle();
  return r;
};
const HOSTED = 'map/table';
const item = (label: string, doc: Document = document) => doc.querySelector<HTMLElement>(`[data-ndd-menu-item="${label}"]`);
const click = async (el: HTMLElement) => {
  el.click();
  await settle();
};

afterEach(() => {
  fixture?.destroy();
  fixture = null;
  iframes.splice(0).forEach(f => f.remove());
  api = null;
  widget = null;
  menuSeen = null;
  docSeen = () => null;
  providedSeen = () => null;
  ownerSeen = () => null;
  calls.length = 0;
  sizes.length = 0;
  widgetWrappers.length = 0;
  destroyedWrappers.clear();
  mounts.mockClear();
  vi.restoreAllMocks();
  delete (navigator as unknown as { userActivation?: unknown }).userActivation;
  document.body.innerHTML = '';
});

describe('XWG1: refusals', () => {
  const stays = (ws: Workspace) => {
    expect(api!.location('table')).toBe('panel');
    expect(ws.state().panels[HOSTED]).toBeUndefined();
    expect(calls).toEqual([]);
  };

  it('disabled: the workspace has no popOut, with one development warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = await setup({ popOut: false });
    const open = stubOpen(popup());
    expect(await popOut()).toEqual({ ok: false, reason: 'disabled' });
    expect(open).not.toHaveBeenCalled();
    expect(warn.mock.calls.some(c => String(c[0]).includes('was refused'))).toBe(true);
    stays(ws);
  });

  it("disabled comes first, before the widget's own rules", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setup({ popOut: false, config: { canPopOut: false } });
    expect(await popOut()).toEqual({ ok: false, reason: 'disabled' });
  });

  it('not-open', async () => {
    await setup();
    expect(api!.popOut('nope')).toEqual({ ok: false, reason: 'not-open' });
  });

  it('not-allowed: no canPopOut, and an owner whose type unmounts while hidden', async () => {
    const ws = await setup({ config: { canPopOut: false } });
    const open = stubOpen(popup());
    expect(await popOut()).toEqual({ ok: false, reason: 'not-allowed' });
    stays(ws);
    teardown();
    const lazy = await setup({ lazy: true });
    expect(await popOut()).toEqual({ ok: false, reason: 'not-allowed' });
    expect(open).not.toHaveBeenCalled();
    stays(lazy);
  });

  it('no-gesture', async () => {
    const ws = await setup();
    const open = stubOpen(popup());
    Object.defineProperty(navigator, 'userActivation', { value: { isActive: false }, configurable: true });
    expect(await popOut()).toEqual({ ok: false, reason: 'no-gesture' });
    expect(open).not.toHaveBeenCalled();
    stays(ws);
  });

  it('blocked, and no-window: nothing changed', async () => {
    const ws = await setup();
    stubOpen(null);
    expect(await popOut()).toEqual({ ok: false, reason: 'blocked' });
    stays(ws);
    const p = popup();
    p.closeByUser(true);
    vi.restoreAllMocks();
    stubOpen(p);
    expect(await popOut()).toEqual({ ok: false, reason: 'no-window' });
    stays(ws);
  });
});

describe('XWG2: from the panel', () => {
  it('leaves the panel into the window in one step: the same element, its state, its panel id', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    const el = content()!;
    await click(el.querySelector<HTMLElement>('.wg-count')!);
    mounts.mockClear();
    expect(await popOut()).toEqual({ ok: true });
    expect(content(p.doc)).toBe(el);
    expect(count(p.doc)).toBe('1');
    expect(mounts).not.toHaveBeenCalled();
    expect(api!.location('table')).toBe('floating');
    expect(widget!.isPoppedOut()).toBe(true);
    expect(widget!.panelId()).toBe(HOSTED);
    expect(widget!.location()).toBe('floating');
    expect(ws.state().panels[HOSTED]).toMatchObject({ state: 'floating', poppedOut: true, owner: { panelId: 'map', widgetId: 'table' } });
    expect(frameIn()).toBeNull(); // no frame in the panel
  });
});

describe("XWG2b: the window's place", () => {
  it("opens over the widget's frame in the panel, at its size", async () => {
    await setup();
    const open = stubOpen(popup());
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isFrame = this.getAttribute('data-ndd-widget') === 'table';
      const w = isFrame ? 400 : 0;
      const hh = isFrame ? 300 : 0;
      return { left: 50, top: 60, right: 50 + w, bottom: 60 + hh, width: w, height: hh, x: 50, y: 60, toJSON() {} } as DOMRect;
    });
    await popOut();
    expect(String(open.mock.calls[0]![2])).toMatch(/width=400,height=300/);
  });
});

describe('XWG3: from each place out of the panel', () => {
  const places: [string, () => void][] = [
    ['docked', () => api!.move('table', { to: 'docked', position: 'bottom' })],
    ['tabbed', () => api!.move('table', { to: 'tabbed' })],
    ['floating', () => api!.move('table', { to: 'floating', rect: { x: 10, y: 10, width: 200, height: 100 } })],
    ['minimized', () => api!.move('table', { to: 'floating' })],
  ];
  for (const [where, move] of places) {
    it(`${where}: its panel pops out, the same element`, async () => {
      const ws = await setup();
      const p = popup();
      stubOpen(p);
      move();
      await settle();
      if (where === 'minimized') {
        ws.minimizePanel(HOSTED);
        await settle();
      }
      expect(api!.location('table')).toBe(where);
      const el = content()!;
      expect(await popOut()).toEqual({ ok: true });
      expect(content(p.doc)).toBe(el);
      expect(api!.location('table')).toBe('floating');
      expect(widget!.isPoppedOut()).toBe(true);
      expect(widget!.panelId()).toBe(HOSTED);
    });
  }
});

describe('XWG4: callbacks', () => {
  it('one pair around the pop-out from the panel, and one around the window closing', async () => {
    await setup();
    const p = popup();
    stubOpen(p);
    await popOut();
    await frames();
    expect(calls).toEqual(['will', 'moved']);
    calls.length = 0;
    p.closeByUser();
    await settle();
    await frames();
    expect(calls).toEqual(['will', 'moved']);
  });

  it('one pair around a pop-out from floating (same location, another container)', async () => {
    await setup();
    stubOpen(popup());
    await go({ to: 'floating' });
    await frames();
    calls.length = 0;
    await popOut();
    await frames();
    expect(calls).toEqual(['will', 'moved']);
  });

  it('one pair around a pop-out from docked and the window closing (it comes back docked for a moment)', async () => {
    await setup();
    const p = popup();
    stubOpen(p);
    await go({ to: 'docked', position: 'bottom' });
    await frames();
    calls.length = 0;
    await popOut();
    await frames();
    expect(calls).toEqual(['will', 'moved']);
    calls.length = 0;
    p.closeByUser();
    await settle();
    await frames();
    expect(calls).toEqual(['will', 'moved']);
    expect(api!.location('table')).toBe('panel');
  });

  it('none for a refusal', async () => {
    await setup();
    stubOpen(null);
    await popOut();
    await frames();
    expect(calls).toEqual([]);
  });
});

describe('XWG5: closing the window sends it back into its panel', () => {
  const ways: [string, (ws: Workspace, p: Popup) => void][] = [
    ['the window closing', (_ws, p) => p.closeByUser()],
    ['the frame\'s "Back into the panel"', (_ws, p) => p.doc.querySelector<HTMLButtonElement>('.ndd-popout-frame__return')!.click()],
    ['returnPanel on its panel id', ws => ws.returnPanel(HOSTED)],
  ];
  for (const [name, close] of ways) {
    it(`${name}: back in the panel, where it was, the same element and state`, async () => {
      const ws = await setup();
      const p = popup();
      stubOpen(p);
      const el = content()!;
      await click(el.querySelector<HTMLElement>('.wg-count')!);
      const before = frameIn()!.getAttribute('style');
      await popOut();
      if (name.includes('Back')) expect(p.doc.querySelector('.ndd-popout-frame__return')!.getAttribute('aria-label')).toBe('Back into the panel');
      close(ws, p);
      await settle();
      expect(api!.location('table')).toBe('panel');
      expect(ws.state().panels[HOSTED]).toBeUndefined();
      expect(content()).toBe(el);
      expect(count()).toBe('1');
      expect(p.closed()).toBe(true);
      expect(frameIn()).not.toBeNull();
      expect(frameIn()!.getAttribute('style')).toBe(before); // its old place in the panel
    });
  }
});

describe('XWG6: move() from the window', () => {
  const targets: [string, WidgetTarget, string][] = [
    ['the panel', { to: 'panel' }, 'panel'],
    ['docked', { to: 'docked', position: 'right' }, 'docked'],
    ['tabbed', { to: 'tabbed' }, 'tabbed'],
    ['floating', { to: 'floating', rect: { x: 20, y: 20, width: 220, height: 140 } }, 'floating'],
  ];
  for (const [name, to, where] of targets) {
    it(`to ${name}: the window closes and it moves, as one move with one pair`, async () => {
      const ws = await setup();
      const p = popup();
      stubOpen(p);
      const el = content()!;
      await popOut();
      await frames();
      calls.length = 0;
      expect(await go(to)).toEqual({ ok: true });
      await frames();
      expect(api!.location('table')).toBe(where);
      expect(widget!.isPoppedOut()).toBe(false);
      expect(p.closed()).toBe(true);
      expect(content()).toBe(el);
      expect(calls).toEqual(['will', 'moved']);
      if (where !== 'panel') expect(ws.state().panels[HOSTED]!.poppedOut).toBeUndefined();
    });
  }
});

describe('XWG7: workspace calls on its panel id', () => {
  it("popOutPanel(hostedId) goes through the widget's rules; returnPanel(hostedId) is the window closing", async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await go({ to: 'docked', position: 'bottom' });
    expect(ws.popOutPanel(HOSTED)).toEqual({ ok: true });
    await settle();
    expect(widget!.isPoppedOut()).toBe(true);
    ws.returnPanel(HOSTED);
    await settle();
    expect(api!.location('table')).toBe('panel');
    // Its rules: without canPopOut, the workspace call is refused too.
    api!.open('table', { ...table, canPopOut: false });
    await go({ to: 'floating' });
    expect(ws.popOutPanel(HOSTED)).toEqual({ ok: false, reason: 'not-allowed' });
  });
});

describe('XWG8: placement() while out', () => {
  it('reopens it floating, at its rect before the window', async () => {
    const ws = await setup();
    stubOpen(popup());
    await go({ to: 'floating', rect: { x: 30, y: 40, width: 250, height: 150 } });
    await popOut();
    const saved = api!.placement('table')!;
    expect(saved).toMatchObject({ v: 1, at: 'floating', rect: { x: 30, y: 40, width: 250, height: 150 } });
    ws.returnPanel(HOSTED);
    await settle();
    api!.close('table');
    await settle();
    api!.open('table', { ...table, placement: saved });
    await settle();
    expect(api!.location('table')).toBe('floating');
    expect(ws.state().floating.find(w => w.id === HOSTED)).toMatchObject({ x: 30, y: 40, width: 250, height: 150 });
    expect(ws.state().panels[HOSTED]!.poppedOut).toBeUndefined();
  });
});

describe('XWG9: ownership', () => {
  it('the owner closing closes the window and the widget', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut();
    ws.closePanel('map');
    await settle();
    expect(p.closed()).toBe(true);
    expect(ws.state().panels[HOSTED]).toBeUndefined();
    expect(p.doc.querySelector('.ndd-popout-frame')).toBeNull();
  });

  it('the owner minimised: the widget stays in its window', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut();
    ws.minimizePanel('map');
    await settle();
    expect(p.closed()).toBe(false);
    expect(widget!.isPoppedOut()).toBe(true);
    expect(content(p.doc)).not.toBeNull();
  });
});

describe('XWG9b: moved from code while out', () => {
  it('minimising its panel from code minimises it (it is not sent into its panel)', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    await popOut();
    ws.minimizePanel(HOSTED);
    await settle();
    expect(p.closed()).toBe(true);
    expect(api!.location('table')).toBe('minimized');
  });
});

describe('XWG10: the menu', () => {
  it("the context says canPopOut and isPoppedOut, and popOut() works; the frame's icon opens the menu in the window", async () => {
    await setup();
    const p = popup();
    stubOpen(p);
    await go({ to: 'floating' });
    await click(document.querySelector<HTMLElement>('[data-ndd-window="map/table"] .ndd-btn-more-actions')!);
    expect(menuSeen).toMatchObject({ canPopOut: true, isPoppedOut: false, location: 'floating' });
    await click(item('Pop it')!);
    expect(widget!.isPoppedOut()).toBe(true);
    menuSeen = null;
    const icon = p.doc.querySelector<HTMLButtonElement>('.ndd-popout-frame__icon--menu')!;
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('aria-haspopup')).toBe('menu');
    // The widget has no icon (nor the desktop a default one): the menu glyph, so there is something to click.
    expect(icon.querySelector('svg')).not.toBeNull();
    await click(icon);
    expect(menuSeen).toMatchObject({ isPoppedOut: true, location: 'floating' });
    expect(p.doc.querySelector('[data-ndd-menu]')).not.toBeNull();
  });

  it("the icon's click and press stop there: they reach neither the window (which dismisses a menu) nor the frame", async () => {
    await setup();
    const p = popup();
    stubOpen(p);
    await popOut();
    const icon = p.doc.querySelector<HTMLButtonElement>('.ndd-popout-frame__icon--menu')!;
    const reached: string[] = [];
    p.win.addEventListener('click', () => reached.push('click'));
    p.doc.addEventListener('pointerdown', () => reached.push('pointerdown'));
    icon.dispatchEvent(new p.win.MouseEvent('pointerdown', { bubbles: true }));
    icon.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, detail: 1, clientX: 5, clientY: 5 }));
    await settle();
    expect(reached).toEqual([]);
    expect(p.doc.querySelector('[data-ndd-menu]')).not.toBeNull();
  });

  it('from the keyboard (a click with detail 0) it opens in the window, below the icon, on its first item', async () => {
    await setup();
    const p = popup();
    stubOpen(p);
    await popOut();
    const icon = p.doc.querySelector<HTMLButtonElement>('.ndd-popout-frame__icon--menu')!;
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue({ left: 12, top: 4, right: 28, bottom: 20, width: 16, height: 16, x: 12, y: 4, toJSON() {} } as DOMRect);
    icon.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, detail: 0 }));
    await settle();
    const menu = p.doc.querySelector<HTMLElement>('[data-ndd-menu]');
    expect(menu).not.toBeNull();
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
    expect(menu!.style.left).toBe('12px');
    expect(menu!.style.top).toBe('20px');
    expect(p.doc.activeElement).toBe(item('Pop it', p.doc));
  });

  it('canPopOut is false without the opt-in, or with popOut off', async () => {
    await setup({ config: { canPopOut: false } });
    await go({ to: 'floating' });
    await click(document.querySelector<HTMLElement>('[data-ndd-window="map/table"] .ndd-btn-more-actions')!);
    expect(menuSeen).toMatchObject({ canPopOut: false });
    teardown();
    menuSeen = null;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setup({ popOut: false });
    await go({ to: 'floating' });
    await click(document.querySelector<HTMLElement>('[data-ndd-window="map/table"] .ndd-btn-more-actions')!);
    expect(menuSeen).toMatchObject({ canPopOut: false });
  });
});

describe('XWG11: events for its panel', () => {
  it('panel:popped-out and panel:returned, once each, once laid out', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    const out = vi.fn();
    const back = vi.fn();
    ws.subscribe('panel:popped-out', out);
    ws.subscribe('panel:returned', back);
    await popOut();
    await frames();
    expect(out).toHaveBeenCalledTimes(1);
    expect(out).toHaveBeenCalledWith({ id: HOSTED, window: p.win });
    p.closeByUser();
    await settle();
    await frames();
    expect(back).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledWith({ id: HOSTED });
  });
});

describe("XWG12: the widget's window", () => {
  it("injectPanelWindow() and the app's popoutWrapper give the widget's window, and the page's again", async () => {
    await setup();
    const p = popup();
    stubOpen(p);
    expect(docSeen()).toBe(document);
    expect(providedSeen()).toBe(document);
    expect(ownerSeen()).toBe('map');
    await popOut();
    expect(docSeen()).toBe(p.doc);
    expect(providedSeen()).toBe(p.doc);
    expect(ownerSeen()).toBe('map'); // injectPanel() is still the owner's
    p.closeByUser();
    await settle();
    expect(docSeen()).toBe(document);
    expect(providedSeen()).toBe(document);
  });
});

describe('XWG13: canPopOut without popOut', () => {
  it('warns in development, once per widget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setup({ popOut: false });
    api!.open('table', table);
    const mine = warn.mock.calls.filter(c => String(c[0]).includes('Widget "table" sets canPopOut'));
    expect(mine).toHaveLength(1);
  });
});

describe("XWG14: the window's kind", () => {
  it('data-ndd-popout-kind="widget" on its frame', async () => {
    await setup();
    const p = popup();
    stubOpen(p);
    await popOut();
    expect(p.doc.querySelector('.ndd-popout-frame')!.getAttribute('data-ndd-popout-kind')).toBe('widget');
  });
});

describe('ndd additions', () => {
  it('XWGN1: onMoved for a move into the window comes once its element is laid out there (after panel:popped-out)', async () => {
    const ws = await setup();
    const p = popup();
    stubOpen(p);
    ws.subscribe('panel:popped-out', () => calls.push('popped-out'));
    await popOut();
    await frames();
    expect(calls).toEqual(['will', 'popped-out', 'moved']);
    expect(sizes).toEqual(['window']);
    // From docked, too: its panel's own step into the window.
    calls.length = 0;
    sizes.length = 0;
    await go({ to: 'docked', position: 'bottom' });
    await frames();
    calls.length = 0;
    sizes.length = 0;
    const p2 = popup();
    vi.mocked(window.open).mockImplementation(() => p2.win);
    expect(await popOut()).toEqual({ ok: true });
    await frames();
    expect(calls).toEqual(['will', 'popped-out', 'moved']);
    expect(sizes).toEqual(['window']);
  });

  it('XWGN2: its panel has no built-in "Open in new window" item; its own titleMenu decides', async () => {
    await setup();
    await go({ to: 'floating' });
    await click(document.querySelector<HTMLElement>('[data-ndd-window="map/table"] .ndd-btn-more-actions')!);
    expect(item('Open in new window')).toBeNull();
    expect(item('Pop it')).not.toBeNull();
  });

  it("XWGN4: a widget in its panel whose owner is out gets its owner's window", async () => {
    // An owner type that may pop out itself.
    const ws2 = createWorkspace({ popOut: true, panels: { map: { component: Owner, defaultOptions: { canPopOut: true } } } }) as unknown as Workspace;
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws2)] });
    fixture = TestBed.createComponent(Shell) as ComponentFixture<unknown>;
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    await settle();
    ws2.openPanel('map', 'map', { title: 'Map' });
    await settle();
    api!.open('table', table);
    await settle();
    const p = popup();
    stubOpen(p);
    expect(ws2.popOutPanel('map')).toEqual({ ok: true });
    await settle();
    expect(content(p.doc)).not.toBeNull();
    expect(docSeen()).toBe(p.doc);
    expect(providedSeen()).toBe(p.doc);
  });

  it("XWGN5: the widget's own wrapper lives as long as its content: closing the widget destroys it", async () => {
    await setup();
    expect(widgetWrappers).toHaveLength(1);
    const mine = widgetWrappers[0]!;
    expect(destroyedWrappers.has(mine)).toBe(false);
    api!.close('table');
    await settle();
    expect(destroyedWrappers.has(mine)).toBe(true);
  });

  it('XWGN6: out of the panel already, its own panel pops out as it is: not closed and opened again', async () => {
    const ws = await setup();
    stubOpen(popup());
    await go({ to: 'docked', position: 'bottom' });
    const closed = vi.fn();
    ws.subscribe('panel:closed', closed);
    expect(await popOut()).toEqual({ ok: true });
    expect(closed).not.toHaveBeenCalled();
    expect(widget!.isPoppedOut()).toBe(true);
  });

  it('XWGN3: without a titleMenu the frame shows a plain icon', async () => {
    await setup({ config: { titleMenu: undefined } });
    const p = popup();
    stubOpen(p);
    await popOut();
    expect(p.doc.querySelector('.ndd-popout-frame__icon--menu')).toBeNull();
    expect(p.doc.querySelector('span.ndd-popout-frame__icon')).not.toBeNull();
  });
});
