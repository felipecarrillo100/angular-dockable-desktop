/**
 * A workspace's pop-out windows (1.12.0): a panel shown in its own browser window. A port of rdd
 * 7.12.1's `core/popOutWindows.ts`, by way of vdd 1.14.0's. Internal: the public face is
 * `workspace.popOutPanel` / `returnPanel` / `focusPanelWindow`, which the workspace hands to this
 * registry once it is bound (`bindPopOutWindows`).
 *
 * The windows live here, outside the store, because `window.open` must run synchronously inside
 * the user's click. The store marks the panel (`PanelInfo.poppedOut`, a floating panel whose frame
 * the workspace doesn't draw); `<ndd-desktop>` renders, per window, the library's frame and the
 * panel's ordinary slot in the child's `<body>` (`NddPopOutWindows`), and the panel's element
 * moves into it. Nothing is re-created (ADR 0002).
 *
 * Every way back ends in one function, `back(id, restorePlace)`: the frame's button, the app's
 * `returnPanel`, the child's `pagehide` (the element is moved back to the main document inside the
 * handler, before the child's document goes), a `closed` poll as a backstop, the main page's own
 * `pagehide`, and the desktop being destroyed (`bindHost`'s undo). A panel that stops being popped
 * out some other way (closed, docked or minimised by the app, dropped by `loadLayout`) closes its
 * window too, through `onPopOutEnded`: the windows follow the store, never the other way round.
 *
 * Zone.js (the P2b spike): a child window's `EventTarget` is its own realm's, which zone.js never
 * patched, so in a zone application a listener added there (the content's own, on its document;
 * the library's, through the document registry) ran outside the Angular zone, and a plain field it
 * wrote never rendered. Each window is given zone.js's own `EventTarget` patch as soon as it opens
 * ({@link patchZone}): it then behaves as the page does. Listeners Angular adds from a template sit
 * on elements created by the page's document, already patched. Without zone.js it does nothing.
 * @internal
 */
