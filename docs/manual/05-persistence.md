# 5. Saving and restoring layouts

## The basics

```ts
import { Component } from '@angular/core';
import { injectWorkspace } from 'angular-dockable-desktop';

@Component({ selector: 'app-layout-menu', template: '…' })
export class LayoutMenu {
  private readonly ws = injectWorkspace();

  save(): void {
    localStorage.setItem('layout', this.ws.saveLayout());     // a JSON string
  }

  restore(): void {
    const saved = localStorage.getItem('layout');
    if (saved && !this.ws.loadLayout(saved)) console.warn('That layout could not be used');
  }
}
```

`saveLayout()` returns a string; `loadLayout(json)` returns `true` when it applied the layout
and `false` when it did not. `inject(Workspace)` works exactly as `injectWorkspace()` does; the
latter only adds a clearer error when nothing is provided.

To restore on startup instead, before anything renders, pass the saved string as
`initialState`:

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideDockableDesktop } from 'angular-dockable-desktop';

bootstrapApplication(App, {
  providers: [
    provideDockableDesktop({
      panels: { /* … */ },
      initialState: localStorage.getItem('layout'),   // null is fine
    }),
  ],
});
```

The same option exists on `createWorkspace(config)`, for a workspace made at module scope. If
the application is server-rendered, read `localStorage` only in the browser: `initialState`
is read once, when the workspace is created.

`loadLayout` replaces the entire workspace: panels not in the snapshot are closed. It returns
`false`, and leaves the current layout untouched, for a string that is not JSON, for a value
that is not an object, and for an object with no `gridRoot`. It never throws. One case is
looser than that: an object that has a `gridRoot` but lacks the `floating`, `minimized` or
`panels` lists is read as an *empty* layout, and `loadLayout` returns `true` having cleared the
workspace. Only pass it strings that `saveLayout()` (in this library or a sibling, below)
produced. A bad `initialState` never throws either: the workspace starts empty, with a
development warning when the string was not JSON.

A panel that survives a `loadLayout` under the same id and registry key is **not re-created**:
its component instance stays, and any saved `props` that differ are applied to its inputs with
`setInput`. Derive editable state from inputs with `linkedSignal` (as the demo's editor does)
and a restore reaches it; copy an input into a plain field once and it will not.

## Autosave

```ts
constructor() {
  const ws = injectWorkspace();
  ws.subscribe('layout:changed', () => localStorage.setItem('layout', ws.saveLayout()));
}
```

`layout:changed` fires for anything `saveLayout()` would capture: opening, closing, minimising,
restoring, docking, floating, reordering, resizing a split, and `loadLayout` itself. Called in
a constructor, the subscription is disposed with the component; outside an injection context,
keep the returned function and call it yourself.

It does **not** fire when an `onSaveState` provider's value changes (below): that is a pull,
and nothing can observe it changing. If that state matters, save on your own trigger too.

## What is saved

The grid tree, floating window rects, z-order and anchors, the minimised list, per-panel
metadata (registry key, title, state, the leaf or rect it came from, dirty flag, `props`), and
which panel was active.

`props` is the family's name for per-panel data. In ndd you supply it as
`openPanel(id, key, { inputs })`; it is saved under `props`, and on restore each key the
component declares as an input (by public name or alias) is applied with `setInput`. Keys the
component does not declare are skipped silently, so a layout written by another build or
another library with extra props never throws `NG0303`. `panelId` is never taken from props.

A saved panel whose registry key is not registered in this application renders a small
"Unregistered panel" placeholder rather than failing, typically after loading a layout saved
by a build with more panel types.

## What cannot be saved: non-serialisable inputs

`inputs` accept anything, but only JSON-serialisable values survive a save. A function, a
class instance, a `Map`, a `Set`, a `RegExp` or a DOM node cannot be restored from JSON, and
neither can Angular's own live values: a component class and a signal (`signal()`, `input()`,
`computed()`) are functions; `TemplateRef`, `ElementRef` and `Injector` are class instances. A
panel carrying one is **excluded from that snapshot**: pruned from the grid, floating and
minimised lists too, so a restore never references a panel it cannot recreate.

The panel keeps working on screen. It simply will not come back after the next
`loadLayout()`.

This is deliberately not silent:

```ts
ws.subscribe('layout:panels-excluded', ({ panels }) => {
  console.warn('Not saved:', panels.map(p => p.id));
});
```

Check ahead of time if you prefer:

```ts
import { isSerializable } from 'angular-dockable-desktop';

