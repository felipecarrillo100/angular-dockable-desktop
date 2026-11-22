# Parity with vue-dockable-desktop and react-dockable-desktop

ndd targets **vue-dockable-desktop 1.1.1** (vdd) as its baseline, and through it
**react-dockable-desktop 6.3.1** (rdd). vdd is already a full port of rdd with rdd's known defects
fixed (its D-series), so ndd ports vdd's behaviour and vdd's tests, and consults rdd only where
vdd leaves something out. Where ndd behaves differently from vdd, it says so here (the N-series)
and a test or a gate rule pins the difference.

**1.1.0** adds one feature ahead of vdd: react-dockable-desktop **7.2.0**'s skin branding
(§1, *Branding*, and §3, *rdd 7.2.0 branding, traced*), with the same variables under the
`ndd-` prefix and the same tests ([ADR 0014](decisions/0014-brand-variables.md)).

**1.12.0** adds rdd **7.12.0** and **7.12.1**'s pop-out windows, as vdd 1.14.0 did (§1, *Pop-out
windows*; §3, *rdd 7.12.0 and 7.12.1 pop-out windows, traced*; §4.5;
[ADR 0019](decisions/0019-popout-windows.md)).

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
`dockPanelToGroup`, `minimizePanel`, `restorePanel`, `maximizePanel`, `setPanelIcon` (1.10.0),
`updatePanelProps` (1.11.0), `setDirection`, `saveLayout`, `loadLayout`, `showContextMenu`,
`closeContextMenu`, the `overlays.*` methods and the `toolbar`/`contributions` stores.
`focusPanel(id, { restore })` is a second overload since 1.11.0, as in rdd 7.11.0 and vdd 1.13.0. One option is renamed for Angular: `openPanel(…, { inputs })`
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
| `<VddAlert>` (vdd 1.8.0) | `<ndd-alert>` (`NddAlert`, 1.6.0) |
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

### Pop-out windows (1.12.0, from rdd 7.12.0 and 7.12.1 / vdd 1.14.0)

Same names as rdd and vdd; the shapes differ only where an Angular rule applies (the desktop owns
the windows, the wrapper is a component type whose context is injection, state is a signal). Traced
in §3, *rdd 7.12.0 and 7.12.1 pop-out windows, traced*; divergences in §4.5; the reasons in
[ADR 0019](decisions/0019-popout-windows.md). Guide: [chapter 15](manual/15-popout-windows.md).

| rdd 7.12.1 | vdd 1.14.0 | ndd 1.12.0 | Note |
|---|---|---|---|
| `createWorkspace({ popOut: true })` | the same | `provideDockableDesktop({ popOut: true })`, `createWorkspace({ popOut: true })` | `WorkspaceConfig.popOut`; not kept on `workspace.config` |
| `defaultOptions.canPopOut` | the same | the same | `core/registry.ts` `PanelDefaultOptions` |
| `workspace.popOutPanel(id)` → `PopOutResult` | the same | the same | `workspace/workspace.ts` checks `disabled`, then hands off to the registry (`core/pop-out-windows.ts`) |
| `workspace.returnPanel(id)`, `workspace.focusPanelWindow(id)` → `{ ok }` | the same | the same | |
| `focusPanel(id)` on a popped-out panel brings its window forward | the same | the same | the internal `activatePanel` is `focusPanel` without the window focus |
| `PanelInfo.poppedOut` | the same | the same | runtime only; stripped on load (`core/serialize.ts`) |
| `PopOutResult` | the same union | the same union | `core/types.ts` |
| `<DockableDesktopProvider popoutUrl>` | `<VddDesktop popout-url>` | `<ndd-desktop [popoutUrl]>` | resolved against `document.baseURI`, so a relative URL follows `--base-href` |
| `<DockableDesktopProvider popoutWrapper>` (`ComponentType<PopoutWrapperProps>`) | `<VddDesktop :popout-wrapper>` (a component, default slot) | `<ndd-desktop [popoutWrapper]>` (a `Type<PopoutWrapper>`: inputs `window`, `document`, an `<ng-content />`) | its context is what its `providers` provide (`common/popout-wrap.ts`, internal) |
| `PopoutWrapperProps` | the same | `PopoutWrapper` | the interface the wrapper component implements: `window` and `document` as signals |
| `usePanelWindow()` → `PanelWindow` | the same, live getters | `injectPanelWindow()` → `Signal<PanelWindow>` | `panel/panel-window.ts` |
| `usePanel().isPoppedOut` | a `ComputedRef<boolean>` | `injectPanel().isPoppedOut`, a `Signal<boolean>` | `PanelRef` |
| `useFloatingWidgets().popOut(id)`, `ManagedWidget.canPopOut` | the same | `injectFloatingWidgets().popOut(id)`, the same | `panel-overlay/widget-hosting.ts` |
| `useWidget().isPoppedOut` | a `ComputedRef<boolean>` | `injectWidget().isPoppedOut`, a `Signal<boolean>` | `WidgetHandle` |
| `WidgetMenuContext.canPopOut`, `.isPoppedOut`, `.popOut()` | the same | the same | |
| events `panel:popping-out`, `panel:popped-out` (`{ id, window }`), `panel:returning`, `panel:returned` | the same | the same | in `BuiltInEvents` |
| messages `popOutWindow`, `returnToDesktop`, `backIntoPanel`, `popOutBlocked`, `inOwnWindow` | the same keys | the same keys | ids `ndd.popOutWindow`, … |
| `.rdd-popout-frame` and `__header`, `__icon`, `__icon--menu`, `__title`, `__return`, `__body` | `.vdd-…` | `.ndd-popout-frame` and the same parts | `src/styles/parts/26a-popout.css`; the frame is also `.ndd-workspace`; plus `.ndd-popout-wrapper`, `.ndd-popout-wrapper__content` |
| `data-rdd-popout`, `data-rdd-popout-kind`, `data-rdd-focused` on the frame | `data-vdd-…` | `data-ndd-popout`, `data-ndd-popout-kind`, `data-ndd-focused` | |
| `.rdd-taskbar-item--popout`, `data-rdd-taskbar-popout`, `.rdd-taskbar-item-popout-marker` | `.vdd-…` | `.ndd-taskbar-item--popout`, `data-ndd-taskbar-popout`, `.ndd-taskbar-item-popout-marker` | `src/styles/parts/06-taskbar.css` |
| `utils/domContext.ts`, `utils/documentRegistry.ts` (internal) | `core/domContext.ts`, `core/documentRegistry.ts` | `core/dom-context.ts`, `core/document-registry.ts` (internal) | plus `eventDocument(event)` and `isRtlElement` |
| `core/popOutWindows.ts`, `core/popOutStyles.ts` (internal) | the same | `core/pop-out-windows.ts`, `core/pop-out-styles.ts` (internal) | ported line for line, prefixes changed; plus the zone.js patch |
| `PopOutWindows.tsx`, the frame | `VddPopOutWindows.vue`, `VddPopOutFrame.vue` | `desktop/pop-out-frame.ts` `NddPopOutFrame` (internal, not exported) | portalled into the child's `<body>`, holding the panel's ordinary slot |

