# 12. Coming from react-dockable-desktop or vue-dockable-desktop

angular-dockable-desktop (ndd) is the third member of a family. react-dockable-desktop (rdd,
6.3.1) came first; vue-dockable-desktop (vdd, 1.1.1) is a Vue-native rewrite of it with rdd's
known defects fixed; ndd is an Angular-native port of vdd. The feature set, the vocabulary and
the action names are the same across all three. The API is designed from each framework's side,
so call sites change.

**Your users' saved layouts do not.** The layout JSON is the family's shared format, byte for
byte ([chapter 5](05-persistence.md)). A string saved by rdd or vdd loads into ndd unchanged,
and ndd's `saveLayout()` output loads into both. The port was gated on this: the ten rdd 6.2.0
fixtures load and re-save identically, and 34 layouts (those fixtures plus both libraries'
saves from twelve real gesture sequences) re-save to the same string in vdd and ndd, each
library re-saving the other's output unchanged. A migration does not discard the workspaces
people arranged.

This chapter maps concepts in both directions from ndd. The authoritative, line-by-line map is
`docs/PARITY.md` §1; the reasons behind each divergence are in its §4.

## The shape of the change

| rdd | vdd | ndd |
|---|---|---|
| `new WorkspaceClient(config)` + `<DockableDesktopProvider client=…>` | `createWorkspace(config)` + `app.use(workspace)` | `createWorkspace(config)` + `provideDockableDesktop(workspace)`, or just `provideDockableDesktop(config)` |
| `<WindowManager />` | `<VddDesktop />` | `<ndd-desktop />` (`NddDesktop`) |
| `useWindowManagerState()` / `useWindowManagerActions()` | `useWorkspace()` | `inject(Workspace)` or `injectWorkspace()` |
| `useWindowManagerState(selector)` | `computed(() => …)` | `computed(() => …)` over `ws.state()` or a narrower signal (`ws.panels()`, `ws.activePanelId()`, …) |
| `useFormContainer()` / `usePanelId()` / `usePanelSize()` | `usePanel()` | `injectPanel()` → `PanelRef` |
| `onActivate` / `onDeactivate` / `onMinimize` / `onRestore` / `onResize` | `watch()` on `isActive` / `isMinimized` / `size` | `effect()` on `isActive()` / `isMinimized()` / `size()` |
| `SidebarHandle` / `ToolbarHandle` methods | `v-model:visible`, `v-model:active-tab-id`, `v-model:width` | `[(visible)]`, `[(activeTabId)]`, `[(width)]` on `model()` inputs |
| `renderContent` / `renderHeader` / `renderHeaderActions` | slots | typed `<ng-template>` directives, or a `component` field |
| `usePanelFloatingWindow()` + `open` / `onClose` | `v-model:open` | `[(open)]` |
| `[data-workspace-skin="…"]` in your skin CSS | `[data-vdd-skin="…"]` | `[data-ndd-skin="…"]` ([chapter 10](10-theming.md#defining-your-own)) |
| partly prefixed classes and tokens (rdd's migration left `--sidebar-*`, `--tab-*`, `--toolbar-*` unprefixed) | `vdd-`-prefixed classes and custom properties | `ndd-`-prefixed classes and custom properties — the names after the prefix match vdd's |

Every workspace action keeps its name and signature: `openPanel`, `closePanel`,
`requestClosePanel`, `focusPanel`, `floatPanel`, `dockPanel`, `dockPanelToGroup`,
`dockPanelToWorkspaceEdge`, `movePanelOrder`, `minimizePanel`, `restorePanel`, `maximizePanel`,
`setDirection`, `saveLayout`, `loadLayout`, `showContextMenu`, `closeContextMenu`, `subscribe`,
`publish`, the `overlays.*` methods and the `toolbar` / `contributions` stores. So does every
shared type name: `LayoutNode`, `PanelInfo`, `SerializedLayout`, `ToolbarItem`,
`ContextMenuItem`, `SidebarTab` and the rest ([chapter 13](13-api-reference.md)).

## Creation and access

| vdd | ndd | Note |
|---|---|---|
| `createWorkspace(config)` + `app.use(ws)` | `createWorkspace(config)` + `provideDockableDesktop(ws)` | A module-scope workspace is live before bootstrap, as in vdd; you own its lifetime. |
| — | `provideDockableDesktop(config)` | Creates the workspace for that injector and disposes it with it. Returns plain providers, so it also works in a component's `providers` — two independent workspaces on one page. |
| `useWorkspace()` | `inject(Workspace)` / `injectWorkspace()` | `Workspace` is its own DI token. `injectWorkspace()` throws a directed error instead of `NullInjectorError` when nothing is provided. |
| `WORKSPACE_KEY` | `Workspace` (the class) | No separate injection key. |
| `ws.state` (reactive object) | `ws.state()` (one immutable signal), and `gridRoot()`, `floating()`, `minimized()`, `panels()`, `activePanelId()`, `draggedPanelId()`, `dir()`, `isRtl()`, `contextMenu()`, `activeContribution()` | State is replaced on every change and deep-frozen in development, stopping at your panels' `props`. |
| `ws.subscribe(event, cb)` | the same | Called in an injection context, the subscription is disposed with the calling component. Outside one, keep and call the returned function. |
| `version` | `VERSION` | The package version, as a string. |

Actions read state untracked, so calling one from an `effect()` never makes that effect depend
on the whole store.

## Composables and hooks → `inject*()` functions

Every rdd hook and vdd composable is an `inject*()` function, called in an injection context (a
field initialiser or a constructor). Cleanup goes through `DestroyRef`, so nothing returns an
unsubscribe function. rdd's context providers (`DockableDesktopProvider`,
`WindowManagerProvider`, `PanelProvider`, `PanelContributionProvider`, `ToolbarProvider`,
`ContextMenuProvider`) have no counterpart: one `provideDockableDesktop()` replaces them all.

| rdd | vdd | ndd |
|---|---|---|
| `useWindowManagerState` / `useWindowManagerActions` | `useWorkspace()` | `injectWorkspace()` |
| `useFormContainer`, `usePanelId`, `usePanelSize` | `usePanel()` → `UsePanelReturn` | `injectPanel()` → `PanelRef` |
| — | `useModals()` | `injectModals()` → `NddModalsApi` |
| — | `useSidePanels()` | `injectSidePanels()` → `NddSidePanelsApi` |
| — | `useContextMenu()` | `injectContextMenu()` |
| — | `usePanelContextMenu(getter)` | `injectPanelContextMenu(getter)` |
| `SidebarHandle` | `useSidebar()`, `useSidebarTab()` | `injectSidebar()`, `injectSidebarTab()` |
| — | `useToolbar()` | `injectToolbar()` |
| `usePanelFloatingWindow` | `useFloatingWidgets()` | `injectFloatingWidgets()` |
| — | `usePanelContribution(getter)` | `injectPanelContribution(getter)` |
| — | `useActiveContribution()` | `injectActiveContribution()` |
| — | `useMergedToolbarItems(items)`, `useMergedSidebarTabs(tabs, icon?)` | `injectMergedToolbarItems(() => items)`, `injectMergedSidebarTabs(() => tabs, icon?)` |
| `useColorScheme()` | `useColorScheme()` → `ComputedRef` | `injectColorScheme()` → read-only `Signal<ColorScheme>` |
| — | — | `injectModalRef()` — inside a modal's content, the `NddModalRef` to close it with a result |

vdd composables that accepted a `MaybeRefOrGetter` take a getter function in ndd: pass
`() => this.items()` or `() => STATIC_ITEMS`. Each `inject*()` returns signals where vdd returned
refs or computeds: read them by calling them.

### The panel-side contract

| vdd `usePanel()` | ndd `injectPanel()` |
|---|---|
| `id` | `id` |
| `title`, `isActive`, `isMinimized`, `isFloating`, `containerType`, `size`, `dirty` (refs) | the same names, as signals. `size()` is `null` until the panel has been laid out. |
| `setDirty`, `setTitle`, `setIcon`, `close`, `minimize` | the same |
| `onBeforeClose(guard)`, `onSaveState(provider)` | the same, disposed through `DestroyRef` |
| — | `trackDirty(() => form().dirty(), options?)` — keeps the dirty flag in step with a Signal Forms form or any signal; `options` may be a getter |

Outside a container, `injectPanel()` reports a `'standalone'` panel and its actions warn in
development instead of throwing, so a panel component renders on its own in a test.

## `v-model` → `[( )]` with `model()`

Every vdd model is an Angular `model()`, bindable as `[( )]`. vdd's `@update:x` event is the
`(xChange)` output.

| Component | Models |
|---|---|
| `<ndd-sidebar>`, `<ndd-secondary-sidebar>` | `activeTabId`, `visible`, `stripVisible`, `width` |
| `<ndd-toolbar>` | `visible` |
| `<ndd-floating-widget>` | `open`, `placement` |
| `<ndd-toolbar-toggle>` | `active` |

A one-way binding behaves differently from vdd; see N10 below.

## Slots and render props → typed templates

| rdd | vdd slot | ndd |
|---|---|---|
| `SidebarTab.renderContent(id, onClose)` | `#tab-<id>="{ close }"` | `<ng-template nddSidebarTab="id" let-tab let-close="close">` |
| `renderHeader` | `#header` | `<ng-template nddSidebarHeader let-tab let-close="close">` |
| `ContextMenuAdapter` | the context menu's default slot | `<ng-template nddContextMenuTemplate let-items let-close="close">` inside `<ndd-context-menu>` |
| `ManagedWindowConfig.content` | a `component` field | a `component` field (with `inputs`) |

Each template's context is typed through `ngTemplateContextGuard` (`NddSidebarTemplateContext`,
`NddContextMenuContext`), so `let-` variables are checked by the compiler. A sidebar tab's
template wins over the tab's `component`; a header template suppresses the default header, and
with it `showCloseButton`.

## `props` → `inputs`, and what the layout keeps

`openPanel(id, component, { inputs })` is ndd's name for vdd's `{ props }`. The values are applied
to the panel component with `ComponentRef.setInput`, so a component receives only the inputs it
declares, and a declared `panelId` input is always the injected panel's id. Modals, drawers,
managed floating widgets and contributed sidebar sections take `inputs` the same way.

The **saved layout keeps the family's `props` key**, so layouts stay byte-compatible. On restore,
each panel's `props` are applied to its inputs. `PanelInfo.props` in `ws.state()` is the same
data.

```ts
import { Injectable } from '@angular/core';
import { injectWorkspace } from 'angular-dockable-desktop';

@Injectable({ providedIn: 'root' })
export class OpenFeature {
  private readonly ws = injectWorkspace();

  open(featureId: number): void {
    // vdd: ws.openPanel(`feature-${featureId}`, 'feature', { props: { featureId } })
    this.ws.openPanel(`feature-${featureId}`, 'feature', { inputs: { featureId }, dedupeKey: String(featureId) });
  }
}
```

## Worked examples

**Setup.** No provider nesting, and the workspace works before the application boots:

```tsx
// rdd
const client = new WorkspaceClient({ panels, initialState });
<DockableDesktopProvider client={client}><WindowManager /></DockableDesktopProvider>
```

```vue
<!-- vdd: createApp(App).use(createWorkspace({ panels, initialState })).mount('#app') -->
<VddDesktop />
```

```ts
// ndd — main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { createWorkspace, provideDockableDesktop } from 'angular-dockable-desktop';
import { App } from './app/app';
import { MapPanel } from './app/map-panel';

export const workspace = createWorkspace({
  panels: { map: { component: MapPanel, defaultOptions: { title: 'Map' } } },
  initialState: localStorage.getItem('layout'),
});

bootstrapApplication(App, { providers: [provideDockableDesktop(workspace)] });
```

```html
<!-- ndd — the root component's template -->
<ndd-desktop class="ndd-fill-viewport" />
```

A panel registered with `loadComponent: () => import('./map-panel').then(m => m.MapPanel)`
instead of `component` is loaded on first use, as the router does ([chapter 3](03-panels.md)).

**Lifecycle.** rdd's five subscriptions became watchers in vdd and are effects in ndd:

```tsx
// rdd
const { onActivate, onResize } = useFormContainer();
useEffect(() => onActivate(() => editor.focus()), [onActivate]);
useEffect(() => onResize((w, h) => chart.resize(w, h)), [onResize]);
```

```ts
// ndd
import { Component, effect } from '@angular/core';
import { injectPanel } from 'angular-dockable-desktop';

@Component({ selector: 'app-chart-panel', template: `<canvas></canvas>` })
export class ChartPanel {
  private readonly panel = injectPanel();

  constructor() {
    effect(() => { if (this.panel.isActive()) this.focusEditor(); });
    effect(() => {
      const size = this.panel.size();
      if (size) this.resizeChart(size.width, size.height);
    });
  }

  private focusEditor(): void { /* … */ }
  private resizeChart(width: number, height: number): void { /* … */ }
}
```

**Two-way state and content.** The imperative handles are gone because the state is a model;
render props and slots become templates:

```vue
<!-- vdd -->
<VddSidebar v-model:active-tab-id="tab" v-model:width="width" :tabs="tabs">
  <template #tab-layers="{ close }"><LayerList @done="close" /></template>
  <VddDesktop />
</VddSidebar>
```

```ts
// ndd
import { Component, signal } from '@angular/core';
import { NddDesktop, NddSidebar, NddSidebarTabTemplate } from 'angular-dockable-desktop';
import type { SidebarTab } from 'angular-dockable-desktop';
import { LayerList } from './layer-list';

@Component({
  selector: 'app-shell',
  imports: [NddSidebar, NddSidebarTabTemplate, NddDesktop, LayerList],
  templateUrl: './shell.html',
})
export class Shell {
  readonly tabs: SidebarTab[] = [{ id: 'layers', label: 'Layers', icon: 'icon-layers' }];
  readonly tab = signal<string | null>('layers');
  readonly width = signal(320);
}
```

```html
<!-- ndd — shell.html -->
<ndd-sidebar position="left" [tabs]="tabs" [(activeTabId)]="tab" [(width)]="width">
  <ng-template nddSidebarTab="layers" let-close="close">
    <app-layer-list (done)="close()" />
  </ng-template>
  <ndd-desktop />
</ndd-sidebar>
```

**Inner floating widgets.** rdd's `open` / `onClose` pair and its `usePanelFloatingWindow()`
hook collapse into one model:

```html
<ndd-panel-overlay>
  <ndd-floating-widget widgetId="info" title="Info" [(open)]="showInfo">
    <app-info />
  </ndd-floating-widget>
</ndd-panel-overlay>
```

**Modals.** `injectModals().open()` returns an `NddModalRef`, shaped like Angular Material's
`MatDialogRef`, where vdd's `useModals().open()` returned the instance id:

```ts
import { Injectable } from '@angular/core';
import { injectModals } from 'angular-dockable-desktop';
import { EditFeature } from './edit-feature';

@Injectable({ providedIn: 'root' })
export class FeatureActions {
  private readonly modals = injectModals();

  async edit(featureId: number): Promise<void> {
    const ref = this.modals.open<boolean>(EditFeature, { featureId }, { title: 'Edit', size: 'medium' });
    const saved = await ref.afterClosed();
    if (saved) { /* … */ }
  }
}
```

Inside `EditFeature`, `injectModalRef<boolean>().close(true)` hands the result back. The id is
still available as `ref.id`, and `ws.overlays.openModal()` still returns the bare id.

## Component-level renames

- `<ndd-toolbar-button>` has no `click` output: the native `click` bubbles from the element, and
  nothing fires while the button is disabled. `(click)` on it works as on any element.
- `<ndd-toolbar-search>`'s `select` event is `(resultSelect)`, because `select` is a DOM event
  name and an output with that name would also catch the native event.
- `<ndd-secondary-sidebar>` must be inside an `<ndd-sidebar>`'s content and takes the other
  side; it has no `position` of its own. Both are one base class and one template.
- `toast()` is a plain function as in vdd; `NddToaster` offers the same methods through
  `inject(NddToaster)` for code that prefers a service.
- `[nddContextMenu]="items"` (`NddContextMenuTrigger`) opens a menu on right-click over any
  element, without calling `injectContextMenu()` yourself.
- Icons (`NddIcon`) are a component class, a `TemplateRef`, or a string of CSS classes (for an
  icon font), where vdd took a Vue component.

## Things that no longer exist

- **rdd's pending-call queue.** rdd's client queued calls made before the provider mounted.
  vdd's and ndd's workspace owns its state from creation, so calls take effect immediately;
  `isConnected` and the never-connected warning are gone.
- **`usePanelFloatingWindow()`** — it wrapped a boolean; use `[(open)]`.
- **`SidebarHandle`, `ToolbarHandle`** — every method was a getter or setter for state that is
  now a model; `injectSidebar()` covers the rest from inside the sidebar.
- **Unsubscribe functions** from `onBeforeClose` / `onSaveState`, and from `subscribe` when it is
  called in an injection context — cleanup is automatic.
- **`getDimensions()`** — `size` is a signal.
- **`SidebarProps`, `UsePanelReturn`, `WORKSPACE_KEY`** (vdd) — the component's inputs, `PanelRef`,
  and the `Workspace` class respectively.

## Behaviour a migrator will notice

### From rdd: the D-series

vdd fixed sixteen rdd defects (D1–D16) and ndd carries every fix. If your code worked around
one, the workaround is unnecessary — and for D2, possibly harmful: if you call `focusPanel()`
after a dock or float to fix a stale `activePanelId`, drop it. The full list is PARITY.md §4.1;
the ones most often worked around:

| | rdd 6.x | vdd and ndd |
|---|---|---|
| D1 | "Maximize" on a taskbar icon does nothing | restores, then maximises |
| D2 | `activePanelId` goes stale after five placement actions | every action resolves the active panel |
| D3 | `openPanel` on a minimised panel returns it to the first leaf | it returns to its original leaf |
| D4 | re-opening a minimised panel publishes no events, so autosave misses it | publishes `panel:restored` and `layout:changed` |
| D8 | the stylesheet sets `height: 100%; overflow: hidden` on `html, body, #root` | only `ndd-` DOM is styled; give the workspace a height, or use `ndd-fill-viewport` ([chapter 10](10-theming.md#giving-the-workspace-a-height)) |

D15 remains a gap in all three: an overflowing tab bar scrolls by wheel, trackpad, touch and
drag, but has no chevron buttons.

### From vdd: the N-series

Where ndd knowingly behaves differently from vdd — because vdd's behaviour is a defect found
during the port, or because Angular requires it. Each is pinned by a test or a gate
(PARITY.md §4.2).

| # | vdd | ndd | What to change |
|---|---|---|---|
| N1 | Scroll offsets and focus are captured only when a panel moves, so a panel whose host is re-created loses its scroll position | Offsets and focus are tracked continuously and survive any detach | Nothing; drop any scroll-restoring workaround |
| N2 | The taskbar preview's entry animation briefly covers its icon, so a quick click lands on the preview | The preview slides in inside the gap and never covers its icon | Nothing |
| N3 | The context menu supports Escape only | The full WAI-ARIA menu pattern: arrows, Home/End, submenus with ArrowRight/Left (mirrored in RTL), focus return on Escape, checkbox items as `menuitemcheckbox` | Remove your own key handling for library menus |
| N4 | A tab's close × is a clickable `<span>` with no keyboard access | The focused tab closes with **Delete** (announced by `aria-keyshortcuts`); the × stays a pointer affordance, `aria-hidden` | Tests that tab to the × should press Delete on the tab |
| N5 | A toolbar group's flyout mirrors on the workspace's direction | It mirrors on the strip's own computed direction | Nothing, unless you relied on the mis-placement |
| N6 | Under an RTL container, dragging a sidebar's resizer away from its edge shrinks it | The drag follows the side the drawer is physically on | Nothing |
| N7 | A collapsed toolbar keeps a 1px border | A collapsed strip (`ndd-toolbar-strip--collapsed`) collapses to nothing | Remove CSS that hid the stray line |
| N8 | A closing panel observes its own deactivation through a synchronous watcher | Angular has no synchronous effect, and a closing panel's effects never run. Subscribe to `panel:activated` (published before `panel:closed`) for the ordered hand-off, or use `DestroyRef.onDestroy` as the "before I go" hook | Replace a `flush: 'sync'` watcher on `isActive` with one of those |
| N9 | One Escape can close both a modal and a drawer opened after it | The answering overlay calls `preventDefault()`, and every overlay ignores an Escape already handled | Nothing |
| N10 | A model bound one-way, with no listener, is controlled: the widget reports a gesture but never applies it | An Angular `model()` is locally writable: a one-way `[placement]` seeds it and follows the parent's *changes*, but does not freeze it. To veto a gesture, answer `(placementChange)` with the parent's own value, which re-syncs the widget. The same holds for every model in the library | Rewrite "bind without a listener to freeze" as the veto pattern |
| N11 | `.vdd-fill-viewport` on the desktop element does nothing | `ndd-fill-viewport` works on the desktop element and on your own container | Move the class onto `<ndd-desktop>` if you like |
| N12 | Panel mounts use `dataset`; vdd does not server-render | Mounts use `setAttribute('data-ndd-panel', …)`; ndd server-renders and hydrates | Nothing |
| N13 | Toolbar group flyout items are `menuitem` with `aria-pressed` | They are `menuitemradio` with `aria-checked` | Update tests or selectors that query by role |
| N14 | The toast container is a generic `<div>` with `aria-label` | It is a labelled `role="region"` | Update tests that query it by role |
| N15 | Dragging a split divider under RTL moves it away from the pointer | The divider follows the pointer in both directions | Nothing |
| N16 | A `ToastAdapter` never receives `show` | It receives `show`, `update` and `dismiss` | Drop code that rendered new toasts from the queue to make up for it |
| N17 | A custom context-menu template is dismissed on `pointerdown`, before its own item's click | A press inside the menu host counts as inside | Move item actions back to `(click)` if you moved them to `(pointerdown)` |

### From vdd: shape changes with no behavioural difference

These change how something is written, not what it does (PARITY.md §4.3):

- vdd's composables are `inject*()` functions; `update:x` events are `(xChange)` outputs.
- `<ndd-toolbar-button>` has no `click` output; `<ndd-toolbar-search>`'s `select` is
  `(resultSelect)` (see [Component-level renames](#component-level-renames)).
- Panel options are `inputs` applied with `setInput`; a component receives only the inputs it
  declares, and `panelId` is always the injected one.
- Every development-only diagnostic is guarded inline with `ngDevMode`, so a production build
  carries none of their text.

## Suggested order

1. Add the stylesheet to `angular.json`, set up `createWorkspace` + `provideDockableDesktop`
   (or `provideDockableDesktop(config)`), and confirm that a layout saved by your rdd or vdd
   application loads.
2. Port panel components. Those using `useFormContainer` / `usePanel()` move to `injectPanel()`
   and effects; rename `props` to `inputs` at `openPanel` call sites and declare each as an
   `input()` on the panel.
3. Port the shell — sidebar, toolbar, modals, context menu, toasts — converting handles and
   `v-model` to `[( )]`, and render props and slots to `ng-template` directives.
4. Rename `vdd-` (or rdd's) classes and custom properties in your own CSS to `ndd-`, and skin
   selectors to `[data-ndd-skin]`.
5. Remove your D2 workarounds, and review anything that relied on N8 or N10.
