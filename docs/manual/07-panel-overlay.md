# 7. Inside a panel: overlay toolbars and floating widgets

Everything so far has been about arranging panels. This chapter is about the inside of one:
toolbars on its edges and small floating widgets over its content, such as a layer list on a
map, a timeline strip or an inspector card.

It is scoped to the panel. Each `<ndd-panel-overlay>` has its own toolbars, its own widget
stacks and its own z-order, and nothing here reaches outside the panel it belongs to.

```ts
import { Component, signal } from '@angular/core';
import {
  NddFloatingWidget, NddPanelOverlay, NddPanelToolbar, NddToolbarButton,
  NddToolbarSeparator, NddToolbarSpacer, NddToolbarToggle,
} from 'angular-dockable-desktop';
import type { PanelFloatPlacement } from 'angular-dockable-desktop';
import { LayerList } from './layer-list';
import { MapCanvas } from './map-canvas';

@Component({
  selector: 'app-map-panel',
  imports: [
    NddPanelOverlay, NddPanelToolbar, NddToolbarButton, NddToolbarSeparator,
    NddToolbarSpacer, NddToolbarToggle, NddFloatingWidget, LayerList, MapCanvas,
  ],
  templateUrl: './map-panel.html',
})
export class MapPanel {
  protected readonly grid = signal(false);
  protected readonly layers = signal<PanelFloatPlacement>({ anchor: 'top-right', stretch: null });

  protected fitAll(): void { /* … */ }
  protected help(): void { /* … */ }
}
```

```html
<ndd-panel-overlay>
  <ndd-panel-toolbar position="top" variant="frosted">
    <ndd-toolbar-button title="Zoom to fit" (click)="fitAll()"><i class="bi bi-arrows-fullscreen"></i></ndd-toolbar-button>
    <ndd-toolbar-separator />
    <ndd-toolbar-toggle title="Snap to grid" [(active)]="grid"><i class="bi bi-grid-3x3"></i></ndd-toolbar-toggle>
    <ndd-toolbar-spacer />
    <ndd-toolbar-button title="Help" (click)="help()"><i class="bi bi-question-circle"></i></ndd-toolbar-button>
  </ndd-panel-toolbar>

  <app-map-canvas />

  <ndd-floating-widget
    widgetId="layers" title="Layers"
    [(placement)]="layers" [width]="260" [height]="200"
  >
    <app-layer-list />
  </ndd-floating-widget>
</ndd-panel-overlay>
```

The demo's main map panel (`projects/demo/src/app/panels/main-map-panel.ts`) is this chapter
in full, working form.

## Toolbars

`<ndd-panel-toolbar>` attaches to `top`, `bottom`, `left` or `right`. It claims space on that
edge, and docked widgets keep clear of it, both where they sit *and* how far they can be
resized. Left and right strips inset themselves past any top and bottom strips, so the corners
are never contested. The claimed size is re-measured whenever the strip changes size (buttons
wrapping, a `buttonSize` change, content appearing), not measured once.

| Input | | Default |
|---|---|---|
| `position` | `top` · `bottom` · `left` · `right`, required | |
| `variant` | `transparent` · `frosted` · `solid` | `transparent` |
| `buttonVariant` | `ghost` · `soft` · `outlined` · `filled`, inherited by its buttons | `ghost` |
| `buttonSize` | icon button size in px; left to the stylesheet when unset | unset |

`left` and `right` are logical: under a right-to-left workspace a `left` strip sits on the
right. The strip has `role="toolbar"` and the matching `aria-orientation`.

The contents are yours. The library provides the pieces it styles consistently, each a
standalone component to import:

- `<ndd-toolbar-button title (click)>` (`NddToolbarButton`): an icon button; the icon is its
  content. It has no `click` output of its own: the inner `<button>`'s native click bubbles, so
  `(click)` works as on any button and, like one, fires nothing while `disabled`.
- `<ndd-toolbar-toggle title [(active)]>` (`NddToolbarToggle`): a two-state button that sets
  `aria-pressed`. `active` is a `model()`, default `false`; `(activeChange)` reports a click.
- `<ndd-toolbar-separator />` (`NddToolbarSeparator`): a divider, hidden from assistive
  technology.
- `<ndd-toolbar-spacer />` (`NddToolbarSpacer`): pushes everything after it to the far end.
- `<ndd-toolbar-center>` (`NddToolbarCenter`): centres its content regardless of what flanks it.
- `<ndd-toolbar-item>` (`NddToolbarItem`): wraps a control that is not one of the above, such
  as a select or a badge.

Button and toggle take `title` (tooltip and accessible name), `disabled`, and `variant`, which
overrides the toolbar's `buttonVariant` for that one button.

### Search

`<ndd-toolbar-search>` (`NddToolbarSearch`) is a compact icon button that expands into a
debounced field, with results in a dropdown:

