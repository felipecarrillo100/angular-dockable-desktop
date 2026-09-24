# Parity with vue-dockable-desktop and react-dockable-desktop

ndd targets **vue-dockable-desktop 1.1.1** (vdd) as its baseline, and through it
**react-dockable-desktop 6.3.1** (rdd). vdd is already a full port of rdd with rdd's known defects
fixed (its D-series), so ndd ports vdd's behaviour and vdd's tests, and consults rdd only where
vdd leaves something out. Where ndd behaves differently from vdd, it says so here (the N-series)
and a test or a gate rule pins the difference.

## 1. API map

The concepts are the same; the surface is Angular's.

### Creation and access

| vdd | ndd | Note |
|---|---|---|
| `createWorkspace(config)` + `app.use(ws)` | `createWorkspace(config)` + `provideDockableDesktop(ws)`, or `provideDockableDesktop(config)` | A module-scope workspace works before bootstrap, as in vdd |
| `useWorkspace()` | `inject(Workspace)` / `injectWorkspace()` | `injectWorkspace()` throws a directed error when nothing is provided |
| `ws.state` (reactive) | `ws.state()` and narrower signals: `panels()`, `floating()`, `minimized()`, `activePanelId()`, `dir()`, `isRtl()`, `activeContribution()` | One immutable signal; frozen in development |
| `ws.subscribe(event, cb)` | the same, auto-disposed with the calling component when called in an injection context | |

### Actions — unchanged in name and signature

`openPanel`, `closePanel`, `requestClosePanel`, `focusPanel`, `floatPanel`, `dockPanel`,
`dockPanelToGroup`, `minimizePanel`, `restorePanel`, `maximizePanel`, `setDirection`,
`saveLayout`, `loadLayout`, `showContextMenu`, `closeContextMenu`, the `overlays.*` methods and
the `toolbar`/`contributions` stores. One option is renamed for Angular: `openPanel(…, { inputs })`
where vdd has `props` (panel inputs are applied with `setInput`). The saved layout keeps the
family's `props` key.

### Panel-side contract

| vdd | ndd |
|---|---|
| `usePanel()` | `injectPanel()` → `PanelRef`: `id`, and signals `title`, `isActive`, `isMinimized`, `isFloating`, `containerType`, `size`, `dirty` |
| `setDirty` / `setTitle` / `setIcon` / `close` / `minimize` | the same |
| `onBeforeClose` / `onSaveState` | the same, disposed through `DestroyRef` |
| — | **`trackDirty(() => form().dirty(), options?)`** — follows a Signal Forms form (or any signal) |
| `usePanelContribution(getter)` | `injectPanelContribution(getter)` |
| `usePanelContextMenu(() => items)` | `injectPanelContextMenu(() => items)` — a getter in both, re-read each time a menu opens |

### Components

| vdd | ndd |
|---|---|
| `<VddDesktop>` | `<ndd-desktop>` (`NddDesktop`) |
| `<VddSidebar>` / `<VddSecondarySidebar>` | `<ndd-sidebar>` / `<ndd-secondary-sidebar>` — one base class and one template |
| `<VddToolbar>` | `<ndd-toolbar>` |
| `<VddContextMenu>` | `<ndd-context-menu>` |
| `<VddModals>` / `<VddSidePanels>` / `<VddConfirm>` | `<ndd-modals>` / `<ndd-side-panels>` / `<ndd-confirm>` |
| `<VddToasts>` + `toast()` | `<ndd-toasts>` + `toast()`, and `NddToaster` for `inject()` |
| `<VddPanelOverlay>` / `<VddPanelToolbar>` / `<VddFloatingWidget>` | `<ndd-panel-overlay>` / `<ndd-panel-toolbar>` / `<ndd-floating-widget>` |
| `<VddToolbarButton>` … `<VddToolbarSearch>` | `<ndd-toolbar-button>` … `<ndd-toolbar-search>` |

### Two-way state — `v-model` → `model()`

Every vdd model is an Angular `model()`, bindable as `[( )]`: the sidebar's `activeTabId`,
`visible`, `stripVisible`, `width`; the toolbar's `visible`; the widget's `open` and `placement`;
the toggle's `active`. vdd's `@update:x` is `(xChange)`. See N10 for the one semantic difference.

### Slots → typed templates

| vdd slot | ndd |
|---|---|
| `#tab-<id>` | `<ng-template nddSidebarTab="id" let-tab let-close="close">` |
| `#header` | `<ng-template nddSidebarHeader>` |
| context-menu slot | `<ng-template nddContextMenuTemplate let-items let-close="close">` |

