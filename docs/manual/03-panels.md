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
      disableLivePreview: false,      // taskbar hover shows a letter tile instead
      preserveScroll: true,           // restore scroll offsets after a move
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

> Whether `inputs` survive `saveLayout()` depends on whether they are JSON-serialisable. See
> [chapter 5](05-persistence.md); it is a runtime fact, not a type-level guarantee.

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

`setTitle()` updates the tab, the window title bar and the taskbar icon. `setIcon()` takes effect
only in a modal or side panel; in the workspace a panel's icon is its registered one, and the
call logs a development warning.

The actions run untracked, so `effect(() => this.panel.setTitle(this.name()))` is safe: the
effect depends on `name` and nothing else. Outside any container — a unit test, a story, a route
— the signals describe a `'standalone'` panel and the actions do nothing but log a development
warning, so the component renders on its own without special-casing.

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
