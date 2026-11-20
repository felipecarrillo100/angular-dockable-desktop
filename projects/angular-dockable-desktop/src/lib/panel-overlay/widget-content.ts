/**
 * The content of one overlay's managed widgets (7.11, widgets out of the panel): each one's
 * element and its component instance.
 *
 * Each widget opened through `injectFloatingWidgets()` gets **one** element,
 * `div.ndd-panel-float__content`, and **one** component instance created on it (the element is
 * the component's host), both for the widget's whole life. Whatever shows the widget — its
 * frame's body today, a hosted panel's slot later — only moves the element in and out, so the
 * frame can be destroyed and created again without the content noticing, exactly as a workspace
 * panel survives its hosts (ADR 0002). The component's view is attached to `ApplicationRef`, as
 * `PanelHost` does for panels, so no frame's lifetime can reach it.
 *
 * The same rule as `PanelDomCache` (`../panel/panel-dom.ts`): an element is created **already in
 * the document**, in a hidden store, and an element no slot is showing goes back there. One
 * instance per overlay, never module-level. Ported from vdd `src/core/widgetContent.ts`, plus the
 * instances, which vdd leaves to a `<Teleport>`.
 * @internal
 */
import { signal, untracked } from '@angular/core';
import type { ComponentRef, Signal, Type } from '@angular/core';
import { moveInto, moveIntoWhenConnected } from '../core/dom-move';

/** Creates a widget's component on its element. Supplied by the overlay store, which has the injectors. */
export type ContentFactory = (id: string, type: Type<unknown>, host: HTMLElement) => ComponentRef<unknown>;

interface Entry {
  el: HTMLDivElement;
  ref: ComponentRef<unknown>;
  type: Type<unknown>;
  /** The inputs last applied, to set only what changed and clear what was dropped. */
  applied: Record<string, unknown>;
}

export class WidgetContentCache {
  private readonly entries = new Map<string, Entry>();
  private readonly map = signal<ReadonlyMap<string, HTMLDivElement>>(new Map());
  /**
   * The last on-screen scroll offset of each scrolled element inside a widget's content. Moving
   * the element between slots detaches it, which resets every offset inside it, so offsets are
   * recorded as they change and put back on attach. Recorded continuously, because by the time a
   * slot goes away the element may already be off screen and read 0.
   */
  private readonly scrolls = new WeakMap<HTMLElement, Map<Element, { top: number; left: number }>>();
  private hidden: HTMLElement | null = null;
  /** Where each element was last asked to be shown, and a move still waiting for that host. */
  private readonly claimedBy = new WeakMap<HTMLElement, Element>();
  private readonly pending = new Map<HTMLElement, () => void>();

  /** The document is resolved on first use, so constructing the cache touches nothing (SSR). */
  constructor(
    private readonly ownerDocument: () => Document,
    private readonly factory: ContentFactory,
  ) {}

  /** Each open widget's element, by id. Reactive: a slot follows its widget's element through it. */
  readonly elements: Signal<ReadonlyMap<string, HTMLDivElement>> = this.map.asReadonly();

  /** The off-screen store an element waits in while no slot shows it. */
  hiddenStore(): HTMLElement {
    if (!this.hidden || !this.hidden.isConnected) {
      const doc = this.ownerDocument();
      const el = doc.createElement('div');
      el.className = 'ndd-widget-store';
      doc.body.appendChild(el);
      this.hidden = el;
    }
    return this.hidden;
  }

  /**
   * Create a widget's content, or bring a live one up to date. A live id keeps its instance and
   * gets the changed inputs (an input dropped from the record is set to `undefined`, as
   * `*ngComponentOutlet` did); a different component replaces the instance and its element.
   */
  render(id: string, type: Type<unknown>, inputs: Record<string, unknown> = {}): void {
    untracked(() => {
      const live = this.entries.get(id);
      if (live && live.type === type) {
        this.applyInputs(live, inputs);
        return;
      }
      if (live) this.release(id);
      const el = this.createElement();
      const ref = this.factory(id, type, el);
      const entry: Entry = { el, ref, type, applied: {} };
      this.applyInputs(entry, inputs);
      this.entries.set(id, entry);
      this.map.update(m => new Map(m).set(id, el));
    });
  }