```html
<ndd-toolbar-search
  placeholder="Find a layer…"
  [search]="searchLayers"
  (resultSelect)="focusLayer($event.id)"
/>
```

```ts
import type { SearchResult } from 'angular-dockable-desktop';

protected readonly searchLayers = (query: string, signal: AbortSignal): Promise<SearchResult[]> =>
  this.api.searchLayers(query, { signal });
```

Pass `search` as an arrow-function property, as above, so `this` is bound when the component
calls it. It receives an `AbortSignal` and **must** honour it. Without that, a slow request for
an earlier query can land after a fast one for a later query and overwrite it, which is why the
signal is in the signature rather than optional. (The component also discards a result that
arrives after its own request was superseded, but it cannot cancel your network request for
you.) It may return the results directly or a promise of them. A rejection is swallowed, and the
dropdown keeps whatever it showed before.

Results are `SearchResult` objects, `{ id, label, description?, group?, icon? }`; a `group`
buckets them under a heading. The output is `(resultSelect)`, not `(select)`, because `select`
is a DOM event.

| | | Default |
|---|---|---|
| `search` | `(query, signal) => SearchResult[] \| Promise<SearchResult[]>`, required | |
| `placeholder` | field placeholder and accessible name | the library's localised "Search" |
| `debounce` | milliseconds after the last keystroke | `300` |
| `(resultSelect)` | a result was chosen; emits the `SearchResult` | |

An empty query clears the results without calling `search`. The field collapses on Escape,
when a result is chosen, and when focus leaves the component. The dropdown is rendered in
`document.body`, so the toolbar's own bounds cannot clip it, and its z-index is derived from
`--ndd-z-base`, so the workspace's `zIndexBase` moves it too.

## Floating widgets

`<ndd-floating-widget>` (`NddFloatingWidget`) docks to a corner of the panel, can be dragged
free of it, and dropped back onto another corner; drop zones appear in the four corners while
a drag is in flight. Widgets sharing a corner stack along the block axis with an 8px gap.

| | | Default |
|---|---|---|
| `widgetId` | unique within this panel's overlay; drives z-order and stacking. Required | |
| `title` | header text, a `Label`: plain text or a message descriptor. Required | |
| `icon` | header icon, an `NddIcon` | none |
| `[(open)]` | model: whether it is shown | `true` |
| `[(placement)]` | model: `{ anchor, stretch }`, see below | `{ anchor: 'top-right', stretch: null }` |
| `width`, `height` | pixels. Ignored on a stretched axis, and returned to when it is released | `320`, `240` |
| `stretchable` | `false` disables resize-to-stretch snapping | `true` |

The header's "×" writes `false` to `open`. Bind `[(open)]` to a signal if the widget should be
able to come back: an unbound widget that the user closes stays closed until it is re-created.

Clicking the header does **not** detach the widget; a drag past 4px does. That matters more
than it sounds: a widget torn off its anchor by a stray click looks unchanged, but its stacked
siblings close the gap and it stops tracking the corner from then on.

### Placement is one value

`anchor` and `stretch` travel together, as one model of type `PanelFloatPlacement`:

```ts
protected readonly placement = signal<PanelFloatPlacement>({ anchor: 'bottom-left', stretch: 'width' });
```

Not two, because a single gesture can change both: releasing a stretched axis also decides
which end the widget is now pinned to. Reporting them separately would let you observe a state
that is never valid. `anchor` is a `FloatAnchor`: `top-left`, `top-right`, `bottom-left` or
`bottom-right`.

Bind the model with `[(placement)]` and your signal always holds the current placement, which
is also **how you persist it**. The library serialises nothing about inner widgets, by design
([chapter 5](05-persistence.md)): a widget's identity is whatever your app says it is. Store
what the signal holds, and seed it with that on the next load.

**A one-way `[placement]` seeds the widget; it does not control it.** A `model()` is locally
writable, so a one-way binding sets the widget's placement when *your* value changes, and the
widget still applies the user's drag. This differs from vdd, where a model bound without a
listener vetoes every gesture (divergence N10). To veto a gesture in ndd, handle
`(placementChange)` by writing your value back **as a new object**, so the input changes and
re-syncs the widget:

```html
<ndd-floating-widget
  widgetId="pinned" title="Pinned"
  [placement]="pinned()"
  (placementChange)="pinned.set({ ...pinned() })"
>
  <app-pinned-card />
</ndd-floating-widget>
```

### Stretch: spanning an axis

An axis can span the panel instead of carrying a size. `stretch` is a `Stretch`
(`'width'`, `'height'` or `'both'`) or `null`.

The mechanism is worth knowing, because it explains the behaviour: a stretched axis pins
**both** ends and writes no size at all. "Full width" is not a width, it is a second pin, so
CSS keeps the widget spanning the panel as the panel resizes, with no observer and no
JavaScript.

