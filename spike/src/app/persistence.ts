/**
 * M0 spike — the persistence port, ported from vdd `src/core/panelDom.ts`.
 *
 * Each panel owns ONE element for its whole lifetime. Moving a panel moves that element;
 * Angular never observes the move. Scroll offsets and focus are recorded per panel while it
 * is laid out and re-applied whenever it is laid out again (vdd ADR 0014).
 *
 * Difference from vdd: an element can be *registered* rather than created here, because the
 * fallback strategy (a persistent ViewContainerRef) has Angular create the host element.
 */

interface Preserved {
  scrolls: { el: Element; top: number; left: number }[];
  focus: { el: HTMLElement; start: number | null; end: number | null } | null;
}

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
  private elements = new Map<string, HTMLElement>();
  private preserved = new Map<string, Preserved>();
  private hidden: HTMLElement | null = null;
  private moving = false;

  constructor(private readonly doc: Document = document) {}

  hiddenStore(): HTMLElement {
    if (!this.hidden || !this.hidden.isConnected) {
      const el = this.doc.createElement('div');
      el.className = 'ndd-panel-store';
      el.style.display = 'none';
      this.doc.body.appendChild(el);
      this.hidden = el;
    }
    return this.hidden;
  }

  /** Create this panel's element (primary strategy), already in the document. */
  elementFor(id: string): HTMLElement {
    let el = this.elements.get(id);
    if (!el) {
      el = this.doc.createElement('div');
      el.className = 'ndd-panel-mount';
      el.dataset['nddPanel'] = id;
      this.hiddenStore().appendChild(el);
      this.register(id, el);
    }
    return el;
  }

  /** Adopt an element Angular created (fallback strategy). */
  register(id: string, el: HTMLElement): void {
    this.elements.set(id, el);
    this.track(id, el);
  }

  /**
   * Keep the preserved record current from live events, not only at move time.
   *
   * Angular removes a destroyed host's DOM *before* any destroy hook runs, so a panel whose
   * host is destroyed (a leaf re-created by a split) is detached with no chance to capture
   * first — and a detached subtree reads scrollTop 0. A record refreshed on every scroll and
   * focus change is already correct whenever the detach happens. Not in vdd; found here.
   */
  private track(id: string, el: HTMLElement): void {
    el.addEventListener('scroll', ev => {
      const s = ev.target as Element;
      if (!isLaidOut(el) || !(s instanceof Element)) return;
      const rec = this.record(id);
      const hit = rec.scrolls.find(r => r.el === s);
      if (hit) { hit.top = s.scrollTop; hit.left = s.scrollLeft; }
      else rec.scrolls.push({ el: s, top: s.scrollTop, left: s.scrollLeft });
    }, { capture: true, passive: true });
    el.addEventListener('focusin', ev => {
      this.record(id).focus = { el: ev.target as HTMLElement, start: null, end: null };
    });
    el.addEventListener('focusout', () => {
      // Chrome fires blur/focusout *synchronously during removal* of a focused subtree, while
      // the element still reports isConnected. So: ignore our own moves outright, and for a
      // detach we did not make (a host destroyed by Angular) decide one microtask later — a
      // genuine blur leaves the panel laid out with focus elsewhere; a detach does not.
      if (this.moving) return;
      queueMicrotask(() => {
        const active = this.doc.activeElement;
        if (el.isConnected && isLaidOut(el) && !(active && el.contains(active))) this.record(id).focus = null;
      });
    });
  }

  private record(id: string): Preserved {
    let rec = this.preserved.get(id);
    if (!rec) { rec = { scrolls: [], focus: null }; this.preserved.set(id, rec); }
    return rec;
  }

  moveTo(id: string, host: HTMLElement | null, refocus: boolean, preserve = true): void {
    const el = this.elements.get(id);
    if (!el) return;
    const target = host ?? this.hiddenStore();
    if (el.parentElement === target) return;
    this.remember(id, el);
    this.moving = true;
    try { target.appendChild(el); } finally { this.moving = false; }
    if (preserve) this.apply(id, el, refocus);
  }

  private remember(id: string, el: HTMLElement): void {
    if (!isLaidOut(el)) return;               // detached or hidden: the live record stands
    const scrolls = scrollables(el).map(s => ({ el: s, top: s.scrollTop, left: s.scrollLeft }));
    let focus: Preserved['focus'] = null;
    const active = this.doc.activeElement as HTMLElement | null;
    if (active && el.contains(active)) {
      const field = active as HTMLInputElement;
      const hasSelection = 'selectionStart' in field && field.selectionStart !== null;
      focus = {
        el: active,
        start: hasSelection ? field.selectionStart : null,
        end: hasSelection ? field.selectionEnd : null,
      };
    }
    this.preserved.set(id, { scrolls, focus });
  }

  private apply(id: string, el: HTMLElement, refocus: boolean): void {
    const record = this.preserved.get(id);
    if (!record) return;
    const run = () => {
      for (const s of record.scrolls) { s.el.scrollTop = s.top; s.el.scrollLeft = s.left; }
      if (refocus && record.focus) {
        record.focus.el.focus({ preventScroll: true });
        if (record.focus.start !== null) {
          try {
            (record.focus.el as HTMLInputElement).setSelectionRange(record.focus.start, record.focus.end ?? record.focus.start);
          } catch { /* element does not support selection */ }
        }
      }
    };
    if (isLaidOut(el)) run();
    requestAnimationFrame(() => { if (isLaidOut(el)) run(); });
  }
}
