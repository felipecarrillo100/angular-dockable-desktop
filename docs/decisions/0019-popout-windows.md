# 0019 — Pop-out windows: zone.js patched per window, the desktop owns them, the wrapper is a component type

**Status:** Accepted (2026-11-22, for ndd 1.12.0, parity react-dockable-desktop 7.12.1; vdd 1.14.0
made the same port, its ADR 0022). Ports a design already settled in rdd
(`docs/plan-widgets-out-of-the-panel.md` §10); this records only where Angular, or ndd's own
earlier decisions, made ndd choose. Builds on [0002](0002-zero-unmount-via-host-element.md),
[0006](0006-zoneless-first.md) and [0008](0008-layout-json-compatibility.md), and changes none of
them.

## Context

rdd 7.12.0 and 7.12.1 let a panel, or a managed widget out of its panel, move into its own browser
window and come back without its component being re-created. The family rule is that vdd and ndd
follow, with the same names and the same observable behaviour, and that saved layouts stay
compatible.

The design was taken in rdd and is not reopened: the store marks the panel
(`PanelInfo.poppedOut`), a windows registry outside the store opens the window synchronously in the
user's click, the page's styles are copied into the child, the four events are sent around each
move, and every way back ends in one function (`back(id, restorePlace)`). ndd ported from vdd's
finished port, with rdd the authority, and built the final 7.12.1 behaviour directly.

The places below did not map one to one, because of how Angular renders, injects and schedules
change detection, and because of ndd's own gate rules.

## Decision

1. **Each child window gets zone.js's own `EventTarget` patch.** A spike (a throwaway app in real
   Chrome, `?zone`) showed that template listeners in a popped-out panel render, since Angular put
   them on elements created by the page's document, which zone.js patched; but a listener on the
   child's own `window` or `document` (the content's, or the library's through the document
   registry) runs outside the Angular zone, so a plain field it writes never renders. ndd supports
   zone.js ([0006](0006-zoneless-first.md)), so the registry applies
   `Zone.__load_patch(…, api.patchEventTarget(child, api, [child.EventTarget.prototype]))` right
   after `window.open` and again when the page attaches (it is idempotent). Without zone.js it does
   nothing. The child's frames that `whenPlaced` waits on are wrapped in the current zone
   (`Zone.current.wrap`). Only `EventTarget` is patched: the child's own timers and observers stay
   unpatched, and the manual says to write signals there.

2. **The library's own window work runs outside the zone.** The 500 ms closed-window poll runs in
   `Zone.root`, and the style copy (`pop-out-styles.ts`: the head copy, its `MutationObserver`s, the
   `<html>` / `<body>` mirror) starts inside `NgZone.runOutsideAngular`, as 0006 already requires of
   high-frequency listeners. Their outcomes only write signals (`onReady`, the entries), which
   schedule change detection under zone.js too.

3. **The registry belongs to `<ndd-desktop>`,** as in vdd: the desktop provides it (internal token
   `POP_OUT_WINDOWS`), binds it to the workspace after its first render (`bindPopOutWindows`), and
   lends it the panel host (park, rect, element, whether parked). Destroying the desktop brings every
   panel back first. The workspace keeps the state and the public actions; it answers `'disabled'`
   itself and `'no-window'` while no registry is bound. The windows follow the store through an
   internal synchronous `onPopOutEnded(id)`. So `popoutUrl` and `popoutWrapper` are inputs on
   `ndd-desktop`, beside `skin` and `taskbar`, not `provideDockableDesktop` options.

4. **The frame is portalled into the child's `<body>`, holding the panel's ordinary slot.**
   `NddPopOutFrame` renders `.ndd-workspace.ndd-popout-frame` through `[nddPortal]` into the child's
   body, with `[nddPanelSlot]` inside, so the panel's library-owned host element
   ([0002](0002-zero-unmount-via-host-element.md)) moves in as it moves into any other slot: nothing
   is re-created, and no new destroy path exists. Its size observer is rebuilt in the child's realm
   and back. The frame's `class` is static in its template, so Angular never overwrites the
   `ndd-no-animations` toggle the styles module writes.

5. **The wrapper is a component type, and its context is dependency injection.** rdd's
   `popoutWrapper` is a React component given `{ window, document, children }`, whose context
   providers reach the panel. An Angular template can't hand injection to content it didn't declare,
   so `[popoutWrapper]` takes a `Type<PopoutWrapper>`: a component with the inputs `window` and
   `document` and an `<ng-content />`. The library creates it (`createComponent`) with the library's
   element projected and attaches it to `ApplicationRef`; the panel's element injector's parent is
   the wrapper's, so what the wrapper's `providers` provide reaches the panel. Its host is a real
   element, `.ndd-popout-wrapper` (and `.ndd-popout-wrapper__content` around portalled library
   elements), both `display: contents`. Its inputs follow the panel's window from an effect that
   runs with the desktop's view, before the wrapper's and the panel's views are checked (Angular 22
   has no `forceRoot`).

6. **The wrapper is read when each panel is created.** rdd re-renders with a new wrapper type, which
   remounts the content anyway; ndd reads it at creation, so a panel keeps the wrapper it was
   created with. The input's JSDoc and the manual say to give it from the start.

7. **Menus and toasts beside the desktop find the wrapper by document,** as in vdd:
   `<ndd-context-menu>` and `<ndd-toasts>` are the desktop's siblings, so no injection reaches them.
   The desktop records its wrapper for each open pop-out document, and a built-in menu or toast
   container shown there looks it up. A custom `nddContextMenuTemplate` renders in the page, where
   `<ndd-context-menu>` is, and is not wrapped.

