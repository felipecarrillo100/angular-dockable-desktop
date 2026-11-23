/**
 * The persistence port: the mechanism that makes a panel survive being moved (ADR 0002).
 *
 * Each panel owns **one** element for its whole lifetime (`.ndd-panel-mount`), holding the
 * element its component is created on (`.ndd-panel-content`). Moving a panel between the grid,
 * a floating window, a hover preview and the off-screen store moves that element — Angular
 * never observes it, so the component, its WebGL context, media and sockets survive.
 *
 * Ported from vdd `src/core/panelDom.ts` plus the M0 spike's finding: preserved scroll and
 * focus are also **tracked live**, because Angular removes a destroyed host's DOM before any
 * destroy hook runs — a panel inside it is detached with no chance to capture first.
 *
 * One instance per `<ndd-desktop>`, never module-level: two workspaces must not share DOM.
 */
import { signal, untracked } from '@angular/core';
import { moveInto, preservesEmbeds, setPreserveEmbeds } from '../core/dom-move';
import { docOf, isElement, rafOf } from '../core/dom-context';

/**
 * What a hosted panel shows (7.11, widgets out of the panel): the content element of the managed
 * widget it hosts, owned by the widget's overlay, and that overlay's content cache, which moves
 * the element in and out and keeps its scroll offsets. rdd's `setHostedContent(id, el)`, vdd's
 * `HostedContent`.
 */
export interface HostedContent {
  el: HTMLElement;
  cache: { attach(el: HTMLElement, host: HTMLElement): void; leave(el: HTMLElement, host: Element): void };
}

interface Preserved {
  scrolls: { el: Element; top: number; left: number }[];
  focus: { el: HTMLElement; start: number | null; end: number | null } | null;
}

/** Does this element currently participate in layout? */
function isLaidOut(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

function scrollables(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) out.push(el);
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  return out;
}

export class PanelDomCache {
  private readonly elements = new Map<string, HTMLDivElement>();
  private readonly contents = new Map<string, HTMLDivElement>();
  /** The element each content element is in when it isn't the mount: the app's popoutWrapper (1.12.0). */
  private readonly contentParents = new Map<string, Element>();
  /** Owned per panel and outliving the hidden period (vdd ADR 0014, M0 finding 1). */
  private readonly preserved = new Map<string, Preserved>();
  /** The last laid-out size, which outlives any host — the taskbar preview scales from it. */
  private readonly sizes = new Map<string, { width: number; height: number }>();
  private hidden: HTMLElement | null = null;
  private moving = false;
  /**
   * Each hosted panel's content, by panel id (7.11), registered by the widget's overlay
   * **before** it opens the panel and cleared after it removes it. A signal, so a hosted panel's
   * slot follows it: a widget closed and re-opened in one tick under the same panel id is a new
   * element under an unchanged id.
   */
  private readonly hosted = signal<ReadonlyMap<string, HostedContent>>(new Map());
  /**
   * The slots alive for each panel, in the order they were created (7.11, `preserveEmbeds`): where
   * a parked element that keeps its embeds goes back to after a render. See `PanelHost`.
   */
  private readonly slots = new Map<string, HTMLElement[]>();

  constructor(private readonly doc: Document) {}

  /** The off-screen store. Panels live here while minimised, and before their first host. */
  hiddenStore(): HTMLElement {
    if (!this.hidden || !this.hidden.isConnected) {
      const el = this.doc.createElement('div');
      el.className = 'ndd-panel-store';
      this.doc.body.appendChild(el);
      this.hidden = el;
    }
    return this.hidden;
  }

  /** This panel's element, created on first ask, already in the document (in the store). */
  elementFor(id: string): HTMLDivElement {
    let el = this.elements.get(id);
    if (!el) {
      el = this.doc.createElement('div');
      el.className = 'ndd-panel-mount';
      // setAttribute, not dataset: the server DOM (Domino) has no `dataset`, and a throw here left
      // every server-rendered workspace empty (found by the M13 SSR smoke).
      el.setAttribute('data-ndd-panel', id);
      const content = this.doc.createElement('div');
      content.className = 'ndd-panel-content';
      el.appendChild(content);
      this.hiddenStore().appendChild(el);
      this.elements.set(id, el);
      this.contents.set(id, content);
      this.track(id, el);
    }
    return el;
  }

