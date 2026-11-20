/**
 * Moving a panel's or a widget's element between slots, keeping embedded state where asked to
 * (rdd 7.11.0, `preserveEmbeds`). rdd's `components/domMove.ts`, vdd's `core/domMove.ts`.
 *
 * An element moved with `appendChild` is removed and re-inserted: an `<iframe>` in it reloads.
 * `moveBefore()` (Chrome and Edge 133+, Firefox 144+) moves it without that, but only between two
 * places in the same document that are both connected. So an element that preserves its embeds is
 * moved with it when it can be, and parked in a hidden store (connected), never detached, between
 * slots. Everything else moves exactly as before.
 *
 * As in vdd, each cache parks in its own hidden store (`PanelDomCache`, `WidgetContentCache`).
 * What is particular to Angular is *when* a marked element must be parked: Angular removes a
 * destroyed view's DOM before any destroy hook runs (ADR 0002), so a slot can't park in
 * `ngOnDestroy`; see `PanelHost` (the panels) and `NddPanelOverlay` (a widget's frame).
 * @internal
 */

const preserving = new WeakSet<Element>();

/**
 * Marks an element (a panel's, or a widget's content) as keeping its embeds alive. Marks only
 * switch on, for the element's life: a container that held such an element once may hold it again.
 */
export function setPreserveEmbeds(el: Element, on: boolean): void {
  if (on) preserving.add(el);
  else preserving.delete(el);
}

/** Whether an element keeps its embeds alive when it moves. */
export function preservesEmbeds(el: Element): boolean {
  return preserving.has(el);
}

type WithMoveBefore = Element & { moveBefore?: (node: Node, child: Node | null) => void };

/** Appends `el` to `parent`: with `moveBefore()` when the element asks for it and it applies. */
export function moveInto(parent: Element, el: Element): void {
  const p = parent as WithMoveBefore;
  if (
    preserving.has(el) &&
    typeof p.moveBefore === 'function' &&
    parent.isConnected &&
    el.isConnected &&
    parent.ownerDocument === el.ownerDocument
  ) {
    try {
      p.moveBefore(el, null);
      return;
    } catch {
      // A move the browser refuses (a state it doesn't allow) falls back to a plain move.
    }
  }
  parent.appendChild(el);
}

/**
 * Runs `move` (moving `el` into `slot`) once the slot is in the document. A slot is created
 * before a freshly created subtree (a new floating window, a new group) is inserted, and
 * `moveBefore()` needs both ends connected, so an element that keeps its embeds waits (where it
 * is, still connected) rather than fall back to a move that reloads them: a microtask first, then
 * frame by frame, bounded. Any other element moves at once, as before. Returns a cancel function
 * for the slot's destruction.
 */
export function moveIntoWhenConnected(slot: Element, el: Element, move: () => void = () => moveInto(slot, el)): () => void {
  if (!preserving.has(el) || slot.isConnected) {
    move();
    return () => undefined;
  }
  let cancelled = false;
  let frames = 0;
  const frame =
    typeof requestAnimationFrame === 'undefined'
      ? (cb: () => void) => {
          setTimeout(cb, 16);
        }
      : (cb: () => void) => {
          requestAnimationFrame(cb);
        };
  const attempt = (): void => {
    if (cancelled) return;
    // A slot that never connects (it was left detached) still gets its element, after a while.
    if (slot.isConnected || ++frames > 60) {
      move();
      return;
    }
    frame(attempt);
  };
  queueMicrotask(attempt);
  return () => {
    cancelled = true;
  };
}
