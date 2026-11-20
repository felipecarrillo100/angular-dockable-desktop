# 14. Widgets out of the panel

A floating widget opened with [`injectFloatingWidgets()`](07-panel-overlay.md#widgets-from-data)
lives inside its panel. From 1.11.0 (react-dockable-desktop 7.11.0) it can also **leave** the panel:
dock beside it, become a tab in its group, or float as a window of its own. It is still the same
widget, owned by the same panel: its component is never re-created, keeps its state, and keeps
every injection from its owner.

Typical uses: a results table that started as a small widget over a map, docked below it to see
more rows; a chart pulled out of a dashboard panel to sit next to another one; a legend floated
out of the way.

## In one example

```ts
// results-button.ts: placed inside the panel's <ndd-panel-overlay>, in one of its toolbars
import { Component } from '@angular/core';
import { NddToolbarButton, injectFloatingWidgets } from 'angular-dockable-desktop';
import type { ManagedWidget } from 'angular-dockable-desktop';
import { ResultsTable } from './results-table';

const RESULTS: ManagedWidget = {
  title: 'Results',
  component: ResultsTable,
  anchor: 'bottom-left', width: 360, height: 220,
  canDock: true,                         // the user may dock it or make it a tab
  canFloat: true,                        // the user may float it
  titleMenu: w => w.location === 'panel'
    ? [
        { label: 'Dock below', action: () => w.move({ to: 'docked', position: 'bottom', size: 0.35 }) },
        { label: 'Open as a tab', action: () => w.move({ to: 'tabbed' }) },
      ]
    : [{ label: 'Back into the panel', action: () => w.move({ to: 'panel' }) }],
};

@Component({
  selector: 'app-results-button',
  imports: [NddToolbarButton],
  template: `<ndd-toolbar-button title="Results" (click)="widgets.open('results', results)">▤</ndd-toolbar-button>`,
})
export class ResultsButton {
  protected readonly widgets = injectFloatingWidgets();
  protected readonly results = RESULTS;
}
```

`injectFloatingWidgets()` needs the overlay's injector, which is why the button is a component of
its own inside the overlay ([Chapter 7](07-panel-overlay.md#call-it-from-a-component-inside-the-overlay)).

The widget opens in the panel as usual. Its title icon is now a button with your menu. Out of the
panel it is a workspace panel of its own, and the same items lead its menus. Its icon opens them
there too:

| Where the widget is | Its menu opens from |
|---|---|
| In the panel | The title icon, a button (a menu glyph when the widget has no icon); Enter or Space opens it on the first item |
| Docked or a tab | The tab's icon (a menu glyph when it has none), or a right-click on the tab (the menu key from the keyboard) |
| Floating | The title bar's icon, or its ⋮ button: both only with a `titleMenu` |

The tab's and the title bar's icons are pointer affordances, `aria-hidden` like the tab's ×: from
the keyboard, use the tab's menu key or the window's ⋮ button.

## Moving it: `move()` and `location()`

```ts
widgets.move('results', { to: 'docked', position: 'bottom', size: 0.35 }); // beside its owner panel
widgets.move('results', { to: 'tabbed' });                                 // a tab in the owner's group
widgets.move('results', { to: 'floating', rect: { x: 80, y: 60, width: 420, height: 300 } });
widgets.move('results', { to: 'floating' });                               // where it is on screen now, at its size
widgets.move('results', { to: 'panel' });                                  // back where it last was in the panel

widgets.location('results'); // 'panel' | 'docked' | 'tabbed' | 'floating' | 'minimized' | null
```

| Target (`WidgetTarget`) | Where |
|---|---|
| `{ to: 'docked', position, size? }` | A new group split off the **owner's** group on that side (`'top'`, `'bottom'`, `'left'`, `'right'`). `size` is its share, 0.1–0.9; by default the workspace's `defaultSplitRatio` |
| `{ to: 'tabbed' }` | A tab in the owner's group |
| `{ to: 'floating', rect? }` | A floating window at `rect` (workspace pixels), never cascaded. Without `rect`: where the widget is on screen, at its size (its frame in the panel, or its own panel out of it; a floating one stays where it is) |
| `{ to: 'panel' }` | Back into the panel, exactly where it was before it left |

The owner panel is always the reference. `location()` reads signals, so it is reactive in a
`computed()`, an `effect()` or a template; inside the widget's content, `injectWidget().location`
(below) is the same value as a signal. `move()` never throws; it returns a `MoveResult`, and a
refusal changes nothing:

| `reason` | When |
|---|---|
| `not-open` | No widget with that id is open in this overlay |
| `owner-not-docked` | `docked` and `tabbed` need the owner in the grid; a floating or minimised owner can still float the widget |
| `owner-not-kept-alive` | The owner's panel type has `keepAlive: false`, so its component is destroyed while hidden and would take the widget with it |
| `no-workspace` | The overlay isn't in a workspace panel: it is in a modal, a side panel, or outside any `<ndd-desktop>` |

`canDock` and `canFloat` (both `false` by default) restrict **the user** only: their drags and
drops of the widget's panel, together with your workspace's `canDrop`
([Chapter 4](04-layout.md#controlling-where-users-can-move-panels)). Your own `move()` calls always
work. Call `open()` again with new values to change them while the widget is open.

## What stays the same

- **Nothing is re-created.** `open()` creates the widget's component at once, on an element of
  its own (`div.ndd-panel-float__content`), and attaches it to the application, as the workspace
  does for its panels. Whatever shows the widget (its frame in the panel, its own panel out of it)
  only moves that element. Its state, scroll offsets, a canvas and its WebGL context all survive.
- **`injectPanel()` is still the owner.** The component is created with the overlay's injector, so
  every injection resolves as before: `injectPanel()` is the owner panel's `PanelRef`, and the
  owner's providers, the workspace and your services are all there. Content bound to its panel (a
  table bound to its map) keeps working wherever the widget is.
- **Its title and icon** become the panel's, and follow a re-open with new ones.

One thing it can no longer inject: the frame component around it (`NddFloatingWidget`). Before
1.11.0 a managed widget's content was rendered inside its frame, and so saw the frame's injector;
now the frame can go away while the content stays, so nothing of the frame's is provided.

## Who closes what

| Event | Result |
|---|---|
| The user closes the widget's panel (the × on its tab or title bar, the menu's Close) | The widget **closes** |
| `closePanel(id)` on that panel, `close(id)`, `closeAll()` | The widget closes |
| The owner panel closes | Its widgets close, wherever they are |
| The owner's tab is hidden, or the owner is minimised | Widgets out of the panel stay out and on screen |
| `loadLayout()` | The widget goes back into its panel (a layout never holds a widget's panel) |

Going back into the panel is always explicit: your own item calling `move({ to: 'panel' })`.

## The widget's own side: `injectWidget()`

Inside a widget's content, `injectWidget()` tells it about the widget; it returns `null` elsewhere.
Each widget's component is created with a child injector that provides it, so anything created
inside the content (its children, a service it provides) injects it too.

```ts
// results-table.ts
import { Component, computed, viewChild } from '@angular/core';
import { injectWidget } from 'angular-dockable-desktop';
import { Grid } from './grid';

@Component({
  selector: 'app-results-table',
  imports: [Grid],
  template: `<app-grid [compact]="compact()" />`,
})
export class ResultsTable {
  private readonly widget = injectWidget();
  private readonly grid = viewChild.required(Grid);
  protected readonly compact = computed(() => this.widget?.location() === 'panel');

  constructor() {
    // Called in an injection context, both are also unsubscribed when this component is destroyed.
    this.widget?.onWillMove(() => this.grid().saveScrollAnchor()); // before the element moves
    this.widget?.onMoved(() => this.grid().resize());              // after, at its new size
  }
}
```

| Field | |
|---|---|
| `id`, `ownerPanelId` | The widget's id, and its owner panel's (`null` when the overlay isn't in a workspace panel). Plain values: they never change |
| `panelId` | A `Signal<string \| null>`: its own panel's id while it is out of its panel, for workspace calls such as `updatePanelTitle`; `null` in the panel |
| `location` | A `Signal<WidgetLocation>`: where it is now |
| `onWillMove(cb)` | Just before the element moves to another container: in or out of the panel, between docked, tabbed and floating, minimised or restored, by your code, the user, or a layout load |
| `onMoved(cb)` | Once it is in its new container and has its new size (when it has none, as when minimised, on the next frames) |

As in `injectPanel()`, what describes state is a signal and what is fixed for the widget's life is
a plain value. Neither callback runs for a close, a refused move, or `move({ to: 'panel' })` while
the widget is already in the panel. Every other move calls both, once each, floating to floating
included; two steps of one user gesture in the same task are one move. Both return their
unsubscribe function, and are also unsubscribed when the component (or other injection context)
that called `injectWidget()` is destroyed, so most content never needs it.

During **a user's** move (a drag, the taskbar), `location()` read inside `onWillMove` already
shows where the widget is going: the workspace's state has changed, the element has not moved
yet. During your own `move()` it still shows where it was. Read the new location in `onMoved`.

## Content with its own view

A move changes the size of the widget's content. Content with a view of its own (a map, a chart, a
canvas you pan) needs to know what to keep. That depends on what the view shows:

- **A place** (a map, a canvas you pan and zoom): keep the camera across the move. Save it in
  `onWillMove` and restore it in `onMoved`, when the new size is known. A bigger panel shows more
  around the same centre.
- **A range** (a chart, a timeline, a profile): keep the visible range on **every** size change, in
  the chart itself, not in the move hooks. A splitter drag or a resized float changes the size just
  as a move does. Record the range whenever the user pans or zooms at an unchanged size; on a new
  size, set the camera from that range: its centre at the view's centre, and on each axis a scale of
  pixels ÷ range. A move then needs no hook at all.

```ts
// A map: keep the camera across a move.
let saved: { center: L.LatLng; zoom: number } | null = null;
this.widget?.onWillMove(() => { saved = this.map && { center: this.map.getCenter(), zoom: this.map.getZoom() }; });
this.widget?.onMoved(() => { this.map?.invalidateSize(); if (saved) this.map?.setView(saved.center, saved.zoom); });
```

```ts
// A chart that keeps its visible range on every size change: moves included, no hooks needed.
constructor() {
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    const view = this.chart();
    let range: Range | null = null;
    let size = { w: view.width, h: view.height };
    const offCamera = view.onCameraChange(() => {       // the user panned or zoomed
      if (view.width === size.w && view.height === size.h) range = view.visibleRange();
    });
    const ro = new ResizeObserver(() => {                // a move, a splitter, a float's edge
      size = { w: view.width, h: view.height };
      if (range) view.setCamera(cameraFor(range, size.w, size.h));   // centre, and pixels ÷ range per axis
    });
    ro.observe(view.element);
    destroyRef.onDestroy(() => { offCamera(); ro.disconnect(); });
  });
}
```

Prefer a camera computed from the range over a "fit to bounds": a fit usually adds a margin, so the
range would widen a little on every move.

**A `<video>`** needs nothing: every move keeps it playing, at its position, without a reload. Its
element is moved, not re-created. (An `<iframe>` is different; see `preserveEmbeds` below.)

## Saving and restoring: `placement()`

```ts
const saved = widgets.placement('results');      // plain JSON: store it with your panel's state
// after a reload (`placement()` gives null for a widget that isn't open):
widgets.open('results', { ...RESULTS, placement: saved ?? undefined });
```

A `WidgetPlacement` is opaque, versioned JSON, the same in the React and Vue libraries, so a saved
value moves between them. It records where the widget is in the panel (corner, stretch, docked or
free, size), or out of it (docked, tabbed or floating) together with where it goes back to.

- A free position is kept as an offset from the panel corner it was nearest, so "16px in from the
  bottom right" stays true on a bigger or smaller panel, and mirrors in RTL.
- `placement` applies on the first open of an id only, as `anchor` does.
- A value this version can't read falls back to the config's `anchor`, size and `stretch`. A valid
  one is clamped into the panel as it is now.
- In a panel that has no size yet (a background tab), a free position waits until it is shown.
- A placement out of the panel moves the widget out after it opens; if that is refused (the owner
  isn't docked), it stays in the panel.
- For a minimised widget, it records where the widget was before it was minimised, as the
  workspace noted it then.

`placement()` is not reactive: read it when you save. The workspace's own `saveLayout()` never
includes a widget's panel: restore the widgets from your panel, with their placements, once the
layout is loaded. To keep a whole set, store each open id with its placement:

```ts
// On unload: which widgets are open, and where each one is.
localStorage.setItem('open-feeds', JSON.stringify(
  widgets.openIds().map(id => ({ id, placement: widgets.placement(id) })),
));
```

## Iframes and media: `preserveEmbeds`

An element that is moved in the page is normally removed and re-inserted, and an `<iframe>` in it
reloads. Set `preserveEmbeds: true` on the widget and the library moves its content with
`moveBefore()`, which keeps the embedded document alive. (On a panel type's `defaultOptions`, the
same option covers that panel's own moves; see
[Chapter 3](03-panels.md#keeping-an-iframe-alive-preserveembeds).)

```ts
widgets.open('preview', { title: 'Preview', component: EmbedFrame, inputs: { src: url }, preserveEmbeds: true });
```

`moveBefore()` is in Chrome and Edge 133+ and Firefox 144+. In Safari the iframe reloads, as it does
without the option. A widget with it also moves its owner panel's element this way, since that
element carries the widget.

How ndd keeps it, and its one limit: Angular removes a destroyed view's DOM before any destroy hook
runs, so a frame, a group or a window that a render destroys would take the element out of the
document with it. Instead, a state change that can destroy one parks the marked elements in a
hidden, connected store first (after the action's own writes, before change detection), and puts
them back in their new place after the render, both with `moveBefore()`. The one case it can't
cover is an application that calls `ApplicationRef.tick()` synchronously in the same task as the
move: that render runs before the park, and the iframe reloads.

## Things to know

- **Its panel's id** is `'<ownerId>/<widgetId>'`. It appears in `getOpenPanelIds()`, the taskbar
  and the panel events (`panel:opened`, `panel:closed`), because the user handles it like a panel.
  Its component key is the reserved `'ndd:widget'`, and `PanelInfo.owner` (a `PanelOwner`,
  `{ panelId, widgetId }`) says whose it is. Keys starting with `ndd:` are the library's: don't
  register a panel type under one.
- **Moving it with `move()` from one place out of the panel to another** replaces its panel:
  listeners see `panel:closed` then `panel:opened` for that id. The content is untouched. A user's
  drag moves the same panel, with no such events.
- **Its menus.** The tab's menu is your `titleMenu` items, then Minimize and Close; the floating ⋮
  menu is your items, then Close (the title bar has its own minimise button). The built-in Float
  isn't offered: your items replace it. A re-open that adds a `titleMenu` shows the menu at once,
  wherever the widget is.
- **Its tab** always has a menu icon, the widget's icon or a menu glyph when it has none: ndd's tabs
  have no fallback icon. The floating title bar shows one only with a `titleMenu`.
- **Its title** is the widget's `title`, and a re-open with a new one updates it wherever the widget
  is. That is the place for a live title (`'Table · Map 1'`). A title set on its panel with
  `updatePanelTitle` stays across moves out of the panel, until the next re-open or the way back.
- **Its inputs:** `updatePanelProps` does nothing on a widget's panel; it has no inputs of its own.
  Re-open the widget with new `inputs` instead.
- **Its size** in the panel is seeded once from `width` and `height`, on the first open of an id;
  a re-open with other values leaves it as it is, as with `anchor`.
- **With your own `nddTabContent`,** the tab shows your content, so its icon opens nothing; the
  right-click and the menu key still do. The template's `component` is `'ndd:widget'`.
- **Panel contributions:** while a widget's panel is the active one, `injectActiveContribution()`
  gives its owner's contribution, so the owner's toolbar items and sidebar tabs stay while the user
  works in the widget.
- **CSS:** a managed widget's content sits in `div.ndd-panel-float__content` inside
  `.ndd-panel-float__body`, so a selector on the body's direct child (`.ndd-panel-float__body > …`)
  no longer matches it. Out of the panel, its panel's body is `.ndd-hosted-widget`. See
  [Chapter 10](10-theming.md#styling-by-state-and-by-panel-kind).

## API summary

| | |
|---|---|
| `injectFloatingWidgets().move(id, to)` | `WidgetTarget` → `MoveResult` |
| `injectFloatingWidgets().location(id)` | `WidgetLocation \| null`, reactive |
| `injectFloatingWidgets().placement(id)` | `WidgetPlacement \| null` |
| `ManagedWidget.canDock`, `.canFloat` | The user's rules out of the panel. Default `false` |
| `ManagedWidget.titleMenu(w)` | `(w: WidgetMenuContext) => ContextMenuItem[]`; `w` is `{ id, location, canDock, canFloat, move, close }` |
| `ManagedWidget.placement` | Open at a saved `WidgetPlacement` |
| `ManagedWidget.preserveEmbeds` | Keep iframes alive across moves |
| `injectWidget()` | `WidgetHandle \| null`: `{ id, ownerPanelId, panelId, location, onWillMove, onMoved }` |
| `PanelInfo.owner` | `PanelOwner`: set on a widget's own panel |

See also: [Chapter 7](07-panel-overlay.md) (the overlay and its widgets), [Chapter 4](04-layout.md)
(`focusPanel(id, { restore })`, events), [Chapter 3](03-panels.md) (`updatePanelProps`,
`preserveEmbeds`).

## Coming from react-dockable-desktop or vue-dockable-desktop

| rdd 7.11.0 | vdd 1.13.0 | ndd 1.11.0 |
|---|---|---|
| `useFloatingWidgets().move()` / `.location()` / `.placement()` | the same | `injectFloatingWidgets()`, the same three; `location()` is reactive |
| `ManagedWidget.content: ReactNode` | `component` + `props` | `component` + `inputs`, as for every managed widget |
| `useWidget()`; `location`, `panelId` re-render on change | `useWidget()`; `ComputedRef`s | `injectWidget()`; `Signal`s |
| `useEffect(() => widget.onMoved(cb), [])` | `widget?.onMoved(cb)` in `setup` | `this.widget?.onMoved(cb)` in an injection context: unsubscribed through its `DestroyRef` |
| `'rdd:widget'`, `div.rdd-panel-float__content`, `.rdd-hosted-widget` | `'vdd:widget'`, `div.vdd-panel-float__content`, `.vdd-hosted-widget` | `'ndd:widget'`, `div.ndd-panel-float__content`, `.ndd-hosted-widget` |
| `renderTabContent` | the `#tab-content` slot | `<ng-template nddTabContent>` |
| `no-workspace`, also outside a `DockableDesktopProvider` | a modal, a side panel, or outside any panel | a modal, a side panel, or outside any `<ndd-desktop>` |

Where ndd differs in behaviour, none of it changing what an app can do, is listed in
[PARITY.md §4.4](../PARITY.md#44-widgets-out-of-the-panel-1110).
