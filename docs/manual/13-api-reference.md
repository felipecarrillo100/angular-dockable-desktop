# 13. API reference

Every public export of `angular-dockable-desktop`, with the chapter that explains it. The
package has **56 runtime exports** and **91 exported types**. `api-surface.json` at the
repository root is the machine-readable list, and a standing gate fails if it and
`public-api.ts` disagree; this chapter was checked against it.

This chapter is a map, not a substitute for the chapters: it says what each export *is* and
where to read about it. Full signatures live in the `.d.ts` files, which your editor already
has. Component inputs, models and outputs below are read from the component source; "model"
means an Angular `model()`, bindable one-way as `[x]` or two-way as `[(x)]`, with an `(xChange)`
output.

Every component and directive is standalone: import the class into your component's `imports`.

## Workspace and providers

| Export | |
|---|---|
| `createWorkspace(config?)` | Creates a `Workspace` outside dependency injection — at module scope, in a test, before `bootstrapApplication`. Live immediately: `openPanel()` works with nothing rendered. [Ch. 1](01-getting-started.md), [ch. 2](02-concepts.md) |
| `provideDockableDesktop(configOrWorkspace?)` | Providers for a workspace. Given a `WorkspaceConfig`, creates one for that injector and disposes it with the injector; given a `Workspace`, provides it as-is. Plain providers, so it also works in a component's `providers`. [Ch. 1](01-getting-started.md) |
| `Workspace` | The workspace class, and its own DI token (`inject(Workspace)`). Signal state (`state()`, `gridRoot()`, `floating()`, `minimized()`, `panels()`, `activePanelId()`, `draggedPanelId()`, `dir()`, `isRtl()`, `contextMenu()`, `activeContribution()`), every action (`openPanel`, `closePanel`, `requestClosePanel`, `focusPanel`, `floatPanel`, `dockPanel`, `dockPanelToGroup`, `dockPanelToWorkspaceEdge`, `movePanelOrder`, `minimizePanel`, `restorePanel`, `maximizePanel`, `closeLeafGroup`, `setDirection`, `saveLayout`, `loadLayout`, `showContextMenu`, `closeContextMenu`, …), the event bus (`subscribe`, `publish`), and the `registry`, `toolbar`, `contributions` and `overlays` stores. [Ch. 2](02-concepts.md) |
| `injectWorkspace()` | `inject(Workspace)` with a directed error, instead of `NullInjectorError`, when no workspace is provided. [Ch. 2](02-concepts.md) |
| `VERSION` | The package version, as a string. |

| Type | |
|---|---|
| `WorkspaceConfig` | `panels`, `initialState`, `dir`, `formatMessage`, `messages`, `defaultSplitRatio`, `defaultEdgeSplitRatio` (clamped 0.1–0.9), `zIndexBase` (default 1000), `classes`. [Ch. 1](01-getting-started.md) |
| `WorkspaceState` | The live state: `gridRoot`, `floating`, `minimized`, `panels`, `activePanelId`, `draggedPanelId`, `dir`, `isRtl`, `splitRatio`, `edgeSplitRatio`. Frozen in development. [Ch. 2](02-concepts.md) |
| `PanelDefinition` | One catalogue entry: `{ component }` or `{ loadComponent }`, with optional `defaultOptions`. [Ch. 3](03-panels.md) |
| `OpenPanelOptions` | `openPanel()` options: `title`, `initialTarget`, `anchor`, `focus`, `inputs`, `dedupeKey`. `inputs` is saved in the layout under `props`. [Ch. 3](03-panels.md) |
| `HostClasses` | Your own classes for library chrome: `window`, `windowBody`, `modal`, `modalBody`, `sidePanel`, `sidePanelBody`. [Ch. 10](10-theming.md) |
| `BuiltInEvents` | Events the library publishes: `panel:opened`, `panel:closed`, `panel:minimized`, `panel:restored`, `panel:activated`, `layout:changed`, `layout:panels-excluded`. Merged with your own event map. [Ch. 2](02-concepts.md), [ch. 5](05-persistence.md) |

## Panels

