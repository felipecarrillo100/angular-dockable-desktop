# 3. Panels

## A panel is just a component

```ts
// src/app/panels/notes-panel.ts
import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-notes-panel',
  template: `<textarea class="notes" [value]="text()" (input)="text.set($any($event.target).value)"></textarea>`,
})
export class NotesPanel {
  protected readonly text = signal('');
}
```

Register it, open it, done. It needs to know nothing about the library.

```ts
provideDockableDesktop({
  panels: { notes: { component: NotesPanel } },
});
```

## Registration options

```ts
panels: {
  notes: {
    component: NotesPanel,
    defaultOptions: {
      title: 'Notes',                 // string, or an i18n descriptor
      icon: 'bi bi-journal',          // CSS classes, a component class, or a TemplateRef
      initialTarget: 'docked',        // 'docked' | 'floating' | 'tabbed'
      favoritePosition: { x: 40, y: 40, width: 480, height: 320 },
      defaultAnchor: 'top-right',     // corner to pin to when floated
      canClose: true,
      canMinimize: true,
      canDrag: true,                  // false also prevents floating
      canFloat: true,                 // false: the user can't float it (1.8.0)
      canDock: true,                  // false: the user can't dock it (1.8.0)
      disableLivePreview: false,      // taskbar hover shows a letter tile instead
      className: 'app-notes',         // on each panel's own content element (1.7.0)
      tabClassName: 'app-notes-tab',  // on its tab (1.7.0)
      keepAlive: true,                // false: destroyed while hidden, see below (1.7.0)
      preserveScroll: true,           // restore scroll offsets after a move
      preserveEmbeds: false,          // true: an <iframe> in it doesn't reload when it moves (1.11.0)
    },
  },
}
```

Every option is optional, and the values shown are the defaults except `title`, `icon`,
`favoritePosition` and `defaultAnchor`. A panel with no `title` is titled with its instance id;
one with no `favoritePosition` floats at 450×350. `'tabbed'` is accepted for compatibility with
the family's layouts and places the panel as `'docked'` does: as a tab in the first group.

An icon (`NddIcon`) takes three forms, so no icon library is imposed: a string of CSS classes
(Bootstrap Icons, Font Awesome), a component class rendered with no inputs, or a `TemplateRef`
for an inline `<svg>`. `<ndd-desktop [defaultPanelIcon]="…">` is the fallback for panels that
register none.

The keys of `panels` are what `openPanel` and saved layouts name, so keep them stable. Keys
starting with `ndd:` are the library's: `'ndd:widget'` is the kind of a managed widget's own panel
([Chapter 14](14-widgets-out-of-the-panel.md)), which `saveLayout()` never saves.

### Freeing a hidden panel (`keepAlive: false`)