### Widgets out of the panel (1.11.0, from rdd 7.11.0 / vdd 1.13.0)

Same names as rdd and vdd; the shapes differ only where an Angular rule applies (content is a
component with `inputs`, state is a signal). Traced in §3, *rdd 7.11.0 widgets out of the panel,
traced*; divergences in §4.4.

| rdd 7.11.0 | vdd 1.13.0 | ndd 1.11.0 | Note |
|---|---|---|---|
| `useFloatingWidgets().move(id, to)` → `MoveResult` | the same | `injectFloatingWidgets().move(id, to)` | `panel-overlay/overlay-store.ts` (types), `panel-overlay/widget-hosting.ts` (the moves) |
| `useFloatingWidgets().location(id)` → `WidgetLocation \| null` | the same, a lookup | the same, reactive | reads the overlay's and the workspace's signals |
| `useFloatingWidgets().placement(id)` → `WidgetPlacement \| null` | the same | the same | the same JSON in all three (`core/widget-placement.ts`, rdd's values kept in its spec) |
| `ManagedWidget.canDock`, `.canFloat` | the same | the same | the hosted panel's options, through `core/panel-options.ts` `optionsFor` |
| `ManagedWidget.titleMenu(w)`, `WidgetMenuContext` | the same | the same | |
| `ManagedWidget.placement` | the same | the same | |
| `ManagedWidget.preserveEmbeds`, `defaultOptions.preserveEmbeds` | the same | the same | `core/dom-move.ts` |
| `ManagedWidget.content: ReactNode` | `component` + `props` | `component` + `inputs` | as for every managed widget since 1.0 |
| `useWidget()`, `WidgetHandle` | the same | `injectWidget()`, `WidgetHandle` | `id`, `ownerPanelId` plain; `panelId`, `location` `Signal`s; `onWillMove` / `onMoved` return the unsubscribe and are also unsubscribed through the injecting context's `DestroyRef` (`panel-overlay/widget-handle.ts`) |
| `WidgetTarget`, `WidgetLocation`, `MoveResult`, `WidgetPlacement` | the same | the same | |
| `PanelInfo.owner`, `PanelOwner` | the same | the same | |
| `'rdd:widget'` (reserved component key) | `'vdd:widget'` | `'ndd:widget'` | `core/panel-options.ts` `HOSTED_COMPONENT` |
| `workspace.focusPanel(id, { restore })` | the same | the same | a second overload on `Workspace` |
| `workspace.updatePanelProps(id, props \| fn)` | the same | the same | the panel's inputs are set again with `setInput` |
| `.rdd-panel-float__content`, `.rdd-hosted-widget` | `.vdd-…` | `.ndd-panel-float__content`, `.ndd-hosted-widget` | plus `.ndd-widget-store`, each overlay's hidden store |
| `.rdd-workspace-tab-icon--menu`, `.rdd-window-title-icon--menu` | `.vdd-…` | `.ndd-workspace-tab-icon--menu`, `.ndd-window-title-icon--menu` | plus `.ndd-panel-float__menu` on the in-panel title button |
| `HostedPanels` actions (`openHostedPanel`, …) | `@internal` on `Workspace` | the same, `@internal`, plus `onStateChange` | not in `api-surface.json` |

### Two workspaces on one page (1.6.1, from rdd 7.7.1 / vdd 1.8.1)

| rdd 7.7.1 | ndd 1.6.1 |
|---|---|
| per-workspace panel host (DOM, sizes, lifecycle) | already: `PanelHost` provided per `<ndd-desktop>` since 1.0 |
| scroll/focus records keyed by element | already: kept on the desktop's own `PanelDomCache` |
| taskbar preview tooltip found by ref | already: no document-wide query |
| `<html>` mirror as an owner stack (`utils/documentMirror.ts`) | `core/document-mirror.ts`, used by `desktop.ts` |
| `TwoWorkspaces.test.tsx` (mirror cases) | `test/components/desktop.spec.ts`, "two desktops on one page" |

### Dialogs (1.6.0, from rdd 7.7.0 / vdd 1.8.0)

| rdd 7.7.0 | ndd 1.6.0 |
|---|---|
| `RddConfirm` `icon` prop, question icon beside the message | `NddConfirm` `icon` input (`NddIcon \| null`), via the internal `ndd-dialog-icon` |
| `RddAlert` | `NddAlert` (`<ndd-alert>`) |
| `useModals().confirm()` / `.alert()`, `ConfirmOptions` / `AlertOptions` | the same, on `injectModals()`; options left out are not passed, so each input keeps its default |
| `rdd-dialog-icon-{type}` from the `--rdd-toast-*-color` tokens | `ndd-dialog-icon-{type}` from `--ndd-toast-*-color` |
| `data-rdd-alert-ok`; `data-rdd-confirm-ok` / `-cancel` (new in rdd) | `data-ndd-alert-ok`; the confirm hooks already existed |
| `alertTitle` message; confirm title from `modalTitle` | `alertTitle` and `confirmTitle`, as vdd |
| `RddConfirm` `onSettled`; fix: dismissal never settled | already: `NddConfirm` settled on destroy |
| fix: `RddConfirm` overwrote the header icon | already: `NddConfirm` never set one |
| `Dialogs.test.tsx` | `test/components/dialogs.spec.ts`; M10 checks the alert settles on destroy, once |

### Source layout (1.5.1, from rdd 7.6.1)

rdd 7.6.1 split its large files to mirror the ports' layout (`src/types.ts`, `src/core/*`,
`components/workspace/*`, `components/panelOverlay/*`). ndd's TypeScript was already modular; only
its stylesheet changed: `styles.css` is now generated from `src/styles/parts/NN-area.css`, with the
same area names as rdd's and vdd's `src/styles/`.