```ts
// A full-width status strip along the bottom, tracking the panel's width.
protected readonly strip = signal<PanelFloatPlacement>({ anchor: 'bottom-left', stretch: 'width' });
```

```html
<ndd-floating-widget
  widgetId="timeline" title="Timeline"
  [(placement)]="strip"
  [width]="240" [height]="120"
>
  <app-timeline />
</ndd-floating-widget>
```

`width` still matters there: it is what the inline axis **returns to** if the user releases it.
The stored size is deliberately left untouched while an axis is stretched, so releasing
restores the size the user last chose rather than the full-bleed value.

A `'height'` or `'both'` widget spans the axis that stacking uses to separate siblings, so it
cannot stack: it will overlap anything anchored to the same side, with z-order deciding. You
get a development warning if that situation arises; give it a fixed height, or move the others
to the opposite side.

A full-width strip *does* stack, and against **both** corners of its edge: it overlaps
whatever is in either, so it clears the taller of the two.

### Which resize handles appear

Not a cosmetic decision. A handle on a pinned edge would move the *opposite* edge instead of
the one under the cursor, and stop almost immediately: an inert stub wearing a resize cursor.

- **Free-floating:** all eight. Nothing is pinned.
- **Docked:** the two free edges and their corner. A `top-left` widget offers `e`, `s`, `se`.
- **Stretched axis:** *both* of its ends, either of which releases it. The edge you drag
  becomes the moving one and the opposite end becomes the new pin, so it reads like an ordinary
  resize. This is also what stops a fully stretched widget from being a dead end with nothing
  to grab.
- **No corner** while anything is stretched: it would mix a resize and a release into one
  gesture.

Under RTL the inline half mirrors, because the pin is logical (`inset-inline-end`) while the
handles are physical. Every handle is grabbable across its whole area: none is clipped by the
widget's `overflow: hidden` (D5).

### Resize-to-stretch snapping

Drag a free edge out to where a stretched axis would sit and the axis converts to stretched on
release. The widget is already visually at its target (the resize clamps stop exactly there),
so the cue is an outline rather than a ghost preview.

The thresholds are asymmetric on purpose: it arms within 16px of the full extent but only
disarms once the drag pulls back past 40px. Without that hysteresis, releasing a stretched
axis by dragging a few pixels inward immediately re-arms and snaps straight back, which makes
the gesture feel broken. `[stretchable]="false"` turns snapping off for content that only makes
sense at a bounded size.

## Panel content with its own stacking

One thing to know before you put a map, a chart library or a video player under an overlay.

A floating widget stacks at a z-index the overlay assigns it. Some libraries give their own
internal layers a much higher one: Leaflet, for instance, puts its map panes at `z-index:
400`. If your panel's content does that, it paints **over** the overlay: the toolbar and the
widgets are in the DOM, laid out correctly, and invisible.

The library cannot prevent it, because it does not know what a panel renders. The fix is one
line, on your own element:

```css
.my-map { isolation: isolate; }
```

That contains the library's stacking inside your element instead of letting it compete with
the overlay's. Any wrapper works (`isolation: isolate`, `position: relative; z-index: 0`, or
a `transform`) as long as your content sits in its own stacking context.

The demo hits this exactly, with Leaflet, and fixes it this way (`.dd-leaflet` in its
`styles.css`).

## Widgets from data

When the widgets are data (one per selected feature, one per running job) there is no
template to write them in. `injectFloatingWidgets()` returns a `FloatingWidgetsApi`:

```ts
const widgets = injectFloatingWidgets();

widgets.open(`feature-${id}`, {
  title: `Feature ${id}`,
  component: FeatureInfo,
  inputs: { id },
  anchor: 'top-right',
  width: 300,
  height: 220,
});
widgets.close(`feature-${id}`);
widgets.closeAll();
```

`openIds` is a signal of the open ids, in the order they were opened, and `isOpen(id)` is a
reactive question about one. The second argument is a `ManagedWidget`: `title` and
`component` are required; `icon`, `inputs`, `anchor` (default `top-right`), `stretch`, `width`
(default 320) and `height` (default 240) are optional. `inputs` go to `component` through
`NgComponentOutlet`. A widget written in the template is the simpler option where you can
write one.

### Call it from a component inside the overlay

`injectFloatingWidgets()` reads the overlay through dependency injection, and
`<ndd-panel-overlay>` provides it to **its own content**. The panel component that renders the
overlay in its template is the overlay's *parent*, so calling `injectFloatingWidgets()` in that
panel's constructor throws: "This must be used inside an `<ndd-panel-overlay>`".

Put the calls in a small child component placed inside the overlay instead. It can render
nothing:

