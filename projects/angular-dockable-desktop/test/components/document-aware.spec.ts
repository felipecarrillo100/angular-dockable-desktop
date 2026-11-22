/**
 * Document-aware internals (1.12.0, groundwork for pop-out windows). A port of vdd 1.14.0's
 * `test/components/documentAware.test.ts` (XDA1–XDA20), itself a port of rdd 7.12.1's
 * `DocumentAware.test.tsx` (DA1–DA18). Ids keep vdd's `X` prefix (`PO` is taken here).
 *
 * A panel's element can live in a same-origin child window while its code runs in the main
 * window's realm, so the library takes the document and window from the element it acts on. The
 * second window here is an `<iframe>`: jsdom gives it its own document, window and constructors,
 * as a real pop-out has (a `createHTMLDocument` document has no `defaultView`, so it cannot stand
 * in for a window).
 *
 * Angular creates its elements with the injected (main) `DOCUMENT`, and they are adopted into the
 * iframe's when inserted there — the component's host is moved into the iframe's body before its
 * first render, and a portal moves its element there — exactly as a pop-out will do: their
 * `ownerDocument` is the iframe's, their prototype the main realm's. So geometry stubs for rendered
 * chrome go on the main `HTMLElement.prototype`, and nodes made with `doc.createElement` stand for
 * the other realm's own.
 *
 * XDA1:  isNode / isElement / isHTMLElement accept a node of another window; instanceof does not
 * XDA2:  docOf / winOf: the node's own document and window; the main ones as the fallback
 * XDA3:  rafOf / cancelRafOf use the node's window's frames; the global ones for a main node
 * XDA4:  resizeObserverFor builds the observer from the node's window's constructor
 * XDA5:  registerDocument is counted, and listeners follow registrations (+ isRegistered,
 *        onDocumentsChange, focusedDocument, eventDocument)
 * XDA6:  a context menu opened from another document renders into its body and fits its window
 * XDA7:  Escape in a registered document closes the menu; in an unregistered one it does not;
 *        each document's Escape is its own
 * XDA8:  a pointerdown elsewhere in the menu's document closes it; one inside the menu does not
 * XDA9:  the context menu records its opener from its own document and hands focus back there
 * XDA10: menu arrow keys follow focus in the menu's own document
 * XDA11: panel focus is recorded and restored in the element's own document, on its window's frame
 * XDA11b: a managed widget's scroll offsets are recorded from scroll events there and put back
 * XDA12: a managed widget's drag and resize set and clear the body class on its own document
 * XDA13: the toolbar flyout portals into the button's document, fits that window, closes there
 * XDA14: isRtlElement asks the element's own window (+ ndd: the flyout reads its strip's
 *        direction there)
 * XDA15: moveIntoWhenConnected waits on the slot's window's frames
 * XDA16: click-to-activate works in a registered document (+ ndd: in the page it leaves the press
 *        to the elements)
 * XDA17: the panel search dropdown portals into the input's document and fits its window
 * XDA18: a panel toolbar measures itself with its own window's ResizeObserver
 * XDA19: a modal in the page does not answer an Escape pressed in another document
 * XDA20: a toast card's observer and entry frame come from its own window
 *
 * Changed shape from vdd: XDA9 closes the menu with Escape on the menu, not Tab (ndd's Tab closes
 * without handing focus back, as it did before 1.12.0); XDA14 tests `isRtlElement` in
 * `core/dom-context.ts` (ndd had no rtl helper: the toolbar read `getComputedStyle` inline);
 * XDA20 checks the toast's own frame runs its entry, not that the main window's rAF is never
 * called (Angular's zoneless scheduler uses the main window's frames itself).
 *
 * Not ported, as in vdd: DA6's "opened from the keyboard, sits at its target and takes its
 * direction" (ndd's menu opens where the caller says, with the workspace's `dir`); DA13's "hands
 * focus back to the button" (ndd's flyout does not move focus into itself); DA14's `isElementRtl`
 * fallback to the element's own document (there is no such helper).
 */
import { Component } from '@angular/core';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { cancelRafOf, docOf, isElement, isHTMLElement, isNode, isRtlElement, rafOf, resizeObserverFor, winOf } from '../../src/lib/core/dom-context';
import {
  eventDocument,
  focusedDocument,
  isRegistered,
  listenOnDocuments,
  onDocumentsChange,
  registerDocument,
} from '../../src/lib/core/document-registry';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { PanelDomCache } from '../../src/lib/panel/panel-dom';
import { WidgetContentCache } from '../../src/lib/panel-overlay/widget-content';
import { moveIntoWhenConnected, setPreserveEmbeds } from '../../src/lib/core/dom-move';
import { NddContextMenu } from '../../src/lib/context-menu/context-menu';
import type { ContextMenuItem } from '../../src/lib/core/context-menu';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddPanelOverlay, NddPanelToolbar } from '../../src/lib/panel-overlay/panel-overlay';
import { NddFloatingWidget } from '../../src/lib/panel-overlay/floating-widget';
import { NddToolbar } from '../../src/lib/toolbar/toolbar';
import type { ToolbarItem } from '../../src/lib/core/toolbar-types';
import { NddToolbarSearch } from '../../src/lib/panel-overlay/toolbar-search';
import { NddModals } from '../../src/lib/overlays/modals';
import { NddToastItem } from '../../src/lib/toast/toasts';
import type { ToastRecord } from '../../src/lib/toast/toast';