  /** The element the panel's component is created on (inside {@link elementFor}). */
  contentFor(id: string): HTMLDivElement {
    this.elementFor(id);
    return this.contents.get(id)!;
  }

  /**
   * Replace a panel's content element with a fresh one — for swapping a lazy panel's
   * placeholder for its real component, since destroying a component may take its host with it.
   * The panel's own mount element, and therefore its place in the layout, is untouched.
   */
  resetContent(id: string): HTMLDivElement {
    const el = this.elementFor(id);
    this.contents.get(id)?.remove();
    const content = this.doc.createElement('div');
    content.className = 'ndd-panel-content';
    // Inside the app's popoutWrapper when there is one (1.12.0), where the first one was.
    (this.contentParents.get(id) ?? el).appendChild(content);
    this.contents.set(id, content);
    return content;
  }

  /**
   * Where a panel's content element goes when it is replaced (1.12.0): inside the app's
   * `popoutWrapper` around it, rather than straight in its mount element.
   */
  setContentParent(id: string, parent: Element): void {
    this.contentParents.set(id, parent);
  }

  /** Every content element, for attributes that follow the workspace (direction). */
  allContents(): Iterable<HTMLDivElement> {
    return this.contents.values();
  }

  /** A hosted panel's content, or `undefined` (an ordinary panel, or none registered). Reactive. */
  hostedContent(id: string): HostedContent | undefined {
    return this.hosted().get(id);
  }

  /** Register (or, with `null`, clear) the content a hosted panel shows. */
  setHostedContent(id: string, content: HostedContent | null): void {
    const current = untracked(this.hosted);
    if (content === null && !current.has(id)) return;
    const next = new Map(current);
    if (content) next.set(id, content);
    else next.delete(id);
    this.hosted.set(next);
  }

  has(id: string): boolean {
    return this.elements.has(id);
  }

  reportSize(id: string, size: { width: number; height: number }): void {
    this.sizes.set(id, size);
  }

  /** The size a panel was last laid out at, or a sensible default for a thumbnail. */
  sizeOf(id: string): { width: number; height: number } {
    return this.sizes.get(id) ?? { width: 800, height: 500 };
  }

  /** The host this panel's element is currently inside. */
  hostOf(id: string): HTMLElement | null {
    return this.elements.get(id)?.parentElement ?? null;
  }

  /**
   * Move a panel's element into `host` (or the store when `null`), preserving scroll and focus.
   * @param options.refocus restore focus too — only when the panel is becoming the active one,
   *   so a background restore never steals the caret.
   */
  moveTo(id: string, host: HTMLElement | null, options?: { refocus?: boolean; preserveScroll?: boolean }): void {
    const el = this.elementFor(id);
    const target = host ?? this.hiddenStore();
    if (el.parentElement === target) return;
    const preserve = options?.preserveScroll !== false;
    if (preserve) this.remember(id, el);
    this.moving = true;
    try {
      // With moveBefore() for an element that keeps its embeds (see ../core/dom-move.ts).
      moveInto(target, el);
    } finally {
      this.moving = false;
    }
    if (preserve) this.apply(id, el, options?.refocus === true);
  }

  /**
   * Marks a panel's element as keeping its embeds alive when it moves (rdd 7.11.0): a panel type
   * with `preserveEmbeds`, and, for a widget with it, its owner panel's element and its hosted
   * panel's. Only switches on, for the element's life.
   */
  preserveEmbeds(id: string): void {
    setPreserveEmbeds(this.elementFor(id), true);
  }

  /** Whether this panel's element keeps its embeds alive (`false` for an unknown id). */
  preservesEmbeds(id: string): boolean {
    const el = this.elements.get(id);
    return !!el && preservesEmbeds(el);
  }

  /** The ids of the open panels whose elements keep their embeds alive. */
  preservingIds(): string[] {
    return [...this.elements].filter(([, el]) => preservesEmbeds(el)).map(([id]) => id);
  }

  /** Whether this panel's element is in the off-screen store. */
  isParked(id: string): boolean {
    const el = this.elements.get(id);
    return !!el && !!this.hidden && el.parentElement === this.hidden;
  }

  /** A slot for this panel was created (`[nddPanelSlot]`). Returns its unregister function. */
  registerSlot(id: string, host: HTMLElement): () => void {
    const list = this.slots.get(id) ?? [];
    list.push(host);
    this.slots.set(id, list);
    return () => {
      const now = this.slots.get(id);
      if (!now) return;
      const rest = now.filter(h => h !== host);
      if (rest.length > 0) this.slots.set(id, rest);
      else this.slots.delete(id);
    };
  }