### Context-menu focus (1.5.0, from rdd 7.6.0)

| rdd 7.6.0 | ndd 1.5.0 |
|---|---|
| menu opens with the menu element focused, nothing highlighted | `settle()` in `context-menu.ts`; the menu already had `tabindex="-1"` |
| `initialFocus?: 'menu' \| 'first-item'`; a keyboard `contextmenu` event (0,0) defaults to `'first-item'` | same option; `menuInitialFocus()` in `core/context-menu.ts` |
| ArrowUp from the menu goes to the last item | already: `onMenuKey` handled `current < 0` |
| the ⋮ button and the Menu key / Shift+F10 pass `'first-item'` | `openMenu()` passes it for a keyboard click (`detail` 0), which covers the ⋮ button; ndd has no Menu-key openers of its own, and a native keyboard `contextmenu` event is covered by the 0,0 rule |
| hover-opened submenu never takes focus | already: `openSubmenuAt(…, focusFirst)` focuses only from the keyboard |
| `--rdd-context-menu-focus-ring` | `--ndd-context-menu-focus-ring` |
| `KeyboardAccess.test.tsx` | `context-menu.spec.ts` (keyboard block); M8 browser gate |

### Toolbar buttons (1.4.0, from rdd 7.5.0)

| rdd 7.5.0 | ndd 1.4.0 |
|---|---|
| `--rdd-panel-toolbar-icon-size`, `--rdd-chrome-icon-size` | `--ndd-…` tokens; descendant `svg` rule, so icons inside `<ndd-icon>` are reached too |
| panel "on": accent 65% + black (dark) / accent (light), on-accent icon | same tokens, same values |
| `soft` chip tokens; `filled` on ≠ off | same |
| workspace toggle: 22% / 16% tint, accent edge and icon | same |
| global `:focus-visible` ring | ndd had none on toolbar/rail buttons: added on the three button classes |
| "Styling toolbar buttons" (panel overlay guide) | same section in `docs/manual/07-panel-overlay.md` |
| demo Toolbar Buttons panel | `projects/demo` Toolbar Buttons panel |

### Review fixes (1.3.1, from rdd 7.4.1)

| rdd 7.4.1 | ndd 1.3.1 |
|---|---|
| default formatter replaces every `{key}`; one shared copy | `formatLabel()`, which `Workspace.format()` now calls |
| window blur ends a tab drag and a floating-window drag | `DragDock` (mouse and touch), `<ndd-floating-window>` title bar |
| repair drops leaf ids missing from `panels`; mismatched or non-finite split sizes become even | `repairLayoutTree` (`core/layout-tree.ts`) |
| a throwing subscriber is logged, delivery continues | `EventBus` (`core/event-bus.ts`) |
| z counter seeded from restored windows | already: constructor and `loadLayout()` |
| toolbar search aborts and clears its debounce on unmount | already: `DestroyRef` in `toolbar-search.ts` |
| `Patch741.test.ts`, `DragBlur.test.tsx` | `review-fixes.spec.ts`, `drag-blur.spec.ts` |

### Field-report fixes (1.3.0, from rdd 7.4.0)

| rdd 7.4.0 | vdd 1.5.0 | ndd 1.3.0 |
|---|---|---|
| frost (and, where it saturates, its background) on a `::before` of the content containers | the same | the same — one transform for all three, prefix aside |
| `prefers-reduced-motion` stops the library's motion | the same | the same |
| `setDirection('rtl')` reaches the sidebar and toasts | `<VddSidebar>`, `<VddToasts>` | `<ndd-sidebar>`, `<ndd-secondary-sidebar>`, `<ndd-toasts>` |
| title `() => string` | `Label` gains `() => string` | `Label` gains `() => string` |
| non-finite saved geometry repaired on load | `core/serialize.ts` | `core/serialize.ts` |
| `data-rdd-*` identity attributes | already `data-vdd-*` | already `data-ndd-*` |
| CHANGELOG in the package | already | copied into the library project by `sync-package-readme.mjs` |
| `frost.browser.ts`, `motion.browser.ts`, `direction.browser.ts` | M17 browser | `scripts/gates/browser/m18.mjs` |
| — | reactivity notes (`markRaw`, `shallowRef`) | a `Directionality` recipe for Angular Material / CDK users |

