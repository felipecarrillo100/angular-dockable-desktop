# 1. Getting started

## Install

```bash
npm install angular-dockable-desktop
```

Requires **Angular 22** (`@angular/core` and `@angular/common` `^22`, as peer dependencies).
The library has no other runtime dependencies.

It is zoneless-first, as a new Angular application is, and works unchanged on zone.js. It
server-renders and hydrates, so an application created with `--ssr` needs nothing extra.

## Set up

Three things: add the stylesheet, provide a workspace, and render it.

### 1. The stylesheet

In `angular.json`, list the library's stylesheet first in the build target's `styles`:

```json
"styles": ["angular-dockable-desktop/styles.css", "src/styles.css"]
```

> Forgetting the stylesheet renders the workspace as an unstyled box with no error, so the
> library checks for it when `<ndd-desktop>` first renders and logs an explicit message in
> development.

### 2. A panel

A panel is an ordinary standalone component:

```ts
// src/app/hello-panel.ts
import { Component } from '@angular/core';
import { injectPanel } from 'angular-dockable-desktop';

@Component({
  selector: 'app-hello-panel',
  template: `<p class="hello">Hello from a panel ({{ panel.id }})</p>`,
})
export class HelloPanel {
  protected readonly panel = injectPanel();
}
```

`injectPanel()` is optional. It is used here only to show the panel's instance id; a panel that
does not need to talk to its container needs nothing from the library ([chapter 3](03-panels.md)).

### 3. The workspace

Add `provideDockableDesktop()` to the application's providers, with the panel catalogue:

```ts
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideDockableDesktop } from 'angular-dockable-desktop';
import { HelloPanel } from './hello-panel';

export const appConfig: ApplicationConfig = {
  providers: [
    // …the providers `ng new` generated…
    provideDockableDesktop({ panels: { hello: { component: HelloPanel, defaultOptions: { title: 'Hello' } } } }),
  ],
};
```

`provideDockableDesktop(config)` creates one `Workspace` for that injector and disposes it with
the injector. `Workspace` is its own DI token, so `inject(Workspace)` reaches it from any
component, directive or service below. `injectWorkspace()` does the same, but throws an error
that names `provideDockableDesktop` instead of a bare `NullInjectorError` when nothing was
provided.

### 4. Render it

```ts
// src/app/app.ts
import { Component, inject } from '@angular/core';
import { NddDesktop, Workspace } from 'angular-dockable-desktop';

@Component({
  selector: 'app-root',
  imports: [NddDesktop],
  template: `<ndd-desktop class="ndd-fill-viewport" />`,
})
export class App {
  constructor() {
    inject(Workspace).openPanel('hello-1', 'hello');
  }
}
```

Run `ng serve` and the workspace fills the window with one tab, "Hello".

## The overlay hosts

`<ndd-desktop>` is the workspace. Four more components are hosts for chrome that must sit above
it; add each once, when you use its feature. Where they sit in the template does not matter.

```ts
import { Component } from '@angular/core';
import { NddContextMenu, NddDesktop, NddModals, NddSidePanels, NddToasts } from 'angular-dockable-desktop';

@Component({
  selector: 'app-root',
  imports: [NddDesktop, NddContextMenu, NddModals, NddSidePanels, NddToasts],
  template: `
    <ndd-desktop class="ndd-fill-viewport" />
    <ndd-context-menu />
    <ndd-modals />
    <ndd-side-panels />
    <ndd-toasts />
  `,
})
export class App {}
```

Two of them matter even if you never open a modal or a menu yourself:

- `<ndd-context-menu>` renders **every** context menu, including the library's own right-click
  menu on tabs, window title bars and taskbar icons. Without it, right-clicking does nothing.
- `<ndd-modals>` renders the built-in unsaved-changes question. Without it, closing a dirty
  panel is refused rather than silently discarding its changes.

Nothing is registered globally: you import the components you use, so a build that never
mentions `<ndd-toasts>` does not carry it.

## Height matters

`<ndd-desktop>` fills its parent. In CSS, `height: 100%` only resolves if every ancestor has a
real height — if any one of them is `height: auto` (the default for a `<div>`, and for a custom
element such as `app-root`), the chain breaks, the workspace collapses to zero pixels and
appears invisible.

The library does not style your page. Either give the workspace's container a real height
(`100vh`, or `flex: 1; min-height: 0` inside a flex column), or use the opt-in utility class
`ndd-fill-viewport` (`height: 100vh; overflow: hidden`), which works on `<ndd-desktop>` itself
or on your own container. In development the library detects a zero-height workspace and tells
you which ancestor broke the chain.

## Open a panel

From a component:

```ts
import { Component, inject } from '@angular/core';
import { Workspace } from 'angular-dockable-desktop';

@Component({
  selector: 'app-open-hello',
  template: `<button type="button" (click)="open()">Open hello</button>`,
})
export class OpenHello {
  private readonly ws = inject(Workspace);

  protected open(): void {
    this.ws.openPanel('hello-2', 'hello');
  }
}
```

A service, a guard or a resolver injects `Workspace` the same way. The workspace is live the
moment it is created: `openPanel()` works before `<ndd-desktop>` has rendered, and the panel
appears when it does.

To drive it from code outside dependency injection altogether, create it at module scope and
hand that instance to the providers:

```ts
// src/app/workspace.ts
import { createWorkspace } from 'angular-dockable-desktop';
import { HelloPanel } from './hello-panel';

export const workspace = createWorkspace({ panels: { hello: { component: HelloPanel } } });

// src/app/app.config.ts — providers: [provideDockableDesktop(workspace)]
// anywhere: workspace.openPanel('hello-1', 'hello');
```

You then own its lifetime (`workspace.dispose()`). Under server-side rendering, prefer
`provideDockableDesktop(config)`: a module-scope workspace is one object shared by every request
the server renders.

`'hello-1'` is the *instance* id — unique per open panel. `'hello'` is the *component* key from
the catalogue. Opening an id that is already open focuses it instead of duplicating it.

## Next

- [Core concepts](02-concepts.md) — the vocabulary: panels, leaves, the grid, the active panel
- [Panels](03-panels.md) — writing a panel that talks back to its container
- [Layout, docking and floating](04-layout.md) — what users do with the mouse, and the API for it
