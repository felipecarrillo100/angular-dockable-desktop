# angular-dockable-desktop — users manual

A window manager and dockable layout engine for Angular 22. Fluid grid splits, tabbed groups,
floating resizable windows, a taskbar, sidebars and toolbars, side drawers, modals, toasts,
context menus — and panels that keep their state through all of it.

Every chapter was written against the **shipped** API. Two standing gates keep it that way:
`docs-api` rejects any code block that imports a name the package does not export or uses an
`<ndd-…>` element no component declares, and `api-surface` rejects any export added or removed
without being recorded. The M15 gate also checks that the API reference names every export and
that the theming chapter's token tables match the stylesheet in both directions.

## Contents

| | Chapter |
|---|---|
| 1 | [Getting started](01-getting-started.md) |
| 2 | [Core concepts](02-concepts.md) |
| 3 | [Panels](03-panels.md) |
| 4 | [Layout, docking and floating](04-layout.md) |
| 5 | [Saving and restoring layouts](05-persistence.md) |
| 6 | [Sidebar and toolbar](06-sidebar-toolbar.md) |
| 7 | [Inside a panel: overlay toolbars and floating widgets](07-panel-overlay.md) |
| 8 | [Modals, side panels, toasts and context menus](08-overlays.md) |
| 9 | [Panel contributions](09-contributions.md) |
| 10 | [Theming and skins](10-theming.md) |
| 11 | [Internationalisation](11-i18n.md) |
| 12 | [Coming from react-dockable-desktop or vue-dockable-desktop](12-migrating.md) |
| 13 | [API reference](13-api-reference.md) |

## The one thing to know first

Panels are **created once and never destroyed** while open. Dragging a panel from a tab into a
floating window, minimising it to the taskbar and restoring it does not re-create the component:
its DOM is moved. A map keeps its WebGL context, an editor keeps its undo history, a video keeps
playing, and the component's signals, effects and injected services are simply still there.

Two things the browser resets when a subtree is detached — scroll offsets and focus — the library
saves and restores explicitly. See [chapter 2](02-concepts.md) for the exact list.

Everything else in this manual follows from that.