| Export | |
|---|---|
| `injectPanel()` | The panel's view of itself, as a `PanelRef`. Outside a container it reports a `'standalone'` panel and its actions warn in development instead of throwing. [Ch. 3](03-panels.md) |
| `PanelRegistry` | The panel catalogue class (`register`, `registerLazy`, `get`, `has`, `keys`, `resolve`). Every workspace has one as `ws.registry`; constructing your own is rarely needed. [Ch. 3](03-panels.md) |
| `isSerializable(value)` | Whether a value round-trips through JSON — the check `saveLayout()` applies to each panel's `props`. [Ch. 5](05-persistence.md) |

| Type | |
|---|---|
| `PanelRef` | What `injectPanel()` returns: `id`; signals `title`, `isActive`, `isMinimized`, `isFloating`, `containerType`, `size`, `dirty`; `setTitle`, `setIcon`, `setDirty`, `close`, `minimize`, `onBeforeClose`, `onSaveState`, `trackDirty`. [Ch. 3](03-panels.md) |
| `PanelRegistryEntry` | A registered panel kind: `component` or `loadComponent`, plus `defaultOptions`. [Ch. 3](03-panels.md) |
| `PanelDefaultOptions` | Per-kind defaults: `title`, `icon`, `initialTarget`, `favoritePosition`, `defaultAnchor`, `canClose`, `canMinimize`, `canDrag`, `disableLivePreview`, `preserveScroll`. [Ch. 3](03-panels.md) |
| `PanelLoader` | A lazy panel loader, `() => Promise<Type \| { default: Type }>` — the router's `loadComponent` shape. [Ch. 3](03-panels.md) |
| `PanelInfo` | Everything the workspace knows about one open panel: `id`, `title`, `component`, `state`, `props`, `serializable`, `dirty`, restore targets, `dedupeKey`. [Ch. 2](02-concepts.md) |
| `PanelState` | `'docked' \| 'floating' \| 'minimized'`. |
| `ContainerType` | Where a panel is rendered: `'dockable-panel'`, `'floating-window'`, `'modal'`, `'left-panel'`, `'right-panel'`, `'standalone'`. [Ch. 3](03-panels.md) |
| `DirtyStateOptions` | Customises the unsaved-changes dialog: `title`, `message`, `alert`, `alertType`. [Ch. 3](03-panels.md) |
| `AlertType` | `'info' \| 'warning' \| 'success' \| 'danger'` — the banner severity in that dialog and in `<ndd-confirm>`. |

## Layout and persistence types

