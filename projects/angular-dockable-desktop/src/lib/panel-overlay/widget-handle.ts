/**
 * `injectWidget()`: what a managed widget's own content knows about the widget (7.11, rdd's
 * `useWidget()`, vdd's of the same name).
 *
 * `injectPanel()` inside a widget's content is still the **owner** panel, so content bound to its
 * owner (a table bound to its map) keeps working wherever the widget is. This is the widget's own
 * side: where it is, and a heads-up around each move of its element.
 *
 * The overlay creates each widget's component with a child injector of its own that provides the
 * handle, so anything created inside the content (its children, its services) injects it too.
 */
import { DestroyRef, InjectionToken, inject } from '@angular/core';
import type { Signal } from '@angular/core';
import type { WidgetLocation } from './overlay-store';

/**
 * What `injectWidget()` returns inside a managed widget's content (7.11).
 *
 * As with `injectPanel()`, what describes *state* is a signal (`location`, `panelId`); what never
 * changes for the widget's life is a plain value. The field names are rdd's and vdd's.
 */
export interface WidgetHandle {
  /** The widget's id, as given to `injectFloatingWidgets().open()`. */
  readonly id: string;
  /** The workspace panel that owns it, or `null` when its overlay isn't in one. */
  readonly ownerPanelId: string | null;
  /**
   * The id of the widget's own panel while it is out of its owner panel, for workspace calls
   * such as `updatePanelTitle`; `null` while it is in the panel.
   */
  readonly panelId: Signal<string | null>;
  /** Where it is shown now. */
  readonly location: Signal<WidgetLocation>;
  /**
   * It is in its own browser window (`injectFloatingWidgets().popOut`, 1.12.0); `location` is then
   * `'floating'`. Its content's `injectPanelWindow()` gives that window.
   */
  readonly isPoppedOut: Signal<boolean>;
  /**
   * Called just before the widget's content element moves to another container: into or out of
   * its panel, between docked, tabbed and floating, minimised or restored, by your code, the
   * user, or a layout load. Save what a move would disturb here, such as a map's view.
   * Returns the unsubscribe function; it is also unsubscribed when the component (or other
   * injection context) that called `injectWidget()` is destroyed.
   */
  onWillMove(cb: () => void): () => void;
  /**
   * Called once the element is in its new container and has its new size (or, with no size, as
   * when minimised, on the next frames), after every move that called `onWillMove`. Returns the
   * unsubscribe function; also unsubscribed with the injecting context, as `onWillMove`.
   *
   * Neither callback runs for a close, a refused move, or `move({ to: 'panel' })` while the
   * widget is already in the panel.
   */
  onMoved(cb: () => void): () => void;
}

/** @internal Provided by the overlay to each managed widget's content. */
export const WIDGET_HANDLE = new InjectionToken<WidgetHandle>('ndd.Widget');

/**
 * The managed widget this is injected in, or `null` outside one (7.11). Call in an injection
 * context: a component inside a widget's content, or a service it provides.
 *
 * ```ts
 * readonly widget = injectWidget();
 * constructor() {
 *   this.widget?.onWillMove(() => this.saveView());
 *   this.widget?.onMoved(() => this.grid()?.resize());
 * }
 * readonly compact = computed(() => this.widget?.location() === 'panel');
 * ```
 */
export function injectWidget(): WidgetHandle | null {
  const handle = inject(WIDGET_HANDLE, { optional: true });
  if (!handle) return null;
  const destroyRef = inject(DestroyRef, { optional: true });
  // A subscription goes with the injecting context, unless it was unsubscribed first.
  const scoped = (off: () => void): (() => void) => {
    const unhook = destroyRef?.onDestroy(off);
    return () => {
      unhook?.();
      off();
    };
  };
  return {
    id: handle.id,
    ownerPanelId: handle.ownerPanelId,
    panelId: handle.panelId,
    location: handle.location,
    isPoppedOut: handle.isPoppedOut,
    onWillMove: cb => scoped(handle.onWillMove(cb)),
    onMoved: cb => scoped(handle.onMoved(cb)),
  };
}