  /** This widget's element, or `undefined` when it is not open. Not reactive: see {@link elements}. */
  get(id: string): HTMLDivElement | undefined {
    return this.entries.get(id)?.el;
  }

  /** This widget's component instance, or `null`. For tests and diagnostics. */
  instance(id: string): unknown {
    return this.entries.get(id)?.ref.instance ?? null;
  }

  /**
   * Show `el` in `host`, with the scroll offsets it had inside. An element that keeps its embeds
   * (`preserveEmbeds`, 7.11) moves with `moveBefore()`, so it waits, where it is and connected,
   * until `host` is in the document: a frame's body is created before the frame is inserted.
   */
  attach(el: HTMLElement, host: HTMLElement): void {
    this.pending.get(el)?.();
    this.pending.delete(el);
    this.claimedBy.set(el, host);
    if (el.parentElement === host) return;
    let done = false;
    const cancel = moveIntoWhenConnected(host, el, () => {
      done = true;
      this.pending.delete(el);
      // A widget closed in between, or another slot took it meanwhile.
      if (!this.isLive(el) || this.claimedBy.get(el) !== host) return;
      this.show(el, host);
    });
    if (!done) this.pending.set(el, cancel);
  }

  private show(el: HTMLElement, host: HTMLElement): void {
    if (el.parentElement === host) return;
    moveInto(host, el);
    const record = this.scrolls.get(el);
    if (!record || record.size === 0) return;
    const apply = () =>
      record.forEach(({ top, left }, s) => {
        if (!s.isConnected) {
          record.delete(s);
          return;
        }
        if (s.scrollTop !== top) s.scrollTop = top;
        if (s.scrollLeft !== left) s.scrollLeft = left;
      });
    apply();
    // Again next frame: a slot the workspace has not laid out yet cannot take an offset at once.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
  }

  /**
   * Take `el` out of `host` into the hidden store, **only if it is still there**: another slot
   * may already have claimed it, so the order of one slot's removal and the next one's creation
   * does not matter. A released element (a closed widget's) is already out of every host.
   */
  leave(el: HTMLElement, host: Element): void {
    if (this.claimedBy.get(el) === host) {
      this.pending.get(el)?.();
      this.pending.delete(el);
      this.claimedBy.delete(el);
    }
    if (el.parentElement === host) moveInto(this.hiddenStore(), el);
  }

  private isLive(el: HTMLElement): boolean {
    for (const entry of this.entries.values()) if (entry.el === el) return true;
    return false;
  }

  /** Destroy a widget's component and take its element out of the document. Called on close. */
  release(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.pending.get(entry.el)?.();
    this.pending.delete(entry.el);
    // Destroying the view also detaches it from ApplicationRef.
    entry.ref.destroy();
    entry.el.remove();
    this.map.update(m => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }

  /** Destroy every widget's content and drop the hidden store. Called when the overlay is destroyed. */
  dispose(): void {
    for (const id of [...this.entries.keys()]) this.release(id);
    this.hidden?.remove();
    this.hidden = null;
  }

  private createElement(): HTMLDivElement {
    const el = this.ownerDocument().createElement('div');
    el.className = 'ndd-panel-float__content';
    const record = new Map<Element, { top: number; left: number }>();
    this.scrolls.set(el, record);
    el.addEventListener(
      'scroll',
      e => {
        const target = e.target;
        // An element being hidden or detached can report its reset to 0 as a scroll: ignored.
        if (!(target instanceof Element) || target.getClientRects().length === 0) return;
        record.set(target, { top: target.scrollTop, left: target.scrollLeft });
      },
      { capture: true, passive: true },
    );
    // In the document before the component exists: it is created connected, never detached.
    this.hiddenStore().appendChild(el);
    return el;
  }

  private applyInputs(entry: Entry, inputs: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(inputs)) {
      if (!(key in entry.applied) || !Object.is(entry.applied[key], value)) entry.ref.setInput(key, value);
    }
    for (const key of Object.keys(entry.applied)) if (!(key in inputs)) entry.ref.setInput(key, undefined);
    entry.applied = { ...inputs };
  }
}