| Type | |
|---|---|
| `SerializedLayout` | The on-disk shape of a saved workspace, shared byte for byte with rdd and vdd (`version: 2`). [Ch. 5](05-persistence.md) |
| `LayoutNode` | A node of the layout tree: `LayoutGridNode \| LayoutLeafNode`. [Ch. 4](04-layout.md) |
| `LayoutGridNode` | A split: `type: 'branch'`, `orientation`, `children`, `sizes` (summing to 1). [Ch. 4](04-layout.md) |
| `LayoutLeafNode` | A tab group: `type: 'leaf'`, `id`, `panels`, `activePanelId`, `canClose`, `keepOnEmpty`. [Ch. 4](04-layout.md) |
| `SplitOrientation` | `'horizontal' \| 'vertical'`. |
| `SplitDirection` | `'left' \| 'right' \| 'top' \| 'bottom'` — an edge, for splits and `dockPanelToWorkspaceEdge`. [Ch. 4](04-layout.md) |
| `DropPosition` | A `SplitDirection` or `'center'` (join as a tab). [Ch. 4](04-layout.md) |
| `DropTarget` | `{ leafId, position }`. [Ch. 4](04-layout.md) |
| `FloatingWindow` | A floating panel's box: `id`, `x`, `y`, `width`, `height`, `z`, `maximized`, `anchor`. [Ch. 4](04-layout.md) |
| `FloatAnchor` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` — a corner, for floating windows and inner widgets. [Ch. 4](04-layout.md), [ch. 7](07-panel-overlay.md) |

## Desktop

### `NddDesktop` — `<ndd-desktop>`

The workspace itself: grid, floating windows, taskbar, drag-and-dock. Mount one per workspace.
[Ch. 1](01-getting-started.md), [ch. 4](04-layout.md)

| Member | Kind | |
|---|---|---|
| `skin` | input, default `'vscode'` | A built-in skin (`vscode`, `macos`, `chrome`, `slate`, `nord`, `obsidian`, `tokyo`) or your own; mirrored as `data-ndd-skin`. [Ch. 10](10-theming.md) |
| `animations` | input, default `true` | The library's own transitions. [Ch. 10](10-theming.md) |
| `taskbar` | input, `TaskbarVisibility`, default `'always'` | When the minimised-panel taskbar shows. |
| `defaultPanelIcon` | input, `NddIcon` | Fallback icon for panels that register none. |
| `taskbarContextMenu` | output, `{ panelId, event }` | A right-click or long press on a taskbar icon, emitted after the library has opened its own menu. |

| Type | |
|---|---|
| `TaskbarVisibility` | `'always'` (a permanent strip), `'compact'` (only while something is minimised), `'autohide'` (an overlay collapsed to a peek strip). |

## Sidebar and toolbar

### `NddSidebar` — `<ndd-sidebar>` and `NddSecondarySidebar` — `<ndd-secondary-sidebar>`

An activity rail and a resizable drawer, wrapping the rest of the shell (normally
`<ndd-desktop>`) as content. The secondary must sit inside a primary's content and takes the
other edge. Both share one base class and template. [Ch. 6](06-sidebar-toolbar.md)

| Member | Kind | |
|---|---|---|
| `position` | input, `SidebarPosition`, default `'right'` | `<ndd-sidebar>` only: which edge. |
| `tabs` | input, required, `SidebarTab[]` | The rail's tabs. |
| `headerAction` | input, `SidebarRailEntry \| SidebarRailEntry[]` | Entries above the tabs. |
| `footerAction` | input, `SidebarRailEntry \| SidebarRailEntry[]` | Entries pinned below the tabs. |
| `minWidth` / `maxWidth` | input, default `150` / `600` | Drawer resize bounds in pixels. |
| `showCloseButton` | input, default `false` | An × in the drawer header. |
| `hideDefaultHeader` | input, default `false` | Suppress the library's drawer header for every tab. |
| `activeTabId` | model, `string \| null`, default `null` | The open tab; `null` when the drawer is closed. |
| `visible` | model, default `true` | The whole sidebar, strip and drawer. |
| `stripVisible` | model, default `true` | The activity strip only. |
| `width` | model, default `280` | Drawer width in pixels. |

| Export | |
|---|---|
| `NddSidebarTabTemplate` | `<ng-template nddSidebarTab="id" let-tab let-close="close">` — content for one tab. Wins over the tab's `component`. [Ch. 6](06-sidebar-toolbar.md) |
| `NddSidebarHeaderTemplate` | `<ng-template nddSidebarHeader let-tab let-close="close">` — replaces the drawer header for whichever tab is open. [Ch. 6](06-sidebar-toolbar.md) |
| `injectSidebar()` | Control the nearest sidebar from anywhere inside it, including a panel: `openTab`, `closeDrawer`, `activeTabId`. Throws outside an `<ndd-sidebar>`. [Ch. 6](06-sidebar-toolbar.md) |
| `injectSidebarTab()` | Control scoped to the tab you are inside: `open`, `close`, `openTab`. [Ch. 6](06-sidebar-toolbar.md) |

### `NddToolbar` — `<ndd-toolbar>`

A strip of workspace tool buttons on any edge. [Ch. 6](06-sidebar-toolbar.md)

| Member | Kind | |
|---|---|---|
| `position` | input, `ToolbarPosition`, default `'left'` | The edge; also decides orientation. |
| `items` | input, required, `ToolbarItem[]` | Actions, radios, toggles, groups and separators. |
| `visible` | model, default `true` | Collapse the strip to nothing; items are kept. |

| Export | |
|---|---|
| `injectToolbar()` | The workspace's `ToolbarState`: radio-group and toggle state for items that do not supply their own. [Ch. 6](06-sidebar-toolbar.md) |

| Type | |
|---|---|
| `SidebarPosition` | `'left' \| 'right'`. |
| `NddSidebarTemplateContext` | The context of a tab or header template: `$implicit` / `tab`, `close`, `open`. |
| `SidebarTab` | A rail tab: `id`, `label`, `icon`, `hidden`, `eagerMount`, `preserveState`, `component`, `inputs`. |
| `SidebarActionButton` | A rail button with an `onClick` that does not toggle the drawer — a hamburger, say. |
| `SidebarCustomEntry` | A rail entry rendered entirely by your own `component` (`custom: true`). |
| `SidebarRailEntry` | `SidebarTab \| SidebarActionButton \| SidebarCustomEntry`. |
| `SidebarContext` | What `injectSidebar()` returns. |
| `SidebarTabContext` | What `injectSidebarTab()` returns. |
| `ToolbarItem` | The union of toolbar item shapes below. |
| `ToolbarActionItem` | `type: 'action'` — a button with an `onClick`. |
| `ToolbarRadioItem` | `type: 'radio'` — mutually exclusive within its `group`. |
| `ToolbarToggleItem` | `type: 'toggle'` — on/off; supplying `active` makes the caller the owner. |
| `ToolbarGroupItem` | `type: 'group'` — a button with a flyout of sub-items, acting as one radio group. |
| `ToolbarGroupSubItem` | One tool in a group's flyout. |
| `ToolbarGroupEntry` | A `ToolbarGroupSubItem` or a flyout separator. |
| `ToolbarSeparator` | `type: 'separator'`. |
| `ToolbarState` | `activeInGroup`, `setActiveInGroup`, `isToggled`, `setToggled`, `toggle` — reactive. |
| `ToolbarPosition` | `'top' \| 'bottom' \| 'left' \| 'right'` — shared by `<ndd-toolbar>` and `<ndd-panel-toolbar>`. |

## Overlays and toasts

### `NddModals` — `<ndd-modals>`

Renders the modal stack and supplies the library's unsaved-changes question. No inputs. Mount
one: without it, closing a dirty panel refuses rather than discarding. [Ch. 8](08-overlays.md)

### `NddSidePanels` — `<ndd-side-panels>`

Renders the two side drawers. [Ch. 8](08-overlays.md)

| Member | Kind | |
|---|---|---|
| `defaultWidth` | input, `number \| string`, default `400` | Used when a drawer is opened without a width. |
| `sides` | input, `'both' \| 'left' \| 'right'`, default `'both'` | Which edges this instance renders. |

### `NddConfirm` — `<ndd-confirm>`

A confirm/cancel dialog body, usable as modal content. [Ch. 8](08-overlays.md)

| Member | Kind | |
|---|---|---|
| `message` | input, required, `Label` | The question. |
| `alert` | input, `string` | An extra banner above the message. |
| `alertType` | input, `AlertType`, default `'info'` | The banner's severity. |
| `yesNo` | input, default `false` | Label the buttons Yes/No instead of OK/Cancel. |
| `onOk` / `onCancel` | input, `() => void` | Callbacks for each answer. |
| `onSettled` | input, `(ok: boolean) => void` | Called exactly once, whichever way the dialog closes. |

### `NddToasts` — `<ndd-toasts>`

The notification host. Mount once, anywhere. [Ch. 8](08-overlays.md)

| Member | Kind | |
|---|---|---|
| `position` | input, `ToastPosition`, default `'top-right'` | Corner of the viewport. |
| `maxVisible` | input, default `3` | How many show at once; the rest wait. |
| `defaultDuration` | input, default `5000` | Auto-dismiss delay in ms; `0` makes toasts sticky. |
| `defaultClosable` | input, default `true` | Show a close button. |
| `pauseOnHover` | input, default `true` | Hold the timer under the pointer. |
| `animation` | input, `'slide' \| 'fade' \| 'none'`, default `'slide'` | Entry and exit. |
| `newestOnTop` | input, default `false` | Stack order. |
| `progressBar` | input, default `false` | A countdown bar on each toast. |
| `width` | input, default `320` | Card width in pixels. |
| `adapter` | input, `ToastAdapter` | Hand every `toast.*` call to another notification library. |

| Export | |
|---|---|
| `injectModals()` | The modal stack: `stack`, `topmost`, `open(component, inputs?, options?)` → `NddModalRef`, `close`, `closeAll`. [Ch. 8](08-overlays.md) |
| `injectSidePanels()` | The drawers: `left`, `right`, `openLeft`, `openRight` (async, `null` when the occupant's guard refuses), `close`, `closeAll`. [Ch. 8](08-overlays.md) |
| `injectModalRef()` | Inside a modal's content, the `NddModalRef` of the modal you are in. Throws elsewhere. [Ch. 8](08-overlays.md) |
| `toast(message, options?)` | Show a notification from anywhere. Also `.info`, `.success`, `.warning`, `.error`, `.dismiss`, `.promise`. Returns the toast id. [Ch. 8](08-overlays.md) |
| `NddToaster` | `toast` as a root-provided service — `inject(NddToaster).success('Saved')` — plus `items`, the live queue. [Ch. 8](08-overlays.md) |
| `resetToasts()` | Empty the queue with no animation, and drop any adapter. For tests and teardown. |

| Type | |
|---|---|
| `NddModalRef` | `id`, `close(result?)`, `requestClose()`, `afterClosed()` — shaped like `MatDialogRef`. |
| `NddModalsApi` | What `injectModals()` returns. |
| `NddSidePanelsApi` | What `injectSidePanels()` returns. |
| `Overlays` | The store behind both, as `ws.overlays`: usable without a component (from a service). |
| `OverlayInstance` | One open drawer or modal: `id`, `component`, `inputs`, `kind`, `options`, `dirty`. |
| `OverlayKind` | `'left-panel' \| 'right-panel' \| 'modal'`. |
| `OverlayState` | `leftPanel`, `rightPanel`, `modals` (bottom to top). |
| `SidePanelOptions` | `title`, `icon`, `width`, `bodyPadding`. |
| `ModalOptions` | `title`, `icon`, `size`, `closable`, `bodyPadding`. |
| `ConfirmDiscard` | The unsaved-changes question, as a function resolving `true` to discard. |
| `ToastFunction` | The type of `toast`. |
| `ToastOptions` | Per-toast `type`, `duration`, `id` (dedupe/update in place), `closable`, `icon`, `content`, `contentInputs`, `onClose`. |
| `ResolvedToastOptions` | Options with every default filled in — what an adapter receives. |
| `ToastType` | `'info' \| 'success' \| 'warning' \| 'error'`. |
| `ToastPosition` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'`. |
| `ToastAdapter` | `show`, `update`, `dismiss`, and a `component` to render (or `null`). |
| `ToastRecord` | One toast in the queue. |
| `ToastPromiseMessages` | `pending`, `success`, `error` for `toast.promise()`. |