type AnyWindow = Window & typeof globalThis;

const frames: HTMLIFrameElement[] = [];
const cleanups: (() => void)[] = [];
let fixture: ComponentFixture<unknown> | null = null;

/** A second window: an iframe with its own document, window and DOM constructors. */
function otherWindow(): { win: AnyWindow; doc: Document } {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  return { win: frame.contentWindow as AnyWindow, doc: frame.contentDocument! };
}

/** A container in `doc`'s body. */
function hostIn(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  doc.body.appendChild(el);
  return el;
}

/**
 * Create `type` with a workspace behind it, its inputs set, and its host in `doc`'s body before its
 * first render (the main document's when `doc` is left out).
 */
async function render<T>(type: Type<T>, doc?: Document, inputs: Record<string, unknown> = {}, ws: Workspace = createWorkspace({ panels: {} })) {
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const f = TestBed.createComponent(type);
  fixture = f as ComponentFixture<unknown>;
  for (const [key, value] of Object.entries(inputs)) f.componentRef.setInput(key, value);
  if (doc) doc.body.appendChild(f.nativeElement as HTMLElement);
  await f.whenStable();
  return { ws, fixture: f, el: f.nativeElement as HTMLElement };
}
const settle = async () => {
  await fixture!.whenStable();
  await fixture!.whenStable();
};

afterEach(() => {
  fixture?.destroy();
  fixture = null;
  cleanups.splice(0).forEach(f => f());
  frames.splice(0).forEach(f => f.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
  document
    .querySelectorAll('.ndd-panel-store, .ndd-panel-mount, .ndd-widget-store, [data-ndd-menu], [data-ndd-submenu], [data-ndd-search-results], .ndd-toolbar-group-flyout')
    .forEach(el => el.remove());
  document.body.classList.remove('ndd-dragging-active', 'ndd-resizing-active');
});

/** jsdom lays nothing out: a 100x50 box wherever an element's inline left/top put it. */
function boxesFromStyle(proto: typeof HTMLElement.prototype, at: { left: number; top: number } = { left: 0, top: 0 }) {
  return vi.spyOn(proto, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const left = this.style.left ? parseFloat(this.style.left) : at.left;
    const top = this.style.top ? parseFloat(this.style.top) : at.top;
    return { left, top, right: left + 100, bottom: top + 50, width: 100, height: 50, x: left, y: top, toJSON() {} } as DOMRect;
  });
}

const sized = (win: AnyWindow, w: number, h: number) => {
  Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
};

const keydown = (win: AnyWindow, target: EventTarget, key: string) =>
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

/** A context menu host in the main document, and its workspace. */
const mountMenu = () => render(NddContextMenu);

const items: ContextMenuItem[] = [
  { label: 'One', action: () => {} },
  { label: 'Two', action: () => {} },
];

/** Opens the menu as an event from `target` would. */
async function openFrom(ws: Workspace, target: EventTarget, x = 10, y = 10, menuItems = items) {
  ws.showContextMenu({ event: { target, clientX: x, clientY: y, preventDefault() {} } as unknown as MouseEvent, items: menuItems });
  await settle();
}

describe('XDA1: node checks across windows', () => {
  it('accepts a node of another window, where instanceof does not', () => {
    const { doc } = otherWindow();
    const div = doc.createElement('div');
    expect(div instanceof HTMLElement).toBe(false);
    expect(div instanceof Element).toBe(false);
    expect(isNode(div)).toBe(true);
    expect(isElement(div)).toBe(true);
    expect(isHTMLElement(div)).toBe(true);
  });

  it('rejects what is not an element, or not an HTML one', () => {
    const { doc, win } = otherWindow();
    expect(isElement(doc.createTextNode('x'))).toBe(false);
    expect(isNode(doc.createTextNode('x'))).toBe(true);
    expect(isNode(win)).toBe(false);
    expect(isNode(null)).toBe(false);
    expect(isElement({ nodeType: 1 })).toBe(false);
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(isElement(svg)).toBe(true);
    expect(isHTMLElement(svg)).toBe(false);
  });
});

describe('XDA2: docOf / winOf', () => {
  it("gives the node's own document and window", () => {
    const { doc, win } = otherWindow();
    const div = doc.createElement('div');
    expect(docOf(div)).toBe(doc);
    expect(docOf(doc)).toBe(doc);
    expect(winOf(div)).toBe(win);
    expect(winOf(div)).not.toBe(window);
  });

  it('falls back to the main document and window', () => {
    expect(docOf(null)).toBe(document);
    expect(winOf(undefined)).toBe(window);
    // A document with no window of its own (createHTMLDocument) is shown in none: the main one.
    const loose = document.implementation.createHTMLDocument('x');
    expect(docOf(loose.body)).toBe(loose);
    expect(winOf(loose.body)).toBe(window);
  });
});