Every template's context is typed through `ngTemplateContextGuard`.

### Angular additions

`NddModalRef<R>` with `afterClosed()` and `injectModalRef()` (shaped like `MatDialogRef`);
`injectModals()` / `injectSidePanels()` / `injectFloatingWidgets()` / `injectSidebar()` /
`injectSidebarTab()` / `injectToolbar()` / `injectContextMenu()` / `injectMerged*()`; lazy panels
through `registerLazy`; server-side rendering and hydration (§4.2 N12).

## 2. Layout compatibility *(hard requirement, [ADR 0008](decisions/0008-layout-json-compatibility.md))*

The saved layout is the family's shared format, byte for byte:

- the ten rdd 6.2.0 fixtures load and re-save identically (`rdd-fixtures.spec.ts`,
  `round-trip.spec.ts`);
- twelve real gesture sequences, driven against vdd's playground and ndd's in the same viewport,
  produce equal layouts (the M6 differential gate);
- **34 layouts** (the fixtures plus both libraries' saves from those gestures) are loaded into
  vdd and into ndd and re-saved: the two saves are the same string, each library re-saves the
  other's output unchanged, and a second round trip changes nothing (the M13 round-trip gate).

## 3. Test map

### The vdd suites

Every vdd suite is ported, with vdd's test names preserved (`vdd-` → `ndd-`, `useX` → `injectX`).
The counts gate enforces each floor; 834 tests run against vdd's 765.

| vdd suite | ndd spec | vdd | ndd | Milestone |
|---|---|---|---|---|
| `smoke.test.ts` | `smoke.spec.ts` | 1 | 1 | M1 |
| `anchorGeometry.test.ts` | `anchor-geometry.spec.ts` | 12 | 12 | M2 |
| `dragResize.test.ts` | `drag-resize.spec.ts` | 10 | 10 | M2 |
| `layoutTree.test.ts` | `layout-tree.spec.ts` | 40 | 40 | M2 |
| `serializable.test.ts` | `serializable.spec.ts` | 12 | 12 | M2 |
| `stretch.test.ts` | `stretch.spec.ts` | 12 | 12 | M2 |
| `stylesheet.test.ts` | `stylesheet.spec.ts` | 7 | 9 | M2 |
| `eventBus.test.ts` | `event-bus.spec.ts` | 11 | 11 | M3 |
| `useWorkspace.test.ts` | `inject-workspace.spec.ts` | 9 | 14 | M3 |
| `rdd-fixtures.test.ts` | `rdd-fixtures.spec.ts` | 30 | 30 | M3 |
| `registry.test.ts` | `registry.spec.ts` | 9 | 12 | M3 |
| `round-trip.test.ts` | `round-trip.spec.ts` | 26 | 26 | M3 |
| `selfDrop.test.ts` | `self-drop.spec.ts` | 20 | 20 | M3 |
| `stateTransitions.test.ts` | `state-transitions.spec.ts` | 45 | 45 | M3 |
| `workspace.test.ts` | `workspace.spec.ts` | 30 | 30 | M3 |
| `desktop.test.ts` | `desktop.spec.ts` | 24 | 24 | M4 |
| `usePanel.test.ts` | `inject-panel.spec.ts` | 14 | 14 | M4 |
| `floatingWindows.test.ts` | `floating-windows.spec.ts` | 25 | 25 | M5 |
| `dragDock.test.ts` | `drag-dock.spec.ts` | 27 | 27 | M6 |
| `taskbar.test.ts` | `taskbar.spec.ts` | 20 | 20 | M7 |
| `contextMenu.test.ts` | `context-menu.spec.ts` | 33 | 38 | M8 |
| `sidebar.test.ts` | `sidebar.spec.ts` | 91 | 111 | M9 |
| `toolbar.test.ts` | `toolbar.spec.ts` | 42 | 48 | M9 |
| `useOverlays.test.ts` | `modals-side-panels.spec.ts` | 9 | 10 | M10 |
| `overlays.test.ts` | `overlays.spec.ts` | 6 | 11 | M10 |
| `panelLifecycle.test.ts` | `panel-lifecycle.spec.ts` | 25 | 29 | M10 |
| `toast.test.ts` | `toast.spec.ts` | 16 | 20 | M10 |
| `panelOverlay.test.ts` | `panel-overlay.spec.ts` | 69 | 71 | M11 |
| `panelToolbarControls.test.ts` | `panel-toolbar-controls.spec.ts` | 16 | 16 | M11 |
| `contributions.test.ts` | `contributions.spec.ts` | 21 | 21 | M12 |
| `diagnostics.test.ts` | `diagnostics.spec.ts` | 14 | 14 | M12 |
| `i18n.test.ts` | `i18n.spec.ts` | 25 | 26 | M12 |
| `styleHookups.test.ts` | `style-hookups.spec.ts` | 14 | 17 | M13 |

`panel-host.spec.ts` (8) has no vdd counterpart: it pins ndd's own zero-unmount host.

### The rdd suites, traced

vdd accounted for rdd's 26 suites; each lands in ndd through the vdd suite it became.

| rdd suite | vdd disposition | ndd spec |
|---|---|---|
| `CoreLayout` · `TabOperations` | Ported | `desktop.spec.ts` |
| `DomStability` | Substituted, because rdd's version asserts React-portal internals | `desktop.spec.ts`, `panel-host.spec.ts`, and the M4 browser gate (same node, live WebGL, playing video, scroll kept) |
| `EventBus` | Ported | `event-bus.spec.ts` |
| `FloatingWindows` | Ported | `floating-windows.spec.ts` |
| `FormContainer` | Rewritten as `panelLifecycle`, since the six subscription methods became refs | `panel-lifecycle.spec.ts` (signals; D14 in its Angular form, N8) |
| `Internationalization` | Ported | `i18n.spec.ts` |
| `LayoutSerialization` | Ported | `round-trip.spec.ts`, `rdd-fixtures.spec.ts` |
| `PanelContribution` | Ported | `contributions.spec.ts` |
| `PanelOverlay` | Ported | `panel-overlay.spec.ts` |
| `PanelRegistry` | Ported | `registry.spec.ts` |
| `PanelSystem` | Ported | `overlays.spec.ts` |
| `Sidebar` | Ported | `sidebar.spec.ts` |
| `SpawnLifecycle` | Ported | `workspace.spec.ts` |
| `StateTransitions` | Ported | `state-transitions.spec.ts` |
| `StyleHookups` | Ported | `style-hookups.spec.ts` |
| `Toast` | Ported | `toast.spec.ts` |
| `Toolbar` | Ported | `toolbar.spec.ts` |
| `TouchSupport` | Ported | `drag-dock.spec.ts` and the M6 touch gate |
| `V2Features` | Partly moot: the `WorkspaceClient` queue tests test machinery vdd deletes, since the store exists before any component | `workspace.spec.ts`, `inject-workspace.spec.ts` |
| `V3Diagnostics` | Ported | `diagnostics.spec.ts` |
| `anchorGeometry` | Ported | `anchor-geometry.spec.ts` |
| `dragResize` | Ported | `drag-resize.spec.ts` |
| `serializable` | Ported | `serializable.spec.ts` |
| `sidePanelPositioning` | Ported, folded into the stylesheet suite | `stylesheet.spec.ts` |
| `useColorScheme` | Ported | `diagnostics.spec.ts` (CS1–CS5) |

## 4. Deliberate divergences

### 4.1 Inherited from vdd (D-series)

vdd fixed sixteen rdd defects (D1–D16) and one of its own regressions (R1). ndd carries every
fix, and each is pinned again in ndd.

| # | The rdd defect vdd fixed | In ndd | Pinned by |
|---|---|---|---|
| D1 | Taskbar "Maximize" did nothing | Carried | M8 browser gate; context-menu spec |
| D2 | `activePanelId` left stale by five actions | Carried: one `resolveActive()` | state-transitions spec; contributions PC12–PC13 |
| D3 | `openPanel` on a minimised panel restored to the wrong leaf | Carried | M7 browser gate; state-transitions spec |
| D4 | Re-opening a minimised panel published no events | Carried | M7 browser gate |
| D5 | Resize handles clipped by `overflow: hidden` | Carried | M5 and M11 browser gates (hit-tested), M11 rule (no negative inset) |
| D6 | Inner scroll lost on every transition | Carried, and strengthened (N1) | M0/M4 browser gates |
| D7 | Focus lost on every transition | Carried | M4 browser gate |
| D8 | The library styled the host page | Carried: the stylesheet styles only `ndd-` DOM | css-prefix gate (ADR 0011); M13 coexistence gate |
| D9 | A dead `.maximized` hookup | Carried | M13 class↔rule sweep |
| D10 | A vendor class hard-coded in the stylesheet | Carried | css-prefix gate |
| D11 | The taskbar thumbnail dead to the pointer | Carried | M7 browser gate (rdd's defect as control) |
| D12 | Load-bearing layout in inline styles | Carried | M9 rules; M9 browser gate |
| D13 | Unprefixed `@keyframes` | Carried | M9 rules; css-prefix gate |
| D14 | A closing panel could not observe its own deactivation | Carried in Angular's form (N8) | panel-lifecycle spec |
| D15 | No scroll affordance on an overflowing tab bar | **Same known gap as vdd**: the tab bar scrolls by wheel, trackpad, touch and drag; the taskbar has arrows | — (§5) |
| D16 | A floating widget's title could not be localised | Carried | panel-overlay PO28–PO30; M12 rules |
| R1 | vdd 1.0.0: a managed widget discarded every placement gesture | Cannot occur as written (M11 finding 3) | panel-overlay PO31–PO35 |

### 4.2 Improvements over vdd (N-series)

Behaviour where ndd knowingly differs from vdd because vdd's is a defect found during the port,
or because Angular requires it. Each is pinned by a test or a gate rule, and N1–N7, N9, N11 and N13–N17
are back-portable to vdd.

| # | vdd behaviour | ndd behaviour | Pinned by |
|---|---|---|---|
| N1 | Scroll offsets and focus are captured only at move time. A panel whose **host** is destroyed (a leaf re-created) is detached before any hook runs, and detached subtrees read `scrollTop 0`, so the offset is lost | The record is kept current from live capture-phase `scroll` / `focusin` events, so it is correct whenever the detach happens. Chrome's synchronous `focusout` during removal is handled (ignored for own moves; judged a microtask later otherwise) | M0 `REBUILD` steps; ADR 0002 findings 1–2 |
| N2 | The taskbar preview's entry animation starts `translateY(-90%)` — 10% of its own height (~18px) low, more than the 8px gap — so for the first frames it covers its icon, and a quick click or right-click after hovering lands on the preview | The slide-in starts 6px low, inside the gap: the preview never covers its icon | M8 browser gate (overlap check + `--control` with vdd's keyframes) |
| N3 | The context menu supports Escape only | The WAI-ARIA menu pattern: focus moves in, arrows/Home/End rove enabled items, ArrowRight/Left (mirrored in RTL) enter/leave submenus, Escape returns focus, checkbox items are `menuitemcheckbox` | context-menu spec (keyboard block); M8 browser gate |
| N4 | A tab's close × is a clickable `<span>` with no keyboard access | The focused tab closes with **Delete** (the WAI-ARIA tabs pattern), announced by `aria-keyshortcuts`, through the same close sequence as the ×. The × itself stays a pointer affordance, `aria-hidden`: a focusable control inside `role="tab"` is a nested interactive. (M4 first made the × focusable; M13's axe sweep showed why that was the wrong fix.) | style-hookups spec (accessibility); M13 axe + keyboard gate |
| N5 | A toolbar group's flyout mirrors on the **workspace's** direction. That is right only when the app also puts `dir` on the chrome around the desktop (vdd's demo does); with only the desktop RTL, the strip stays on the left while the flyout opens leftwards off-screen and is clamped back over the strip | The flyout mirrors on the **strip's own computed direction** — where it is actually laid out. Its content still takes the workspace's `dir` | toolbar spec ("by the strip's own direction"); M9 browser gate (`rtl` and `rtl-desktop-only` cases) |
| N6 | The sidebar's resizer grows the drawer by the **logical** side. Under a right-to-left container the flex row reverses, so `position="left"` renders on the right edge — and dragging its resizer away from the edge shrinks it | The drag direction follows the side the drawer is physically on (logical side × computed direction) | sidebar spec ("Right-to-left"); M9 browser gate (RTL page resize) |
| N7 | A collapsed toolbar (`visible=false`) keeps its 1px edge border, leaving a line where the strip was | A collapsed strip carries `ndd-toolbar-strip--collapsed`, which drops the border: it collapses to nothing | toolbar spec ("Collapsed strip"); M9 browser gate (width 0) |
| N8 | D14: a closing panel observes its own deactivation through a `flush: 'sync'` watcher, published before `panel:closed` | Angular has no synchronous effect, and a closing panel's effects never run (it is destroyed before they flush). The synchronous channel is the workspace's `panel:activated` event, which `closePanel` publishes before `panel:closed` while the closing panel's subscription is live; `DestroyRef.onDestroy` is the deterministic "before I go" hook | panel-lifecycle spec (the ordering test asserts all three) |
| N9 | Escape: the answering modal calls `stopPropagation()`, which does not stop other listeners on the same `document`. A drawer opened *after* a modal listens after it, and since a guard-less close is synchronous the stack is already empty when the drawer looks — so one Escape closes both | The answering overlay calls `preventDefault()`, and every overlay ignores an Escape whose default was prevented | overlays spec ("a drawer was opened after it"); M10 rule 3 |
| N10 | A model bound *without* a listener is controlled: the widget reports a gesture but never self-applies it (PO24) | An Angular `model()` is locally writable: a one-way `[placement]` seeds it and follows the parent's *changes*, but does not freeze it. The Angular way to veto a gesture is to answer `(placementChange)` with the parent's own value, which re-syncs the widget. The same holds for every model in the library (sidebar, toolbar, toggle, widget) | panel-overlay spec PO24 (rewritten to the veto pattern and says so) |
| N11 | `.vdd-fill-viewport` on the desktop element itself does nothing: the later `.vdd-workspace { height: 100% }` has the same specificity and wins, so the workspace stays as tall as its content | `.ndd-workspace.ndd-fill-viewport` is part of the utility's selector, so it works on the workspace as well as on a consumer's own container | M13 consumer smoke (workspace height in a fresh app) |
| N12 | Panel mounts are tagged with `el.dataset.vddPanel`; vdd does not server-render | `setAttribute('data-ndd-panel', …)`: the server DOM has no `dataset`, and the throw left every server-rendered workspace empty. ndd server-renders and hydrates | M13 consumer smoke (prerender log, served HTML) |
| N13 | A toolbar group's flyout items are `role="menuitem"` with `aria-pressed` — an attribute ARIA does not allow on a menu item | The flyout's tools are mutually exclusive, so they are `menuitemradio` with `aria-checked` | M13 axe gate |
| N14 | The toast container carries `aria-label` on a generic `<div>`, which ARIA prohibits | It is a labelled `role="region"` — what a notification area is | style-hookups spec (accessibility); M13 axe gate |
| N15 | Dragging a split divider under RTL moves it *away* from the pointer: the delta is physical, the sizes logical, and a row runs right to left | The drag reads the row's computed direction and negates the delta under RTL, so the divider follows the pointer in both directions (found while writing the manual, M15) | M15 browser gate (divider follows the pointer, LTR and RTL, both schedulers) |
| N16 | `ToastAdapter.show` is never called: a new toast is queued, and an adapter only ever sees `update` and `dismiss` | A new toast calls `adapter.show(id, message, options)` with the defaults filled in (`info`, 5000 ms, closable), so an adapter really does receive every call | toast spec ("an adapter receives every call", strengthened to assert the `show`) |
| N17 | With a custom context-menu template, a press *inside* the menu counts as outside (there is no built-in root to test against), so the menu is dismissed on `pointerdown`, before the item's click | In custom mode the menu host counts as inside, so a custom menu's own buttons work with a real pointer; a press outside still dismisses | context-menu spec ("a real press inside a custom menu…") |

### 4.3 Shape changes with no behavioural equivalent

These change how something is written, not what it does:

- vdd's composables are `inject*()` functions; `update:x` events are `(xChange)` outputs.
- `<ndd-toolbar-button>` has no `click` output: the native click bubbles, and fires nothing while
  disabled. `<ndd-toolbar-search>`'s `select` is `(resultSelect)`, since `select` is a DOM event.
- Panel options are `inputs` applied with `setInput`; a component receives only the inputs it
  declares, and `panelId` is always the injected one.
- Every dev-only diagnostic is guarded inline with `ngDevMode`, so a production build carries none
  of their text (M12).
- `injectModals().open()` returns an `NddModalRef<R>` (with `id` and `afterClosed()`) where vdd's
  `useModals().open()` returns the id.
- Every action — workspace, `PanelRef`, toast — runs untracked, so calling one from an `effect()`
  is safe ([ADR 0013](decisions/0013-actions-are-untracked.md)). vdd's watchers never had the
  question; in Angular an unguarded read inside an action made the calling effect loop.

## 5. Known gaps

- **D15** — tab-bar overflow has no chevron buttons, as in vdd (§4.1). A change of its own.
- **Three accessible names are not in the message table**: the toast region ("Notifications"),
  the toast close button ("Close notification") and the sidebar drawer's close button ("Close")
  are English in every locale, as in vdd. Adding keys would change `MessageKey`, which every
  consumer's `Record<MessageKey, string>` table is typed against — a change for a minor release,
  made in both libraries together.
- **`loadLayout` is lenient about a partial payload**, as in vdd: an object with a `gridRoot` but
  without `floating`, `minimized` or `panels` is read as empty arrays, returns `true`, and replaces
  the workspace. Layouts the libraries write always carry all four; only a hand-built payload can
  hit this. Documented in [chapter 5](manual/05-persistence.md).
- No other rdd or vdd behaviour is missing: every suite in §3 is ported and passing.
