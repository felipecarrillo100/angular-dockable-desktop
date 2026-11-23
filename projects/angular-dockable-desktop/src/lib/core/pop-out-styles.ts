/**
 * Styles in a pop-out window (1.12.0; a port of rdd 7.12.1's `src/core/popOutStyles.ts`, S3, D9,
 * as vdd 1.14.0's `core/popOutStyles.ts`). Internal: not exported from the package.
 *
 * A pop-out's document starts with no styles of the page. While the window is open this keeps it
 * looking like the main window, by copying, never by patching (D9: no `insertRule` interception):
 *
 * - **The main `<head>`'s stylesheets**, every `<link rel=stylesheet>` and `<style>`, cloned in
 *   order after the child's own head content; the library's sheet and every component's styles
 *   (Angular adds them to the head) come that way. A `MutationObserver` keeps them in step: nodes
 *   added and removed, a `<style>`'s text, a link's `href` / `media` / `disabled`.
 *   `document.adoptedStyleSheets` are copied as one `<style data-ndd-adopted>` of their rules'
 *   text, re-read on those same changes (never polled). Rules a CSS-in-JS library inserts with
 *   `insertRule` leave their `<style>` empty and are not copied: that is what the app's
 *   `popoutWrapper` (P4) is for.
 * - **`<html>` and `<body>`**: every attribute but `style` as it is (skin, colour scheme, theme
 *   classes, `dir`, `lang`), plus the inline custom properties (`--*`) and `color-scheme`. Classes
 *   the child set itself are kept. A `MutationObserver` keeps them in step. (`document-mirror.ts`
 *   writes the library's own values, `data-ndd-skin`, `ndd-no-animations`, `--ndd-z-base`, onto
 *   the main `<html>`; they arrive here with the rest, so the mirror never runs for the child.)
 * - **The workspace's scope on the frame**: its `data-color-scheme`, `data-ndd-skin` and
 *   `ndd-no-animations`, so scheme- and skin-scoped rules apply inside the frame as inside the
 *   workspace.
 *
 * `onReady` is called once every link copied at the start has loaded or failed, or after a short
 * limit, so the frame can stay hidden rather than flash unstyled.
 *
 * Zone.js: the caller starts this outside the Angular zone (the frame does), so the observers, the
 * links' listeners and the timer, which only touch the DOM, never run the application's change
 * detection; `onReady` writes a signal, which schedules a render under either scheduler.
 * @internal
 */
/** How long the frame may stay hidden waiting for copied stylesheets. */
export const POPOUT_STYLES_TIMEOUT_MS = 3000;

/** The workspace attributes the frame repeats (what the scheme and skin rules match on). */
const SCOPE_ATTRIBUTES = ['data-color-scheme', 'data-ndd-skin'];
const SCOPE_CLASSES = ['ndd-no-animations'];

export interface PopOutStylesOptions {
  /** The pop-out's document. */
  child: Document;
  /** The library's frame in it, which repeats the workspace's scope. */
  frame: HTMLElement;
  /** The workspace element whose scope the frame repeats; none, nothing is repeated. */
  scope: Element | null;
  /** Called once the copied stylesheets have loaded (or failed, or the limit passed). */
  onReady: () => void;
  /** The main document. */
  main?: Document;
  timeoutMs?: number;
}