### Brand surfaces and corners (1.2.0, from rdd 7.3.0)

| rdd 7.3.0 | vdd 1.4.0 | ndd 1.2.0 |
|---|---|---|
| `--rdd-brand-surface`, `--rdd-brand-text` | `--vdd-brand-surface`, `--vdd-brand-text` | `--ndd-brand-surface`, `--ndd-brand-text` |
| `--rdd-radius-scale` | `--vdd-radius-scale` | `--ndd-radius-scale` |
| `--rdd--b-*` derived values on `:root`, built on `--rdd--b-base` | the same, `vdd-` | the same, `ndd-` — one transform for all three, prefix aside |
| `--rdd-placeholder-bg` (a token since rdd 7.1.2) | the preview letter's rule reads `--vdd--b-placeholder-bg` | the same, `ndd-` |
| `--rdd-danger-color` on the unregistered-panel message | the literal danger red | the literal danger red |

### Branding (1.1.0, from rdd 7.2.0)

| rdd 7.2.0 | vdd 1.1.1 | ndd 1.1.0 |
|---|---|---|
| `--rdd-brand-accent` on `:root` | — | `--ndd-brand-accent` on `:root` |
| `--rdd-brand-on-accent` | — | `--ndd-brand-on-accent` |
| `--rdd-skin-font-family` (set by a skin) | — | `--ndd-skin-font-family` |
| `--rdd-font-family: var(--rdd-skin-font-family, …)` on `:root` | — | `--ndd-font-family: var(--ndd-skin-font-family, …)` on `:root` |
| every skin's `--rdd-accent-color: var(--rdd-brand-accent, …)`, tints as `color-mix()` | — | the same, `ndd-`: 14 accent declarations, 142 tints and 2 on-accent rules, textually identical to rdd's after the prefix |
| `WindowManager` sets `data-rdd-skin` on `<html>` | `data-vdd-skin` on `<html>` | `<ndd-desktop>` sets `data-ndd-skin` on `<html>` (1.0.0 already did), so the skin font resolves there |

Two differences in ndd's stylesheet, both older than 1.1.0: ndd's default stack has no
`'Segoe UI'` (`'Outfit', 'Inter', system-ui, -apple-system, sans-serif`, kept as it was), and ndd
had not declared `--ndd-font-family` at all — five rules carried their own fallbacks, which 1.1.0
removes, as rdd 6.4.0 had. ndd has no `--ndd-font-family-mono` token; its monospaced labels keep
`monospace`.

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
| `contextMenu.test.ts` | `context-menu.spec.ts` | 33 | 42 | M8 |
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

### rdd 7.2.0 branding, traced

| rdd 7.2.0 test | ndd |
|---|---|
| `tests/browser/branding.browser.ts` — 14-scene baseline, red brand, on-accent | `scripts/gates/browser/m16.mjs` (baseline in `scripts/gates/browser/fixtures/m16-branding-baseline.json`, captured from 1.0.0), both schedulers, plus a `--control` run that must fail |
| `tests/browser/fonts.browser.ts` — skin fonts, brand font in every skin | `scripts/gates/browser/m16.mjs` (fonts) |
| `StylesheetContract.test.ts` — "branding contract" (5) | `stylesheet.spec.ts` — "branding contract (styles.css)" (5, names kept) |
| `tests/browser/radius.browser.ts` (7.3.0) — corner baseline, scale 0 and 1.5 | `scripts/gates/browser/m17.mjs` (corners; baseline `fixtures/m17-radius-baseline.json`, captured from 1.1.0), both schedulers |
| `branding.browser.ts` brand-surface cases (7.3.0) — leftovers, layers, contrast, one input | `scripts/gates/browser/m17.mjs` (surfaces) |
| `StylesheetContract.test.ts` — "corner contract" (2), "surface contract" (3) | `stylesheet.spec.ts` — the same, names kept |

### rdd 7.12.0 and 7.12.1 pop-out windows, traced

