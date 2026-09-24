# angular-dockable-desktop

A window manager and dockable layout engine for **Angular 22**. Fluid grid splits, tabbed
groups, floating resizable windows, a taskbar with live previews, zero-unmount state
preservation, sidebars and toolbars, side panels and modals, toasts, context menus, per-panel
overlays, internationalisation and RTL.

**[Live demo](https://felipecarrillo100.github.io/angular-dockable-desktop/)** &nbsp;|&nbsp; **[Users manual](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/manual/)** &nbsp;|&nbsp; **[Design decisions](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/decisions/)** &nbsp;|&nbsp;
**[Parity with the React and Vue versions](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/PARITY.md)** &nbsp;|&nbsp; **[Changelog](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/CHANGELOG.md)**

Written as a native Angular library — standalone components, signals, `input()` / `model()` /
`output()`, `inject()`, typed templates, zoneless-first — not as a transliteration of its
siblings [react-dockable-desktop](https://github.com/felipecarrillo100/react-dockable-desktop)
and [vue-dockable-desktop](https://github.com/felipecarrillo100/vue-dockable-desktop). It reads
and writes the **same serialised layout format** as both, byte for byte, so a layout saved by
any of the three loads in the others.

> **Versioning.** ndd follows its own semver. This release tracks **vue-dockable-desktop 1.1.1**
> and, through it, **react-dockable-desktop 6.3.1**, feature by feature in
> [docs/PARITY.md](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/PARITY.md).

## Install

```bash
npm install angular-dockable-desktop
```

Requires Angular 22 (`@angular/core` and `@angular/common` as peers). **No runtime
dependencies** beyond `tslib`, which the Angular packager declares for every library and every
Angular app already has — no CDK, no UI kit. Works zoneless (the default for a new
Angular app) and with zone.js, and server-renders and hydrates.

## Quick start

Add the stylesheet to `angular.json` (`projects.<app>.architect.build.options.styles`), first:

```json
"styles": ["angular-dockable-desktop/styles.css", "src/styles.css"]
```

A panel is any standalone component:

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

Register it where the application is configured:

```ts
// src/app/app.config.ts — add to `providers`
provideDockableDesktop({ panels: { hello: { component: HelloPanel, defaultOptions: { title: 'Hello' } } } }),
```

And render the desktop:

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

That exact code is what the release gate installs into a fresh `ng new --ssr --zoneless`
application, builds, prerenders, serves and hydrates.

`Workspace` is an ordinary injectable, so every action is a method on it, from any component or
service — and its state is signals:

```ts
import { computed, inject } from '@angular/core';
import { Workspace } from 'angular-dockable-desktop';

// In any component, directive or service:
const ws = inject(Workspace);
// openPanel(instanceId, panelKey, options?) — the id is yours, the key is from `panels`.
ws.openPanel('overview', 'hello', { title: 'Overview' });
ws.floatPanel('overview', { x: 80, y: 60, width: 480, height: 320 });
localStorage.setItem('layout', ws.saveLayout());
const open = computed(() => Object.keys(ws.panels()).length);
```

Mount `<ndd-context-menu />`, `<ndd-modals />`, `<ndd-side-panels />` and `<ndd-toasts />` once,
anywhere, for menus, the unsaved-changes question, drawers and notifications
([chapter 1](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/manual/01-getting-started.md)).

## Features

- **Split-docking grid** — drag a tab to any edge of a group to split it, to its centre to join
  it, or to a workspace edge for a full-width row; mouse, pen and touch
- **Floating windows** — eight-direction resize, maximise, minimise, and corner anchoring that
  survives resizes and RTL
- **Zero unmount** — a panel is created once and *moved*, never re-created, across docking,
  floating, tab switches and the taskbar; maps keep their WebGL context, editors their undo
  history, and scroll and focus are restored explicitly
- **Taskbar** with live previews — the thumbnail is the panel's own DOM, not a screenshot
- **Panel lifecycle** — `injectPanel()` signals for active, minimised, floating, size and dirty;
  close guards; `trackDirty()` for Signal Forms; an unsaved-changes question on close
- **Sidebar and toolbar** — primary and secondary sidebars and a workspace toolbar, bound with
  `[( )]`, with per-panel contributions that follow the active panel
- **Panel overlay** — toolbars on a panel's own edges and floating widgets inside it, opened
  declaratively or from data
- **Overlays** — a modal stack with `NddModalRef.afterClosed()`, side drawers, a confirm dialog,
  toasts callable from anywhere, and context menus with a typed custom template
- **Layout serialisation** — the whole workspace as one JSON string, byte-compatible with rdd
  and vdd, including each panel's own saved state
- **Theming** — seven skins plus your own, light and dark, 125 documented `--ndd-*` tokens; the
  library styles only its own DOM and coexists with Bootstrap, Tailwind and Angular Material
- **i18n and RTL** — every string goes through one `formatMessage` function; a signal-backed
  locale relabels live; `setDirection('rtl')` mirrors the whole workspace structurally
- **Accessible** — WAI-ARIA tabs, menus and dialogs, verified with axe-core; no change detection
  on idle pointer movement
- **Typed** — strict templates, typed template contexts, typed events

## Documentation

| | |
|---|---|
| [Live demo](https://felipecarrillo100.github.io/angular-dockable-desktop/) | Every capability in one application, published from `projects/demo` by GitHub Pages on each push to `main` |
| [`docs/manual/`](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/manual/) | The users manual — 13 chapters, starting with [Getting started](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/manual/01-getting-started.md) |
| [`docs/manual/12-migrating.md`](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/manual/12-migrating.md) | Coming from react-dockable-desktop or vue-dockable-desktop |
| [`docs/decisions/`](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/decisions/) | Architecture decision records |
| [`docs/PARITY.md`](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/PARITY.md) | The API map to vdd, the test map, and every deliberate divergence (D1–D16, N1–N17) |
| [`docs/PROGRESS.md`](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/PROGRESS.md) and [`docs/evidence/`](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/docs/evidence/) | One row and one written record per milestone gate |
| [`CHANGELOG.md`](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/CHANGELOG.md) | What changed |

## License

[MIT](https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/LICENSE)