const isSheetNode = (n: Node): n is HTMLLinkElement | HTMLStyleElement => {
  if (n.nodeType !== 1) return false;
  const el = n as Element;
  if (el.localName === 'style') return true;
  return el.localName === 'link' && (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet');
};

/** Copies `src`'s attributes onto `dst` (absolute `href` for a link, which may live under another URL). */
function copyAttributes(src: Element, dst: Element): void {
  for (const { name } of Array.from(dst.attributes)) if (!src.hasAttribute(name)) dst.removeAttribute(name);
  for (const { name, value } of Array.from(src.attributes)) {
    const v = name === 'href' && src.localName === 'link' ? (src as HTMLLinkElement).href : value;
    if (dst.getAttribute(name) !== v) dst.setAttribute(name, v);
  }
}

/** The text of the main document's constructed sheets, or null when it has none (or can't say). */
function adoptedText(main: Document): string | null {
  const sheets = (main as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets;
  if (!sheets || sheets.length === 0) return null;
  const parts: string[] = [];
  for (const sheet of sheets) {
    try {
      parts.push(Array.from(sheet.cssRules, r => r.cssText).join('\n'));
    } catch {
      /* unreadable */
    }
  }
  return parts.join('\n');
}

/**
 * Mirrors `src` onto `dst`: every attribute but `style`, and the inline custom properties and
 * `color-scheme`. What the mirror set before and `src` no longer has is removed; anything else the
 * child set on `dst` (its own classes, its own inline layout) is left alone.
 */
function createElementMirror(src: Element, dst: Element): () => void {
  let copiedAttrs = new Set<string>();
  let copiedClasses = new Set<string>();
  let copiedProps = new Set<string>();
  return () => {
    const attrs = new Set<string>();
    for (const { name, value } of Array.from(src.attributes)) {
      if (name === 'style') continue;
      attrs.add(name);
      if (name === 'class') continue;
      if (dst.getAttribute(name) !== value) dst.setAttribute(name, value);
    }
    for (const name of copiedAttrs) if (!attrs.has(name) && name !== 'class') dst.removeAttribute(name);
    copiedAttrs = attrs;
    // Classes: the source's, plus whatever the child added itself.
    const classes = new Set(Array.from(src.classList));
    for (const c of copiedClasses) if (!classes.has(c)) dst.classList.remove(c);
    for (const c of classes) if (!dst.classList.contains(c)) dst.classList.add(c);
    copiedClasses = classes;
    // Inline custom properties and color-scheme.
    const srcStyle = (src as HTMLElement).style;
    const dstStyle = (dst as HTMLElement).style;
    if (!srcStyle || !dstStyle) return;
    const props = new Set<string>();
    for (const name of Array.from(srcStyle)) {
      if (!name.startsWith('--') && name !== 'color-scheme') continue;
      props.add(name);
      const value = srcStyle.getPropertyValue(name);
      const priority = srcStyle.getPropertyPriority(name);
      if (dstStyle.getPropertyValue(name) !== value || dstStyle.getPropertyPriority(name) !== priority) {
        dstStyle.setProperty(name, value, priority);
      }
    }
    for (const name of copiedProps) if (!props.has(name)) dstStyle.removeProperty(name);
    copiedProps = props;
  };
}

/** Starts keeping the pop-out's styles in step with the main window. Returns the function that stops it. */
export function startPopOutStyles({
  child,
  frame,
  scope,
  onReady,
  main = document,
  timeoutMs = POPOUT_STYLES_TIMEOUT_MS,
}: PopOutStylesOptions): () => void {
  const clones = new Map<Node, Element>();
  let adopted: HTMLStyleElement | null = null;
  const observers: MutationObserver[] = [];
  const MainObserver = (main.defaultView as (Window & typeof globalThis) | null)?.MutationObserver ?? MutationObserver;

  // ── the head ──
  const syncHead = () => {
    const sources = Array.from(main.head.querySelectorAll('link, style')).filter(isSheetNode);
    const live = new Set<Node>(sources);
    for (const [src, clone] of clones)
      if (!live.has(src)) {
        clone.remove();
        clones.delete(src);
      }
    for (const src of sources) {
      let clone = clones.get(src);
      if (!clone) {
        clone = child.importNode(src, true) as Element;
        copyAttributes(src, clone);
        clones.set(src, clone);
      } else {
        copyAttributes(src, clone);
        if (src.localName === 'style' && clone.textContent !== src.textContent) clone.textContent = src.textContent;
      }
    }
    // The constructed sheets, after the rest, as they would cascade.
    const text = adoptedText(main);
    if (text === null) {
      adopted?.remove();
      adopted = null;
    } else {
      if (!adopted) {
        adopted = child.createElement('style');
        adopted.setAttribute('data-ndd-adopted', '');
      }
      if (adopted.textContent !== text) adopted.textContent = text;
    }
    // In order, after the child's own head content: moved only when out of order.
    const wanted = [...sources.map(s => clones.get(s)!), ...(adopted ? [adopted] : [])];
    const present = Array.from(child.head.children).filter(el => wanted.includes(el));
    if (present.length !== wanted.length || present.some((el, i) => el !== wanted[i])) {
      for (const el of wanted) child.head.appendChild(el);
    }
  };

  // ── <html>, <body>, and the workspace's scope on the frame ──
  const syncHtml = createElementMirror(main.documentElement, child.documentElement);
  const syncBody = createElementMirror(main.body, child.body);
  const syncScope = () => {
    if (!scope) return;
    for (const name of SCOPE_ATTRIBUTES) {
      const v = scope.getAttribute(name);
      if (v === null) frame.removeAttribute(name);
      else if (frame.getAttribute(name) !== v) frame.setAttribute(name, v);
    }
    for (const c of SCOPE_CLASSES) frame.classList.toggle(c, scope.classList.contains(c));
  };

  syncHead();
  syncHtml();
  syncBody();
  syncScope();

  const watch = (target: Node, init: MutationObserverInit, fn: () => void) => {
    const o = new MainObserver(fn);
    o.observe(target, init);
    observers.push(o);
  };
  watch(
    main.head,
    {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'media', 'disabled', 'rel', 'type'],
    },
    syncHead,
  );
  // An adopted sheet changes with no DOM change of its own: re-read whenever the page's <html> does too.
  watch(main.documentElement, { attributes: true }, () => {
    syncHtml();
    syncHead();
  });
  watch(main.body, { attributes: true }, syncBody);
  if (scope) watch(scope, { attributes: true, attributeFilter: [...SCOPE_ATTRIBUTES, 'class'] }, syncScope);

  // ── ready: every link copied now has loaded or failed, or the limit passed ──
  let done = false;
  const ready = () => {
    if (!done) {
      done = true;
      clearTimeout(timer);
      onReady();
    }
  };
  const links = Array.from(clones.values()).filter(el => el.localName === 'link');
  let pending = links.length;
  const settle = () => {
    if (--pending <= 0) ready();
  };
  for (const link of links) {
    link.addEventListener('load', settle, { once: true });
    link.addEventListener('error', settle, { once: true });
  }
  const timer = setTimeout(ready, timeoutMs);
  if (pending === 0) ready();

  return () => {
    done = true;
    clearTimeout(timer);
    observers.splice(0).forEach(o => o.disconnect());
    for (const link of links) {
      link.removeEventListener('load', settle);
      link.removeEventListener('error', settle);
    }
  };
}
