# 4. Layout, docking and floating

Most of this chapter is things your users do with the mouse. The API exists so you can do them
programmatically too — for a "reset layout" button, a workspace preset, or a test.

## What the user can do

- **Drag a tab** onto another leaf's top/bottom/left/right target to split it, or its centre to
  join that tab group. Drag within a tab bar to reorder.
- **Drag to a workspace edge** to create a full-width or full-height row/column.
- **Drag to a workspace corner** to float the panel anchored to that corner.
- **Drag anywhere else** to float it freely.
- **Resize** splits by dragging the divider; floating windows from any of eight edges.
- **Double-click a window title bar** to maximise it, or use its maximise button; the same
  gesture restores its size.
- **Minimise** to the taskbar; click the icon or its hover preview to restore.
- **Right-click** a tab, a window title bar or a taskbar icon for the panel's menu (rendered by
  `<ndd-context-menu>`). The menu follows the WAI-ARIA menu pattern: arrow keys, Home/End,
  submenus, Escape.
- **Press Delete** on a focused tab to close it, through the same close sequence as its ×.
- On **touch**: long-press (300ms) a tab or title bar to start a drag; long-press a taskbar icon
  for its context menu. Moving more than 8px cancels the press. The first tap on a taskbar icon
  opens its preview, a second restores.

Dropping a panel where it already is does nothing. A panel that is alone in its group, dropped
back onto that same group — any side, or the centre — asks for the layout it already has, and
the sole docked panel dropped on a workspace edge likewise already fills the workspace. Both are
no-ops rather than moves, in the drag and through the actions below.

RTL is handled throughout: drop zones, tab order and corner anchors mirror, and anchors are
stored logically (`'top-left'` means the inline-start corner), so a layout saved in one direction
restores correctly in the other. Set the direction with `provideDockableDesktop({ dir: 'rtl' })`,
or at run time with `ws.setDirection('rtl')`; read it with `ws.dir()` and `ws.isRtl()`.

## Programmatic equivalents

The actions are methods on the workspace. Call them on it — destructuring a method loses its
`this`:

```ts
const ws = inject(Workspace);

ws.floatPanel('map-1', { x: 100, y: 80, width: 520, height: 360 });
ws.floatPanel('map-1', undefined, 'bottom-right');        // float, pinned to a corner
ws.dockPanel('map-1');                                    // back to its last leaf
ws.dockPanel('map-1', 'group-default');                   // into a named leaf, as a tab
ws.dockPanelToGroup('map-1', 'group-default', 'right');   // split that leaf
ws.dockPanelToWorkspaceEdge('map-1', 'bottom');           // full-width row
ws.movePanelOrder('map-1', 'group-default', 0);           // first tab of that leaf
ws.maximizePanel('map-1');                                // toggle; floats a docked panel first
ws.minimizePanel('map-1');
ws.restorePanel('map-1');                                 // focuses it
ws.restorePanel('map-1', { focus: false });               // restores without stealing focus
ws.focusPanel('map-1');                                   // select its tab, or raise its window
ws.closeLeafGroup('console');                             // remove an empty leaf
ws.updateFloatingPosition('map-1', { x: 20, y: 20 });
```