describe('XDA3: rafOf / cancelRafOf', () => {
  it("uses the node's window's frames", () => {
    const { doc, win } = otherWindow();
    const own = vi.spyOn(win, 'requestAnimationFrame').mockReturnValue(7);
    const ownCancel = vi.spyOn(win, 'cancelAnimationFrame').mockImplementation(() => {});
    const main = vi.spyOn(window, 'requestAnimationFrame');
    const el = doc.createElement('div');
    const cb = () => {};
    expect(rafOf(el)!(cb)).toBe(7);
    expect(own).toHaveBeenCalledWith(cb);
    expect(main).not.toHaveBeenCalled();
    cancelRafOf(el)(7);
    expect(ownCancel).toHaveBeenCalledWith(7);
  });

  it('uses the global ones for a node of the main window', () => {
    const main = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(3);
    const mainCancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    expect(rafOf(document.body)!(() => {})).toBe(3);
    expect(main).toHaveBeenCalledTimes(1);
    cancelRafOf(document.body)(3);
    expect(mainCancel).toHaveBeenCalledWith(3);
  });
});

/** jsdom has no ResizeObserver: a main-window one, for the duration of a test. */
function mainObserver(): typeof ResizeObserver {
  const original = globalThis.ResizeObserver;
  class MainObserver {
    constructor(_cb: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = MainObserver as unknown as typeof ResizeObserver;
  cleanups.push(() => {
    globalThis.ResizeObserver = original;
  });
  return MainObserver as unknown as typeof ResizeObserver;
}

/** An observer class for `win` that records what it observes. */
function ownObserver(win: AnyWindow) {
  const observed: Element[] = [];
  const built: ResizeObserverCallback[] = [];
  class OwnObserver {
    constructor(cb: ResizeObserverCallback) {
      built.push(cb);
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect() {}
  }
  (win as unknown as { ResizeObserver: unknown }).ResizeObserver = OwnObserver;
  return { OwnObserver, observed, built };
}

describe('XDA4: resizeObserverFor', () => {
  it("builds the observer from the node's window's constructor", () => {
    const Main = mainObserver();
    const { doc, win } = otherWindow();
    const { OwnObserver, built } = ownObserver(win);
    const cb: ResizeObserverCallback = () => {};
    const ro = resizeObserverFor(doc.createElement('div'), cb);
    expect(ro).toBeInstanceOf(OwnObserver);
    expect(built).toEqual([cb]);
    // A main-window node keeps the global one.
    expect(resizeObserverFor(document.body, cb)).toBeInstanceOf(Main);
  });

  it("falls back to the main window's when the node's window has none", () => {
    const Main = mainObserver();
    const { doc, win } = otherWindow();
    (win as unknown as { ResizeObserver: unknown }).ResizeObserver = undefined;
    expect(resizeObserverFor(doc.createElement('div'), () => {})).toBeInstanceOf(Main);
  });
});

describe('XDA5: registerDocument', () => {
  it('is counted, and a listener follows registrations', () => {
    const { doc, win } = otherWindow();
    const add = vi.spyOn(doc, 'addEventListener');
    const remove = vi.spyOn(doc, 'removeEventListener');
    const seen: Event[] = [];
    const stop = listenOnDocuments('keydown', e => seen.push(e));
    const press = () => keydown(win, doc.body, 'a');

    press();
    expect(seen).toHaveLength(0); // not registered yet
    const first = registerDocument(doc);
    const second = registerDocument(doc);
    expect(add).toHaveBeenCalledTimes(1); // attached once, on the first registration
    press();
    expect(seen).toHaveLength(1);
    first();
    first(); // undoing one registration twice does nothing
    expect(remove).not.toHaveBeenCalled();
    press();
    expect(seen).toHaveLength(2);
    second();
    expect(remove).toHaveBeenCalledTimes(1);
    press();
    expect(seen).toHaveLength(2);

    // A listener added while a document is registered reaches it; stopping removes it.
    const again = registerDocument(doc);
    const late: Event[] = [];
    const stopLate = listenOnDocuments('keydown', e => late.push(e));
    press();
    expect(late).toHaveLength(1);
    stopLate();
    press();
    expect(late).toHaveLength(1);
    again();
    stop();
  });

  it('registering the main document changes nothing', () => {
    const seen: Event[] = [];
    const stop = listenOnDocuments('keydown', e => seen.push(e));
    const undo = registerDocument(document);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    undo();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(seen).toHaveLength(2); // still listened on after the undo
    stop();
  });

  it('tells who is registered, who joins and leaves, and which document has focus', () => {
    const { doc } = otherWindow();
    const changes = vi.fn();
    const stop = onDocumentsChange(changes);
    expect(isRegistered(document)).toBe(true);
    expect(isRegistered(doc)).toBe(false);
    const first = registerDocument(doc);
    const second = registerDocument(doc);
    expect(isRegistered(doc)).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1); // joined once
    vi.spyOn(doc, 'hasFocus').mockReturnValue(false);
    expect(focusedDocument()).toBe(document);
    vi.spyOn(doc, 'hasFocus').mockReturnValue(true);
    expect(focusedDocument()).toBe(doc);
    first();
    expect(changes).toHaveBeenCalledTimes(1);
    second();
    expect(changes).toHaveBeenCalledTimes(2); // left once, on the last undo
    expect(isRegistered(doc)).toBe(false);
    expect(focusedDocument()).toBe(document);
    stop();
    registerDocument(doc)();
    expect(changes).toHaveBeenCalledTimes(2); // stopped
  });

  it('eventDocument names the document a listener fired on', () => {
    const { doc, win } = otherWindow();
    cleanups.push(registerDocument(doc));
    const seen: (Document | null)[] = [];
    const stop = listenOnDocuments('keydown', e => seen.push(eventDocument(e)));
    keydown(win, doc.body, 'a');
    keydown(window, document.body, 'a');
    stop();
    expect(seen).toEqual([doc, document]);
    // An event that is not being dispatched has no current target: the main document.
    expect(eventDocument(new win.Event('x'))).toBe(document);
  });
});

describe('XDA6: a context menu opened from another document', () => {
  it('renders into that body and fits that window', async () => {
    const { doc, win } = otherWindow();
    const anchor = hostIn(doc);
    sized(win, 300, 200);
    boxesFromStyle(HTMLElement.prototype, { left: 20, top: 20 });
    const { ws } = await mountMenu();
    await openFrom(ws, anchor, 280, 10);
    const menu = doc.body.querySelector<HTMLElement>('.ndd-context-menu');
    expect(menu).not.toBeNull();
    expect(document.body.querySelector('.ndd-context-menu')).toBeNull();
    // Clamped to the other window's 300px (the main one is 1024 wide): 300 - 100 - 8.
    expect(menu!.style.left).toBe('192px');
  });

  it('opens its submenu there', async () => {
    const { doc, win } = otherWindow();
    sized(win, 300, 200);
    const { ws } = await mountMenu();
    await openFrom(ws, doc.body, 10, 10, [{ label: 'More', items: [{ label: 'Inner', action: () => {} }] }]);
    const parent = doc.body.querySelector<HTMLElement>('[data-ndd-menu] [aria-haspopup]')!;
    parent.focus();
    keydown(win, parent, 'ArrowRight');
    await settle();
    expect(doc.body.querySelector('[data-ndd-submenu]')).not.toBeNull();
    expect(document.body.querySelector('[data-ndd-submenu]')).toBeNull();
  });

  it("under RTL, places its submenu from that window's width", async () => {
    const { doc, win } = otherWindow();
    sized(win, 300, 200);
    boxesFromStyle(HTMLElement.prototype, { left: 20, top: 20 });
    const ws = createWorkspace({ panels: {} });
    ws.setDirection('rtl');
    await render(NddContextMenu, undefined, {}, ws);
    await openFrom(ws, doc.body, 10, 10, [{ label: 'More', items: [{ label: 'Inner', action: () => {} }] }]);
    const parent = doc.body.querySelector<HTMLElement>('[data-ndd-menu] [aria-haspopup]')!;
    parent.focus();
    keydown(win, parent, 'ArrowLeft');
    await settle();
    // Leftwards from the parent item's left edge (20), measured in that window: 300 - 20 + 2.
    expect(doc.body.querySelector<HTMLElement>('[data-ndd-submenu]')!.style.right).toBe('282px');
  });

  it('stays on the main body when opened from the main document', async () => {
    const { ws } = await mountMenu();
    await openFrom(ws, document.body);
    expect(document.body.querySelector('.ndd-context-menu')).not.toBeNull();
  });
});

describe('XDA7: Escape in another document', () => {
  it('closes the menu when that document is registered', async () => {
    const { doc, win } = otherWindow();
    const { ws } = await mountMenu();
    await openFrom(ws, doc.body);
    keydown(win, doc.body, 'Escape');
    await settle();
    expect(doc.body.querySelector('.ndd-context-menu')).not.toBeNull(); // not registered: unheard

    cleanups.push(registerDocument(doc));
    keydown(win, doc.body, 'Escape');
    await settle();
    expect(doc.body.querySelector('.ndd-context-menu')).toBeNull();
  });

  it("is that document's own: an Escape in the page leaves a menu there open", async () => {
    const { doc } = otherWindow();
    cleanups.push(registerDocument(doc));
    const { ws } = await mountMenu();
    await openFrom(ws, doc.body);
    keydown(window, document.body, 'Escape');
    await settle();
    expect(doc.body.querySelector('.ndd-context-menu')).not.toBeNull();
  });

  it("and the page's menu stays through an Escape in the other document", async () => {
    const { doc, win } = otherWindow();
    cleanups.push(registerDocument(doc));
    const { ws } = await mountMenu();
    await openFrom(ws, document.body);
    keydown(win, doc.body, 'Escape');
    await settle();
    expect(document.body.querySelector('.ndd-context-menu')).not.toBeNull();
    keydown(window, document.body, 'Escape');
    await settle();
    expect(document.body.querySelector('.ndd-context-menu')).toBeNull();
  });
});

describe('XDA8: outside clicks in the menu document', () => {
  it('a pointerdown elsewhere there closes it; one inside does not', async () => {
    const { doc, win } = otherWindow();
    const { ws } = await mountMenu();
    const elsewhere = hostIn(doc);
    await openFrom(ws, elsewhere);
    const menu = doc.body.querySelector('.ndd-context-menu')!;
    menu.querySelector('button')!.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await settle();
    expect(doc.body.querySelector('.ndd-context-menu')).not.toBeNull();
    // A node of that window's own realm inside the menu is inside too (no instanceof check).
    const own = doc.createElement('span');
    menu.querySelector('button')!.appendChild(own);
    own.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await settle();
    expect(doc.body.querySelector('.ndd-context-menu')).not.toBeNull();
    elsewhere.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await settle();
    expect(doc.body.querySelector('.ndd-context-menu')).toBeNull();
  });

  it("a click on that window closes it too (the canvas case), and the page's still does", async () => {
    const { doc, win } = otherWindow();
    const { ws } = await mountMenu();
    await openFrom(ws, doc.body);
    win.dispatchEvent(new win.MouseEvent('click'));
    await settle();
    expect(doc.body.querySelector('.ndd-context-menu')).toBeNull();

    await openFrom(ws, doc.body);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(doc.body.querySelector('.ndd-context-menu')).toBeNull();
  });
});

describe('XDA9: the opener in another document', () => {
  it('gets focus back when the menu closes from inside', async () => {
    const { doc, win } = otherWindow();
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    opener.focus();
    expect(doc.activeElement).toBe(opener);
    // The main document's own focus does not name it (it reports the frame, or its body): only the
    // opener's document can. (jsdom moves an iframe's focus out when the page focuses a node of
    // its own, so the page cannot hold a focus of its own here as it can in a browser.)
    expect(document.activeElement).not.toBe(opener);

    const { ws } = await mountMenu();
    await openFrom(ws, opener);
    const menu = doc.body.querySelector<HTMLElement>('.ndd-context-menu')!;
    expect(doc.activeElement).toBe(menu);
    keydown(win, menu, 'Escape');
    await settle();
    expect(doc.body.querySelector('.ndd-context-menu')).toBeNull();
    expect(doc.activeElement).toBe(opener);
  });
});

describe('XDA10: menu arrow keys in another document', () => {
  it("move from the item focused in the menu's own document", async () => {
    const { doc, win } = otherWindow();
    const { ws } = await mountMenu();
    await openFrom(ws, doc.body, 10, 10, [
      { label: 'a', action: () => {} },
      { label: 'b', action: () => {} },
      { label: 'c', action: () => {} },
    ]);
    const menu = doc.body.querySelector<HTMLElement>('.ndd-context-menu')!;
    const [, b, c] = Array.from(menu.querySelectorAll<HTMLElement>('button'));
    b!.focus();
    expect(doc.activeElement).toBe(b);
    keydown(win, b!, 'ArrowDown');
    expect(doc.activeElement).toBe(c);
  });
});

describe('XDA11: panel focus restore in another document', () => {
  it("records focus there, and restores it on that window's frame", () => {
    const { doc, win } = otherWindow();
    // jsdom lays nothing out: report the nodes as on screen.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const frame = vi.spyOn(win, 'requestAnimationFrame').mockReturnValue(1);
    const mainFrame = vi.spyOn(window, 'requestAnimationFrame');
    const cache = new PanelDomCache(document);
    cleanups.push(() => cache.dispose());
    const first = hostIn(doc);
    const second = hostIn(doc);
    cache.moveTo('p', first);
    const root = cache.elementFor('p');
    const field = doc.createElement('input');
    root.appendChild(field);
    field.focus();
    expect(doc.activeElement).toBe(field);
    // The main document's focus does not name it: that is not the panel's document.
    expect(document.activeElement).not.toBe(field);
    const refocus = vi.spyOn(field, 'focus');
    frame.mockClear(); // the first move's own second pass

    cache.moveTo('p', second, { refocus: true });
    expect(refocus).toHaveBeenCalled();
    expect(frame).toHaveBeenCalledTimes(1);
    expect(mainFrame).not.toHaveBeenCalled();
  });

  it('tracks scrolls and focus there live, for a detach it does not make', async () => {
    const { doc, win } = otherWindow();
    let laidOut = true;
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => (laidOut ? [{}] : []) as unknown as DOMRectList);
    const queued: FrameRequestCallback[] = [];
    vi.spyOn(win, 'requestAnimationFrame').mockImplementation(cb => {
      queued.push(cb);
      return 1;
    });
    const cache = new PanelDomCache(document);
    cleanups.push(() => cache.dispose());
    cache.moveTo('p', hostIn(doc));
    const root = cache.elementFor('p');
    const list = doc.createElement('div');
    const field = doc.createElement('input');
    list.appendChild(field);
    root.appendChild(list);
    let top = 0;
    Object.defineProperty(list, 'scrollTop', { get: () => top, set: (v: number) => (top = v), configurable: true });
    top = 90;
    list.dispatchEvent(new win.Event('scroll'));
    field.focus();
    // A focusout whose focus stays inside the panel, in the panel's own document, keeps the record.
    root.dispatchEvent(new win.FocusEvent('focusout'));
    await Promise.resolve();
    // Then the panel is hidden (not laid out: no fresh read) and its offsets reset.
    laidOut = false;
    top = 0;
    const refocus = vi.spyOn(field, 'focus');
    queued.length = 0;
    cache.moveTo('p', hostIn(doc), { refocus: true });
    expect(refocus).not.toHaveBeenCalled();
    // Laid out again by the next frame, that window's: the live record is put back.
    laidOut = true;
    queued.forEach(cb => cb(0));
    expect(top).toBe(90);
    expect(refocus).toHaveBeenCalled();
  });
});

describe("XDA11b: a managed widget's scroll offsets in another document", () => {
  it('are recorded from scroll events there and put back', () => {
    const { doc, win } = otherWindow();
    vi.spyOn(win.Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const frame = vi.spyOn(win, 'requestAnimationFrame').mockReturnValue(1);
    const fakeRef = { instance: {}, setInput() {}, destroy() {} };
    const cache = new WidgetContentCache(() => document, () => fakeRef as never);
    cleanups.push(() => cache.dispose());
    @Component({ selector: 'ndd-test-xda11b', template: '' })
    class Content {}
    cache.render('w', Content);
    const el = cache.get('w')!;
    const host = hostIn(doc);
    cache.attach(el, host);
    const list = doc.createElement('div');
    let top = 0;
    Object.defineProperty(list, 'scrollTop', { get: () => top, set: (v: number) => (top = v), configurable: true });
    el.appendChild(list);
    top = 120;
    list.dispatchEvent(new win.Event('scroll'));
    top = 0; // the move reset it
    cache.leave(el, host);
    const next = hostIn(doc);
    cache.attach(el, next);
    expect(top).toBe(120);
    expect(frame).toHaveBeenCalled(); // the second pass, on that window's frame
  });
});

describe("XDA12: a managed widget's drag in another document", () => {
  @Component({
    selector: 'ndd-test-xda12',
    imports: [NddPanelOverlay, NddFloatingWidget],
    template: '<ndd-panel-overlay><ndd-floating-widget widgetId="da12" title="W"><span></span></ndd-floating-widget></ndd-panel-overlay>',
  })
  class Widget {}
  const pointer = (win: AnyWindow, type: string, x: number) =>
    new win.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: 10, button: 0 });

  it('sets and clears the body class there, not on the main body', async () => {
    const { doc, win } = otherWindow();
    await render(Widget, doc);
    const frame = doc.querySelector<HTMLElement>('.ndd-panel-float')!;
    frame.setPointerCapture = vi.fn();
    const header = frame.querySelector('[data-ndd-widget-header]')!;
    header.dispatchEvent(pointer(win, 'pointerdown', 10));
    frame.dispatchEvent(pointer(win, 'pointermove', 60));
    await settle();
    expect(doc.body.classList.contains('ndd-dragging-active')).toBe(true);
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
    frame.dispatchEvent(pointer(win, 'pointerup', 60));
    await settle();
    expect(doc.body.classList.contains('ndd-dragging-active')).toBe(false);
  });

  it('a cancelled drag clears it there too', async () => {
    const { doc, win } = otherWindow();
    await render(Widget, doc);
    const frame = doc.querySelector<HTMLElement>('.ndd-panel-float')!;
    frame.setPointerCapture = vi.fn();
    frame.querySelector('[data-ndd-widget-header]')!.dispatchEvent(pointer(win, 'pointerdown', 10));
    frame.dispatchEvent(pointer(win, 'pointermove', 60));
    await settle();
    expect(doc.body.classList.contains('ndd-dragging-active')).toBe(true);
    frame.dispatchEvent(pointer(win, 'pointercancel', 60));
    await settle();
    expect(doc.body.classList.contains('ndd-dragging-active')).toBe(false);
  });

  it('a resize sets the resizing class there too', async () => {
    const { doc, win } = otherWindow();
    await render(Widget, doc);
    const handle = doc.querySelector<HTMLElement>('.ndd-resize-handle')!;
    handle.setPointerCapture = vi.fn();
    handle.dispatchEvent(pointer(win, 'pointerdown', 10));
    expect(doc.body.classList.contains('ndd-resizing-active')).toBe(true);
    expect(document.body.classList.contains('ndd-resizing-active')).toBe(false);
    handle.dispatchEvent(pointer(win, 'pointerup', 10));
    expect(doc.body.classList.contains('ndd-resizing-active')).toBe(false);
  });

  it("a resize ends when the handle's own window loses focus", async () => {
    const { doc, win } = otherWindow();
    await render(Widget, doc);
    const handle = doc.querySelector<HTMLElement>('.ndd-resize-handle')!;
    handle.setPointerCapture = vi.fn();
    handle.dispatchEvent(pointer(win, 'pointerdown', 10));
    win.dispatchEvent(new win.Event('blur'));
    expect(doc.body.classList.contains('ndd-resizing-active')).toBe(false);
  });
});