rdd 7.12.0 is pop-out windows (stages S1–S7 and next.1, with 7.12.0's event timing); 7.12.1 lets a
click inside a pop-out open another one. vdd 1.14.0 and ndd 1.12.0 port the final 7.12.1 behaviour
at once, not the history. Every ported test keeps rdd's number behind an `X`, because `PO` was
already an ndd id; ndd's own additions are `…N` ids (`XPON1`, `XWGN1`, …).

| rdd 7.12.1 | vdd 1.14.0 | ndd 1.12.0 |
|---|---|---|
| `DocumentAware.test.tsx` (DA1–DA18) | `documentAware.test.ts` XDA1–XDA20 (36) | `test/components/document-aware.spec.ts` XDA1–XDA20 (45): vdd's 36, plus `eventDocument`, window-click and main-document dismissal, RTL submenu width, realm-neutral inside checks for the menu and the flyout, live focus and scroll tracking, a cancelled widget drag, the strip's direction from its window, the button filter, floating-window activation, the page leaving the press to its elements, the search's focusout |
| `PopOut.test.tsx`, the store cases | `popOutStore.test.ts` (113) | `test/store/pop-out-store.spec.ts` (122): vdd's 113 in full (XPO37, the 1,332-case matrix, its count asserted; XPO44 ×8), plus XPON1–XPON9 |
| `PopOut.test.tsx`, the window cases | `popOutWindows.test.ts` (45) | `test/components/pop-out-windows.spec.ts` (53): vdd's 45 (XPO1–XPO32, XPOE1/2, XPOM1, XPOR1), plus XPON1–XPON7 and XPON5b |
| `PopOutStyles.test.tsx` (PS1–PS9) | `popOutStyles.test.ts` (14) | `test/components/pop-out-styles.spec.ts` (17): XPS1–XPS9, plus XPSN1 (`lang` / `dir` through the mirror), XPSN2 (the desktop's `skin` and `animations`), XPSN3 (a link's `href` alone) |
| `PopoutWrapper.test.tsx` (PW1–PW6) | `popoutWrapper.test.ts` (17) | `test/components/popout-wrapper.spec.ts` (19): XPW1–XPW6 (XPW6 ×10), plus XPWN1 (a lazy panel inside the wrapper) and XPWN2 (a closed panel takes its wrapper) |
| `PopOutChrome.test.tsx` (PC1–PC5) | `popOutChrome.test.ts` (18) | `test/components/pop-out-chrome.spec.ts` (20): XPC1–XPC5, plus XPCN1 (the page's container always, a toast dismissed in its window) and XPCN2 (the adapter) |
| `PopOutWidgets.test.tsx` (WG1–WG14, WG2b, WG9b) | `popOutWidgets.test.ts` (36) | `test/components/pop-out-widgets.spec.ts` (42): vdd's 36, plus XWGN1–XWGN6 (`onMoved` after `panel:popped-out`, no built-in item, a plain icon without `titleMenu`, the owner out and the widget in its panel, the wrapper destroyed on close, a widget already out) |
| `PopOutFocus.test.tsx` (PF1–PF5, PF4b) | `popOutFocus.test.ts` (19) | `test/components/pop-out-focus.spec.ts` (20): XPF1–XPF6, XPF4b; XPF2 adds focus after an activation |
| `PopOutFromPopOut.test.tsx` (its PF1–PF7) | `popOutFromPopOut.test.ts` (8) | `test/components/pop-out-from-pop-out.spec.ts` (8): XFP1–XFP7, XFP6b |
| `tests/browser/popout.browser.ts` | `scripts/gates/browser/m18.mjs` (15 cases) | `scripts/gates/browser/m19.mjs` (16 cases, each zoneless and with `?zone`): vdd's 15, plus `zone` (a listener on the pop-out's own document renders under zone.js only with the patch) |
| `tests/browser/harness/main.tsx` | the playground's `?po=1`, … | the playground's `?po=1`, `po2=1`, `pourl=1`, `rc=1`, `wo=1`, `opo=1` (`projects/playground/src/app/pop-panel.ts`, `pop-widget.ts`, `runtime-css.ts`, `public/popout.html`) |

**rdd cases not ported, each with its reason:**

| rdd case | Why |
|---|---|
| DA6, the keyboard open at its target, with the target's `dir` | ndd's context menu opens where its request says, with the workspace's `dir` (as vdd); the library's own icon buttons pass an event below the icon (`menuEventBelow`), covered by XPF6 and XWG10 |
| DA13, "focus goes back to the button" | ndd's toolbar flyout never moves focus into itself, so there is nothing to hand back (as vdd) |
| DA14, `isElementRtl`'s document fallback | ndd's `isRtlElement` reads the element's own window; there is no fallback to port (XDA14 tests it in both realms) |
| PO10's StrictMode case | React's StrictMode double effect has no Angular equivalent; PO10's other cases are XPO10 |
| browser "alone in its group (an edge dock): the grid comes back exactly" | covered by the store matrix XPO37 (1,332 return cases, an edge dock among them) and by the browser's `neighbours` case |
| browser "an Emotion-styled element looks the same in the pop-out" | the playground has no Emotion: the `wrapper` case uses a runtime-inserting stand-in (`runtime-css.ts`, rules added with `insertRule` per document), which shows the same production failure |
| browser "a widget's frame icon is styled and clickable in the window; its titleMenu's icons too" | the wrapper around a widget's content is unit-tested (XWG12, XWGN4, XWGN5, XPC1); the `widget menu` case clicks the frame's icon and its item in the window; the playground's widget has no runtime-styled icon |
| browser "the frame's icon and a menu item's icon look as in the page; a toast raised in the window shows there" | inside the `wrapper` case, not a case of its own |

### rdd 7.11.0 widgets out of the panel, traced (ndd 1.11.0)

rdd 7.11.0 is 7.11.0-next.0 (the feature), 7.11.0-next.1 (feedback fixes) and two fixes; vdd 1.13.0
and ndd 1.11.0 port all three at once.

| rdd 7.11.0 | vdd 1.13.0 | ndd 1.11.0 |
|---|---|---|
| a managed widget's content rendered once into `div.rdd-panel-float__content` (next.0, Changed) | teleported once into `div.vdd-panel-float__content` | created once, imperatively, on `div.ndd-panel-float__content` with the overlay's injector plus a per-widget child injector carrying the handle, and attached to `ApplicationRef` (`panel-overlay/widget-content.ts`, `widget-content-slot.ts`); `open()` creates it synchronously |
| the whole placement in the overlay (next.0, Changed) | `ManagedPlacement` in the overlay store | the same; the size is seeded once from `width` / `height` |
| a pointerdown anywhere in the content brings the widget to the front | the same (PO39) | the same: a capture-phase listener on the content slot (PO39) |
| hosted panels: `'rdd:widget'`, `PanelInfo.owner`, never saved, never reported as excluded, dropped from a hand-made layout | `'vdd:widget'`, the same rules | `'ndd:widget'`, the same rules (`workspace/workspace.ts`, `core/serialize.ts` `withoutHostedPanels`), `initialState` included |
| `move()` / `location()`, the four refusals | the same | the same (`widget-hosting.ts`) |
| `canDock` / `canFloat`, `titleMenu`; hosted tab menu: items, then Minimize and Close, no Float; ⋮ menu: items, then Close | the same | the same (`core/panel-menu.ts` `buildPanelMenu`, `buildMoreActionsMenu`) |
| `useWidget()`, `onWillMove` / `onMoved` | the same | `injectWidget()`; a user's move is heard through the workspace's synchronous `onStateChange`, before anything renders |
| `placement()` / `open({ placement })` | the same JSON | the same JSON; a free position waits for a size through the overlay's `ResizeObserver` |
| `focusPanel(id, { restore })`, `updatePanelProps`, `preserveEmbeds` | the same; each cache parks in its own store | the same; parking is driven from the workspace's state writes (§4.4) |
| next.1: `useWidget().panelId` | a `ComputedRef` | a `Signal` |
| next.1: the tab / title-bar icon opens the widget's menu | the same | the same, with the differences in §4.4 |
| next.1: a widget's panel brings its owner's contribution | the same | the same (`activeContributionSignal` maps the hosted id to its owner; the M12 rule accepts the optional argument) |
| next.1: a title set with `updatePanelTitle` kept across moves out of the panel | the same | the same |
| 7.11.0: `onMoved` after floating → floating and tab → tab in the same group | the same | the same (`settled()` after every `move()`) |
| 7.11.0: `move({ to: 'floating' })` without a rect, out of the panel, opens where its panel is | the same | the same (`frameRect`) |
| `HostedPanels.test.tsx` (HP1–HP7) | `test/store/hostedPanels.test.ts` (19) | `test/store/hosted-panels.spec.ts` (23), names kept, plus HP8 (the standard menu reads a hosted panel's own options) |
| `WidgetsOut.test.tsx` (WO1–WO8, WO17–WO19, WO21) | `test/components/widgetsOut.test.ts` (40) | `test/components/widgets-out.spec.ts` (42), names kept |
| `WidgetsOut.test.tsx` (WO9–WO16, WO20, WO22, WO23) | `test/components/widgetsOutMenus.test.ts` (33) | `test/components/widgets-out-menus.spec.ts` (37), names kept |
| `WidgetPlacement.test.ts` (WP1–WP6) | `test/core/widgetPlacement.test.ts` (11) | `test/core/widget-placement.spec.ts` (11), names and values kept |
| `FocusPropsEmbeds.test.tsx` (FE1–FE4) | `test/components/focusPropsEmbeds.test.ts` (17) | `test/components/focus-props-embeds.spec.ts` (19), names kept; FE4 counts real detaches with a custom element's `disconnectedCallback` |
| `PanelOverlay.test.tsx` PO36–PO39 | `panelOverlay.test.ts` PO36–PO39 | `panel-overlay.spec.ts` PO36–PO39 (11 tests, 71 → 82), plus a detach probe in PO37 |
| `tests/browser/widgetsOut.browser.ts` | `scripts/gates/browser/m11.mjs`, five 7.11 sections | `scripts/gates/browser/m11.mjs`, six 7.11 sections: the content fills its body and a press in it raises the widget (M2); out of the panel and back with the same element and state (M3); the title menu in the panel, on the hosted tab and on the floating title bar, by pointer and by keyboard (M4); `onWillMove` sees the old size and `onMoved` the new one (M5); placement saved and re-opened (M6); an iframe that keeps its document (M7) |
| — | the M13 browser tour renders the new classes | `scripts/gates/browser/m13.mjs`: the tour opens a managed widget with a `titleMenu`, tabs it and floats it, so `.ndd-panel-float__content`, `.ndd-widget-store`, `.ndd-panel-float__menu`, `.ndd-hosted-widget` and both `--menu` icon classes are rendered, swept and axe-checked |

### rdd per-panel icons, traced (ndd 1.10.0)

rdd has had a runtime panel icon since 7.1.0; vdd ported it in 1.12.0, ndd in 1.10.0. Same names.

| rdd 7.10.0 | vdd 1.12.0 | ndd 1.10.0 |
|---|---|---|
| `setPanelIcon(id, icon \| null)`: unknown id no-op, same icon no change, `null` the registered icon, no event | the same | the same (`NddIcon \| null`) |
| the panel handle's `setIcon` → `setPanelIcon(id, icon ?? null)` in the workspace | `usePanel().setIcon` | `injectPanel().setIcon`, untracked like `setTitle`; no standalone warning in a workspace panel |
| `PanelInfo.icon`, runtime only | the same | the same |
| shown as runtime ?? registered ?? default in the tab, floating title bar, taskbar and `TabContentProps.icon` | the same, `#tab-content` | the same, `nddTabContent` (completes the 1.9.0 row below) |
| never written by `saveLayout`; kept by `loadLayout` for a panel still open with the same component | the same; a hand-made `icon` is dropped | the same, dropped on load and in `initialState` |
| — | `test/components/panelIcon.test.ts` (10) | `test/components/panel-icon.spec.ts` (10) |

### rdd 7.10.0 Release C, traced

| rdd 7.10.0 | vdd 1.11.0 | ndd 1.9.0 |
|---|---|---|
| `renderTabContent` prop, `TabContentProps` | the `#tab-content` slot | `<ng-template nddTabContent let-tab>` (`NddTabContentTemplate`, typed by `ngTemplateContextGuard`), handed to every group through DI as the empty-workspace template is |
| `icon`: runtime, else the registration's, else the default | the registration's or `undefined` | the registration's or `undefined`, as ndd's grid tabs show |
| `definePanels`, a `createWorkspace` overload, `TypedWorkspace`, `PanelMap`, `PanelPropsOf` | same names | same, except `PanelInputsOf` for ndd's `inputs` option: signal inputs (`input()`, `model()`, write type after a transform), a `loadComponent`'s too; untyped for a component with no signal inputs |
| type tests: a compiled fixture | in the test file, checked by `vue-tsc` | in the spec, compiled by the test build |

### rdd 7.9.0 Release B, traced

| rdd 7.9.0 | vdd 1.10.0 | ndd 1.8.0 |
|---|---|---|
| `defaultOptions.canFloat` / `canDock` | same | same |
| `createWorkspace({ canDrop })`, `PanelDrop` / `PanelDropTarget` | same, `core/dockRules.ts` | same, `core/dock-rules.ts`, used by `DragDock`, the zones and the menus |
| forbidden targets not offered, asked again at release | same | same; a corner float is mirrored under RTL before `canDrop` sees it |
| `startPointerDrag` ends on blur and lost capture, `onCancel` | lost capture added (blur since 1.5.1) | all three added: ndd's ended only on pointerup and pointercancel |
| `dockZones.browser.ts` | M6 browser gate | already covered by the M6 browser gate, LTR and RTL |

### rdd 7.8.0 Release A, traced

| rdd 7.8.0 | vdd 1.9.0 | ndd 1.7.0 |
|---|---|---|
| `<RddDesktop emptyWorkspace={…}>` | slot `#empty-workspace` | `<ng-template nddEmptyWorkspace>` (`NddEmptyWorkspaceTemplate`), shown by the root group only |
| `data-rdd-selected` / `-focused` / `-dirty` on tabs, `-focused` / `-maximized` on windows | `data-vdd-*` | `data-ndd-*`, same names and meaning |
| `openPanel(…, { dockTo: { panel, position, size } })` | same | same; the not-docked warning is development-only (`ngDevMode`) |
| `defaultOptions.className` / `tabClassName` | same | same, on `.ndd-panel-content` (applied on every creation) and the tab |
| `defaultOptions.keepAlive: false` | same; vdd ADR 0021 | same; [ADR 0018](decisions/0018-opt-in-unmount-while-hidden.md), amending 0002 |
| layered stylesheet | moved to a later phase | moved to a later phase (265 `!important` in ndd's stylesheet) |

Also ndd-only, in the manual: Angular Material's CDK overlay container sits at z-index 1000, below
the floating windows, so its popups opened from a floating window appear behind it; Chapter 10 gives
the one-rule fix.

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
| N3 | The context menu supports Escape only | The WAI-ARIA menu pattern: focus moves in (onto the menu itself with nothing highlighted since 1.5.0; onto the first item with `initialFocus: 'first-item'` or a keyboard opening), arrows/Home/End rove enabled items, ArrowRight/Left (mirrored in RTL) enter/leave submenus, Escape returns focus, checkbox items are `menuitemcheckbox` | context-menu spec (keyboard block); M8 browser gate |
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

### 4.4 Widgets out of the panel (1.11.0)

Where ndd 1.11.0 differs from rdd 7.11.0 and vdd 1.13.0. None changes what an app can do.

| rdd 7.11.0 | vdd 1.13.0 | ndd 1.11.0 |
|---|---|---|
| a widget's content is a `ReactNode` (`content`) | `component` + `props` | `component` + `inputs`, created imperatively with the overlay's injector and a per-widget child injector carrying `injectWidget()`'s handle. `injectPanel()` inside it is still the owner. It can no longer inject the frame (`NddFloatingWidget`): under `*ngComponentOutlet` (before 1.11.0) it was created with the frame's injector |
| — | — | `open()` creates the component synchronously; before 1.11.0 `*ngComponentOutlet` created it on the next render |
| `useWidget()` re-renders on a change of `location` | `ComputedRef`s | `Signal`s; `onWillMove` / `onMoved` return the unsubscribe and are also unsubscribed through the injecting context's `DestroyRef` |
| `location` read in `onWillMove` is where the widget was | for a user's move, already the new location | the same as vdd: during a user's move the synchronous `onStateChange` listener runs after the state write, so `location()` already shows the new location; during the app's own `move()` it is still the old one |
| `useFloatingWidgets().location()` is a lookup | a lookup | reactive: it reads signals, so it can drive a `computed()` or a template |
| a re-open that adds a `titleMenu` to a floating widget's panel shows its ⋮ menu on the next re-render | at once | at once: the items are read from signals |
| a widget's tab icon opens its menu; rdd's tabs always have an icon | vdd's tabs have no fallback icon, so a widget's tab with none shows the menu glyph | the same as vdd, on the tab, and on the floating title bar with a `titleMenu`. The icon spans are `aria-hidden` pointer affordances, as the tab's × is (N4); the keyboard's way is the window's ⋮ button and the tab's menu key |
| — | — | the managed size is seeded once from `width` / `height`; before 1.11.0 a re-open with new values resized a widget the user had not resized |
| one hidden store for parked elements | each cache parks in its own hidden store | the same as vdd (`PanelDomCache`, `WidgetContentCache`, one `.ndd-widget-store` per overlay). Angular removes a destroyed view's DOM before any destroy hook runs (ADR 0002), so `preserveEmbeds` can't park in a slot's destroy hook as rdd's layout cleanup and vdd's `onBeforeUnmount` do: `PanelHost` watches the workspace's state writes and parks the marked elements after the action's writes and before change detection, and puts them back after the render. Known hole: an app that calls `ApplicationRef.tick()` synchronously in the same task renders before the park, and the iframe reloads |
| — | — | an ordinary (unmarked) panel's element is still detached when a drag between groups destroys its slot: unchanged (ADR 0002 finding 1): briefly detached, its scroll and focus carried by the live record. `preserveEmbeds` avoids it for marked elements |
| — | — | `closePanel` on a panel whose `canClose` refuses publishes nothing, as before; a hosted panel can always close |
| an overlay outside a `DockableDesktopProvider`: `move()` refuses with `no-workspace` | a modal, a side panel or outside any panel | a modal, a side panel, or outside any `<ndd-desktop>` |

### 4.5 Pop-out windows (1.12.0)

Where ndd 1.12.0 differs from rdd 7.12.1 and vdd 1.14.0. None changes what an app can do; the
reasons are in [ADR 0019](decisions/0019-popout-windows.md).

| rdd 7.12.1 | vdd 1.14.0 | ndd 1.12.0 |
|---|---|---|
| — (no zone.js) | — | each child window gets zone.js's own `EventTarget` patch at open and at attach (idempotent; nothing without zone.js), and `whenPlaced`'s child frames are wrapped in the current zone, so a listener on a pop-out's window or document runs in the Angular zone; the closed poll runs in `Zone.root` and the style copy outside the Angular zone |
| the windows registry belongs to the workspace client | it belongs to `<VddDesktop>` | it belongs to `<ndd-desktop>` (internal token `POP_OUT_WINDOWS`), bound after its first render; so `popOutPanel` with no desktop returns `'no-window'` right after `'disabled'`, and a widget's `popOut()` without one returns `'no-window'` |
| `<DockableDesktopProvider popoutUrl popoutWrapper>` | `<VddDesktop>` props | inputs on `ndd-desktop`, beside `skin` and `taskbar` |
| the frame is a React portal into the child's body | a `<Teleport>` | `[nddPortal]` into the child's body, holding `[nddPanelSlot]`, so the host element of [0002](decisions/0002-zero-unmount-via-host-element.md) moves in; the frame's `class` is static, so Angular never overwrites `ndd-no-animations` |
| `popoutWrapper` gets `{ window, document, children }`; its context providers reach the panel | a component with props and a default slot | a component type with the inputs `window` and `document` and an `<ng-content />`; its context is its `providers` (the panel's element injector's parent is the wrapper's); its host is `.ndd-popout-wrapper` (`display: contents`) |
| a new wrapper type re-renders (and remounts) the content | the same | read when each panel is created: give it from the start |
| the wrapper is committed before the panel's element moves | the same flush | the wrapper's inputs follow from an effect that runs with the desktop's view, before the wrapper's and the panel's views are checked (XPW2 checks the render through both effects) |
| `<RddContextMenu>` and the toasts sit inside the provider | found by document | found by document, as vdd; a custom `nddContextMenuTemplate` renders in the page and is not wrapped |
| a widget's content is inside the wrapper | the same | by injection only: the content element is the component's own host and moves, so the widget wrapper's host is placed nowhere; in a window the content's DOM is inside the hosted panel's wrapper |
| `usePanelWindow()` re-renders its component | live getters | `injectPanelWindow()`, a `Signal<PanelWindow>` |
| `usePanel().isPoppedOut`, `useWidget().isPoppedOut` are booleans | `ComputedRef`s | `Signal<boolean>`s |
| React creates a popped-out panel's new nodes in the pop-out's document | Vue uses the main `document` | Angular's renderer uses the main `DOCUMENT`; the pop-out adopts them on insertion |
| one Escape stack, scoped per document; one document listener for click-to-activate | claims per document; element handlers in the page | as vdd: Escape listeners go through the document registry and act on their own document; in the page the elements' own handlers activate, the registry's `pointerdown` and `focusin` only in a pop-out |
| `setActivePanel` | `activatePanel`, `focusPanel`'s old body | `activatePanel(id)` is `focusPanel` with a private flag that skips the window focus: ndd's M3 rule allows `activePanelId` writes only in `focusPanel`, `resolveActive` and `loadLayout`, so the body stays in `focusPanel` |
| `openPanel` on an open popped-out panel | activates | activates without focusing its window (rdd's core), as vdd |
| a widget's `onMoved` into the window on the next frames | the same | once its panel's `panel:popped-out` fires: ndd renders the window's content on a later tick, and the page's frames would report the page's size |
| a widget's return sets its last container key to `'floating'` | marks the entry `returning` | the same as vdd |
| a widget frame's title icon always has an icon | the same | a menu glyph when the widget has none, as ndd's in-panel widget button already does |
| a toolbar flyout or search dropdown in a closing pop-out | left open | closed when its document leaves the registry, as the context menu is |
| the built-in menu items have an icon | none | none: ndd's built-in menu items have none |
| the taskbar's entries are `<button>`s | the same for a popped-out panel's | the same as vdd; its rule adds `padding: 0; font: inherit; position: relative` |
| `<html>`'s document mirror for the child | not run for the child | not run for the child: the `<html>` mirror copies what it writes (`lang` and `dir` too), rdd's observable result |
| the workspace element from `getWorkspaceElement()` | the same | an input of the frame, from the desktop's host |
| `popOut` is not in the config's declared type | declared | declared on `WorkspaceConfig` (its line can't be rewritten); the value never has it |
| a lone panel popped out of the root group leaves a new `group-default` | the group keeps its id | the same as vdd; the JSON format is unchanged |
| the windows follow the store through `subscribeToState` | `onPopOutEnded(id)` | the same as vdd; with no registry bound, `returnPanel` clears the flag itself |
| the development warnings | outside production builds | in development (`ngDevMode`), as every ndd diagnostic |
| the Playwright `hasFocus` recipe | stubs the pop-out | the same: `focusedDocument` asks the pop-outs first |
| `ViewEncapsulation` | — | Emulated and None styles are head tags and are copied; `ShadowDom` is not covered (untested) |
| — | — | file names are kebab-case (`dom-context.ts`, `pop-out-windows.ts`, …), ndd's convention |
| — | — | `panel-host`'s park/reclaim fallback frame stays the main window's: it waits for the workspace's own render |

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
