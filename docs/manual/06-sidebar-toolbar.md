# 6. Sidebar and toolbar

Two pieces of application chrome that surround the workspace rather than living inside it: an
activity bar with a resizable drawer, and a strip of tool buttons on any edge. Both are
optional, and both are ordinary standalone components: you place them yourself, so they sit
wherever your layout needs them.

## The sidebar

`<ndd-sidebar>` renders three things in a row: the activity strip of tab icons, the drawer that
opens beside it, and whatever you project into it (usually the workspace).

```ts
import { Component, signal } from '@angular/core';
import { NddDesktop, NddSidebar, NddSidebarTabTemplate } from 'angular-dockable-desktop';
import type { SidebarTab } from 'angular-dockable-desktop';
import { LayerTree } from './layer-tree';
import { SearchPane } from './search-pane';

@Component({
  selector: 'app-shell',
  imports: [NddDesktop, NddSidebar, NddSidebarTabTemplate, LayerTree, SearchPane],
  templateUrl: './shell.html',
})
export class Shell {
  protected readonly tabs: SidebarTab[] = [
    { id: 'layers', label: 'Layers', icon: 'bi bi-layers' },
    { id: 'search', label: 'Search', icon: 'bi bi-search' },
  ];
  protected readonly openTab = signal<string | null>('layers');
}
```

```html
<ndd-sidebar position="left" [tabs]="tabs" [(activeTabId)]="openTab">
  <ng-template nddSidebarTab="layers"><app-layer-tree /></ng-template>
  <ng-template nddSidebarTab="search"><app-search-pane /></ng-template>

  <ndd-desktop />
</ndd-sidebar>
```

Clicking a tab opens its drawer; clicking the open tab again closes it. `position` is `left` or
`right` (default `right`) and decides which edge the whole assembly sits on: you never place the
strip and the drawer separately.

An icon, here and everywhere in the library, is an `NddIcon`: a string of CSS classes (as above,
for Bootstrap Icons, Font Awesome and similar sets), a component class, or a `TemplateRef` for
an inline `<svg>`. See [chapter 10](10-theming.md).

| Input | | Default |
|---|---|---|
| `tabs` | the tabs, required | |
| `position` | `left` · `right` (primary only) | `right` |
| `headerAction`, `footerAction` | pinned rail entries, below | none |
| `minWidth`, `maxWidth` | drawer bounds in pixels | `150`, `600` |
| `showCloseButton` | an "×" in the drawer header | `false` |
| `hideDefaultHeader` | no drawer header at all | `false` |

### Four models

| Model | Meaning | Default |
|---|---|---|
| `[(activeTabId)]` | the open tab, or `null` | `null` |
| `[(visible)]` | show the whole sidebar | `true` |
| `[(stripVisible)]` | show the activity strip; the drawer is unaffected | `true` |
| `[(width)]` | drawer width in pixels | `280` |

Each is an Angular `model()`. Bind it with `[( )]` to a `WritableSignal` and the two stay in
step: your signal sets the sidebar, and a click or a resize drag writes back into your signal.
Each also has its change output, `(activeTabIdChange)`, `(visibleChange)`,
`(stripVisibleChange)` and `(widthChange)`, for when you only want to be told.

Leave a model unbound and the sidebar keeps its own state. Bind it one way, `[activeTabId]="x"`,
and your value seeds it and is re-applied whenever **your** value changes, but the sidebar
still updates itself on a click. This is Angular's model semantics and it differs from vdd,
where a model bound without a listener is controlled (divergence N10,
[chapter 12](12-migrating.md)). To keep a value from changing, answer the change output by
writing your own value back.

So `[(visible)]` is also how you hide and show the sidebar; there is no `show()` or `hide()`
to call:

```html
<ndd-sidebar [(visible)]="sidebarShown" [tabs]="tabs">
  <ndd-desktop />
</ndd-sidebar>
```

Hiding the whole sidebar hides the drawer too, but keeps `activeTabId`, so showing it again
reopens the same tab.

`stripVisible` exists for the pattern where a hamburger button drives everything and the icon
rail should not be on screen at all: hide the strip, keep the drawer, open tabs yourself.

Width is clamped to `minWidth`/`maxWidth` while the user drags, so the value a drag writes is
always in range. A width you set yourself is not rewritten: set `width` to 9999 and your
signal still says 9999, while the drawer renders at `maxWidth`. Resizing follows the side the
drawer is physically on, so under a right-to-left container (where `position="left"` renders
on the right) dragging away from the edge still grows it (divergence N6).

