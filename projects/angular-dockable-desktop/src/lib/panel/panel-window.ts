/**
 * The window a panel is in (1.12.0, rdd 7.12.0's `panelWindow.tsx`, vdd 1.14.0's `panelWindow.ts`):
 * the main one, or its pop-out's. Panel code reads it with {@link injectPanelWindow}; the app's
 * `<ndd-desktop [popoutWrapper]>` component gets it as its `window` and `document` inputs, so a
 * CSS-in-JS cache (or anything else kept per document) can follow the panel into the pop-out's
 * document.
 *
 * Also the pop-out documents' wrapper (internal): `<ndd-context-menu>` and `<ndd-toasts>` are
 * mounted beside `<ndd-desktop>`, not inside it, so no injection reaches them from the desktop.
 * Each desktop records its `popoutWrapper` here for the documents of its open pop-outs, and a menu
 * or a toast container shown in one of them looks it up by its document.
 */
import { inject, signal, untracked } from '@angular/core';
import type { Signal, Type } from '@angular/core';
import { PANEL_CONTEXT } from './panel-ref';

/** The window and document a panel is shown in. See {@link injectPanelWindow}. (1.12.0) */
export interface PanelWindow {
  window: Window;
  document: Document;
}

/**
 * What the component given to `<ndd-desktop [popoutWrapper]>` declares (1.12.0): two inputs, the
 * window and the document of what it is around, and an `<ng-content />` for it.
 *
 * ```ts
 * @Component({
 *   selector: 'app-popout-wrapper',
 *   template: '<ng-content />',
 *   // What the content injects: here, a style cache for the document the wrapper is given.
 *   providers: [{ provide: STYLE_CACHE, useFactory: () => { const w = inject(PopoutWrapperComponent); return computed(() => cacheFor(w.document())); } }],
 * })
 * export class PopoutWrapperComponent implements PopoutWrapper {
 *   readonly window = input.required<Window>();
 *   readonly document = input.required<Document>();
 * }
 * ```
 */
export interface PopoutWrapper {
  readonly window: Signal<Window>;
  readonly document: Signal<Document>;
}

let main: PanelWindow | null = null;
/** @internal The main window, as one stable object (on the server, where there is none, empty). */
export function mainWindow(): PanelWindow {
  if (typeof window === 'undefined') return {} as PanelWindow;
  if (!main || main.window !== window) main = { window, document };
  return main;
}

/** Outside a workspace panel: the main window, always. */
let mainSignal: Signal<PanelWindow> | null = null;
function mainWindowSignal(): Signal<PanelWindow> {
  mainSignal ??= signal(mainWindow()).asReadonly();
  return mainSignal;
}

/**
 * The window and document the panel is shown in (1.12.0), as a signal: the pop-out's while the
 * panel is in its own window, the main ones otherwise (and outside a workspace panel, or with
 * `popOut` off). It changes when the panel pops out and when it returns, in the render that shows
 * the panel there, so code that listens on the window, uses its `requestAnimationFrame`,
 * `devicePixelRatio` or `matchMedia`, or creates elements, can follow.
 *
 * Call in an injection context: a field initialiser or the constructor of the panel component (or
 * of anything inside it).
 *
 * ```ts
 * private readonly panelWindow = injectPanelWindow();
 * constructor() {
 *   effect(onCleanup => {
 *     const win = this.panelWindow().window;
 *     const onResize = () => this.redraw(win.devicePixelRatio);
 *     win.addEventListener('resize', onResize);
 *     onCleanup(() => win.removeEventListener('resize', onResize));
 *   });
 * }
 * ```
 */
export function injectPanelWindow(): Signal<PanelWindow> {
  return inject(PANEL_CONTEXT, { optional: true })?.window ?? mainWindowSignal();
}

/** Each open pop-out's document, with the wrapper of the desktop that owns it. */
const wrappers = signal<ReadonlyMap<Document, Type<unknown>>>(new Map());

/**
 * @internal Records `wrapper` for a pop-out's document; returns the function that removes it (only
 * if it is still this one).
 */
export function setPopoutWrapper(doc: Document, wrapper: Type<unknown>): () => void {
  const next = new Map(untracked(wrappers));
  next.set(doc, wrapper);
  wrappers.set(next);
  return () => {
    const now = untracked(wrappers);
    if (now.get(doc) !== wrapper) return;
    const left = new Map(now);
    left.delete(doc);
    wrappers.set(left);
  };
}

/**
 * @internal The app's `popoutWrapper` for `doc`, a pop-out's document; null for the main document,
 * or a document no desktop with a wrapper has open. Reactive.
 */
export function popoutWrapperFor(doc: Document | null | undefined): Type<unknown> | null {
  const map = wrappers();
  if (!doc || (typeof document !== 'undefined' && doc === document)) return null;
  return map.get(doc) ?? null;
}