describe('XDA13: the toolbar flyout in another document', () => {
  const groupItems: ToolbarItem[] = [
    {
      type: 'group',
      id: 'g',
      label: 'Group',
      defaultIcon: 'icon',
      items: [
        { id: 'a', label: 'A', icon: 'icon-a' },
        { id: 'b', label: 'B', icon: 'icon-b' },
      ],
    },
  ];

  const openIn = async (position: 'left' | 'right' | 'top', setup?: (win: AnyWindow) => void) => {
    const { doc, win } = otherWindow();
    setup?.(win);
    await render(NddToolbar, doc, { items: groupItems, position });
    const btn = doc.querySelector<HTMLButtonElement>('button.ndd-toolbar-btn-group')!;
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await settle();
    return { doc, win, btn, flyout: doc.body.querySelector<HTMLElement>('.ndd-toolbar-group-flyout') };
  };

  it("portals into the button's body and closes on a press there", async () => {
    const { doc, win, flyout } = await openIn('top');
    expect(flyout).not.toBeNull();
    expect(document.body.querySelector('.ndd-toolbar-group-flyout')).toBeNull();
    // A press on a node of that window's own realm inside the flyout is inside (no instanceof).
    const own = doc.createElement('span');
    flyout!.appendChild(own);
    own.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await settle();
    expect(doc.body.querySelector('.ndd-toolbar-group-flyout')).not.toBeNull();
    doc.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await settle();
    expect(doc.body.querySelector('.ndd-toolbar-group-flyout')).toBeNull();
  });

  it("is placed with the button's window size", async () => {
    // Beside a right-hand strip: `right` is measured from that window's width (300 - 20 + 8).
    const { flyout } = await openIn('right', win => {
      sized(win, 300, 200);
      boxesFromStyle(HTMLElement.prototype, { left: 20, top: 20 });
    });
    expect(flyout!.style.right).toBe('288px');
  });

  it("is clamped into the button's window", async () => {
    // Below a top strip at x 250: its right edge (350) passes that window's 300, so 300 - 100 - 8.
    const { flyout } = await openIn('top', win => {
      sized(win, 300, 200);
      boxesFromStyle(HTMLElement.prototype, { left: 250, top: 20 });
    });
    expect(flyout!.style.left).toBe('192px');
  });

  it("answers an Escape in the button's document only", async () => {
    const { doc, win } = await openIn('top');
    cleanups.push(registerDocument(doc));
    keydown(window, document.body, 'Escape');
    await settle();
    expect(doc.body.querySelector('.ndd-toolbar-group-flyout')).not.toBeNull();
    keydown(win, doc.body, 'Escape');
    await settle();
    expect(doc.body.querySelector('.ndd-toolbar-group-flyout')).toBeNull();
  });
});