By default a panel's component is created once and never destroyed while the panel is open (see
[Zero unmount](02-concepts.md#zero-unmount)). For a heavy kind that is rarely shown,
`keepAlive: false` trades that for memory: the component is destroyed while the panel is **an
unselected tab or minimised**, and created afresh when it is shown again. `className` goes on the
panel's own content element (`.ndd-panel-content`), which moves with the panel.

- **Its own state is lost each time it is hidden**, and its `DestroyRef` callbacks run: in such a
  panel, destroyed means *hidden*, not *closed*. Keep what must survive outside it.
- **A guard it registered with `onBeforeClose` is not active while it is destroyed.** Its dirty
  flag still is, so closing a hidden dirty panel still asks first.
- **Its tab, title, dirty flag, size and container carry on**, and the taskbar shows a letter tile
  instead of a live preview while it is minimised.
- A floating window is always shown, so a floating panel keeps its component. A lazy kind loads
  its chunk once; creating it again needs no second load.

### Keeping an iframe alive (`preserveEmbeds`)

1.11.0. A panel's element is moved, never re-created, when the panel docks, floats, minimises or the grid
changes around it. A moved `<iframe>` (or `<video>`, or an embedded map) still reloads, because
the browser re-inserts it. `preserveEmbeds: true` moves the panel with `Element.moveBefore()`
instead, which keeps the embedded document: Chrome and Edge 133+ and Firefox 144+. In a browser
without it (Safari today), the iframe reloads as before. Use it for a panel whose content is an
embed whose state matters; it costs a little more on every layout change, so leave it off
elsewhere. A managed widget has its own `preserveEmbeds`
([chapter 14](14-widgets-out-of-the-panel.md#iframes-and-media-preserveembeds)), which also marks
its owner panel.

Angular removes a destroyed view's DOM before any destroy hook runs, so a group, window or taskbar
preview that a render destroys would take the panel's element with it. A state change that can
destroy one therefore parks the marked panels in the workspace's hidden store first (after the
action's own writes, before change detection), and puts each back in its new place after the
render, both with `moveBefore()`. An application that calls `ApplicationRef.tick()` synchronously
in the same task as the change renders before the park, and the iframe reloads. An ordinary
panel's element (one without `preserveEmbeds`) is still briefly detached when a drag between
groups destroys its slot, as it always was ([ADR 0002](../decisions/0002-zero-unmount-via-host-element.md),
finding 1): harmless for everything but an embed.

### Lazy panels

Use `loadComponent` in place of `component` and the panel lands in its own chunk, loaded the
first time a panel of that kind opens:

```ts
panels: {
  editor: {
    loadComponent: () => import('./panels/code-editor-panel').then(m => m.CodeEditorPanel),
    defaultOptions: { title: 'Code Editor' },
  },
}
```

The loader may resolve to the component class or to a module whose `default` export is one.
Concurrent opens share one load. The panel's tab and window appear at once, with a "Loading…"
placeholder until the chunk arrives. A key that is not registered at all — typically after
loading a layout saved by a build with more panel types — renders a diagnostic placeholder in
place of the panel rather than failing.

## Per-instance data

A panel's per-instance data arrives as its own **inputs**:

```ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-document-panel',
  template: `<h2>{{ path() }}</h2>`,
})
export class DocumentPanel {
  readonly path = input.required<string>();
}
```

```ts
ws.openPanel('doc-42', 'document', {
  inputs: { path: '/notes/todo.md' },
  title: 'todo.md',
  dedupeKey: '/notes/todo.md',
});
```

Each key of `inputs` that the component declares as an input (by public name or alias) is
applied with `ComponentRef.setInput`; keys it does not declare are skipped without an error. A
component that declares a `panelId` input receives its instance id there, and that one input is
always the library's, never the caller's. (vdd calls this option `props`; the saved layout keeps
the family's `props` key, so layouts stay interchangeable.)

`dedupeKey` means *"if a `document` panel with this key is already open, focus it instead of
opening a second"* — useful when several call sites cannot agree on the same literal id. The
redirect ignores the caller's id and inputs; `ws.findPanelId('document', key)` looks the match up
without opening anything.

The other `openPanel` options are `initialTarget` and `anchor` (overriding the registration),
and `focus` — `false` opens the panel without making it active.

To change an open panel's data, `ws.updatePanelProps(id, props)` replaces its inputs, or derives
them from the current ones with a function (`ws.updatePanelProps('doc-42', prev => ({ ...prev,
path: '/notes/done.md' }))`). Every key the component declares is set again, as on open;
`saveLayout()`'s serialisability check is re-run on the new values, and `layout:changed` is
emitted. A panel that isn't open, and a managed widget's own panel (a widget moved out of its
panel has no inputs of its own), are left alone (1.11.0).

> Whether `inputs` survive `saveLayout()` depends on whether they are JSON-serialisable. See
> [chapter 5](05-persistence.md); it is a runtime fact, not a type-level guarantee.

### A typed registry: `definePanels`

Wrap the map in `definePanels()` and the workspace's `openPanel` is typed from it: only registered
names are accepted, and `inputs` is checked against that panel's signal inputs (`input()`,
`input.required()`, `model()`), without `panelId`, which the library sets. Opt-in: a plain map keeps
working exactly as before (1.9.0).

```ts
import { createWorkspace, definePanels } from 'angular-dockable-desktop';

const panels = definePanels({
  map:   { component: MapPanel },
  chart: { component: ChartPanel },   // ChartPanel: readonly series = input.required<number>();
});
export const workspace = createWorkspace({ panels });

workspace.openPanel('c1', 'chart', { inputs: { series: 3 } });    // ✓
workspace.openPanel('m1', 'mpa');                                 // ✗ not a registered panel
workspace.openPanel('c2', 'chart', { inputs: { series: '3' } });  // ✗ series is a number
```

`definePanels` returns its argument unchanged; the typing is all at compile time. A `loadComponent`
entry is typed from the component it loads. Inputs are optional in the type, as at runtime; an input
with a `transform` accepts what the transform accepts. `@Input()` decorator inputs are invisible to
the type system, so a component with no signal inputs stays untyped. With a typed event bus as well,
pass both type arguments: `createWorkspace<typeof panels, AppEvents>({ panels })`.

The typing comes from the workspace `createWorkspace` returns. `inject(Workspace)` and
`injectWorkspace()` return the untyped `Workspace`, so for typed calls inside components, import that
same `workspace` (the one you passed to `provideDockableDesktop`). The typed workspace is still a
`Workspace` and goes anywhere one does.

## Talking to the container: `injectPanel()`

Call it in an injection context — a field initialiser or the constructor:

```ts
import { Component } from '@angular/core';
import { injectPanel } from 'angular-dockable-desktop';

@Component({ selector: 'app-map-panel', template: `…` })
export class MapPanel {
  protected readonly panel = injectPanel();
  // panel.id                           — the instance id, a plain string
  // panel.title() isActive() isMinimized() isFloating() containerType() size() dirty()
  // panel.setTitle() setIcon() setDirty() close() minimize()
  // panel.onBeforeClose() onSaveState() trackDirty()
}
```

It returns a `PanelRef`. Apart from `id`, its state members are **signals**, so you react to them
with the tools you already use — templates, `computed()` and `effect()`:

```ts
constructor() {
  effect(() => { if (this.panel.isActive()) this.editor.focus(); });
  effect(() => (this.panel.isMinimized() ? this.stopPolling() : this.startPolling()));
  effect(() => {
    const size = this.panel.size();        // null until laid out
    if (size) this.chart.resize(size.width, size.height);
  });
}
```

`containerType()` tells you where the panel is rendered: `'dockable-panel'`, `'floating-window'`,
`'modal'`, `'left-panel'`, `'right-panel'` or `'standalone'`. The same component can be opened as
a panel *and* as a modal ([chapter 8](08-overlays.md)); this is how it adapts. A minimised panel
reports the container it will be restored to.

`setTitle()` updates the tab, the window title bar and the taskbar icon. `setIcon()` changes the
icon in the same places — the tab, the floating title bar and the taskbar button — or, in a modal
or side panel, its title bar (1.10.0; before, it only worked in a modal or side panel).

The actions run untracked, so `effect(() => this.panel.setTitle(this.name()))` is safe: the
effect depends on `name` and nothing else. Outside any container — a unit test, a story, a route
— the signals describe a `'standalone'` panel and the actions do nothing but log a development
warning, so the component renders on its own without special-casing.

### Changing the icon

A panel's icon is its registration's `defaultOptions.icon` until something changes it: the panel
itself with `injectPanel().setIcon(icon)`, or anyone with `workspace.setPanelIcon(id, icon)`
(1.10.0). Both take any `NddIcon` — a component, a `TemplateRef` or a class string.

```ts
effect(() => this.panel.setIcon(this.connected() ? 'bi bi-wifi' : 'bi bi-wifi-off'));

ws.setPanelIcon('map-1', null);  // back to the registered icon
```

The tab, the floating title bar, the taskbar button and the `icon` an `nddTabContent` template
receives all show the runtime icon, else the registered one; the taskbar then falls back to
`defaultPanelIcon`. `null` goes back to the registered icon, an unknown id does nothing, setting the
icon a panel already has changes nothing, and no event is published. It is read as
`state().panels[id].icon`.

The runtime icon lives only in memory: `saveLayout()` never writes it (the JSON is byte for byte
what it would be without one), and an `icon` in a hand-made layout is dropped on load. `loadLayout()`
keeps it for a panel that stays open with the same component — that component isn't re-created, so
it wouldn't set it again; a restored panel starts from its registered icon.

### Unsaved changes

```ts
effect(() => this.panel.setDirty(this.text() !== this.saved()));
```

A dirty panel shows `*` after its title, and closing it raises the built-in unsaved-changes
confirmation — from a tab's ×, a window's ×, the Delete key on a focused tab, a menu, or
`close()`. The question is rendered by `<ndd-modals>`; with none mounted, the close is refused
rather than discarding anything. Customise the dialog:

```ts
this.panel.setDirty(true, {
  title: 'Discard notes?',
  message: 'Your notes have not been saved.',
  alert: '2 fields still required',
  alertType: 'warning',            // 'info' | 'warning' | 'success' | 'danger'
});
```

With **Signal Forms**, let `trackDirty()` follow the form instead of calling `setDirty` by hand.
The options may be a getter, re-read each time, so the dialog says what is wrong right now:

```ts
import { Component, signal } from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';
import { injectPanel } from 'angular-dockable-desktop';

@Component({
  selector: 'app-customer-panel',
  imports: [FormField],
  template: `<label>Name <input [formField]="form.name" /></label>`,
})
export class CustomerPanel {
  private readonly panel = injectPanel();
  private readonly model = signal({ name: '' });
  protected readonly form = form(this.model, path => required(path.name));

  constructor() {
    this.panel.trackDirty(
      () => this.form().dirty(),
      () => ({ alert: this.form().valid() ? undefined : 'Name is required' }),
    );
  }
}
```

`trackDirty` accepts any boolean getter, not only a form's. It stops with the component.

### Vetoing a close

```ts
this.panel.onBeforeClose(async () => {
  const { confirmed } = await this.myOwnDialog();
  return confirmed;          // false blocks the close
});
```

The guard runs first; the unsaved-changes question is asked only if the guard allows the close.
It is disposed with the component through its `DestroyRef` — there is no unsubscribe to
remember.

### Contributing live state to a saved layout

`inputs` are captured when the panel opens. For state that accumulates afterwards — a scroll
position, a view mode, an in-progress edit — register a provider, and it is pulled fresh on
every `saveLayout()`:

```ts
this.panel.onSaveState(() => ({ path: this.path(), viewMode: this.viewMode() }));
```

The value is saved as the panel's `props` and applied to its inputs by name when the layout is
restored, so use the input names as keys. Return `undefined` to fall back to the panel's opening
`inputs`. The value must be synchronous and JSON-serialisable.

## Closing and minimising from inside

```ts
this.panel.close();                  // honours any onBeforeClose guard and dirty state
this.panel.close({ force: true });   // skips both
this.panel.minimize();
```

A panel registered with `canClose: false` cannot be closed this way either, forced or not; one
with `canMinimize: false` ignores `minimize()`.

## Controls on the panel

There is no slot for your own buttons in a panel's tab or title bar. A panel's own controls
belong in the panel: wrap its content in `<ndd-panel-overlay>` and add a toolbar strip on any
edge, which widgets and content keep clear of ([chapter 7](07-panel-overlay.md)):

```html
<ndd-panel-overlay>
  <ndd-panel-toolbar position="top">
    <ndd-toolbar-button title="Save" (click)="save()">Save</ndd-toolbar-button>
  </ndd-panel-toolbar>
  <textarea class="notes"></textarea>
</ndd-panel-overlay>
```

(import `NddPanelOverlay`, `NddPanelToolbar` and `NddToolbarButton`). To put controls in the
application's toolbar or sidebar while the panel is active, publish a contribution
([chapter 9](09-contributions.md)).

## Panel context menu

```ts
import { injectPanelContextMenu } from 'angular-dockable-desktop';

injectPanelContextMenu(() => [
  { label: 'Save', action: () => this.save() },
  { label: 'Revert', action: () => this.revert(), disabled: !this.panel.dirty() },
]);
```

Your items are appended, behind a separator, to the standard menu for the panel's tab, floating
title bar and taskbar icon (Float / Minimize / Close; the items a panel's registration forbids
are absent). The getter is re-read each time the menu opens, so `disabled` and friends track
state. Call it in an injection context; it is disposed with the component. Menus are rendered by
`<ndd-context-menu>` ([chapter 1](01-getting-started.md#the-overlay-hosts)).

**A managed widget's own panel** (1.11.0) is the exception: its `titleMenu` items come first, and
there is no built-in Float, because those items are what move it. Its tab icon and its floating
title-bar icon open the same menu. See [Chapter 14](14-widgets-out-of-the-panel.md#things-to-know).
