# 9. Panel contributions

An application toolbar whose contents depend on which panel the user is working in. A map
panel wants pan/draw/measure; a document panel wants bold/italic/heading; a chart panel wants
neither. The shell cannot know about all of them, and each panel should not have to reach into
the shell.

A panel *publishes*, the shell *merges*, and the library surfaces the publication only while
that panel is the active one.

## From inside a panel

```ts
import { Component, signal } from '@angular/core';
import { injectPanelContribution } from 'angular-dockable-desktop';

@Component({ selector: 'app-map-panel', template: `…` })
export class MapPanel {
  protected readonly tool = signal<'pan' | 'draw' | 'measure'>('pan');

  constructor() {
    injectPanelContribution(() => ({
      toolbarItems: [
        { type: 'radio', id: 'pan', group: 'tool', label: 'Pan', icon: 'bi bi-arrows-move',
          onActivate: () => this.tool.set('pan') },
        { type: 'radio', id: 'draw', group: 'tool', label: 'Draw', icon: 'bi bi-pencil',
          onActivate: () => this.tool.set('draw') },
      ],
      sidebarSections: [
        { id: 'layers', label: 'Layers', icon: 'bi bi-layers', component: LayerList },
      ],
    }));
  }
}
```

Call it in the panel component's injection context — a field initialiser or the constructor.
Both fields of a `PanelContribution` are optional and independent: publish only items, only
sections, both, or nothing. The library assigns **no meaning** to either: what a "toolbar item"
is for is your application's decision, and neither `<ndd-toolbar>` nor `<ndd-sidebar>` reads
contributions on its own.

**Pass a getter, not an object.** The getter is read in an effect, so the contribution is
re-published whenever a signal it reads changes — and never otherwise. Items that enable,
check or disappear with the panel's own state need no extra wiring:

```ts
protected readonly dirty = signal(false);

constructor() {
  injectPanelContribution(() => ({
    toolbarItems: [
      { type: 'action', id: 'save', label: 'Save', icon: 'bi bi-save',
        onClick: () => this.save(), disabled: !this.dirty() },
    ],
  }));
}
```

The first publication happens synchronously, when `injectPanelContribution` is called, so the
contribution exists before the panel's first render. The effect's first run publishes again
with the panel's inputs set (they are not yet set when the constructor runs), so a getter may
read `input()` signals.

The contribution is withdrawn with the component, through `DestroyRef`; there is nothing to
clean up. Outside a panel — a component rendered standalone, in a test or a story — it does
nothing, with a development warning.

### Publish before withdraw

Each re-publication stores the new contribution *first* and only then withdraws the previous
registration. The other order would leave a moment in which the panel has published nothing,
and anything reading the active contribution in between — a `computed`, an effect, a test —
would see the panel's items disappear and reappear. A withdraw is also a no-op once something
newer has been published for the same panel id, so a stale clean-up can never undo a newer
publication. You get this for free through `injectPanelContribution`; if you drive
`workspace.contributions.publish(panelId, contribution)` yourself, keep the same order:

```ts
const previous = withdraw;
withdraw = workspace.contributions.publish(panelId, next);
previous();
```

## In the shell

```ts
import { Component, signal } from '@angular/core';
import {
  NddDesktop, NddSidebar, NddToolbar, injectMergedSidebarTabs, injectMergedToolbarItems,
} from 'angular-dockable-desktop';
import type { SidebarTab, ToolbarItem } from 'angular-dockable-desktop';

@Component({
  selector: 'app-shell',
  imports: [NddDesktop, NddSidebar, NddToolbar],
  template: `
    <ndd-sidebar [tabs]="tabs()" [(activeTabId)]="openTab">
      <ndd-toolbar [items]="items()" position="left" />
      <ndd-desktop />
    </ndd-sidebar>
  `,
})
export class Shell {
  protected readonly openTab = signal<string | null>(null);
  // Yours, plus the active panel's.
  protected readonly items = injectMergedToolbarItems((): ToolbarItem[] => APP_TOOLS);
  protected readonly tabs = injectMergedSidebarTabs((): SidebarTab[] => APP_TABS, 'bi bi-app');
}
```

`injectMergedToolbarItems(() => items)` appends the contributed items behind a separator;
`injectMergedSidebarTabs(() => tabs, fallbackIcon?)` appends contributed sections as tabs.
Both take a **getter** for your own list, so your static items can themselves be reactive — a
toggle's `active` read from a signal, a label resolved through the current locale — and both
return a `Signal`, a `computed` over your list and the active contribution. When there is
nothing to add, the result is your list unchanged. Both must be called in an injection context.