describe('XDA14: rtl helpers', () => {
  it("isRtlElement asks the element's own window", () => {
    const { doc, win } = otherWindow();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const own = vi.spyOn(win, 'getComputedStyle').mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration);
    expect(isRtlElement(el)).toBe(true);
    expect(own).toHaveBeenCalledWith(el);
    expect(isRtlElement(null)).toBe(false);
  });

  it("the toolbar flyout reads its strip's direction from the strip's own window", async () => {
    // A 'left' strip laid out right to left sits on the right and opens leftwards: 300 - 20 + 8.
    const { doc, win } = otherWindow();
    sized(win, 300, 200);
    boxesFromStyle(HTMLElement.prototype, { left: 20, top: 20 });
    vi.spyOn(win, 'getComputedStyle').mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration);
    await render(NddToolbar, doc, { items: [{ type: 'group', id: 'g', label: 'G', defaultIcon: 'i', items: [{ id: 'a', label: 'A', icon: 'i' }] }], position: 'left' });
    doc.querySelector<HTMLButtonElement>('button.ndd-toolbar-btn-group')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await settle();
    expect(doc.body.querySelector<HTMLElement>('.ndd-toolbar-group-flyout')!.style.right).toBe('288px');
  });
});

describe('XDA15: moveIntoWhenConnected', () => {
  it("waits on the slot's window's frames", async () => {
    const { doc, win } = otherWindow();
    const own = vi.spyOn(win, 'requestAnimationFrame').mockReturnValue(1);
    const main = vi.spyOn(window, 'requestAnimationFrame');
    const slot = doc.createElement('div'); // not connected yet
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    setPreserveEmbeds(el, true);
    const cancel = moveIntoWhenConnected(slot, el);
    await Promise.resolve(); // the first attempt waits a microtask
    expect(own).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalled();
    cancel();
  });
});