import { signal, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import type { PopOutResult } from './types';
import type { Workspace } from '../workspace/workspace';
import { optionsFor } from './panel-options';
import { registerDocument } from './document-registry';
import { findLeaf, findLeafForPanel } from './layout-tree';

/** The initial document's URL, which a window shows until the app's page replaces it. */
const BLANK = 'about:blank';
/** How often a window is checked for having closed without a `pagehide` (a backstop). */
const CLOSED_POLL_MS = 500;
/**
 * How long the app's page (`popoutUrl`) may take to load. Past it, or when the page can't be read
 * (another origin, or a redirect off this one), the panel comes back and the window closes.
 */
export const POPOUT_LOAD_TIMEOUT_MS = 10_000;
/**
 * How long a pop-out's copied stylesheets may hide its frame (rdd's `POPOUT_STYLES_TIMEOUT_MS`).
 * The styles themselves come with P3's `pop-out-styles.ts`, which takes this value over.
 */
export const POPOUT_STYLES_TIMEOUT_MS = 3000;
/**
 * How long `panel:popped-out` / `panel:returned` wait for the panel to be in its new place: past
 * it they are sent anyway. Longer than a pop-out's styles may take, which hide its frame.
 */
export const POPOUT_PLACED_TIMEOUT_MS: number = POPOUT_STYLES_TIMEOUT_MS + 1000;

/** Distinguishes the windows of one page: two workspaces can have the same panel id. */
let windowCount = 0;
const pageKey = Math.random().toString(36).slice(2, 8);

/** What the desktop lends the windows: the panel's element, where it is and how to take it back. */
export interface PopOutHost {
  /** Moves the panel's element back into the main document, now. */
  park(id: string): void;
  /** The panel's box on the main page, or null when it isn't shown. */
  rectOf(id: string): { left: number; top: number; width: number; height: number } | null;
  /** The panel's element, or null when it has none: where it is decides when the events are sent. */
  element(id: string): Element | null;
  /** Whether the panel's element is in the cache's hidden store (a tab not shown, minimised). */
  isParked(id: string): boolean;
}

/** One open window, as the desktop renders it. `doc` is null until its page has loaded. */
export interface PopOutEntry {
  /** This window's own name: unique per window opened, so a re-opened panel renders afresh. */
  readonly key: string;
  readonly id: string;
  readonly win: Window;
  readonly doc: Document | null;
}

/**
 * What a managed widget's overlay lends for its hosted panel (P5): the panel is popped out through
 * the widget (it may have to leave its panel first), and comes back into the panel when its window
 * closes.
 */
export interface HostedPopOut {
  /** `popOutPanel(hostedId)`: the widget's own `popOut()`. */
  popOut(): PopOutResult;
  /** Its window is closing to bring it back (not a move from code): before the element moves. */
  returning(): void;
  /** ...and it is out of the window: the widget goes back into its panel. */
  returned(): void;
}

/** How a hosted panel is popped out: the widget has checked its own rules (P5). */
export interface HostedPopOutOptions {
  /** Called once the window is open, before the panel moves in: takes the widget out of its panel if needed. */
  prepare: () => boolean;
  /** Where the widget is (client pixels of `view`, else of the main page), for the window's place and size. */
  rect?: { left: number; top: number; width: number; height: number } | null;
  /** The window `rect` was measured in, when not the main page's: its owner panel's pop-out (rdd 7.12.1). */
  view?: Window;
}

/** A workspace's pop-out windows: what the workspace and `<ndd-desktop>` use. */
export interface PopOutWindows {
  /** See `Workspace.popOutPanel`. With `hosted`, a managed widget's own pop-out (P5). */
  popOut(id: string, hosted?: HostedPopOutOptions): PopOutResult;
  /** Brings a panel's window forward, best effort; false when it has none. */
  focusWindow(id: string): boolean;
  /** Lends a hosted panel's widget rules; returns the function that takes them back. */
  registerHosted(panelId: string, hosted: HostedPopOut): () => void;
  /** See `Workspace.returnPanel`. */
  returnPanel(id: string): { ok: boolean };
  /** Whether the user may pop this panel out now (the menu item's rule). Never a widget's panel. */
  canPopOut(id: string): boolean;
  /** Whether the workspace was created with `popOut: true`. */
  readonly enabled: boolean;
  /** The app's page for a pop-out (`<ndd-desktop [popoutUrl]>`); a blank window without one. */
  setUrl(url: string | undefined): void;
  /** The desktop lends its panel host; returns the function that takes it back (every panel returns). */
  bindHost(host: PopOutHost): () => void;
  /**
   * Hands `popOutPanel` / `returnPanel` / `focusPanelWindow` to the workspace and follows the store
   * (`onPopOutEnded`); returns the function that undoes both.
   */
  bind(): () => void;
  /** The open windows, a new array whenever they change: what Angular renders from. */
  readonly entries: Signal<readonly PopOutEntry[]>;
  /** The same, for code outside a reactive context: `cb` runs on each change. */
  subscribe(cb: () => void): () => void;
  getSnapshot(): readonly PopOutEntry[];
}

interface Entry {
  /** `panel:popping-out` was sent, so `panel:returned` follows when it comes back (or the window fails). */
  leaving?: boolean;
  /** `panel:popped-out` was sent (the panel is laid out in the window), so `panel:returning` comes first on the way back. */
  announced?: boolean;
  key: string;
  id: string;
  win: Window;
  doc: Document | null;
  /** Removes the window's listeners and timers, and unregisters its document. */
  stop: () => void;
}

const refuse = (reason: Extract<PopOutResult, { ok: false }>['reason']): PopOutResult => ({ ok: false, reason });

/** Whether the window's document can be read (same origin), without throwing. */
function readable(win: Window): boolean {
  try {
    return !!win.document;
  } catch {
    return false;
  }
}

/**
 * The window's document once its page has loaded, else null; throws when it can't be read. With
 * no page of the app's (`blank`), the window's own initial document, as soon as it has a body:
 * opened with an empty URL, nothing replaces it. Otherwise the app's page, once the initial blank
 * document has been replaced and has loaded.
 */
function loadedDocument(win: Window, blank: boolean): Document | null {
  const doc = win.document;
  if (!doc?.body) return null;
  if (blank) return doc;
  return doc.URL !== BLANK && doc.readyState === 'complete' ? doc : null;
}

const activationOf = (win: Window) => (win.navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;

/**
 * The window the user is clicking in (rdd 7.12.1), which must be the one to open the new window:
 * the main page, or one of its pop-outs (a click there activates that window, not the page). The
 * main page in a browser that can't tell (no API: assume so); null when no window is in a click or
 * key press; undefined when there is no window at all (a server).
 */
function activeWindow(popOuts: Iterable<Window>): Window | null | undefined {
  if (typeof window === 'undefined') return undefined;
  const main = activationOf(window);
  if (!main || main.isActive) return window;
  for (const win of popOuts) {
    try {
      if (!win.closed && activationOf(win)?.isActive === true) return win;
    } catch {
      /* closed or unreadable */
    }
  }
  return null;
}

/** Just enough of zone.js's global `Zone` (when an application loads it) for the patch below. */
interface ZoneGlobal {
  __symbol__(name: string): string;
  __load_patch(name: string, fn: (global: unknown, zone: unknown, api: { patchEventTarget(global: unknown, api: unknown, apis: object[]): unknown }) => void): void;
  readonly current: { wrap<F extends (...args: never[]) => unknown>(fn: F, source: string): F };
  readonly root: { run<T>(fn: () => T): T };
}
const zoneGlobal = (): ZoneGlobal | null => {
  const z = (globalThis as { Zone?: Partial<ZoneGlobal> }).Zone;
  return z && typeof z.__load_patch === 'function' && typeof z.__symbol__ === 'function' ? (z as ZoneGlobal) : null;
};
let zonePatches = 0;

/**
 * Gives a child window zone.js's own `EventTarget` patch (the P2b spike's fix), so a listener added
 * in it runs in the zone it was added from, as on the page: in a zone application a plain field a
 * listener there writes renders. Once per realm (zone.js marks what it patched); the window keeps
 * its realm across the same-origin load of the app's page, so the patch made at `open` stays. Does
 * nothing without zone.js.
 */
function patchZone(win: Window): void {
  const zone = zoneGlobal();
  if (!zone) return;
  try {
    const proto = (win as unknown as { EventTarget?: { prototype: object } }).EventTarget?.prototype;
    if (!proto || Object.prototype.hasOwnProperty.call(proto, zone.__symbol__('addEventListener'))) return;
    zone.__load_patch(`ndd-popout-${++zonePatches}`, (_global, _zone, api) => {
      api.patchEventTarget(win, api, [proto]);
    });
  } catch {
    /* a closed window, or a zone.js without the patch API: listeners there run outside the zone */
  }
}

/**
 * Runs `fn` outside the Angular zone when zone.js is loaded, as `NgZone.runOutsideAngular` would:
 * for the closed poll, whose ticks would otherwise run the application's change detection twice a
 * second while a window is open (ADR 0006). What it changes is signals, which schedule a render
 * under either scheduler.
 */
const outsideZone = <T>(fn: () => T): T => {
  const zone = zoneGlobal();
  return zone?.root ? zone.root.run(fn) : fn();
};

/** `fn`, run in the zone current now when zone.js is loaded: for a callback a child window's frame runs. */
const inCurrentZone = <F extends (...args: never[]) => unknown>(fn: F): F => zoneGlobal()?.current.wrap(fn, 'ndd-popout') ?? fn;

const devWarn = (message: string) => {
  if (typeof ngDevMode === 'undefined' || ngDevMode) console.warn(`[angular-dockable-desktop] ${message}`);
};

export function createPopOutWindows(ws: Workspace<never>): PopOutWindows {
  const enabled = ws.popOutEnabled;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const snapshot = signal<readonly PopOutEntry[]>([]);
  let url: string | undefined;
  /** The desktop's panel host, while one is mounted. */
  let currentHost: PopOutHost | null = null;
  const host = (): PopOutHost | null => currentHost;

  /** Hosted panels' widgets, by panel id (P5). */
  const hostedRouters = new Map<string, HostedPopOut>();

  /** Per panel, bumped by each pop-out and each return: an event waiting for an older one is dropped. */
  const epochs = new Map<string, number>();
  const bump = (id: string) => {
    epochs.set(id, (epochs.get(id) ?? 0) + 1);
  };

  const state = () => untracked(ws.state);
  const panelOf = (id: string) => state().panels[id];

  /** Whether the panel's state shows it on the page (floating, or the selected tab of its group). */
  const shownOnPage = (id: string): boolean => {
    const { panels, gridRoot } = state();
    const p = panels[id];
    if (!p || p.poppedOut) return false;
    if (p.state === 'floating') return true;
    if (p.state !== 'docked') return false;
    const leafId = findLeafForPanel(gridRoot, id);
    return leafId !== null && findLeaf(gridRoot, leafId)?.activePanelId === id;
  };

  /**
   * Whether the panel's element is in its new place in `doc`: in the window's frame, shown (its
   * styles are ready), for a pop-out; in a slot of the page, not parked, for a return (a panel that
   * comes back hidden, a tab not selected or minimised, is in its place parked). No element (no
   * desktop any more, or a widget's panel gone with its widget back in its panel): nothing to wait for.
   */
  const placed = (id: string, doc: Document, out: boolean): boolean => {
    const h = host();
    const el = h?.element(id);
    if (!h || !el) return true;
    if (!el.isConnected || el.ownerDocument !== doc) return false;
    if (out) {
      const frame = el.closest('.ndd-popout-frame') as HTMLElement | null;
      return !!frame && frame.style.visibility !== 'hidden';
    }
    return !shownOnPage(id) || !h.isParked(id);
  };

  /**
   * Calls `cb` once the panel's element is in its new place in `doc` and one more frame of that
   * window has passed, so its layout (and a `resize()` there) sees the new size. Sent anyway after
   * {@link POPOUT_PLACED_TIMEOUT_MS}; dropped when the panel pops out or returns again meanwhile.
   * Size is not required: a panel back as a hidden tab is 0 x 0. A child window's frames run in
   * the zone this was called from (zone.js doesn't patch that window's timers).
   */
  const whenPlaced = (id: string, doc: Document, out: boolean, cb: () => void) => {
    const mine = epochs.get(id);
    const view = doc.defaultView;
    const frame =
      view && typeof view.requestAnimationFrame === 'function'
        ? (f: () => void) => {
            // The page's own frames are zone.js's to patch; only a child window's are wrapped here.
            view.requestAnimationFrame(doc === document ? f : inCurrentZone(f));
          }
        : (f: () => void) => {
            setTimeout(f, 16);
          };
    let done = false;
    const stop = () => {
      done = true;
      clearTimeout(limit);
    };
    const finish = () => {
      if (done) return;
      stop();
      if (epochs.get(id) === mine) cb();
    };
    const limit = setTimeout(finish, POPOUT_PLACED_TIMEOUT_MS);
    const tick = () => {
      if (done) return;
      if (epochs.get(id) !== mine) {
        stop();
        return;
      }
      if (placed(id, doc, out)) frame(finish);
      else frame(tick);
    };
    try {
      frame(tick);
    } catch {
      /* the window is gone: the limit sends it */
    }
  };

  const emit = () => {
    snapshot.set(Array.from(entries.values(), ({ key, id, win, doc }) => ({ key, id, win, doc })));
    listeners.forEach(l => l());
  };

  const canPopOut = (id: string): boolean => {
    if (!enabled) return false;
    const panel = panelOf(id);
    return !!panel && !panel.owner && optionsFor(ws.registry, panel)?.canPopOut === true;
  };

  // The main page going away closes every child window, each panel back where it was.
  const onMainPageHide = () => {
    for (const id of [...entries.keys()]) back(id, true);
  };
  const watchMainPage = (on: boolean) => {
    if (typeof window === 'undefined') return;
    if (on) window.addEventListener('pagehide', onMainPageHide);
    else window.removeEventListener('pagehide', onMainPageHide);
  };

  /**
   * The one way back: the element returns to the main document first, then the window closes and
   * the store clears the flag (`restorePlace`: a docked panel goes back where it was). Returns
   * false when the panel has no window.
   */
  const back = (id: string, restorePlace: boolean): boolean => {
    const entry = entries.get(id);
    if (!entry) return false;
    // A widget's panel coming back (not moved from code): its widget is told first (P5).
    const widget = restorePlace ? hostedRouters.get(id) : undefined;
    entries.delete(id);
    bump(id);
    // Not for a panel closed while out: panel:closed says so.
    const stillOpen = !!panelOf(id);
    // Before the element leaves the window: only once panel:popped-out was sent.
    if (entry.announced && stillOpen) ws.emitBuiltIn('panel:returning', { id });
    widget?.returning();
    // A menu open in this window goes with it: its body is about to be gone. (A toolbar flyout and
    // a search dropdown there close when the document leaves the registry, below.)
    const menu = untracked(ws.contextMenu);
    if (entry.doc && menu?.container && menu.container.ownerDocument === entry.doc) ws.closeContextMenu();
    try {
      host()?.park(id);
    } catch {
      /* the slot will park it when it is destroyed */
    }
    entry.stop();
    try {
      if (!entry.win.closed) entry.win.close();
    } catch {
      /* already gone */
    }
    if (entries.size === 0) watchMainPage(false);
    ws.clearPoppedOut(id, restorePlace);
    emit();
    // Once it is back in its place and laid out (the desktop moves it on its next render). After a
    // panel:popping-out, also for a window that failed before panel:popped-out.
    if (entry.leaving && stillOpen) whenPlaced(id, document, false, () => ws.emitBuiltIn('panel:returned', { id }));
    // ...and it goes back into its panel.
    widget?.returned();
    return true;
  };

  /** Whether the panel is out and its window's page is ready, and `panel:popped-out` is still to be sent. */
  const ready = (entry: Entry) => !entry.announced && !!entry.doc && entries.get(entry.id) === entry && !!panelOf(entry.id)?.poppedOut;

  /**
   * Shows the window's content (the desktop renders the open windows, `emit`), then, once the
   * panel's element is laid out in the window, `panel:popped-out`.
   */
  const show = (entry: Entry) => {
    emit();
    if (!ready(entry)) return;
    whenPlaced(entry.id, entry.doc!, true, () => {
      if (!ready(entry)) return;
      entry.announced = true;
      ws.emitBuiltIn('panel:popped-out', { id: entry.id, window: entry.win });
    });
  };

  /**
   * A page that fails after `popOutPanel` returned `ok` (it can't be read, or doesn't load in
   * time): the panel comes back and the window closes.
   */
  const fail = (id: string, why: string) => {
    devWarn(`The pop-out window of "${id}" ${why}; the panel is back on the page. popoutUrl must be a page of this origin.`);
    back(id, true);
  };

  /** Waits for the window's page (its `load`), then listens for it going away; polls for a silent close. */
  const watchWindow = (entry: Entry, blank: boolean) => {
    const { id, win } = entry;
    const undo: (() => void)[] = [];
    entry.stop = () => undo.splice(0).forEach(f => f());
    /** Whether this entry is still the open window of its panel (a timer may outlive it). */
    const live = () => entries.get(id) === entry;
    /** While the app's page is awaited: checks whether it is ready (set below). */
    let checkReady: (() => void) | null = null;
    // First, so a page that fails at once (below) stops it too. Each tick also checks whether the
    // app's page is ready, so a missed `load` event doesn't leave the panel waiting.
    const closed = outsideZone(() =>
      setInterval(() => {
        if (!live()) return;
        if (win.closed) back(id, true);
        else checkReady?.();
      }, CLOSED_POLL_MS),
    );
    undo.push(() => clearInterval(closed));
    const attach = (doc: Document) => {
      entry.doc = doc;
      // Again for the loaded page, in case its realm is not the one patched at open (does nothing twice).
      patchZone(win);
      // Synchronous: the element is back in the main document before the child's document goes.
      const onHide = () => {
        back(id, true);
      };
      win.addEventListener('pagehide', onHide);
      undo.push(() => {
        try {
          win.removeEventListener('pagehide', onHide);
        } catch {
          /* gone */
        }
      });
      // Menus, Escape and click-to-activate listen there too (P1).
      undo.push(registerDocument(doc));
    };
    /** Attaches if the page is ready; true once attached or given up. */
    const tryAttach = (): boolean => {
      let doc: Document | null;
      try {
        doc = loadedDocument(win, blank);
      } catch {
        fail(id, 'shows a page this one cannot reach');
        return true;
      }
      if (!doc) return false;
      attach(doc);
      return true;
    };
    if (!tryAttach()) {
      const onLoad = () => {
        if (!live() || entry.doc) return;
        if (tryAttach() && live()) {
          stopWaiting();
          show(entry);
        }
      };
      const timer = setTimeout(() => {
        if (live() && !entry.doc) fail(id, `did not load within ${POPOUT_LOAD_TIMEOUT_MS / 1000} s`);
      }, POPOUT_LOAD_TIMEOUT_MS);
      checkReady = onLoad;
      const stopWaiting = () => {
        checkReady = null;
        clearTimeout(timer);
        try {
          win.removeEventListener('load', onLoad);
        } catch {
          /* gone */
        }
      };
      // The window object outlives its initial blank document on a same-origin page load.
      win.addEventListener('load', onLoad);
      undo.push(stopWaiting);
    }
  };

  /**
   * The window's place and size: over the panel where it is now, in screen coordinates. `view` is
   * the window `at` was measured in (a widget's owner in its own window); else the main page,
   * where a panel's own rect is measured.
   */
  const featuresFor = (id: string, at?: { left: number; top: number; width: number; height: number } | null, view?: Window): string => {
    const r = at ?? host()?.rectOf(id) ?? null;
    const w = (at && view) || window;
    const width = Math.max(320, Math.round(r?.width || 640));
    const height = Math.max(240, Math.round(r?.height || 480));
    const chromeTop = Math.max(0, (w.outerHeight || 0) - (w.innerHeight || 0));
    // Not clamped: a second monitor left of or above the primary one has negative coordinates.
    const left = Math.round((w.screenX || 0) + (r?.left ?? 100));
    const top = Math.round((w.screenY || 0) + chromeTop + (r?.top ?? 100));
    return `popup=yes,left=${left},top=${top},width=${width},height=${height}`;
  };

  const popOut = (id: string, hosted?: HostedPopOutOptions): PopOutResult => {
    // `popOutPanel` refuses (and warns) itself on a workspace without popOut.
    if (!enabled) return refuse('disabled');
    const panel = panelOf(id);
    if (!hosted) {
      if (!panel) return refuse('not-open');
      // A widget's panel (7.11) pops out through the widget, whose rules apply (P5).
      if (panel.owner) return hostedRouters.get(id)?.popOut() ?? refuse('not-allowed');
      if (optionsFor(ws.registry, panel)?.canPopOut !== true) return refuse('not-allowed');
    }
    const open = entries.get(id);
    if (open && panel?.poppedOut) {
      try {
        open.win.focus();
      } catch {
        /* best effort */
      }
      return { ok: true };
    }
    // The window the user clicked opens it: a browser blocks a window opened from another one.
    const opener = activeWindow(Array.from(entries.values(), e => e.win));
    if (opener === null) return refuse('no-gesture');
    // No desktop mounted (yet, or any more): nothing would show the panel there.
    if (!currentHost || !opener) return refuse('no-window');

    const name = `ndd-popout-${id}-${pageKey}-${++windowCount}`;
    let target = '';
    let win: Window | null;
    try {
      // No page of the app's: an empty URL, so the window keeps its initial document (an
      // `about:blank` URL may replace it with a new one after this returns, in Firefox). The app's
      // page is resolved against the main page's, whichever window opens it.
      if (url) target = new URL(url, document.baseURI).href;
      // A name of its own per window: another workspace's panel, or a window left by a reload of
      // this page, may have the same id.
      win = opener.open(target, name, featuresFor(id, hosted?.rect, hosted?.view));
    } catch {
      win = null;
    }
    if (!win) return refuse('blocked');
    if (win.closed || !readable(win)) {
      try {
        win.close();
      } catch {
        /* gone */
      }
      return refuse('no-window');
    }
    // Before anything listens there: in a zone application, what is added in the window runs in the zone.
    patchZone(win);
    // A widget still in its panel leaves it now, into its hosted panel; nothing changed before.
    if (hosted && !hosted.prepare()) {
      try {
        win.close();
      } catch {
        /* gone */
      }
      return refuse('not-allowed');
    }

    const entry: Entry = { key: name, id, win, doc: null, stop: () => undefined };
    entries.set(id, entry);
    bump(id);
    if (entries.size === 1) watchMainPage(true);
    watchWindow(entry, target === '');
    if (!entries.has(id)) return refuse('no-window'); // its page failed at once
    // Still in the user's click, before Angular renders: the element is in the page, at its size.
    // From here, panel:popped-out or (the window failing) panel:returned follows.
    entry.leaving = true;
    ws.emitBuiltIn('panel:popping-out', { id });
    if (!ws.setPoppedOut(id)) {
      back(id, false);
      return refuse('not-open');
    }
    show(entry);
    return { ok: true };
  };

  const focusWindow = (id: string): boolean => {
    const entry = entries.get(id);
    if (!entry) return false;
    try {
      entry.win.focus();
    } catch {
      /* best effort: a browser may refuse */
    }
    return true;
  };
  const returnPanel = (id: string): { ok: boolean } => {
    if (back(id, true)) return { ok: true };
    // Flagged in the store with no window of its own (set from inside the library, never by a
    // pop-out that opened): it still comes back, as before any registry was bound.
    if (!panelOf(id)?.poppedOut) return { ok: false };
    ws.clearPoppedOut(id, true);
    return { ok: true };
  };

  return {
    enabled,
    popOut,
    returnPanel,
    focusWindow,
    registerHosted(panelId, hostedPopOut) {
      hostedRouters.set(panelId, hostedPopOut);
      return () => {
        if (hostedRouters.get(panelId) === hostedPopOut) hostedRouters.delete(panelId);
      };
    },
    canPopOut,
    setUrl: next => {
      url = next || undefined;
    },
    bindHost(next) {
      currentHost = next;
      return () => {
        if (currentHost !== next) return;
        // The desktop being destroyed (a route change) brings every panel back while it can still
        // take the element: no window is left showing nothing.
        for (const id of [...entries.keys()]) back(id, true);
        currentHost = null;
      };
    },
    bind() {
      const unbind = ws.bindPopOutWindows({ popOut: id => popOut(id), returnPanel, focusWindow });
      // The windows follow the store: a panel no longer popped out loses its window.
      const unfollow = ws.onPopOutEnded(id => {
        back(id, false);
      });
      return () => {
        unfollow();
        unbind();
      };
    },
    entries: snapshot.asReadonly(),
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot: () => untracked(snapshot),
  };
}