For a different merge — contributed items first, no separator, a specific slot in the middle —
read the contribution yourself:

```ts
import { computed } from '@angular/core';
import { injectActiveContribution } from 'angular-dockable-desktop';
import type { ToolbarItem } from 'angular-dockable-desktop';

export class Shell {
  private readonly contribution = injectActiveContribution();
  protected readonly items = computed((): ToolbarItem[] => [
    ...(this.contribution()?.toolbarItems ?? []),
    { type: 'separator' },
    ...APP_TOOLS,
  ]);
}
```

`injectActiveContribution()` is `workspace.activeContribution`, a `Signal<PanelContribution | null>`;
outside an injection context, read `workspace.activeContribution()` directly.
`mergeToolbarItems(items, contribution)` and `mergeSidebarTabs(tabs, contribution, icon?)` are
the plain functions the merged helpers wrap, if you want the same shape somewhere else.

## Why "only while active" is trustworthy

A contribution is read from the workspace's `activePanelId`. The thing that makes the feature
safe is a guarantee made elsewhere: **`activePanelId` never names a panel the user cannot
see.** Every action that could invalidate it — closing, minimising, docking, floating,
reordering, restoring a saved layout — resolves it through one code path (vdd's D2, carried;
see [PARITY](../PARITY.md)).

That guarantee is worth stating because the failure it prevents is subtle rather than loud. If
`activePanelId` could name a hidden panel, the shell's toolbar would show controls belonging
to a panel behind another tab: controls that look functional and act on something the user
cannot see. react-dockable-desktop had exactly that after a layout restore, because it seeded
the active panel from insertion order rather than from what was visible.

So:

- Minimise a panel and its contribution disappears from the shell. It is still alive and
  still publishing; restore it and the same contribution comes back.
- Put a panel behind another tab and the same applies.
- A panel that publishes nothing yields `null` while active — not the previous panel's items.
- `injectPanel().isActive()` is the same test from the panel's side: `true` exactly when the
  shell is surfacing its contribution.

A component opened as a drawer or a modal ([chapter 8](08-overlays.md)) can call
`injectPanelContribution` too, but an overlay is never the workspace's active panel, so its
contribution is never surfaced.

## Two instances of the same panel

Two map panels open at once both publish, independently, keyed by their own panel ids. But
contributed *toolbar item state* needs a moment's thought, because the workspace's own toolbar
state is keyed by item **id** (and a radio item's by its **group**):

```ts
// Both instances contribute an item with id "snap", so both read one shared value.
{ type: 'toggle', id: 'snap', label: 'Snap', icon: 'bi bi-grid' }

// Controlled: each panel owns its own value, and they cannot collide.
{ type: 'toggle', id: 'snap', label: 'Snap', icon: 'bi bi-grid',
  active: this.snapping(), onToggle: on => this.snapping.set(on) }
```

Prefer the controlled form for anything contributed. A contributed control almost always
belongs to its panel rather than to the application, which is the same distinction
[chapter 6](06-sidebar-toolbar.md) draws for the toolbar generally. Because the getter reads
`this.snapping()`, the contribution is re-published when it changes, and the toolbar follows.

## Sections and sidebar tabs

A `PanelSidebarSection` is `{ id, label, icon?, component, inputs? }`. `sectionToTab(section,
fallbackIcon?)` converts one into a `SidebarTab`, using the fallback icon for a section that
omits its own; `injectMergedSidebarTabs` applies it for you.

A contributed section deliberately has no `eagerMount` or `preserveState`: it exists only
while its panel is alive *and* active, so neither flag has anything to mean. If a panel's
sidebar content must survive being switched away from, keep the state in the panel (or a
service it shares with the section) and let the section render it.

## Coming from vue-dockable-desktop

| vdd | ndd |
|---|---|
| `usePanelContribution(getter)` | `injectPanelContribution(getter)` |
| `useActiveContribution()`, a `computed` | `injectActiveContribution()`, a `Signal` (also `workspace.activeContribution`) |
| `useMergedToolbarItems(items)` | `injectMergedToolbarItems(() => items)` — a getter |
| `useMergedSidebarTabs(tabs, icon)` | `injectMergedSidebarTabs(() => tabs, icon)` — a getter |
| `mergeToolbarItems` / `mergeSidebarTabs` / `sectionToTab` | the same |
| `PanelSidebarSection.props` | `PanelSidebarSection.inputs` |

Coming from react-dockable-desktop: there is no `<PanelContributionProvider>` (the store is on
the workspace), no memoising (the getter is tracked), and after a layout restore the
contribution surfaced is the visible panel's — rdd's was whichever panel came first in its
`panels` object.