describe('XDA16: click-to-activate in a registered document', () => {
  @Component({ selector: 'ndd-test-xda16-panel', template: '' })
  class P {}
  @Component({ selector: 'ndd-test-xda16', imports: [NddDesktop], template: '<ndd-desktop />' })
  class Shell {}

  const setup = async () => {
    const ws = createWorkspace({ panels: { p: { component: P } } });
    await render(Shell, undefined, {}, ws);
    ws.openPanel('a', 'p');
    ws.openPanel('b', 'p');
    ws.focusPanel('b');
    await settle();
    expect(ws.activePanelId()).toBe('b');
    return ws;
  };
  /** A group's pane showing `id`, in `doc`. */
  const paneIn = (doc: Document, id: string) => {
    const pane = doc.createElement('div');
    pane.className = 'ndd-workspace-panel';
    pane.setAttribute('data-active-panel-id', id);
    const inner = doc.createElement('span');
    pane.appendChild(inner);
    doc.body.appendChild(pane);
    cleanups.push(() => pane.remove());
    return inner;
  };

  it('a pointerdown in a panel shown there makes it the active one', async () => {
    const ws = await setup();
    const { doc, win } = otherWindow();
    const inner = paneIn(doc, 'a');
    const press = () => inner.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    press();
    expect(ws.activePanelId()).toBe('b'); // not registered: unheard
    cleanups.push(registerDocument(doc));
    press();
    expect(ws.activePanelId()).toBe('a');
  });

  it("in a floating window shown there too; not for another button's press", async () => {
    const ws = await setup();
    const { doc, win } = otherWindow();
    cleanups.push(registerDocument(doc));
    const frame = doc.createElement('div');
    frame.setAttribute('data-ndd-window', 'a');
    doc.body.appendChild(frame);
    frame.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 2 }));
    expect(ws.activePanelId()).toBe('b');
    frame.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(ws.activePanelId()).toBe('a');
  });

  it('in the page it leaves the press to the elements, as before', async () => {
    const ws = await setup();
    // A pane-like element outside the desktop: no element handler of the library's is on it.
    const inner = paneIn(document, 'a');
    inner.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(ws.activePanelId()).toBe('b');
  });
});

