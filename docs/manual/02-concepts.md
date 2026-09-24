# 2. Core concepts

Seven words carry most of the meaning.

## Panel

A unit of content the user can move around: a map, an editor, a property sheet. A panel has

- a **component key** — what kind of panel it is (`'map'`), registered once in the catalogue;
- an **instance id** — which one it is (`'map-1'`), unique while open;
- a **state** — `'docked'`, `'floating'` or `'minimized'`.

Registering a component key once and opening many instances of it is the normal pattern. The
component behind a key is any standalone Angular component; it can be loaded eagerly
(`component`) or on first use (`loadComponent`, the router's shape).

## The grid

A tree. Two node types:

- a **branch** (`LayoutGridNode`) — splits its children horizontally or vertically, with
  relative `sizes` summing to 1;
- a **leaf** (`LayoutLeafNode`) — a tab group, holding an ordered list of panel ids and a
  selected one.

Dragging a panel onto another leaf's edge splits that leaf into a branch. Dragging onto its
centre adds a tab. Emptying a leaf removes it and collapses the branch, unless the leaf was
created with `keepOnEmpty`. An empty workspace is a single empty leaf, `group-default`.

## Floating windows

A panel can leave the grid entirely and become a free window with its own title bar, draggable,
resizable on eight edges, and stacked by z-order. A floating window can be **anchored** to one of
the four workspace corners, in which case windows sharing that corner stack with a gap instead
of overlapping. When the workspace shrinks, floating windows are clamped back into view.

## Minimised and the taskbar

A minimised panel leaves the layout and appears as an icon in the taskbar. It remembers where it
came from, so restoring returns it to the same leaf, or to the same floating rect. Hovering its
icon shows a **live** thumbnail — not a screenshot, the actual running panel, scaled.

The taskbar has three modes, set with `<ndd-desktop [taskbar]="…">`: `'always'` (the default),
`'compact'` (only when something is minimised), and `'autohide'` (an 8px peek strip that expands
on hover).

## Zero unmount

A minimised panel is off screen but **still running**. So is a panel in a background tab.
Nothing in this library destroys a panel's component until the panel is closed.

Each panel's component is created once, attached to `ApplicationRef` rather than to any view
inside the layout, and its element is *moved* between leaves, windows and the taskbar. No layout
component's lifetime can reach it, so moving a tab never runs its `ngOnDestroy` or constructor
again.

The consequence worth internalising: background panels keep their timers, effects and
subscriptions live. If a panel polls a server, it keeps polling while minimised unless you stop
it — and `injectPanel()` gives you `isMinimized` precisely so you can.

Because panels are attached to the application, change detection reaches them as it reaches any
other view, zoneless or on zone.js. Dependency injection still follows the tree: a panel can
inject anything provided on or above `<ndd-desktop>`.

### What survives, and what the library restores

Moving a panel's DOM keeps almost everything, but not quite everything — detaching a subtree
makes the browser reset two things. The library handles those itself:

| | |
|---|---|
| Component state, signals, effects, timers | survive — the component is never destroyed |
| WebGL / canvas contexts | survive |
| Media playback position | survives |
| `<input>` values, selection range, `<details open>` | survive |
| **Scroll offsets** | reset by the browser — **saved and restored by the library** |
| **Focus** | reset by the browser — **restored by the library**, but only when the panel becomes the active one, so it never steals your caret |
| `<iframe>` content | **reloads.** Nothing can prevent this; an iframe re-runs its document when re-parented |

ndd keeps the scroll and focus record current from live `scroll` and `focusin` events, rather
than reading it at the moment of a move, so it is right even when the element hosting a panel is
removed before the panel is moved out of it (PARITY N1).

Opt a panel out of scroll restoration with `defaultOptions.preserveScroll: false` if it manages
virtualised scrolling itself.

## The active panel

Exactly one panel is *active* — `activePanelId`. It is always a panel the user can actually see:
the selected tab of some leaf, or a floating window. Never a minimised one. Every action that
moves a panel ends by re-deciding it in one place, so it cannot go stale.

Active-ness drives three things:

1. focused chrome (the active tab and window are drawn differently);
2. `injectPanel().isActive()` inside the panel;
3. **panel contributions** — toolbar items and sidebar sections a panel publishes are surfaced
   only while it is active (see [chapter 9](09-contributions.md)).

That third point is why the library is strict about this: a contributed control bound to a
panel the user cannot see would look functional and act on the wrong thing.

## The workspace

The `Workspace` object, created by `provideDockableDesktop(config)` or by `createWorkspace()`.
It owns the state, the panel registry and the event bus. It is live from the moment it is
created, independent of any component, which is what makes it callable from services and from
code that runs before `<ndd-desktop>` renders.

Reach it with `inject(Workspace)` (or `injectWorkspace()`):

```ts
import { Component, computed, inject } from '@angular/core';
import { Workspace } from 'angular-dockable-desktop';

@Component({
  selector: 'app-status-bar',
  template: `{{ openCount() }} open · active: {{ active() ?? 'none' }}`,
})
export class StatusBar {
  private readonly ws = inject(Workspace);
  protected readonly openCount = computed(() => Object.keys(this.ws.panels()).length);
  protected readonly active = this.ws.activePanelId;
}
```

The state is **signals**. `ws.state()` is the whole of it, one immutable object replaced on
every change; the narrower signals — `gridRoot()`, `panels()`, `floating()`, `minimized()`,
`activePanelId()`, `draggedPanelId()`, `dir()`, `isRtl()`, `activeContribution()` — are
`computed` slices of it, so a template or `computed()` that reads `panels()` does not re-run
when only a floating window moves. In development the published state is deep-frozen: it is
read-only from the outside, and changes go through the actions.

Actions (`openPanel`, `floatPanel`, `saveLayout` …) are methods. Signals can be destructured
(`const { panels } = inject(Workspace)`); methods cannot, because they need their `this` — call
them on the workspace. Every read an action makes is untracked, so calling one from an
`effect()` never makes that effect depend on the whole store.

Because `provideDockableDesktop()` returns ordinary providers, it also works in a component's
`providers`, which is how two independent workspaces live on one page: each subtree injects its
own.

## Two layers of "floating"

A naming point that saves confusion later:

- a **floating window** is workspace-level — a panel detached from the grid;
- a **floating widget** (`<ndd-floating-widget>`) lives *inside* a single panel — a legend, an
  info card, a timeline strip, docked to that panel's corners.

They look similar and are unrelated. [Chapter 7](07-panel-overlay.md) covers widgets.