### Tab content, two ways

An `nddSidebarTab` template, as above, or a `component` on the tab itself, when the tabs come
from data:

```ts
protected readonly tabs: SidebarTab[] = [
  { id: 'layers', label: 'Layers', icon: 'bi bi-layers', component: LayerTree },
  { id: 'props', label: 'Properties', icon: 'bi bi-info-circle', component: Inspector, inputs: { compact: true } },
];
```

`inputs` are applied to `component` through `NgComponentOutlet`. A template wins over
`component` for the same id. In development you get a warning if a tab that opens has neither.

Place the templates directly inside the sidebar element, not wrapped in another element: the
sidebar reads its direct content only, which is what stops a primary sidebar from picking up
the templates of a secondary nested inside it. Import `NddSidebarTabTemplate` (and
`NddSidebarHeaderTemplate`, below) alongside `NddSidebar`.

The template context is typed through `ngTemplateContextGuard` as
`NddSidebarTemplateContext`: `$implicit` and `tab` are the `SidebarTab`, `close()` closes the
drawer and `open()` opens this tab.

```html
<ng-template nddSidebarTab="layers" let-tab let-close="close">
  <app-layer-tree [title]="tab.label" (done)="close()" />
</ng-template>
```

### When content mounts

By default a tab's content is created on first open and destroyed when the drawer closes. Two
flags on the tab change that:

- `eagerMount: true`: create it as soon as the sidebar renders. Implies `preserveState`.
- `preserveState: true`: keep it alive behind `display: none` when closed.

Use `preserveState` for anything expensive or stateful: a half-filled form, a loaded tree, a
scrolled list. Use `eagerMount` when the content needs to start work before anyone looks at
it: a subscription, a first fetch.

If the open tab stops existing (the list changed, or the panel that contributed it closed), the
drawer closes. It never falls back silently to a tab the user did not choose.

### Hidden tabs

A tab with `hidden: true` renders no button on the rail but is otherwise a normal tab, fully
openable through `[(activeTabId)]` or `injectSidebar().openTab()`. `icon` is optional on a
hidden tab. This is how you get a pane that only a menu item or a keyboard shortcut can reach.
Every tab can be hidden at once, leaving a rail with nothing on it but your own header button.

### The drawer header

By default the drawer shows the open tab's label. Three ways to change that:

- `[showCloseButton]="true"` adds an "×" beside the title.
- `[hideDefaultHeader]="true"` removes the header entirely.
- an `nddSidebarHeader` template replaces it, for whichever tab is open, with the same typed
  context as a tab template.

```html
<ng-template nddSidebarHeader let-tab let-close="close">
  <app-drawer-header [title]="tab.label" (dismiss)="close()" />
</ng-template>
```

Providing the template suppresses the default header on its own; `hideDefaultHeader` is not
needed alongside it. `showCloseButton` has no effect once the header is gone, since the button
is part of it; in development you are told so rather than left wondering.

### Pinned rail entries

`headerAction` and `footerAction` add entries above and below the tab list. Each takes one
`SidebarRailEntry` or an array, and an entry can be three things:

```ts
import type { SidebarRailEntry } from 'angular-dockable-desktop';

const entries: SidebarRailEntry[] = [
  // a button that does not toggle the drawer (SidebarActionButton)
  { id: 'menu', icon: 'bi bi-list', label: 'Menu', onClick: () => navOpen.update(v => !v) },

  // a real tab, behaving exactly like one from the main list (SidebarTab)
  { id: 'settings', label: 'Settings', icon: 'bi bi-gear', component: SettingsPane },

  // something you render yourself, unwrapped (SidebarCustomEntry)
  { id: 'avatar', custom: true, component: UserAvatar },
];
```

An action button takes an optional `disabled`; a custom entry takes optional `inputs`. `id` is
needed only inside an array. The footer is pinned to the bottom of the rail regardless of how
many tabs there are: the usual home for Settings and an account avatar.

### A second sidebar

`<ndd-secondary-sidebar>` is the same component on the opposite edge. It takes whichever side
the primary is not using, so it has no `position`:

```html
<ndd-sidebar position="left" [tabs]="navTabs">
  <ndd-secondary-sidebar [tabs]="inspectorTabs" [(activeTabId)]="inspector">
    <ndd-desktop />
  </ndd-secondary-sidebar>
</ndd-sidebar>
```

It accepts every other input, model and template the primary does (import
`NddSecondarySidebar`), and must be nested inside an `<ndd-sidebar>`: rendered on its own, it
throws with an explanation. So does a secondary nested inside another secondary; the library
supports one primary and one secondary. The two resize independently.

### Reaching the sidebar from anywhere

```ts
import { effect } from '@angular/core';
import { injectSidebar } from 'angular-dockable-desktop';

// in a constructor or field initialiser
const sidebar = injectSidebar();   // { openTab, closeDrawer, activeTabId, position, isSecondary }
sidebar.openTab('layers');
effect(() => console.log('open tab:', sidebar.activeTabId()));
```

`activeTabId` is a
read-only signal. It resolves to the nearest sidebar, so inside an `<ndd-secondary-sidebar>` it
is the secondary's. It works from a panel rendered in the workspace too, since the workspace is
the sidebar's own content.

Inside a tab's own content, whether it comes from a template or a `component`, there is also:

```ts
import { injectSidebarTab } from 'angular-dockable-desktop';

const { tabId, open, close, openTab } = injectSidebarTab();
```

which is scoped to the tab you are in: a "done" button can `close()` without knowing which tab
it lives in, and `openTab(id)` switches to another. It is available in the header template as
well. It is **not** available in a workspace panel, which is not inside any tab. Both functions
throw, with a message saying what is missing, if used outside.

## The toolbar

`<ndd-toolbar>` takes a `position` and an array of items. Items are data, not markup:

```ts
import { Component, signal } from '@angular/core';
import { NddToolbar } from 'angular-dockable-desktop';
import type { ToolbarItem } from 'angular-dockable-desktop';

@Component({
  selector: 'app-tools',
  imports: [NddToolbar],
  template: `<ndd-toolbar position="left" [items]="items" [(visible)]="toolbarShown" />`,
})
export class Tools {
  protected readonly toolbarShown = signal(true);
  protected readonly items: ToolbarItem[] = [
    { type: 'action', id: 'zoom-all', label: 'Zoom to fit', icon: 'bi bi-arrows-fullscreen', onClick: () => this.fitAll() },
    { type: 'separator' },
    { type: 'radio', id: 'pan', group: 'mode', label: 'Pan', icon: 'bi bi-arrows-move' },
    { type: 'radio', id: 'select', group: 'mode', label: 'Select', icon: 'bi bi-cursor' },
    { type: 'toggle', id: 'snap', label: 'Snap to grid', icon: 'bi bi-grid-3x3' },
    {
      type: 'group',
      id: 'draw',
      label: 'Draw',
      defaultIcon: 'bi bi-pencil',
      items: [
        { id: 'line', label: 'Line', icon: 'bi bi-slash-lg', shortcut: 'L' },
        { type: 'separator' },
        { id: 'polygon', label: 'Polygon', icon: 'bi bi-pentagon' },
      ],
    },
  ];

  private fitAll(): void { /* … */ }
}
```

- **action** (`ToolbarActionItem`): a one-shot button; `onClick` is required.
- **radio** (`ToolbarRadioItem`): one of a set; items sharing a `group` are mutually exclusive.
  Optional `onActivate(id)` and `shortcut`.
- **toggle** (`ToolbarToggleItem`): an independent on/off modifier. Optional `onToggle(on)`.
- **group** (`ToolbarGroupItem`): a collapsed family, one button that opens a flyout with radio
  semantics inside. The button wears the selected sub-tool's icon and label, so the strip shows
  the state while collapsed; `defaultIcon` and `label` apply while nothing is selected. Each
  sub-item (`ToolbarGroupSubItem`) may carry `shortcut`, `disabled` and `onActivate`.
- **separator** (`ToolbarSeparator`): a rule, allowed in `items` and in a group's `items`.

Every item except a separator takes `disabled`.

`position` is `left` (default), `right`, `top` or `bottom`, and decides the orientation.
`[(visible)]` collapses the strip without destroying anything, so state survives being hidden;
a collapsed strip also drops its edge border, so it takes no space at all (divergence N7).