## Context menu

### `NddContextMenu` — `<ndd-context-menu>`

Renders whatever menu is pending (tab, title-bar and taskbar menus, and your own). Mount one.
Keyboard support follows the WAI-ARIA menu pattern. [Ch. 8](08-overlays.md)

| Member | Kind | |
|---|---|---|
| `theme` | input, default `'dark'` | A theme hook, mirrored onto the menu's class. |

| Export | |
|---|---|
| `NddContextMenuTemplate` | `<ng-template nddContextMenuTemplate let-items let-close="close">` inside `<ndd-context-menu>` — replaces the built-in menu rendering. [Ch. 8](08-overlays.md) |
| `NddContextMenuTrigger` | `[nddContextMenu]="items"` — open these items (an array, or a getter read on opening) on right-click over the host element. [Ch. 8](08-overlays.md) |
| `injectContextMenu()` | A function that opens a menu from `ShowContextMenuOptions`. [Ch. 8](08-overlays.md) |
| `injectPanelContextMenu(getter)` | Contribute items to *this panel's* own tab and title-bar menu; the getter is read each time the menu opens. [Ch. 3](03-panels.md) |

| Type | |
|---|---|
| `NddContextMenuContext` | The custom template's context: `$implicit` / `items`, `x`, `y`, `close`. |
| `ContextMenuItem` | `ContextMenuSimpleItem \| ContextMenuSeparator \| ContextMenuSubMenu`. |
| `ContextMenuSimpleItem` | `label`, `icon`, `title`, `checkbox`, `action`, `disabled`, `cyAction`. |
| `ContextMenuSeparator` | `{ separator: true }`. |
| `ContextMenuSubMenu` | `label`, `title`, `items` — one level deep. |
| `ContextMenuCheckbox` | The checkbox column on a simple item: `value`, `active`, `enabled`. |
| `ShowContextMenuOptions` | `items`, and a position from `event` or `x`/`y`. |