Leaf ids are generated as the user splits the layout; read the current ones from
`ws.gridRoot()`. `dockPanelToGroup` and `movePanelOrder` ignore, with a development warning, a
leaf id that is no longer in the layout. `restorePanel` returns a panel to the leaf it was
minimised from; if that leaf has since gone, the panel floats instead (or, when it may not be
dragged, joins the first group). `ws.closePanel(id)` closes at once; `ws.requestClosePanel(id)`
is the close the chrome uses, asking the panel's guard and the unsaved-changes question first
([chapter 3](03-panels.md#unsaved-changes)).

`closeLeafGroup` is what the × on an empty group calls. It removes the leaf from the tree and
does not close the panels in it: close those first, or they are left open in no group (opening
such an id again docks it into the first group).

Queries: `ws.isOpen(id)`, `ws.getOpenPanelIds()` and `ws.findPanelId(component, dedupeKey)`.

## Split ratios

Set the defaults once:

```ts
provideDockableDesktop({
  panels: { /* … */ },
  defaultSplitRatio: 0.5,      // dropping on a leaf's edge
  defaultEdgeSplitRatio: 0.2,  // dropping on a workspace edge
});
```

Both are the fraction taken by the dropped panel, and both are clamped to 0.1–0.9. Adjust an
existing split by the **path** of child indices from the root to the branch — `[]` is the root
branch itself, `[1]` its second child:

```ts
ws.updateSplitSizes([], [0.7, 0.3]);   // the root branch's two children
```

Give one size per child, summing to 1; the values are applied as given.

## Starting from a defined layout

The grid is data, so you can hand the workspace a shape to start from — typically with empty
leaves that panels then open into:

```ts
provideDockableDesktop({
  panels: { /* … */ },
  initialState: JSON.stringify({
    version: 2,
    gridRoot: {
      type: 'branch', orientation: 'vertical', sizes: [0.75, 0.25],
      children: [
        { type: 'leaf', id: 'main',    panels: [], activePanelId: null },
        { type: 'leaf', id: 'console', panels: [], activePanelId: null, keepOnEmpty: true },
      ],
    },
    floating: [], minimized: [], panels: {},
  }),
});
```

`initialState` takes the same JSON `saveLayout()` produces ([chapter 5](05-persistence.md)).
`openPanel` docks new panels into the first leaf (`main` here); use `dockPanel(id, 'console')`
to put one elsewhere.

`keepOnEmpty: true` keeps a leaf in the layout after its last tab closes — use it for a slot
that should stay reserved, like a console pane.

## Locking a panel down

Registration options restrict what the user may do:

```ts
defaultOptions: { canDrag: false, canMinimize: false, canClose: false }
```

The chrome drops the matching buttons and menu items, and the actions honour the same options:
`floatPanel` does nothing for a panel with `canDrag: false`, `minimizePanel` for one with
`canMinimize: false`, and `closePanel` for one with `canClose: false`. `canDrag: false` also
keeps the tab in place.

A leaf can refuse to be removed with `canClose: false` on the leaf node itself (in an
`initialState`): `closeLeafGroup`, and so the × on the empty group, then leaves it where it is.
Together with `keepOnEmpty` that makes a permanent slot.

## Reacting to layout changes

```ts
const ws = inject(Workspace);

ws.subscribe('layout:changed', () => localStorage.setItem('layout', ws.saveLayout()));
ws.subscribe('panel:opened', ({ id, component }) => track('open', component));
ws.subscribe('panel:closed', ({ id }) => {});
ws.subscribe('panel:minimized', ({ id }) => {});
ws.subscribe('panel:restored', ({ id }) => {});
ws.subscribe('panel:activated', ({ id, previous }) => {});
```

`subscribe` returns an unsubscribe function. Called in an injection context — a component,
directive or service constructor or field initialiser — it also unsubscribes by itself when that
context is destroyed, as `takeUntilDestroyed()` does. Called elsewhere, from an event handler
for instance, the returned function is yours to call.

`layout:changed` is the coalesced signal for autosave: it covers open, close, minimise, restore,
dedupe redirects and every placement change (dock, float, reorder, edge-dock, split resize). It
does **not** fire when an `onSaveState` provider's return value changes on its own — that is a
pull, and nothing can observe it changing. If your panel's state matters for autosave, save on
your own trigger too.

For state rather than events, read the signals: `computed(() => ws.minimized().length)` is live
without a subscription. `panel:activated` exists for the one thing a signal cannot give you —
ordering: `closePanel` publishes it before `panel:closed`, while the closing panel's own
subscription is still live.

## The event bus, for your own messages

The same channel carries application events between panels, so two panels can talk without
knowing about each other:

```ts
ws.publish('map:zoom', { level: 12 });
ws.subscribe('map:zoom', ({ level }) => {});
```

Type them by parameterising the workspace. Declare the map as a `type` alias — an `interface`
does not satisfy the `Record<string, unknown>` constraint:

```ts
import { createWorkspace, injectWorkspace, provideDockableDesktop } from 'angular-dockable-desktop';

type AppEvents = { 'map:zoom': { level: number } };

export const workspace = createWorkspace<AppEvents>({ panels: { /* … */ } });
// providers: [provideDockableDesktop(workspace)]

// in a component or service, with either form of provider:
const ws = injectWorkspace<AppEvents>();
ws.publish('map:zoom', { level: 12 });   // checked against AppEvents
```

The built-in events (`BuiltInEvents`) are always part of the map.