describe('XDA17: the panel search dropdown in another document', () => {
  it("portals into the input's body and fits that window", async () => {
    const { doc, win } = otherWindow();
    sized(win, 300, 200);
    boxesFromStyle(HTMLElement.prototype, { left: 200, top: 20 }); // 200..300: a 240-wide dropdown overflows
    const results = [{ id: 'r', label: 'Result' }];
    const { fixture: f } = await render(NddToolbarSearch, doc, { search: () => results });
    doc.querySelector<HTMLButtonElement>('[data-ndd-search-toggle]')!.click();
    await f.whenStable();
    vi.useFakeTimers();
    const input = doc.querySelector<HTMLInputElement>('[data-ndd-search-input]')!;
    input.value = 'map';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(400);
    f.detectChanges();
    const dropdown = doc.body.querySelector<HTMLElement>('.ndd-panel-toolbar-search__dropdown');
    expect(dropdown).not.toBeNull();
    expect(document.body.querySelector('.ndd-panel-toolbar-search__dropdown')).toBeNull();
    expect(dropdown!.style.left).toBe('52px'); // 300 - 240 - 8
  });

  it('stays open while focus moves to a node of that document inside it', async () => {
    const { doc, win } = otherWindow();
    const { fixture: f } = await render(NddToolbarSearch, doc, { search: () => [] });
    doc.querySelector<HTMLButtonElement>('[data-ndd-search-toggle]')!.click();
    await f.whenStable();
    const input = doc.querySelector<HTMLInputElement>('[data-ndd-search-input]')!;
    const inside = doc.createElement('button');
    (f.nativeElement as HTMLElement).appendChild(inside);
    input.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true, relatedTarget: inside }));
    await f.whenStable();
    expect(doc.querySelector('[data-ndd-search-input]')).not.toBeNull();
  });
});