```ts
import { Component, effect, input, untracked } from '@angular/core';
import { injectFloatingWidgets } from 'angular-dockable-desktop';
import { FeatureInfo } from './feature-info';

@Component({ selector: 'app-feature-widgets', host: { hidden: '' }, template: '' })
export class FeatureWidgets {
  /** The features that should have a widget open. Each id doubles as the widget id. */
  readonly featureIds = input.required<string[]>();

  constructor() {
    const widgets = injectFloatingWidgets();
    effect(() => {
      const wanted = this.featureIds();
      untracked(() => {
        for (const id of widgets.openIds()) if (!wanted.includes(id)) widgets.close(id);
        for (const id of wanted) {
          if (!widgets.isOpen(id)) {
            widgets.open(id, { title: `Feature ${id}`, component: FeatureInfo, inputs: { id } });
          }
        }
      });
    });
  }
}
```

```html
<ndd-panel-overlay>
  <app-map-canvas (featureClick)="toggle($event)" />
  <app-feature-widgets [featureIds]="selected()" />
</ndd-panel-overlay>
```

Every application that opens widgets from data hits this, and the demo uses the same shape
(`camera-widgets.ts`). The `untracked` matters: without it, the effect would also depend on
`openIds`, and re-run every time it opened a widget. The widget's own "×" closes it in the
overlay, not in your list, so watch `openIds()` if your own state must follow.

**`anchor`, `stretch`, `width` and `height` are initial values here, not live state.** The
overlay seeds a widget from them the first time you open that id and owns its placement from
then on, so a drag or a resize-to-stretch survives, including a later `open()` on the same id,
which refreshes the widget's content and leaves it where the user put it. `close(id)` forgets
the placement, so closing and reopening is how you reset it. vdd 1.0.0 discarded these
gestures on every render (its R1); ndd binds each managed widget to the overlay's own record,
so that cannot occur.

The consequence worth knowing: a managed widget's placement is not readable, so it cannot be
persisted the way a template widget's `[(placement)]` can. If you need to restore widgets
where the user left them, declare them in the template and own the model.

### Titles that follow the language

`title` is a `Label`, so it takes a message descriptor as well as a string:

```ts
widgets.open('legend', {
  title: { id: 'legend.title', defaultMessage: 'Legend' },
  component: Legend,
});
```

The descriptor is resolved on every render, so the header follows a locale change with no
reopen. That matters more here than anywhere else, because this object is the one title the
library *stores*: a string you resolve yourself is frozen at the language that was current when
you called `open()`, and the only way to change it would be to call `open()` again for every
open id. A widget in the template can use either, since its `title` binding re-evaluates with
your own component anyway. See [chapter 11](11-i18n.md).

The same applies to `inputs`, in the other direction: they are your component's, so a widget
that must follow the language should read the locale itself rather than receive
already-resolved text.

## Coming from react-dockable-desktop or vue-dockable-desktop

| rdd | vdd | ndd |
|---|---|---|
| `<PanelOverlayRoot>` | `<VddPanelOverlay>` | `<ndd-panel-overlay>` |
| `<PanelToolbar>` | `<VddPanelToolbar>` | `<ndd-panel-toolbar>` |
| `<ToolbarButton icon={…}>` | `<VddToolbarButton>`, icon as the slot | `<ndd-toolbar-button>`, icon as content, native `(click)` |
| `<ToolbarToggle active onToggle>` | `<VddToolbarToggle v-model:active>` | `<ndd-toolbar-toggle [(active)]>` |
| `<ToolbarSearchInput onSearch onSelect>` | `<VddToolbarSearch :search @select>` | `<ndd-toolbar-search [search] (resultSelect)>` |
| `<ToolbarSeparator>` / `<ToolbarSpacer>` / `<ToolbarCenter>` / `<ToolbarItem>` | `Vdd`-prefixed | `<ndd-toolbar-separator>` / `-spacer>` / `-center>` / `-item>` |
| `<PanelFloatingWindow>` | `<VddFloatingWidget>` | `<ndd-floating-widget>` |
| `open` + `onClose` | `v-model:open` | `[(open)]` |
| `defaultAnchor` + `defaultStretch` + `stretch` + `onPlacementChange` | one `v-model:placement` | one `[(placement)]` |
| `usePanelFloatingWindow()` | a `ref` plus `v-model:open` | a signal plus `[(open)]` |
| `usePanelFloatingWindowManager()` | `useFloatingWidgets()` | `injectFloatingWidgets()`, from inside the overlay |
| widget `props` | `props` | `inputs` |

Two things behave better than rdd rather than differently, as in vdd:

- **A docked widget can no longer be resized over a toolbar** on the far side. rdd bounded
  growth by the panel's edge, so it could.
- **Every resize handle is grabbable across its whole area.** rdd positioned them at `-4px` to
  straddle the edge, and `overflow: hidden` clipped half of each one away; at a rounded corner
  nothing was hittable at all, so a corner drag silently did nothing.
