# 0018 — Opt-in destroy while hidden (`keepAlive: false`)

**Status:** Accepted (2026-10-06, owner's decision, for all three editions: rdd 7.8.0, vdd 1.9.0,
ndd 1.7.0; vdd records it as its ADR 0021). Amends [0002](0002-zero-unmount-via-host-element.md)
for panel kinds that opt in; the default is unchanged.

## Context

[0002](0002-zero-unmount-via-host-element.md) makes it the library's defining guarantee that a
panel is created once and never destroyed while it is open. That stays right for almost every
panel: a map, an editor or a video keeps its state across every move.

The cost is that a panel holds whatever it holds for as long as it is open, visible or not. An app
with many heavy panels that are rarely shown asked for a way to free that while they are hidden.
It was chosen on value and cost as one of the Release A items, with the same name in all three
editions.

## Decision

A panel kind can set `defaultOptions.keepAlive: false`. Its component then exists only while the
panel is on screen: floating, or the selected tab of its group. `PanelHost` destroys it while the
panel is an unselected tab or minimised, and creates it afresh when it is shown again, from the
resolved component type (a lazy kind loads its chunk once).

The structure of 0002 is untouched. The component is still created with `createComponent` on the
library-owned content element and attached to `ApplicationRef`, never to a view inside a leaf; the
panel's host entry, its element, its size signal and its `PANEL_CONTEXT` stay for its whole life.
Only the component itself comes and goes, from one place, `PanelHost`.

Without the option, nothing changes: `keepAlive` defaults to `true`.

## Consequences

- In a `keepAlive: false` panel, `DestroyRef` callbacks mean *hidden*, not *closed*. The manual
  says so next to the option ([Chapter 3](../manual/03-panels.md)), and
  [Chapter 2](../manual/02-concepts.md) notes the exception beside the zero-unmount guarantee.
- A guard the panel registered with `onBeforeClose` is disposed with the component, so it is not
  active while the panel is hidden. The panel's dirty flag lives in the store and still is.
- The taskbar shows a letter tile instead of a live preview for such a panel.
- `test/components/release-a.spec.ts` pins it: destroy and fresh creation, the default unchanged,
  and no leaked instances or DOM over 50 hide/show cycles.