A group's flyout is rendered in `document.body`, so the strip cannot clip it, and closes on
Escape, an outside click or a choice. It opens away from the strip and mirrors on the strip's
**own** computed direction, which is correct whether or not the chrome around the desktop is
right-to-left (divergence N5). Its entries are `menuitemradio` with `aria-checked`, since the
tools are mutually exclusive (divergence N13).

### Where the selection lives

Radio and toggle state is on the workspace, so nothing needs a provider and anything that can
inject the workspace can read or set it, a service included:

```ts
import { computed } from '@angular/core';
import { injectToolbar } from 'angular-dockable-desktop';

const toolbar = injectToolbar();

toolbar.activeInGroup('mode');              // 'pan' | 'select' | null
toolbar.setActiveInGroup('mode', 'select');
toolbar.isToggled('snap');                  // boolean
toolbar.setToggled('snap', true);
toolbar.toggle('snap');

const snapping = computed(() => toolbar.isToggled('snap'));
```

The reads are signal reads, so a template, a `computed()` or an `effect()` tracks them. A
group's selection is stored under the group's own `id` (`activeInGroup('draw')`). That
includes reading from inside a panel: a map panel can follow the active tool without the
toolbar passing anything down to it. `injectToolbar()` returns the same object as
`injectWorkspace().toolbar`.

### Taking control of an item

Supply `active` on a toggle, or `activeItemId` on a group, and that item stops consulting the
workspace: your value is the truth, and the item reports changes through `onToggle` or
`onActiveItemChange` instead of applying them.

```ts
{ type: 'toggle', id: 'snap', label: 'Snap', icon: 'bi bi-grid-3x3',
  active: this.snapEnabled(), onToggle: (on: boolean) => this.snapEnabled.set(on) }
```

Build the array in a `computed()` (or an `injectMergedToolbarItems` getter, see
[chapter 9](09-contributions.md)) so `active` follows your signal.

The field counts as supplied when it is *present*, including `active: false` and
`activeItemId: null`. That distinction is the point: workspace state is keyed by item id, so
two instances of the same panel type would otherwise share one "snap" setting. Control the
item and each panel keeps its own. Radio items have no controlled form.

Use the workspace state for genuinely global modes, and control the item when it belongs to a
particular panel.

## Coming from react-dockable-desktop or vue-dockable-desktop

rdd exposed eleven methods across two imperative handles. Every one of them was a getter or a
setter for state, so each is a model or an `inject*()` function here:

| rdd | vdd | ndd |
|---|---|---|
| `sidebarRef.current.openTab(id)` | `useSidebar().openTab(id)` | `injectSidebar().openTab(id)`, or write `[(activeTabId)]` |
| `closeDrawer()` | `useSidebar().closeDrawer()` | `injectSidebar().closeDrawer()`, or write `null` |
| `getActiveTab()` | `useSidebar().activeTabId` (a ref) | `injectSidebar().activeTabId()` (a signal) |
| `show()` / `hide()` / `toggle()` | `v-model:visible` | `[(visible)]` |
| `showStrip()` / `hideStrip()` | `v-model:strip-visible` | `[(stripVisible)]` |
| `setWidth(px)` / `getWidth()` | `v-model:width` | `[(width)]` |
| `onActiveTabChange`, `onWidthChange`, … | `update:` events | `(activeTabIdChange)`, `(widthChange)`, … |
| `tab.renderContent(id)` | `#tab-<id>` slot, or `tab.component` | `<ng-template nddSidebarTab="id">`, or `tab.component` |
| — | `tab.props` | `tab.inputs` |
| `renderHeader(tab, onClose, onOpen)` | `#header` slot | `<ng-template nddSidebarHeader let-tab let-close="close" let-open="open">` |
| — | `useSidebarTab()` | `injectSidebarTab()` |
| `<ToolbarProvider>` | nothing | nothing: the state is on the workspace |
| `getActiveInGroup` / `isModifierActive` | `activeInGroup` / `isToggled` | the same, via `injectToolbar()` |
| `setModifierActive` / `toggleModifier` | `setToggled` / `toggle` | the same |

Toolbar `items` arrays transfer verbatim from rdd or vdd; only the icons change type.

One behavioural difference from rdd worth knowing: rdd's `setWidth` clamped inside the
component, so calling it out of range silently changed your value. A model belongs to you, so
ndd, like vdd, clamps where the value is produced (the resize drag) and bounds the rendered
drawer with `min-width`/`max-width`.