## Panel overlay

Toolbars and floating widgets *inside* one panel. [Ch. 7](07-panel-overlay.md)

### `NddPanelOverlay` — `<ndd-panel-overlay>`

The root for one panel's own toolbars and widgets; also renders the widgets opened through
`injectFloatingWidgets()`. No inputs.

### `NddPanelToolbar` — `<ndd-panel-toolbar>`

| Member | Kind | |
|---|---|---|
| `position` | input, required, `ToolbarPosition` | The panel edge. |
| `variant` | input, `ToolbarVariant`, default `'transparent'` | Strip background. |
| `buttonVariant` | input, `ButtonVariant`, default `'ghost'` | Inherited by the toolbar's buttons. |
| `buttonSize` | input, `number` | Icon button size in pixels; left to the stylesheet when unset. |

### `NddFloatingWidget` — `<ndd-floating-widget>`

| Member | Kind | |
|---|---|---|
| `widgetId` | input, required | Unique within the panel's overlay. |
| `title` | input, required, `Label` | Header text, resolved on every render. |
| `icon` | input, `NddIcon` | Header icon. |
| `width` / `height` | input, default `320` / `240` | Size in pixels, ignored on a stretched axis. |
| `stretchable` | input, default `true` | `false` disables resize-to-stretch snapping. |
| `open` | model, default `true` | Whether the widget is shown. |
| `placement` | model, `PanelFloatPlacement`, default `{ anchor: 'top-right', stretch: null }` | Corner and stretched axes. Bind `[(placement)]` to own and persist it. |

