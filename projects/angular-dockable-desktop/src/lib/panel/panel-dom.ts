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
  /** Owned per panel and outliving the hidden period (vdd ADR 0014, M0 finding 1). */
  private readonly preserved = new Map<string, Preserved>();
  /** The last laid-out size, which outlives any host — the taskbar preview scales from it. */
  private readonly sizes = new Map<string, { width: number; height: number }>();
  private hidden: HTMLElement | null = null;
  private moving = false;

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
    el.appendChild(content);
    this.contents.set(id, content);
    return content;
  }

  /** Every content element, for attributes that follow the workspace (direction). */
  allContents(): Iterable<HTMLDivElement> {
    return this.contents.values();
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
      target.appendChild(el);
    } finally {
      this.moving = false;
    }
    if (preserve) this.apply(id, el, options?.refocus === true);
  }

  /** Forget a panel entirely. Called when the panel closes. */
  release(id: string): void {
    this.elements.get(id)?.remove();
    this.elements.delete(id);
    this.contents.delete(id);
    this.preserved.delete(id);
    this.sizes.delete(id);
  }

  /** Drop every element and the store. */
  dispose(): void {
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
    this.contents.clear();
    this.preserved.clear();
    this.sizes.clear();
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
        if (!(s instanceof Element) || !isLaidOut(el)) return;
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
        const active = this.doc.activeElement;
        if (el.isConnected && isLaidOut(el) && !(active && el.contains(active))) this.record(id).focus = null;
      });
    });
  }

  private remember(id: string, el: HTMLElement): void {
    if (!isLaidOut(el)) return; // detached or hidden: the live record stands
    const scrolls = scrollables(el).map(s => ({ el: s, top: s.scrollTop, left: s.scrollLeft }));
    let focus: Preserved['focus'] = null;
    const active = this.doc.activeElement as HTMLElement | null;
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
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => isLaidOut(el) && run());
  }
}
