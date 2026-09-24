# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release states which vue-dockable-desktop and react-dockable-desktop releases it
corresponds to, as a **Parity** line. The three libraries version independently; the
feature-by-feature map is [docs/PARITY.md](docs/PARITY.md).

## [Unreleased]

## [1.0.0] — 2026-09-24

**Parity: vue-dockable-desktop 1.1.1, react-dockable-desktop 6.3.1.** The first release: a native
Angular 22 implementation of the family's window manager, with the same capabilities and the
same saved-layout format.

### Added

- **The workspace.** `provideDockableDesktop(config)` or `createWorkspace(config)` +
  `provideDockableDesktop(ws)`; `inject(Workspace)` / `injectWorkspace()`. State is signals
  (`state()`, `panels()`, `floating()`, `minimized()`, `activePanelId()`, `dir()`, `isRtl()`),
  deep-frozen in development. Every action of the family (`openPanel`, `floatPanel`,
  `dockPanelToGroup`, `dockPanelToWorkspaceEdge`, `minimizePanel`, `saveLayout`, …) with the same
  names and signatures. A workspace created at module scope works before bootstrap. Lazy panels
  through `loadComponent`, the router's shape. A typed event bus whose subscriptions made in an
  injection context are disposed with it.
- **`<ndd-desktop>`**: the split/tab/edge docking grid, floating windows with eight-direction
  resize, maximise and corner anchors, the taskbar (always, compact, auto-hide) with live
  previews, touch support (long-press drag), structural RTL, seven skins.
- **Zero unmount**: a panel component is created once, into a library-owned host element, and
  moved between the grid, a window, the taskbar preview and a hidden store — never re-created.
  Scroll offsets and focus are restored explicitly.
- **`injectPanel()` → `PanelRef`**: `title`, `isActive`, `isMinimized`, `isFloating`,
  `containerType`, `size` and `dirty` as signals; `setTitle`, `setIcon`, `setDirty`, `close`,
  `minimize`; `onBeforeClose` and `onSaveState`, disposed with the component; and
  **`trackDirty()`**, which follows a Signal Forms form (or any signal). Panel options are
  `input()`s, set through `setInput`.
- **Chrome**: `<ndd-sidebar>` and `<ndd-secondary-sidebar>` (one template), `<ndd-toolbar>`, with
  their state as `model()`s bound through `[( )]`; typed `nddSidebarTab` and `nddSidebarHeader`
  templates; `injectSidebar()`, `injectSidebarTab()`, `injectToolbar()`.
- **Overlays**: `<ndd-modals>` with `injectModals().open()` returning an `NddModalRef<R>`
  (`afterClosed()`, and `injectModalRef()` inside), `<ndd-side-panels>`, `<ndd-confirm>` and the
  built-in unsaved-changes question; `<ndd-toasts>` with a plain `toast` function callable from
  anywhere and the injectable `NddToaster`; `<ndd-context-menu>` with the standard tab, window
  and taskbar menus, `injectPanelContextMenu()`, `[nddContextMenu]`, and a typed custom template.
- **Inside a panel**: `<ndd-panel-overlay>`, `<ndd-panel-toolbar>` and its controls,
  `<ndd-toolbar-search>`, `<ndd-floating-widget>` (`[(open)]`, `[(placement)]`, corner docking and
  stretch placements) and `injectFloatingWidgets()` for widgets opened from data.
- **Contributions**: `injectPanelContribution()`, `injectActiveContribution()`,
  `injectMergedToolbarItems()` and `injectMergedSidebarTabs()` — a panel contributes to the
  application's toolbar and sidebar only while it is the active, visible one.
- **i18n**: one `formatMessage(descriptor)` function for every string; a formatter that reads a
  signal relabels the chrome live. `setDirection('rtl')` mirrors the workspace.
- **Theming**: 125 documented `--ndd-*` tokens, light and dark through the application's
  `data-color-scheme`, `injectColorScheme()`, and the `ndd-fill-viewport` utility.
- **Server-side rendering and hydration**, zoneless-first with zone.js supported.
- **Development diagnostics** — a missing stylesheet, a zero-height desktop, misuse outside a
  panel, layout repair — guarded inline by `ngDevMode`, so a production bundle carries none of
  them.
- **The demo** (`projects/demo`): 16 panel kinds with Monaco, Leaflet and a `unified` markdown
  pipeline without framework wrappers, six locales, eight skins, RTL.
- **The manual** (`docs/manual/`, 13 chapters), including migration from rdd and vdd and a token
  reference.

### Compatibility

- The saved layout is byte-compatible with react-dockable-desktop and vue-dockable-desktop:
  rdd 6.2.0's fixtures and both libraries' saves load and re-save identically in all directions.
- Every vdd test suite is ported (839 tests against vdd's 765), with vdd's test names.

### Differences from vue-dockable-desktop 1.1.1

All sixteen of vdd's fixes to rdd (D1–D16) are carried. ndd also fixes seventeen things vdd
does differently (N1–N17), most of them back-portable. Among them:

- a split divider dragged under RTL follows the pointer (N15);
- a `ToastAdapter` receives `show` as well as `update` and `dismiss` (N16);
- a custom context-menu template's own buttons work with a real pointer (N17);
- the tab close button is not a nested control; Delete closes a focused tab (N4);
- server rendering works (N12); `ndd-fill-viewport` works on the desktop itself (N11).

The full list, each pinned by a test or a gate, is [docs/PARITY.md §4](docs/PARITY.md).

### Dependencies

- Peer: `@angular/core` and `@angular/common` `^22.0.0`. **No runtime dependencies**, not even
  `tslib`, and no dependency on `@angular/cdk` or `@angular/aria`.

[Unreleased]: https://github.com/felipecarrillo100/angular-dockable-desktop/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/felipecarrillo100/angular-dockable-desktop/releases/tag/v1.0.0
