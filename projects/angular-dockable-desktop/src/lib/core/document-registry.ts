/**
 * The documents that hold panel content (1.12.0 groundwork for pop-out windows). A port of rdd
 * 7.12.1's `src/utils/documentRegistry.ts`, by way of vdd's `src/core/documentRegistry.ts`.
 *
 * Document-wide listeners the library needs wherever panel content is — the Escape listeners of
 * the context menu, the toolbar flyout and the overlays, and click-to-activate — are attached
 * through {@link listenOnDocuments}: on the main document, as before, and on every document
 * registered with {@link registerDocument}. A pop-out registers its child document when it opens
 * and calls the returned function when it closes; listeners follow, added to a document on its
 * first registration and removed on its last.
 *
 * A listener attached this way runs on each document separately: it acts only on the document the
 * event fired in ({@link eventDocument}), so an Escape in a pop-out closes that window's menu and
 * leaves the page's alone, and the other way round.
 *
 * Zone.js: a listener added on the main document is patched by zone.js like any other. One added
 * to a child window's document goes through that window's own `EventTarget`, which the pop-out
 * registry patches with zone.js's own patch when zone.js is loaded (ADR 0019); every listener here
 * only writes signals as well, which schedule change detection under either scheduler (ADR 0006).
 * @internal
 */

interface Subscription {
  type: string;
  listener: EventListener;
  options?: boolean | AddEventListenerOptions;
}

/** Registered documents other than the main one, with their registration counts. */
const counts = new Map<Document, number>();
const subscriptions = new Set<Subscription>();
/** Told when a document joins (first registration) or leaves (last one undone). */
const changeListeners = new Set<() => void>();
const changed = () => changeListeners.forEach(l => l());

const mainDocument = (): Document | null => (typeof document === 'undefined' ? null : document);

/** The main document and every registered one. */
function documents(): Document[] {
  const main = mainDocument();
  const others = Array.from(counts.keys()).filter(d => d !== main);
  return main ? [main, ...others] : others;
}

const attach = (doc: Document, s: Subscription) => doc.addEventListener(s.type, s.listener, s.options);
const detach = (doc: Document, s: Subscription) => doc.removeEventListener(s.type, s.listener, s.options);

/**
 * Adds `doc` to the documents the library listens on. Counted: a document registered twice stays
 * until both registrations are undone. Registering the main document has no effect (it is always
 * listened on). Returns the function that undoes this registration; calling it again does nothing.
 */
export function registerDocument(doc: Document): () => void {
  const isMain = doc === mainDocument();
  if (!isMain) {
    const n = counts.get(doc) ?? 0;
    counts.set(doc, n + 1);
    if (n === 0) {
      subscriptions.forEach(s => attach(doc, s));
      changed();
    }
  }
  let done = false;
  return () => {
    if (done || isMain) return;
    done = true;
    const n = counts.get(doc) ?? 0;
    if (n <= 1) {
      counts.delete(doc);
      subscriptions.forEach(s => detach(doc, s));
      changed();
    } else {
      counts.set(doc, n - 1);
    }
  };
}

/**
 * Listens for `type` on the main document and every registered document, now and as documents
 * come and go. Returns the function that removes the listener from all of them.
 */
export function listenOnDocuments<K extends keyof DocumentEventMap>(
  type: K,
  listener: (e: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): () => void {
  const s: Subscription = { type, listener: listener as EventListener, options };
  subscriptions.add(s);
  documents().forEach(d => attach(d, s));
  return () => {
    if (!subscriptions.delete(s)) return;
    documents().forEach(d => detach(d, s));
  };
}

/** Whether `doc` is the main document or a registered one (a pop-out's, while it is open). */
export function isRegistered(doc: Document): boolean {
  return doc === mainDocument() || counts.has(doc);
}

/**
 * Calls `cb` whenever a document joins or leaves (a pop-out window opening or closing). Returns
 * the function that stops it.
 */
export function onDocumentsChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => {
    changeListeners.delete(cb);
  };
}

/**
 * The document the user is in: a registered pop-out's whose `hasFocus()` is true, else the main
 * one (null on the server).
 */
export function focusedDocument(): Document | null {
  const main = mainDocument();
  for (const doc of counts.keys()) {
    if (doc === main) continue;
    try {
      if (doc.hasFocus()) return doc;
    } catch {
      /* a closed window's document */
    }
  }
  return main;
}

/**
 * The document a `listenOnDocuments` listener fired on: the event's `currentTarget`, else the
 * main one. A listener compares it with its own document to act only there.
 */
export function eventDocument(event: Event): Document | null {
  const target = event.currentTarget as Node | null;
  return target && target.nodeType === 9 ? (target as Document) : mainDocument();
}