if (!isSerializable(myInputs)) { /* pass an id instead of the object */ }
```

The usual fix is to pass an identifier in `inputs` and look the live object up inside the
panel, from a service.

> `Date` is accepted, matching `JSON.stringify`. It restores as an ISO string, not a `Date`.

## Capturing state that changes after opening

A panel's open-time inputs cannot describe what the user has done since. `onSaveState`
contributes the current value instead:

```ts
import { Component, input, linkedSignal } from '@angular/core';
import { injectPanel } from 'angular-dockable-desktop';

@Component({ selector: 'app-notes-panel', template: '…' })
export class NotesPanel {
  readonly content = input<string | undefined>(undefined);
  protected readonly text = linkedSignal(() => this.content() ?? '');

  constructor() {
    injectPanel().onSaveState(() => ({ content: this.text() }));
  }
}
```

The provider is pulled fresh on every `saveLayout()` and re-checked for serialisability each
time, since a panel's serialisability can change over its lifetime. What it returns **replaces**
the panel's saved `props` (it is not merged with the open-time inputs), and on restore it comes
back through the same inputs, which is why the example names the key after the `content`
input. Return `undefined` to fall back to the open-time inputs. The provider must be
synchronous, and it is unregistered with the component that called `injectPanel()`.

## Which panel is active after a restore

Resolved in this order:

1. the snapshot's own `activePanelId`, if that panel is still visible in the restored layout;
2. otherwise the selected tab of the first leaf in the grid, depth-first;
3. otherwise the frontmost floating window, so a float-only layout does not restore with
   nothing active;
4. otherwise `null`.

A minimised panel is never chosen: it is not on screen, even though it is still running. A
stale `activePanelId` is ignored with a development warning. The same rule holds during normal
use: closing or minimising the active panel moves `activePanelId()` to whatever became visible
in its place. A restore that changes the active panel publishes `panel:activated`.

## Layout repair

Two faults could be written into saved layouts by earlier versions of the family: a lone docked
panel dropped onto its own group left rdd with the panel listed in **two** groups and vdd with
it in **none**, and `saveLayout()` stored the result. Both are healed on read, by
`initialState` and `loadLayout` alike, with nothing asked of the application:

- a panel listed in more than one group is kept in the first, depth-first; a group left empty
  is removed (unless it carries `keepOnEmpty`), and the split sizes around it are
  renormalised;
- a panel the layout calls docked but that no group lists is put back into the first group.

In development the repairs are reported in one warning. The repair changes only what is read,
never what `saveLayout()` writes, so saving again from the repaired session stores the
corrected layout. A healthy layout is returned untouched.

Reading also migrates floating windows from the pre-anchor format, which stored two booleans
(`stickyRight`, `stickyBottom`) instead of a corner, exactly as rdd does.

## Compatibility with react-dockable-desktop and vue-dockable-desktop

The format is the family's shared one at `version: 2`, **byte for byte**, in every direction:
a layout saved by react-dockable-desktop (6.2.0 onwards) or vue-dockable-desktop loads here,
and one saved here loads there. If you are moving an application to Angular, your users keep
the workspaces they arranged.

This is a tested guarantee (ADR 0008), not a coincidence of shared ancestry:

- the ten rdd 6.2.0 fixtures load and re-save identically;
- twelve real gesture sequences driven against vdd and ndd in the same viewport produce equal
  layouts;
- 34 layouts are loaded into both vdd and ndd and re-saved: the two saves are the same string,
  each library re-saves the other's output unchanged, and a second round trip changes nothing.

The one thing to know: **ndd does not persist inner floating-widget placement**
([chapter 7](07-panel-overlay.md)), because neither rdd nor vdd does, and adding a field
would break the guarantee. Persist widgets yourself through `[(placement)]`.

See also: [chapter 3](03-panels.md) for `injectPanel()`, [chapter 4](04-layout.md) for what
the grid tree holds, [chapter 12](12-migrating.md) for moving an application across.
