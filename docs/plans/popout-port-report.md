# Pop-out windows port (rdd 7.12.1 → ndd 1.12.0): milestone report

Branch `feat/popout-windows`, uncommitted. Plan: rdd `docs/plan-widgets-out-of-the-panel.md` §10; template:
vdd 1.14.0's finished port (`~/git/vue-dockable-desktop`).

## Summary for the owner (2026-11-22)

**Status: done.** ndd 1.12.0 (parity: react-dockable-desktop 7.12.1). P1–P7 are complete and uncommitted on
`feat/popout-windows`: no commit, push, tag or publish.

- **Gates:**
  - `npm run gate:release` passes M13–M19, 1442/1442 tests in 57 files, every browser gate zoneless and `?zone`;
  - `npm run gate:selftest` passes, 54 cases, every violation rejected;
  - the browser gate M19 has 16 cases;
  - the demo was checked in real Chrome with `--base-href /sub/`: the map and the Cameras widget out and back.
- **Needs your review: two existing gates were changed.** Each stays an exact count and is recorded in ADR 0019:
  1. `scripts/gates/m15.mjs`: manual chapters, 14 → 15, the same change 1.11.0 made from 13 to 14.
  2. `scripts/gates/m13.mjs`: the count of ported vdd suites, 33 → 42 (vdd 1.14.0's nine pop-out suites). The first
     `gate:release` failed on this count alone; the rerun is green.
- **The main ndd-only decision (ADR 0019):** zone.js doesn't patch a child window's `EventTarget`, so each pop-out
  window gets zone.js's own patch when it opens. It does nothing in a zoneless app. The library's polls and style
  observers run outside the zone.
- **Bundle budgets (warnings only; budgets unchanged):**
  - the demo's initial bundle went 588 → 630 kB, past its 600 kB warning, because of the port;
  - the playground's was already over its 500 kB warning before the port (560 → 608 kB).
- **Also known:**
  - ndd's M3 rule check already fails at HEAD (it reads the `focusPanel` overload as the body). M3 isn't in
    `gate:release`; the port doesn't make it worse;
  - WO14 (`widgets-out-menus.spec.ts`, unchanged) failed once in a parallel non-vacuity run and passed every
    other time;
  - ndd's M13 tour can't see classes that render only in a pop-out window, unlike vdd's; it was left as it is.
- **Docs:** an independent review found 1 error and 8 nits, all fixed: the taskbar menu doesn't offer "Open in
  new window", the `'not-open'` late refusal, examples that compile, and others.
- **Your manual checks:** Safari, Firefox and Edge smoke tests; two monitors.
- **Try it:** `npm run demo`, then open the Leaflet map, and right-click its tab → "Open in new window".

## P1: document-aware internals (rdd S1, plus S6's per-document Escape rule)

**Built (internal, not in `public-api.ts`; no public API change):**
- `lib/core/dom-context.ts`: `isNode`, `isElement`, `isHTMLElement`, `docOf`, `winOf`, `rafOf`, `cancelRafOf`,
  `resizeObserverFor` (as vdd), plus `isRtlElement` (ndd had no rtl helper). The header lists what stays
  main-window-only (drags, drop hit-testing, splitters, sidebar resizer, taskbar + preview, workspace sizing and
  cascade, drag blur, panel-host's reclaim fallback frame, overlays, the toast container, color scheme/document mirror).
- `lib/core/document-registry.ts`: `registerDocument`, `listenOnDocuments`, `isRegistered`, `onDocumentsChange`,
  `focusedDocument`, `eventDocument` (vdd's helper). Header notes the zone.js behaviour (below).
- `common/portal.ts`: `[nddPortal]` takes a document or a node of one (read once, at creation); empty = main body.
- Routed sites:
  - context menu: `ContextMenuRequest.container` (optional, internal type) set by `showContextMenu` from the event
    target's document; menu and submenu portal there; clamp, submenu width (RTL) and arrow keys use the menu's
    window/document; opener read from the menu's document; outside `pointerdown` + window `click` on the main
    document and the menu's; Escape through `listenOnDocuments`, acted on only for the menu's document.
  - toolbar flyout: portal into the button's body (`OpenFlyout.body`), placed and clamped in its window, direction
    via `isRtlElement(host)`, outside presses in its document, Escape through the registry for that document, `isNode`.
  - toolbar search: dropdown into the field's body, fitted to its window; `isNode` in focusout.
  - `panel-dom` (scroll `isElement`, focus record and focusout in the element's document, `rafOf`), `dom-move`
    (slot's rAF), `widget-content` (host's rAF, `isElement`), `widget-hosting` (`resizeObserverFor`/`rafOf`),
    `panel-overlay` (root and toolbar observers), `floating-widget` (drag/resize classes on the frame's body),
    `toasts` (card observer and entry frame), `panel-host` (size observer), `drag-dock` / `leaf-group` (`isHTMLElement`/`isElement`).
  - `overlay-host`: Escape through the registry, main document only.
  - `desktop`: click-to-activate on `pointerdown` through `listenOnDocuments`, acting only in other documents
    (floating window `[data-ndd-window]`, else the group's selected tab); the page keeps its element handlers.

**Tests:** `test/components/document-aware.spec.ts`, 45 tests, XDA1–XDA20 (vdd's 36 plus ndd cases: eventDocument,
window-click and main-document dismissal, RTL submenu width, realm-neutral inside checks for menu and flyout,
live focus/scroll tracking, cancelled widget drag, strip direction from its window, button filter, floating-window
activation, "the page leaves the press to the elements", search focusout). `baseline-counts.json` +45;
`port-map.json`: suite `documentAware.test.ts → document-aware.spec.ts` (min 36, M19) and modules `dom-context.ts`,
`document-registry.ts` (M19). Changed shape: XDA9 closes with Escape (ndd's Tab does not restore focus); the page
cannot hold its own focus in jsdom while an iframe has one, so XDA9/XDA11 assert the main document's focus does not
name the node instead; XDA20 runs the toast's own frame rather than asserting the main rAF is never called (Angular's
zoneless scheduler uses it). Not ported (as vdd): DA6 keyboard-at-target, DA13 focus back to the button, DA14 fallback.

**Mutation checks:** 58 single-line mutations (M1–M56, M22b, M27b) over every routed line; all 58 red, each restored.
The first round had 23 compile-only "survivors" (unused imports under `noUnusedLocals`); those were rewritten to
keep the imports used and re-run, all red.

**Results:** `npm run verify` PASS (types, lint, 1141/1141 tests in 49 files, non-vacuity for the 18 changed
registered modules, the two new ones included); `npm run lint` clean. No existing spec edited. No gate run.

**Divergences / decisions:**
- File names are kebab-case (`dom-context.ts`, `document-registry.ts`), ndd's convention.
- Activation: element handlers in the page, registry listener only elsewhere (as vdd); rdd uses one document listener.
- `panel-host`'s park/reclaim fallback rAF stays the main window's (it waits for the workspace's own render).
- Overlay Escape via the registry is behaviour-equivalent to the old main-document listener in P1.
- Zone.js: listeners added through `listenOnDocuments` on the main document are zone-patched; on a child window's
  document they go through that realm's unpatched `EventTarget`, so in a `?zone` app they run outside the Angular
  zone. All of them only write signals, which schedule change detection under zone.js too — P2 should spike this.

**Open for later milestones:**
- No test covers the `widget-hosting` settle observer, the overlay root's pending observer, `panel-host`'s size
  observer, or the `drag-dock`/`leaf-group` guards (main-window nodes behave the same).
- Observers are built for the element's window at creation; P2 must rebuild them when an element moves into a pop-out.
- A menu or flyout whose pop-out closes while open still points at the closed body (P2).
- P6: `focusin` activation and `[data-ndd-popout]` frames.

## P2a: the store side of pop-out windows (rdd S2 state model, return places, save)

**Built:**
- `core/types.ts`: `PanelInfo.poppedOut?: true`; `PopOutResult` (rdd's union exactly; JSDoc gives vdd's order, with
  `'no-window'` right after `'disabled'`), exported from `public-api.ts`. `core/registry.ts`: `PanelDefaultOptions.canPopOut`.
- `core/layout-tree.ts`: `PlaceBeside`, `placesBeside`, `returnBeside` (with `withStandIns`, `nodeAt`, `replaceAt`,
  `commonAncestor`), `groupOf`, `insertPanelAmongMates`, `resolveActivePanelId`.
- `core/serialize.ts`: a loaded `poppedOut` flag is stripped (`withoutPopOutFlags`).
- `workspace/workspace.ts`: `WorkspaceConfig.popOut` (kept off `config`), the dev warning for `canPopOut` without
  `popOut`; public `popOutPanel` (`'disabled'` + one warning; `'no-window'` while unbound), `returnPanel`,
  `focusPanelWindow` (rdd's JSDoc); `@internal` `popOutEnabled`, `setPoppedOut`, `clearPoppedOut`, `onPopOutEnded`,
  `bindPopOutWindows`, exported `@internal` interface `PopOutWindowsBinding`; private `snapshot`, `withReturnPlaces`,
  `returnPlace`, `restoredCopy`, `dockedCopy`, `applySnapshot` (one `set`, then `resolveActive(copy's active)`),
  `endPopOut`, `forgetPopOut`. `floatPanel`/`maximizePanel` are ignored while out; minimise/dock/dockToGroup/dockToEdge
  call `endPopOut` first; `movePanelOrder` clears the flag with no stop; `closePanel`/`removeHostedPanel`/`loadLayout`
  end it; `saveLayout` writes the return places, last out first; the cascade skips the hidden entry.
- `desktop.ts`: `shownWindows` (no frame for a popped-out panel), its clamp skips it; `floating-window.ts`: the
  anchor stack skips it.
- `api-surface.json`: `+ "PopOutResult"` only (`--write` after `build:lib`; check then ok, 61 + 108).

**Tests:** `test/store/pop-out-store.spec.ts`, 122: vdd's 113 in full (XPO37's 1,332 cases, count asserted in
`afterAll` and proven to fail the run when wrong; XPO44, 8) + ndd XPON1–XPON9 (popped-out panel active, layout:changed,
a floating panel never docks on return, re-record keeps its save order, a minimised floating panel, the kept group
selects it in a save, sizes normalised, saved active panel, the nearest mate over the first). Baseline +122; port-map
suite `popOutStore.test.ts → pop-out-store.spec.ts` (min 113, M19).

**Mutation checks:** 87 single-line mutations (M1–M86, M9b) over every guard, `endPopOut`, return-place rule, the save and
record steps, the serialize strip, the desktop/stack filters and each tree-helper rule; reruns as M12b…M81b where the
first form only broke compilation (unused locals, unreachable code). Final: all red except 3 equivalent ones: M13
(`popOutOrigins.clear()` in `loadLayout`: every flagged origin is already forgotten), M51 (`origin &&` in the empty-grid
rule: a flagged docked panel always has an origin) and M61 (a floating panel's seq: its return never changes the tree).
The first round's 8 survivors (M35, M36, M37, M58, M59, M82, M85, M86) and M39b each got an XPON test, then went red.

**Results:** `npm run verify` PASS (types, lint, 1263/1263 in 50 files, non-vacuity for the 22 changed modules).
`build:lib` ok. No existing spec edited. No gate run (`m3.mjs` run once by hand; see below).

**Divergences / decisions:**
- `activatePanel` not split out: ndd's M3 requires `focusPanel`'s own body to call `resolveActive` and allows
  `activePanelId` writes only in `resolveActive`/`focusPanel`/`loadLayout`. `focusPanelWindow` calls `focusPanel`. P6
  must keep `focusPanel`'s body there (for example an internal flag that skips the window focus).
- M3 static check: `node scripts/gates/m3.mjs` reports "focusPanel() does not end in this.resolveActive()". This failure
  already exists at HEAD: its method matcher reads the overload's `{ restore?: boolean }`. It is not from this work, and
  the gate was not edited. Its activePanelId-writers rule passes.
- The rest is as in vdd P2a: `popOut` is listed in `config`'s declared type, but its value never has it. A lone panel out
  of the root group leaves that group with its id. `onPopOutEnded` is a synchronous callback. Until a registry is bound,
  `returnPanel` clears the flag itself.

**Open for P2b:** the registry and `bind`; `onPopOutEnded → back(id, false)`; menu items; the zone spike; P6: `focusPanel`
on a popped-out panel focuses its window.

## P2b: the windows registry, the frame, the menus and the browser gate M19 (rdd S2 + 7.12.0 timing + 7.12.1)

**Zone spike (first):** a throwaway JIT app (scratchpad, esbuild + playwright-core, real Chrome) moved an Angular
component into a `window.open('')` child. Findings, `?zone`, Eager components:
- template listeners render a signal and a plain field: they sit on elements made by the page's document, which
  zone.js patched;
- a listener on the child's document (the content's own, or one added through `listenOnDocuments`) runs outside
  the Angular zone (`NgZone.isInAngularZone()` false): a plain field it writes doesn't render, unlike the same
  listener on the page;
- the patch survives the same-origin load of `popoutUrl` (the realm is kept).

**Decision (for the ADR in P7):** each child window gets zone.js's own patch, `Zone.__load_patch(...,
api.patchEventTarget(child, api, [child.EventTarget.prototype]))`. It is applied right after `open` and again at
attach (it is idempotent), and does nothing without zone.js. A child window's frames used by `whenPlaced` are
wrapped in the current zone (`Zone.current.wrap`). The 500 ms closed poll runs in `Zone.root`, so it doesn't run
change detection twice a second.

**Built:**
- `lib/core/pop-out-windows.ts` (internal): vdd's registry in its rdd 7.12.1 form. Names are
  `ndd-popout-<id>-<pageKey>-<n>`. It adds `patchZone`/`outsideZone`, and its `entries` is a signal.
- `Workspace.emitBuiltIn` (`@internal`, appended).
- 4 `BuiltInEvents` and 5 messages, with rdd's translations in the demo's six tables. They are required: the
  demo's tables are typed `Record<MessageKey, string>`.
- `PanelHost.reobserve(id)`.
- `lib/desktop/pop-out-frame.ts`:
  - `NddPopOutFrame`, `POP_OUT_WINDOWS` (token, provided by `NddDesktop`) and `injectPopOutMenu()`;
  - the frame is portalled with `[nddPortal]`;
  - it carries `.ndd-workspace.ndd-popout-frame`, `data-ndd-popout(-kind)`, the icon, the title and the SVG
    `.ndd-custom-tab-btn.ndd-popout-frame__return`, plus `[nddPanelSlot]`;
  - there is an inline minimum layout, the title, `dir` and `lang`, and `fillWindow`/`fillSlot`;
  - the size observer is rebuilt in and out;
  - the `styled` signal is P3's hook (true for now).
- `NddDesktop`:
  - new input `popoutUrl`, on `ndd-desktop`, where `skin`/`taskbar` live (vdd's prop, too);
  - it binds the registry after the first render and lends park/rectOf/element/isParked;
  - destroying it brings every panel back.
- Menus: "Open in new window" after Float in the tab and title menus, and leading the floating ⋮ menu (which now
  shows for it). A `'blocked'` toast comes from the item only.
- A context menu open in a closing window closes in `back()`. A toolbar flyout and a search dropdown close when
  their document leaves the registry (P1's open item, done for all three).
- `styles/parts/26a-popout.css`, then `npm run css`.
- Playground:
  - `?po=1`, `?po2=1`, `?pourl=1`;
  - `PopPanel` (Eager, lint-disabled with a reason, for the zone case);
  - `public/popout.html`.
- `scripts/gates/browser/m19.mjs`: 8 cases × zoneless/zone. `scripts/gates/m19.mjs` is a placeholder. M19 is not
  in `gate:release`.

**Tests:**
- `pop-out-windows.spec.ts`, 53: vdd's 45 (XPO1–XPO32, XPOE1/2, XPOM1, XPOR1), plus XPON1–XPON7 and XPON5b.
- `pop-out-from-pop-out.spec.ts`, 7 (XFP1–XFP7).
- Baseline +53, +7. Port-map: both suites (min 45 / 7), and module `core/pop-out-windows.ts`.
- XFP6b waits for P5.
- Changed shape:
  - XPO23 lets Angular's 0 ms scheduler timer run before counting timers;
  - XPOE1/2 give the page real-timer frames (`ownFrames`): jsdom's page rAF interval can be created under an
    earlier test's fake timers and never run. This was found as a flake under load in the full run.

**Mutation checks:**
- Unit: 112 single-line mutations over 3 rounds. Compile-only ones were rewritten and rerun (the "b"/"c" forms).
  - The first round's survivors M4, M9, M25, M58, M59 and D4 each got an XPON test and went red. M31 and M61
    together went red on XPON7.
  - Equivalent, kept as rdd's safety nets:
    - M30 (connected/document check);
    - M31 and M61 alone (double-guarded by the epoch and `ready`);
    - M32;
    - M44b (the load timer checks `live()`);
    - M49 and F14 (a hosted panel's options have no `canPopOut` until P5);
    - M60 (the zone patch at open: unit tests are zoneless).
- Browser:
  - `opener.open` → `window.open`: red;
  - the zone patch disabled: red (the zone case reads at once);
  - `popping-out` after `setPoppedOut`: green, equivalent, as in vdd;
  - the poll in the zone: green. It only costs change detection, and no case measures that.

**Results:**
- `npm run verify` PASS: 1323/1323 in 52 files, lint clean, non-vacuity ok for all 28 changed modules.
- `npm run gate -- M19` PASS: standing gate, M19 placeholder, M19 browser ok (zoneless + zone).
- api-surface: no change.
- `focusPanel` untouched (the M3 rule).

**Divergences / decisions:**
- The zone patch above is ndd-only.
- The registry belongs to the desktop (DI token), as in vdd.
- In the gate, a zoneless render lands on Angular's scheduler, about 50 ms after a click, so the gate waits
  200–300 ms. Zone renders inside the event.
- Menu items have no icon.

**Open:**
- P3: styles, with `styled` starting false.
- P4: wrapper, `injectPanelWindow`, toasts per document.
- P5: `registerHosted` in use, XFP6b, hosted `canPopOut`.
- P6: focus, `focusin`, the taskbar.
- P7: ADR 0019 (the zone decision), PARITY, the M19 rules.
- A pre-existing load-sensitive test, WO14 (`widgets-out-menus.spec.ts`), failed once in a parallel non-vacuity
  control run.

## P3: styles in pop-out windows (rdd S3)

**Built:**
- `lib/core/pop-out-styles.ts` (internal, not in `public-api.ts`): rdd 7.12.1's `popOutStyles.ts` line for
  line (as vdd's), prefixes changed. `startPopOutStyles({ child, frame, scope, onReady, main?, timeoutMs? })` →
  stop; `POPOUT_STYLES_TIMEOUT_MS` = 3000. Head copy in order after the child's own content (absolute link
  `href`), a `MutationObserver` (nodes, style text, link `href`/`media`/`disabled`), `adoptedStyleSheets` as one
  `<style data-ndd-adopted>` (re-read on the same triggers, never polled), the `<html>`/`<body>` mirror (every
  attribute but `style`, inline `--*` and `color-scheme`; the child's own classes and layout kept), the frame
  repeating `data-color-scheme`, `data-ndd-skin`, `ndd-no-animations` from the workspace element; ready when
  every copied link has loaded or failed, or after 3 s.
- `pop-out-frame.ts`: `styled` starts false (the frame is `visibility: hidden` until `onReady`); new input
  `scope`; an `afterRenderEffect` on the frame element starts the styles inside `NgZone.runOutsideAngular`
  and stops them in its cleanup (return, close, destroy). The P2b `lang` copy is gone: the `<html>` mirror
  carries `lang` and `dir`, as in rdd (XPO4 still green).
- `desktop.ts`: `protected readonly scopeEl` (its host, `.ndd-workspace`), passed as `[scope]`.
- No CSS change (`npm run css` run; `26a-popout.css` already had what is needed).
- Playground: `skin` is a signal, exposed as `__pg.skin` (the gate's skin switch).
- `scripts/gates/m19.mjs` (placeholder) also requires `pop-out-styles.spec.ts`.

**Tests:** `test/components/pop-out-styles.spec.ts`, 17: vdd's 14 (XPS1–XPS9; XPS5 ×2, XPS7 ×3, XPS9 ×3) plus
XPSN1 (page `lang`/`dir` reach the window through the mirror and follow), XPSN2 (the desktop's `skin` and
`animations` inputs reach the frame and the window's `<html>`), XPSN3 (a link's `href` alone follows; added
because M7 survived XPS3, which changes `href` with `media`/`disabled`). Baseline +17; port-map suite
`popOutStyles.test.ts → pop-out-styles.spec.ts` (min 14, M19) and module `core/pop-out-styles.ts` (M19).
Browser: a `styles` case in `scripts/gates/browser/m19.mjs` (nord, dark and light, zoneless and `?zone`): frame
shown only once ready; the frame's and `#po-fill`'s computed background, colour, `--ndd-accent-color` and font
equal the page workspace's through a scheme switch (on `<html>`) and a skin switch (`__pg.skin` → tokyo, the
frame's `data-ndd-skin` checked); a `<style>` added later applies (`#po-fill` outline). The 8 P2b cases pass
unchanged with the hidden-until-ready frame.

**Mutation checks:** unit, 34 single-line mutations, all red and restored: M1–M29 over the module (sheet filter,
rel filter, absolute href, removal, reorder, style text, head attribute filter, adopted re-read, adopted order,
the `<html>` watch's re-read, the `style` skip, attribute/class/prop removal, class overwrite, the `color-scheme`
filter, body watch, scope attributes/classes/watch/removal, settle count, error listener, timer, ready at once,
stop's disconnect, `copyAttributes` removal, initial html and scope syncs), F1–F4 in the frame (`styled` start,
`onReady`, the cleanup, the scope input), D1 (the desktop's `[scope]`). M4 first broke compilation only
(unused local) and was rerun as M4b; M7 survived the first round and went red with XPSN3. Browser: B1 no
`[scope]` (frame skin null), B2 no head observer (late sheet missing), B3 no `<html>` observer (scheme and skin
switches diverge): all red in both schedulers, restored. Not measurable: `runOutsideAngular` (unit tests are
zoneless; no case measures change-detection counts).

**Results:** `npm run verify` PASS (types, lint clean, 1340/1340 in 53 files, non-vacuity ok for every changed
module, `core/pop-out-styles.ts` included: 18 red). `npm run gate -- M19` PASS (standing gate incl. counts,
css-prefix, api-surface unchanged; M19 placeholder; M19 browser: 9 cases, zoneless + zone).

**Divergences / decisions:**
- `document-mirror.ts` is not run for the child: the `<html>` mirror copies what it writes (rdd's path too).
- The workspace element reaches the frame as an input from the desktop's host (rdd's `getWorkspaceElement()`).
- The styles run outside the Angular zone (ndd-only, P2b's poll rule); `onReady` writes a signal.
- The frame's `class` is static in its template, so Angular never overwrites the `ndd-no-animations` toggle.
- The browser gate needs `build:lib` before `ng build playground` when run by hand (the playground reads `dist/`).

**Open:** P4's wrapper (rules inserted with `insertRule` are not copied); the docs note on Angular component
styles (P7).

## P4: the wrapper, `injectPanelWindow`, events, frame chrome and toasts (rdd S4 + next.1 + 7.12.0 marker)

**Built:**
- Public (additions only; `api-surface.json` +`injectPanelWindow`, `PanelWindow`, `PopoutWrapper`; 62 runtime + 110 types):
  - `<ndd-desktop [popoutWrapper]>` (`Type<PopoutWrapper>`), next to `popoutUrl`: a component with inputs `window`,
    `document` and an `<ng-content />`;
  - `injectPanelWindow(): Signal<PanelWindow>`; `PanelRef.isPoppedOut: Signal<boolean>` (an appended line).
- `lib/panel/panel-window.ts`: the types, `mainWindow()`, `injectPanelWindow`, and the internal document → wrapper map
  (`setPopoutWrapper`, `popoutWrapperFor`, a signal).
- `lib/common/popout-wrap.ts` (internal): `mountPopoutWrapper` (`createComponent`, the library's element projected, inputs
  set at once, attached to `ApplicationRef`, host `.ndd-popout-wrapper`) and the structural `*nddPopoutWrap="doc; type: …"`:
  in a pop-out's document, the wrapper's host goes in that `<body>`, a projected `.ndd-popout-wrapper__content` takes the
  template's `[nddPortal]` elements (new token `NDD_PORTAL_INTO` read by `NddPortal`), and the template's injector is the
  wrapper's. In the main document, or with no wrapper, it renders the template as it is.
- Where it sits: every panel's `.ndd-panel-content` (`PanelHost.wrap`, created with the panel, destroyed with it; the
  panel's element injector's parent is the wrapper's; `PanelDomCache.setContentParent` keeps a lazy / `keepAlive: false`
  re-created content inside it); the whole frame (`[wrapper]` from the desktop); a built-in context menu and submenu
  shown in a pop-out; a pop-out's toast container. The menu and toasts find it by their document (the desktop records it
  per open pop-out document).
- `injectPanelWindow`: `PanelHost.windowOf(id)` from the registry's `entries` (`doc`); the panel wrapper's inputs follow
  it from an effect that runs with the desktop's view, before the wrapper's and the panel's views are checked.
- Toasts: `toast.ts` records each toast's document at its first `show` (`focusedDocument()`), internal, kept by an update by
  id, cleared on removal/reset. `<ndd-toasts>`: one container per document (the page's always, keyed per document),
  `maxVisible` still one slice; a closing window removes its shown toasts and runs `onClose`; a queued one shows in the
  page; the adapter path unchanged.
- Events and the return button: already right from P2b; confirmed by XPC3/XPC5 and the browser cases, no change.
- CSS: `.ndd-popout-wrapper, .ndd-popout-wrapper__content { display: contents }` in `26a-popout.css`, then `npm run css`.
- Playground `?rc=1`: `app/runtime-css.ts` (per-document cache with `insertRule`, `rcIcon`, `RcWrapper`), the popper's
  icon, `#po-rc`, `#po-menu`, `#po-toast`. `scripts/gates/m19.mjs` (placeholder) also requires the two specs and
  `runtime-css.ts`.

**Tests:** `test/components/popout-wrapper.spec.ts` 19 (XPW1–XPW6 as vdd's 17, XPW6 ×10; ndd XPWN1 lazy panel inside the
wrapper, XPWN2 a closed panel takes its wrapper) and `test/components/pop-out-chrome.spec.ts` 20 (vdd's 18: XPC1 ×3, XPC2
×5, XPC3 ×8, XPC4, XPC5; ndd XPCN1 page container always / dismissed in its window, XPCN2 adapter). Baseline +19, +20;
port-map suites `popoutWrapper.test.ts → popout-wrapper.spec.ts` (min 17), `popOutChrome.test.ts → pop-out-chrome.spec.ts`
(min 18), modules `panel/panel-window.ts`, `common/popout-wrap.ts` (M19). Browser `m19.mjs`: `wrapper` and
`returnButton` (default/nord × dark/light), zoneless and `?zone`; the `events` case (doc and size at each event, blank and
`popoutUrl`) was P2b's and still passes.

**Mutation checks:** unit, 52 runs over 40 single-line mutations: W1–W12 (no wrapper, wrapper with popOut off, window never
switches, inputs never follow, isPoppedOut false, panel not under the wrapper's injector, no `window` in the context,
reset content outside, wrapper not destroyed, content parent unrecorded, no initial inputs, `injectPanelWindow` main
only), F1–F2 (frame), P1 (portal), D1–D4 (directive), M1 (menu), R1–R2 (registration), T1–T11 (toasts), K1 (kind),
E1–E5 (registry timing). Compile-only first forms reran as W1b, W3b, W12b, P1b, D2b, D4b, M1b, R1b, T1b, T7b, T10b.
All red except P2 (the portal's same-document check) and R2 (`popoutWrapperFor`'s main-document check): equivalent safety
nets (no wrapped view is ever for another document; no desktop records the main one). T11 first survived; XPCN2 gained
its window-closing step and it went red. Browser: no wrapper, toasts always in the page, frame unwrapped, menu
unwrapped, the return button without `ndd-custom-tab-btn`: each red; all restored and rebuilt.

**Results:** `npm run verify` PASS (types, lint, 1379/1379 in 55 files, non-vacuity ok for all 31 changed registered modules, the two new ones included); `npm run lint` clean; `npm run gate -- M19` PASS (standing gate incl. counts, css-prefix, api-surface; M19 placeholder; M19 browser: 11 cases, zoneless + zone).

**Divergences / decisions:**
- The Angular idiom: a component type input (as `popoutUrl`, a desktop input), not a template: a template can't hand
  injection to content it didn't declare. Its "context" is DI: what the wrapper `providers` reach the content's
  components. Its host is a real element, so it gets `.ndd-popout-wrapper` (`display: contents`); `fillSlot`'s list
  also matches a bare wrapper.
- The wrapper is read when each panel is created (rdd re-renders with a new type, which remounts anyway): give it from
  the start; the input's JSDoc says so.
- Menus and toasts beside the desktop find it by document (as vdd), not by injection; a custom `nddContextMenuTemplate`
  renders in the page and is not wrapped.
- XPW2 checks the render through the wrapper's and the content's effects (Angular checks the desktop's view, which moves
  the element, then the wrapper's, then the panel's), not a single flush.
- The panel's wrapper effect runs with the desktop's view (Angular 22 has no `forceRoot`).

**Open:** P5 (a widget's content and frame inside the wrapper; WidgetScope's window); P7 docs (the Angular wrapper recipe,
toasts across windows, the read-once rule).

## P5: managed widgets in their own window (rdd S5 + 7.12.1 `view` + the S7 title-icon fix)

**Built (public additions, members only; `api-surface.json` no new names):**
- `injectFloatingWidgets().popOut(id): PopOutResult`, `ManagedWidget.canPopOut`, `WidgetHandle.isPoppedOut`
  (`Signal<boolean>`, also on `injectWidget()`), `WidgetMenuContext.canPopOut` / `isPoppedOut` / `popOut()`.
  `backIntoPanel` was already in the messages; while out, `location` stays `'floating'`.
- `panel-overlay/widget-hosting.ts`: `popOut` (checks first: `disabled` through `ws.popOutPanel` with its
  warning, `not-open`, `not-allowed` for no `canPopOut` / no workspace owner / hosted owner / `keepAlive: false`,
  `no-window` without a desktop; then `popOuts.popOut(hostedId, { rect, view, prepare })` with nothing awaited
  before `open`; already out → its own panel pops out), `isPoppedOut`, `opened` (the dev warning, once per
  widget, `ngDevMode`-guarded), `windowOf`, the `'floating|out'` key, `registerHosted` (`returning` fires
  `onWillMove` and marks the entry; `returned` sends it home and settles), the menu context. The overlay store
  injects `POP_OUT_WINDOWS` (optional) and passes it in.
- Widget content's window and wrapper (rdd `WidgetScope`): the widget's injector provides `PANEL_CONTEXT` with
  its own `window` signal (its own panel's while out of the owner, else the owner's; `injectPanel()` stays the
  owner's), and, with pop-outs on and a `popoutWrapper`, a wrapper (`mountPopoutWrapper`) for the content's
  whole life whose `window`/`document` inputs follow it; destroyed with the content.
- `desktop/pop-out-frame.ts`: a hosted panel with `titleMenu` items gets
  `button.ndd-popout-frame__icon.ndd-popout-frame__icon--menu` (`pointerdown` and `click` stopped; Enter/Space
  open below the icon on the first item via internal `menuEventBelow` in `core/context-menu.ts`); without an
  icon it shows the 3-dot glyph. CSS already in `26a-popout.css` (css:check ok).
- Playground `?wo=1` (`app/pop-widget.ts`: owner `ov`, type `wover`, widget `wo` with "Open in new window" /
  "Back into the panel" in its `titleMenu`), `?opo=1` (owner type `canPopOut`, `#wo-po-in`), `#wo-po-btn`,
  `#ov-po-btn`. `scripts/gates/m19.mjs` requires the new spec and `pop-widget.ts`.

**Tests:** `test/components/pop-out-widgets.spec.ts` 42: vdd's 36 (XWG1 ×6, 2, 2b, 3 ×4, 4 ×4, 5 ×3, 6 ×4, 7, 8,
9 ×2, 9b, 10 ×4, 11, 12, 13, 14) + XWGN1 (onMoved after `panel:popped-out`, in the window, from the panel and
from docked), XWGN2 (no built-in item), XWGN3 (plain icon without titleMenu), XWGN4 (owner out, widget in its
panel: owner's window and wrapper), XWGN5 (the widget's wrapper destroyed on close), XWGN6 (already out: its
panel is not closed and re-opened). `pop-out-from-pop-out.spec.ts` +XFP6b (7 → 8). Baseline +42, 7 → 8;
port-map suite `popOutWidgets.test.ts → pop-out-widgets.spec.ts` (min 36), XFP min 8. Browser `m19.mjs`:
`widget`, `widgetMenu`, `widgetFromOwner` (zoneless + `?zone`).

**Mutation checks:** unit 55 runs over 47 single-line mutations (U1–U37, F1–F7, C1–C2, G1; compile-only first forms
rerun as U8b, U11b/c, U12b, U19b, U22b, U24b, U27b, F3b). All red except three equivalent: U31 (detach's
`awaiting` cleanup: the popped-out callback checks the entry itself), U27b (unregistering the router: a removed
hosted panel is refused `not-open` before any router is asked), F7 (`items.length === 0` in the frame: the button
renders only with items). U11c first survived; XWGN6 was added and it went red. Browser B1–B4 (click
`stopPropagation` dropped; `view` dropped → 30,49 vs 110,27; settling at once → two `moved`; `returning` flag
dropped → `will, will, moved`): all red, restored and rebuilt.

**Results:** `npm run verify` PASS (1422/1422 in 56 files, lint clean, non-vacuity ok for every changed registered
module); `npm run lint` clean; `css:check` ok; `npm run gate -- M19` PASS (standing gate incl. counts, css-prefix,
api-surface 62 + 110 unchanged, docs-api; M19 placeholder; M19 browser: 14 cases, zoneless + zone).

**Divergences / decisions:**
- The widget's wrapper is around its content by injection only: in ndd the content element is the content
  component's own host and moves between containers, so the wrapper's host is placed nowhere (its providers and
  inputs are what reach the content). DOM-wise the content in a window is inside the hosted panel's wrapper.
- onMoved for a move into the window is sent once `panel:popped-out` fires for its panel (the element laid out
  there), not on the next frames from the page: ndd renders the window's content on a later tick, and a page
  observer/frames would report the page's size. Unit and browser cases check the size.
- `returning` marks the entry (as vdd), not rdd's last-key write.
- The frame's widget-menu button shows a 3-dot glyph when there is no icon (rdd always has a default icon; ndd's
  in-panel widget button already does this). Found by the browser case: an empty button is invisible.
- Browser gate process check: two orphaned `chrome_crashpad_handler` processes (2 days old, parent 1) match the
  `ms-playwright` pattern permanently; treated as not a running suite. One verify started while a foreign
  Playwright Chrome was running was stopped at once and rerun after it ended.

**Open:** P6 (focus, `focusin`, taskbar; the in-panel title icon's keyboard open still opens at the event's
0,0, ndd's existing `openMenu`; vdd fixed its equivalent in P6 with `menuEventBelow`, now available), P7 (docs:
widget bullet, the app's own "Open in new window" item, the wrapper-by-injection note; ADR/PARITY).

## P6: focus across windows (rdd S6) + P5's title-icon gap

**Built (no new exported names; `api-surface.json` untouched):**
- `workspace/workspace.ts`: `focusPanel(id)` on a popped-out panel also calls the registry's `focusWindow` (a JSDoc
  added above the existing overload line, which is untouched; the body still ends in `resolveActive` and still
  holds the minimised `activePanelId` write, so M3 is no worse). New `@internal` member `activatePanel(id)`
  (appended after `emitBuiltIn`): `focusPanel` with a private `focusOwnWindow` flag off, rdd's `setActivePanel`.
  It is used by `focusPanelWindow` (already complete from P2a; it focuses the window itself, so exactly one
  `focus()`), by `openPanel` on an open panel, and by activation inside a pop-out.
- `desktop/desktop.ts`: the registry's `pointerdown` listener checks `[data-ndd-popout]` first (→ `activatePanel`); a
  new `focusin` listener through `listenOnDocuments` does the same. In the page, focus alone still never activates.
- `desktop/pop-out-frame.ts`: `data-ndd-focused` while its panel is active.
- `desktop/taskbar.ts`: popped-out panels after the minimised ones, `<button data-ndd-taskbar-popout>`
  `.ndd-taskbar-item--popout` with the `.ndd-taskbar-item-popout-marker` SVG, label `"<title>: in its own window"`
  (`inOwnWindow`, already in the messages), click → `focusPanelWindow`; the taskbar shows (and scrolls) counting
  them. CSS in `styles/parts/06-taskbar.css`, then `npm run css` (css:check ok).
- `panel-overlay/panel-overlay.ts`: `openTitleMenu` from the keyboard (`detail` 0) opens through `menuEventBelow`
  with `initialFocus: 'first-item'`: below the icon, in the icon's document (P5's 0,0 leftover, fixed).
- Escape: already scoped per document since P1 (menu, flyout, overlays); confirmed by tests, no change.
- `scripts/gates/m19.mjs` requires the new spec.

**Tests:** `test/components/pop-out-focus.spec.ts`, 20: XPF1 ×5, XPF2 ×3 (adds openPanel, and focus after an
activation), XPF3 ×4, XPF4 ×2, XPF4b, XPF5 ×3 (adds compact mode), XPF6 ×2 (keyboard title menu, pop-out and
page). Baseline +20; port-map suite `popOutFocus.test.ts → pop-out-focus.spec.ts` (min 19, M19). Browser
`m19.mjs` +2 cases, zoneless + `?zone`: `focusAcross` (click and focus activate, `data-ndd-focused`, Escape both
ways, taskbar entry: button, label, marker in its corner, one `focus()`, gone on return) and `focusWindow`
(child/main `focus()` counts, active panel, `focusPanel`, unknown id; rdd's `hasFocus` stub on the pop-out → the
toast lands in the page; without it, in the pop-out).

**Mutation checks:** unit 27 runs over 22 mutations (F1–F6, A1–A5, D1–D2, T1–T5, M1–M2, E1–E2): all red. The
compile-only first forms (F1, F2, A1, A2, A3, M1, E1, E2: unused locals/imports) were rerun as F1b, F2b, A1c, A2b,
A3b, M1b, E1b, E2b. Survivors in round 1: F6 (the flag's reset), so the XPF2 "after an activation" test was added;
and M2 (`initialFocus` dropped), so XPF6 now asserts the focused element is a `menuitem`. Both red on rerun. Browser
B1–B10 (pop-out activation, focusin, the attribute, the menu's document check, the entry's click → activate only,
the marker's `position: absolute`, focusPanel's window focus, focusPanelWindow's main `focus()`, the registry's
child `focus()`, the gate's `hasFocus` stub): all red, zoneless and zone. All restored and rebuilt.

**Results:** `npm run verify` PASS (1442/1442 in 57 files, types, lint, non-vacuity ok for all 33 changed modules);
`npm run lint` clean (inside verify); `npm run gate -- M19` PASS (standing gate: counts 1442/57, css-prefix, api-surface 62 + 110 unchanged, docs-api; zone; M19 placeholder; M19 browser 16 cases, zoneless + zone).

**Divergences / decisions:**
- `activatePanel` is a flag around `focusPanel`, not vdd's moved body: M3 allows `activePanelId` writes only in
  `focusPanel`, so the body stays there.
- `openPanel` on an open popped-out panel activates without focusing its window (rdd's core, as vdd).
- Taskbar entries are `<button>`s (rdd); the minimised items stay `div`s, so the rule adds `padding: 0; font:
  inherit; position: relative`.
- The browser recipe stubs only the pop-out's `hasFocus` (`focusedDocument` checks pop-outs first), as vdd.

**Open:** P7 (docs: focus section, the Playwright `hasFocus` recipe, the 5 s activation trap; ADR/PARITY;
`pop-out-frame.ts` is still not a registered non-vacuity module).

## P7: docs, demo, release files and the M19 rules

**Built:**
- **Manual:** new `docs/manual/15-popout-windows.md` (rdd's guide, vdd's chapter, ndd's names and Angular idioms): turning it
  on, the reasons in ndd's order, the gesture rule, `popoutUrl` (error 153, `--base-href`), coming back and where to, saving,
  styles (Angular component styles; `ShadowDom` not covered), the CSS-in-JS recipe (a component type, context by `providers`,
  read once, custom `nddContextMenuTemplate` unwrapped, one cache per document), `injectPanelWindow()`, **change detection and
  zone.js**, what reloads, widgets, focus and the taskbar, toasts, events, Playwright (`hasFocus` stub, 5 s trap), the limits,
  messages, and a three-column "Coming from" table. Short additions in chapters 03, 04, 05, 07, 08, 10, 11 (key list), 12 (row +
  "New message keys in 1.12.0"), 13 (every new name; counts 62 + 110), 14; the manual index; README (feature, 15 chapters).
- **ADR 0019** (indexed): the zone.js patch per window, the work outside the zone, the registry owned by the desktop, the
  portalled frame, the wrapper as a component type with DI context, read once, menus/toasts by document, the widget wrapper by
  injection only, `activatePanel` as a flag (M3), per-document activation/Escape, `onMoved` at `panel:popped-out`, `popOut` in
  the config type; consequences incl. the M15 count.
- **PARITY:** §1 API map (rdd | vdd | ndd), §3 trace and test map (XDA/XPO/XFP/XPS/XPW/XPC/XWG/XPF, counts, ndd's `N` additions,
  8 rdd cases not ported with reasons), §4.5 divergences (every one from P1–P6, plus flyout/search closing with the window).
- **Demo:** `popOut: true`; `leafletMap` `canPopOut`; the Cameras widget `canPopOut` + "Open in new window" (`w.popOut()`);
  `<ndd-desktop popoutUrl="popout.html">` (relative, so it follows `--base-href`); `projects/demo/public/popout.html` (favicon).
- **Release files:** 1.12.0 in the library `package.json` and `version.ts` (the root lock carries no library version);
  CHANGELOG `[1.12.0] — 2026-11-22`, parity line, Added / Fixed / Tests / Documentation, fresh `[Unreleased]`;
  `sync-package-readme.mjs` run (package README and CHANGELOG). `api-surface.json` unchanged in P7.
- **Gate:** `scripts/gates/m19.mjs` is the real M19 rules gate (M18's style; `NDD_GATE_M19_ROOT` for seeded copies);
  `scripts/gates/selftest-m19.mjs` (17 seeds + clean; runs alone, imported by `selftest.mjs`); M19 in `gate:release`;
  IMPLEMENTATION_PLAN M19 entry; PROGRESS row; `docs/evidence/M19.md`.
- **Housekeeping:** `desktop/pop-out-frame.ts` registered as an M19 non-vacuity module (stubbed: 525/1442 red). **M15 edited:**
  its exact chapter count 14 → 15 (as 1.11.0 did 13 → 14), else `gate:release` fails; recorded in ADR 0019.

**Mutation checks:** the 17 seeds, each caught by its own rule (the output must name it; CHANGELOG seeds re-sync the package copy
so only the targeted rule can fire): 17/17, clean passes.

**Results:** `npm run verify` PASS (1442/1442, 57 files, lint clean, non-vacuity ok for every changed module); `npm run gate -- M19`
PASS (standing gate, counts, api-surface 62 + 110, docs-api 165 blocks, demo build, M19 rules, browser 16 cases zoneless + zone);
`node scripts/gates/selftest-m19.mjs` 18/18. Demo check (real Chrome, demo built with `--base-href /sub/`, both schedulers): the
map out by its tab menu (window at `/sub/popout.html`, favicon, taskbar entry) and back by "Return to desktop", the same node;
the Cameras table out by its menu, its frame icon opens its `titleMenu`, back by "Back into the panel"; no console errors.

**Findings:**
- M13: ndd's tour doesn't touch pop-out CSS and its live sweep is one-way (rendered → has a rule), so it can't fail on rules that
  render only in a child window (vdd's did); not extended. The child-window classes are not live-swept.
- Bundle budgets (a scratch worktree of `main`): playground initial 560.26 kB on `main` (the 500 kB warning predates the port),
  607.91 kB now. **The demo's 600 kB warning is new:** 588.39 kB on `main`, 629.58 kB now. Budgets unchanged.

**Open:** `gate:release` and the full `gate:selftest` (owner); the independent docs review the plan calls for.