  /** The newest slot alive for this panel, in the document or not, or `null`. */
  newestSlot(id: string): HTMLElement | null {
    return this.slots.get(id)?.at(-1) ?? null;
  }

  /** The newest slot alive for this panel that is in the document, or `null`. */
  liveSlot(id: string): HTMLElement | null {
    const list = this.slots.get(id) ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.isConnected) return list[i]!;
    return null;
  }

  /** Forget a panel entirely. Called when the panel closes. */
  release(id: string): void {
    this.elements.get(id)?.remove();
    this.elements.delete(id);
    this.contents.delete(id);
    this.contentParents.delete(id);
    this.preserved.delete(id);
    this.sizes.delete(id);
  }

  /** Drop every element and the store. */
  dispose(): void {
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
    this.contents.clear();
    this.contentParents.clear();
    this.preserved.clear();
    this.sizes.clear();
    this.hosted.set(new Map());
    this.slots.clear();
    this.hidden?.remove();
    this.hidden = null;
  }

  // ── scroll and focus ───────────────────────────────────────────────────────

  private record(id: string): Preserved {
    let rec = this.preserved.get(id);
    if (!rec) {
      rec = { scrolls: [], focus: null };
      this.preserved.set(id, rec);
    }
    return rec;
  }

  /** Keep the record current from live events, for detaches this class does not make. */
  private track(id: string, el: HTMLElement): void {
    el.addEventListener(
      'scroll',
      ev => {
        const s = ev.target;
        // Any window's element (1.12.0): a panel shown in a pop-out scrolls there.
        if (!isElement(s) || !isLaidOut(el)) return;
        const rec = this.record(id);
        const hit = rec.scrolls.find(r => r.el === s);
        if (hit) {
          hit.top = s.scrollTop;
          hit.left = s.scrollLeft;
        } else rec.scrolls.push({ el: s, top: s.scrollTop, left: s.scrollLeft });
      },
      { capture: true, passive: true },
    );
    el.addEventListener('focusin', ev => {
      this.record(id).focus = { el: ev.target as HTMLElement, start: null, end: null };
    });
    el.addEventListener('focusout', () => {
      // Chrome fires focusout *synchronously during removal*, while isConnected is still true:
      // ignore our own moves, and judge foreign detaches one microtask later (M0 finding 2).
      if (this.moving) return;
      queueMicrotask(() => {
        // The element's own document (1.12.0): a panel shown in a pop-out keeps its focus there.
        const active = docOf(el).activeElement;
        if (el.isConnected && isLaidOut(el) && !(active && el.contains(active))) this.record(id).focus = null;
      });
    });
  }

  private remember(id: string, el: HTMLElement): void {
    if (!isLaidOut(el)) return; // detached or hidden: the live record stands
    const scrolls = scrollables(el).map(s => ({ el: s, top: s.scrollTop, left: s.scrollLeft }));
    let focus: Preserved['focus'] = null;
    // The element's own document (1.12.0).
    const active = docOf(el).activeElement as HTMLElement | null;
    if (active && el.contains(active)) {
      const field = active as HTMLInputElement;
      const hasSelection = 'selectionStart' in field && field.selectionStart !== null;
      focus = { el: active, start: hasSelection ? field.selectionStart : null, end: hasSelection ? field.selectionEnd : null };
    }
    this.preserved.set(id, { scrolls, focus });
  }

  private apply(id: string, el: HTMLElement, refocus: boolean): void {
    const record = this.preserved.get(id);
    if (!record) return;
    const run = () => {
      for (const s of record.scrolls) {
        s.el.scrollTop = s.top;
        s.el.scrollLeft = s.left;
      }
      if (refocus && record.focus) {
        record.focus.el.focus({ preventScroll: true });
        if (record.focus.start !== null) {
          try {
            (record.focus.el as HTMLInputElement).setSelectionRange(record.focus.start, record.focus.end ?? record.focus.start);
          } catch {
            /* the element does not support selection */
          }
        }
      }
    };
    if (isLaidOut(el)) run();
    // Again next frame: on the way out of the store the subtree is not laid out yet.
    // On the element's window's frame (1.12.0).
    rafOf(el)?.(() => isLaidOut(el) && run());
  }
}