### Panel-toolbar contents

| Export | Selector | Inputs, models, outputs |
|---|---|---|
| `NddToolbarButton` | `<ndd-toolbar-button>` | inputs `title`, `disabled` (default `false`), `variant` (`ButtonVariant`). No `click` output: use the native `(click)`, which does not fire while disabled. |
| `NddToolbarToggle` | `<ndd-toolbar-toggle>` | inputs `title`, `disabled`, `variant`; model `active` (default `false`). |
| `NddToolbarSearch` | `<ndd-toolbar-search>` | inputs `search` (required, `(query, signal) => SearchResult[] \| Promise<SearchResult[]>`), `placeholder`, `debounce` (default `300` ms); output `resultSelect` (`SearchResult`). |
| `NddToolbarSeparator` | `<ndd-toolbar-separator>` | none — a divider. |
| `NddToolbarSpacer` | `<ndd-toolbar-spacer>` | none — pushes what follows to the far end. |
| `NddToolbarItem` | `<ndd-toolbar-item>` | none — wraps a control that is not a library button (a select, an input, a badge). |
| `NddToolbarCenter` | `<ndd-toolbar-center>` | none — centres its content, independent of what sits on either side. |

| Export | |
|---|---|
| `injectFloatingWidgets()` | Open and close widgets by id from data (one per selected feature, say): `openIds`, `open(id, ManagedWidget)`, `close`, `closeAll`, `isOpen`. Needs the overlay's injector. |

| Type | |
|---|---|
| `FloatingWidgetsApi` | What `injectFloatingWidgets()` returns. |
| `ManagedWidget` | A widget opened from data: `title`, `icon`, `component`, `inputs`, and first-open seeds `anchor`, `width`, `height`, `stretch`. |
| `PanelFloatPlacement` | `{ anchor: FloatAnchor, stretch: Stretch \| null }`. |
| `Stretch` | `'width' \| 'height' \| 'both'` — the axes a widget spans. |
| `ToolbarVariant` | `'transparent' \| 'frosted' \| 'solid'`. |
| `ButtonVariant` | `'ghost' \| 'soft' \| 'outlined' \| 'filled'`. |
| `ToolbarInsets` | Space claimed by panel toolbars: `top`, `bottom`, `inlineStart`, `inlineEnd`. |
| `SearchResult` | A dropdown row: `id`, `label`, `description`, `group`, `icon`. |

## Contributions

What the active panel publishes into the application's own toolbar and sidebar.
[Ch. 9](09-contributions.md)