8. **A widget's wrapper is around its content by injection only.** In ndd a managed widget's
   content element is the content component's own host and moves between containers, so the
   widget's wrapper's host is placed nowhere: its providers and inputs are what reach the content,
   for the widget's whole life. In a window the content's DOM sits inside the hosted panel's
   wrapper.

9. **Activation keeps `focusPanel`'s body.** rdd's `focusPanel` on a popped-out panel brings its
   window forward, and its components call the core's `setActivePanel`, which never does. vdd moved
   `focusPanel`'s old body into an internal `activatePanel`. ndd's M3 rule allows `activePanelId`
   writes only in `focusPanel`, `resolveActive` and `loadLayout`, and requires `focusPanel` to end
   in `resolveActive`; so the internal `activatePanel(id)` is `focusPanel` with a private flag that
   skips the window focus. It is used by `focusPanelWindow` (which focuses the window itself, so
   exactly one `focus()`), by `openPanel` on an open panel, and by activation inside a pop-out.

10. **Activation and Escape go through the document registry, per document,** as in vdd: in the
    page the elements' own handlers answer as before; the registry's `pointerdown` and `focusin`
    listeners act only in a pop-out (`[data-ndd-popout]` first). Every Escape listener of a menu or
    a flyout acts only on the document the key fired in; overlays are main-document only.

11. **A widget's `onMoved` into the window waits for `panel:popped-out`.** ndd renders the window's
    content on a later tick, and an observer or frames from the page would report the page's size.
    So the move into the window settles once its panel's `panel:popped-out` fires, when the element
    is laid out there, at the window's size. A widget's return marks its hosted entry `returning`
    (as vdd), rather than rdd's last-key write, so a docked widget's panel restored docked first
    doesn't fire a second `onWillMove`.

12. **`popOut` is in the config type.** `WorkspaceConfig.popOut` is declared, so `config`'s declared
    type lists it; the API rule forbids rewriting that line to narrow it. The value never has it.

## Consequences

- With no `<ndd-desktop>` rendered, `popOutPanel` returns `'no-window'` right after `'disabled'`
  (before `'not-open'`), and a widget's `popOut()` returns `'no-window'`. rdd always has its
  registry. Documented in [chapter 15](../manual/15-popout-windows.md) and
  [PARITY](../PARITY.md) §4.5.
- Under zone.js a popped-out panel behaves as it does in the page; the library adds no change
  detection of its own for the windows. The M19 browser gate runs every case zoneless and with
  `?zone`, and a `zone` case proves the patch (it fails without it).
- `injectPanelWindow()` is a `Signal<PanelWindow>`; `isPoppedOut` on `PanelRef` and `WidgetHandle`
  is a `Signal<boolean>`.
- Angular's renderer creates elements with the main `DOCUMENT`, so nodes made while a panel is out
  are adopted by the pop-out on insertion. The manual says to ask a node for its `ownerDocument` and
  to avoid `instanceof`.
- A toolbar flyout and a search dropdown close when their pop-out closes (their document leaves the
  registry), as the context menu does; vdd leaves them open.
- `ViewEncapsulation.ShadowDom` is not covered: its styles live in shadow roots, which the head
  copy doesn't read. Untested; the manual says so.
- Saved layouts are unchanged: a popped-out panel is saved at its return place, without the flag
  ([0008](0008-layout-json-compatibility.md)).
- The manual has 15 chapters, so the M15 rule that counts them was moved from 14 to 15, as 1.11.0
  moved it from 13 to 14: the same exact-count rule, not a looser one.
- The port map now lists vdd 1.14.0's nine pop-out suites, so M13's exact count of ported vdd
  suites moved from 33 (its value since M13) to 42. It stays an exact count, and every suite keeps
  its own minimum.
- Pinned by the nine ported suites (`document-aware`, `pop-out-store`, `pop-out-windows`,
  `pop-out-styles`, `popout-wrapper`, `pop-out-chrome`, `pop-out-widgets`, `pop-out-focus`,
  `pop-out-from-pop-out`), by the M19 browser gate in real Chrome under both schedulers, and by the
  M19 rules.
- rdd 7.12.2 (the frame's title icon at 14 × 14, a bigger icon scaled to fit it and a floating
  window's) landed before 1.12.0 was published, so 1.12.0 names it as its parity release. M19's rule
  on the parity line changed from 7.12.1 to 7.12.2, still exact, and its selftest seed with it
  (`7.12.2` → `7.12.1`). PARITY's "rdd 7.12.0 and 7.12.1 pop-out windows, traced" heading, which
  M19 matches, stays: 7.12.2 is traced inside it.
- 7.12.2's third rule, a cap that scales a bigger icon down to its box (`> * { max-width: 100%;
  max-height: 100% }`), isn't ported: in ndd the box's child is `<ndd-icon>`, then the icon
  component's host, then the app's element, so the cap reaches the wrong element and a percentage
  can't pass through the hosts. A component icon whose element is fixed at, say, 16 × 16 keeps that
  size, centred in the 14 × 14 box, without growing the header and without being squeezed (ndd never
  squeezed it: `<ndd-icon>` took the squeeze). The case MapEvolution reported, an icon that takes its
  size from its box, is fixed: the box is 14 × 14 and an `svg` or `img` at any depth is drawn at
  14 × 14. Reaching the app's element would need `display: contents` on hosts the app owns; not done.