describe("XDA18: a panel toolbar's ResizeObserver", () => {
  @Component({
    selector: 'ndd-test-xda18',
    imports: [NddPanelOverlay, NddPanelToolbar],
    template: '<ndd-panel-overlay><ndd-panel-toolbar position="top"><span></span></ndd-panel-toolbar></ndd-panel-overlay>',
  })
  class Toolbar {}

  it("comes from the toolbar's own window", async () => {
    const { doc, win } = otherWindow();
    const { observed } = ownObserver(win);
    await render(Toolbar, doc);
    expect(observed.some(el => el.classList.contains('ndd-panel-toolbar'))).toBe(true);
  });
});

describe('XDA19: a modal in the page and an Escape elsewhere', () => {
  @Component({ selector: 'ndd-test-xda19-content', template: '<div>content</div>' })
  class Content {}
  @Component({ selector: 'ndd-test-xda19', imports: [NddModals], template: '<ndd-modals />' })
  class Host {}

  it('stays open through an Escape in another registered document, and closes on one in the page', async () => {
    const { ws } = await render(Host);
    ws.overlays.openModal(Content, {}, { title: 'M' });
    await settle();
    expect(ws.overlays.state().modals).toHaveLength(1);

    const { doc, win } = otherWindow();
    cleanups.push(registerDocument(doc));
    keydown(win, doc.body, 'Escape');
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    expect(ws.overlays.state().modals).toHaveLength(1);
    keydown(window, document.body, 'Escape');
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    expect(ws.overlays.state().modals).toHaveLength(0);
  });
});

describe("XDA20: a toast card's observer and frame", () => {
  it('come from its own window', async () => {
    const { doc, win } = otherWindow();
    const { observed } = ownObserver(win);
    const queued: FrameRequestCallback[] = [];
    const own = vi.spyOn(win, 'requestAnimationFrame').mockImplementation(cb => {
      queued.push(cb);
      return 1;
    });
    const toast: ToastRecord = { id: 't', message: 'Hi', options: { id: 't' }, exiting: false, revision: 0 };
    const { fixture: f } = await render(NddToastItem, doc, { toast, animation: 'slide', defaultDuration: 0 });
    expect(observed.some(el => el.classList.contains('ndd-toast__body'))).toBe(true);
    expect(own).toHaveBeenCalled();
    const card = doc.querySelector<HTMLElement>('.ndd-toast')!;
    expect(card.classList.contains('ndd-toast--visible')).toBe(false);
    queued.forEach(cb => cb(0)); // the entry runs on that window's frame
    await f.whenStable();
    expect(card.classList.contains('ndd-toast--visible')).toBe(true);
  });
});