| Export | |
|---|---|
| `injectPanelContribution(getter)` | Publish this panel's toolbar items and sidebar sections; re-published whenever what the getter reads changes, withdrawn when the component is destroyed. |
| `injectActiveContribution()` | A signal of what the active panel published, or `null`. |
| `injectMergedToolbarItems(() => items)` | Your static items plus the active panel's, as a signal. |
| `injectMergedSidebarTabs(() => tabs, icon?)` | Your static tabs plus the active panel's sections, as a signal. |
| `mergeToolbarItems(items, contribution)` | The merge, without injection. |
| `mergeSidebarTabs(tabs, contribution, icon?)` | The merge, without injection. |
| `sectionToTab(section, icon?)` | A contributed section as a `SidebarTab`. |

| Type | |
|---|---|
| `PanelContribution` | `{ toolbarItems?, sidebarSections? }`. |
| `PanelSidebarSection` | `id`, `label`, `icon`, `component`, `inputs`. |
| `Contributions` | The store, as `ws.contributions`: `publish`, `get`, `ids`. |

## i18n

[Ch. 11](11-i18n.md)

| Export | |
|---|---|
| `defaultMessages` | The built-in string table, as data. Override entries through `WorkspaceConfig.messages`. |
| `formatLabel(label, formatter?)` | Resolve a string-or-descriptor without a workspace. |

| Type | |
|---|---|
| `Label` | `string \| MessageDescriptor` — accepted wherever the library shows text. |
| `MessageDescriptor` | `{ id, defaultMessage?, values? }`. |
| `MessageFormatter` | `(descriptor) => string` — `WorkspaceConfig.formatMessage`, the whole i18n surface. |
| `MessageKey` | A key of `defaultMessages`. |

## Theming and icons

| Export | |
|---|---|
| `injectColorScheme()` | A read-only signal of the application's colour scheme, following `data-color-scheme` on `<html>`. [Ch. 10](10-theming.md) |

| Type | |
|---|---|
| `ColorScheme` | `'dark' \| 'light'`. |
| `NddIcon` | An icon: a component class, a `TemplateRef`, or a string of CSS classes. |

## Utilities

The drag, resize and clamping primitives the library uses for its own windows, exported so a
panel can build resizable UI with identical behaviour. [Ch. 7](07-panel-overlay.md)

| Export | |
|---|---|
| `startPointerDrag(config)` | A pointer-capture drag with automatic cleanup on release or cancel. |
| `computeResizedRect(dir, dx, dy, start, constraints)` | The new rect for an eight-direction resize-handle drag. Pure. |
| `clampFloatingRect(rect, view, anchored)` | Where a floating box must move to stay reachable in a shrinking view; returns the same object when nothing changed. |

| Type | |
|---|---|
| `PointerDragConfig` | `element`, `pointerId`, start coordinates, `captureStart`, `onMove`, `onEnd`, `activeClasses`. |
| `ResizeDir` | `'n' \| 'ne' \| 'e' \| 'se' \| 's' \| 'sw' \| 'w' \| 'nw'`. |
| `ResizeRect` | `{ x, y, w, h }`. |
| `ResizeConstraints` | `minW`, `minH`, and direction-scoped `maxW`, `maxH`, `minX`, `minY`. |
| `FloatingRect` | `{ x, y, width, height }`. |

## What is deliberately absent

Coming from rdd or vdd you may look for these. Each is gone because Angular makes it
unnecessary, not because the capability is missing; [chapter 12](12-migrating.md) maps every
one.

| Absent | Because |
|---|---|
| `WorkspaceClient` and its pending-call queue (rdd) | `createWorkspace()` is live before any component |
| rdd's `*Provider` components; vdd's `app.use(workspace)` and `WORKSPACE_KEY` | `provideDockableDesktop()`; `Workspace` is its own token |
| `SidebarHandle`, `ToolbarHandle`, `usePanelFloatingWindow` (rdd) | `model()` inputs, bound with `[( )]` |
| vdd's `use*()` composables | the `inject*()` functions above |
| `UsePanelReturn`, `SidebarProps` (vdd) | `PanelRef`; the component's own inputs |
| `version` (vdd) | `VERSION` |
| `renderContent`, `renderHeader`, `ContextMenuAdapter` (rdd); slots (vdd) | `nddSidebarTab`, `nddSidebarHeader`, `nddContextMenuTemplate`, or a `component` field |
