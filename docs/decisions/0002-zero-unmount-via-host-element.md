# 0002 — Zero unmount via a library-owned host element

**Status:** Accepted, proven by the M0 spike ([evidence](../evidence/M0.md)).

## Context

The library's defining guarantee is that a panel is created once and never destroyed while
it is open. Docking, floating, tabbing, minimising and restoring *re-parent* it. That is what
lets a panel hold a WebGL map, a Monaco model, a playing video or an open socket across every
layout change.

rdd does this with `createPortal` into a cached `<div>`. vdd does it with `<Teleport>` into
the same kind of element (vdd ADR 0002). Angular's idiomatic way to render a component
somewhere, a `ViewContainerRef` in the host's template, is exactly what must be avoided. It
ties the panel's view to the host's view, so destroying a leaf, a split or a floating window
would destroy the panel. The M0 `inline` control proves this: 27 failures, and a re-mount on
every move.

## Decision

Each panel is created with

```ts
const ref = createComponent(PanelType, {
  environmentInjector,            // the application's
  elementInjector,                // provides PanelRef for injectPanel()
  hostElement: cache.elementFor(id),
});
appRef.attachView(ref.hostView);
```

This works as follows:

- **The host element belongs to the library.** It is created by `PanelDomCache`, lives for
  the panel's whole lifetime, and starts inside a hidden store that is already in the
  document.
- **The view hangs off `ApplicationRef`.** It is not in any component's view tree, so change
  detection reaches it wherever its element sits, including the hidden store, and no layout
  component's destruction can reach it.
- **Moves are plain DOM operations.** A single `afterRenderEffect` watches the *resolved host
  elements* and calls `cache.moveTo(id, host)`, which is `appendChild` bracketed by
  scroll/focus preservation. Angular never observes the move.
- **Panel inputs are set with `ref.setInput()`.** This works while the panel is hidden.

It is a structural invariant, not a discipline: nothing any present or future code path does
to a host can unmount a panel.

**Fallback, also proven in M0:** create the panel in a persistent hidden
`ViewContainerRef` and move its host node. It passed every assertion too. It is rejected as
primary only because the panel's lifetime would then hang on whichever component owns that
container, and M0 shows no advantage to offset that.

## Findings that change the implementation

1. **Preserved scroll and focus must be tracked live, not only captured at move time.** When
   Angular destroys a host, it removes the host's DOM *before* any destroy hook runs, so a
   panel inside it is detached with no chance to capture. A detached subtree then reads
   `scrollTop === 0`. `PanelDomCache` therefore keeps each panel's record current from
   capture-phase `scroll` and `focusin` listeners. That makes the M0 `REBUILD` steps, which
   destroy every host with a panel inside, pass. This is new relative to vdd, where the same
   gap exists for a host Vue destroys. It is recorded for `PARITY.md` as an improvement.
2. **Chrome fires `blur`/`focusout` synchronously while removing a focused subtree**, and at
   that moment the element still reports `isConnected`. A naive "focus left, forget it"
   handler erases the record in the middle of a move. Our own moves suppress the handler;
   detaches we did not make are judged one microtask later.
3. **`afterRenderEffect` over `viewChild()` signals is the right trigger.** It re-runs when a
   host arrives, so a panel whose host has not rendered yet is parked and then placed with
   no extra bookkeeping (the same lesson as vdd's M0 finding 4).
4. **The same code works unchanged under zone.js and zoneless** (D4), including a timer
   writing a signal inside a hidden panel.

## Consequences

- An `<iframe>` inside a panel reloads on every re-parent. No strategy prevents this; it is
  how iframes work, and it is documented as a limitation.
- Panels are always rendered, even when minimised, so their timers keep running, identical
  to rdd and vdd. Angular DevTools shows each panel as a root view.
- Closing a panel must call `appRef.detachView` and `ref.destroy()` explicitly, followed by
  `cache.release(id)`. This is the one place a panel is ever destroyed.

## Addendum (M4) — placement is driven by slots

M0 moved panels from one `afterRenderEffect` over the resolved host elements. The library
instead follows vdd: each place a panel can appear is a `[nddPanelSlot]` directive that moves
the panel's element into itself in `ngOnInit`, and on destroy parks it in the store **unless
another slot already holds it**. That is simpler — no global list of hosts to resolve — and it
composes with finding 1: Angular removes the slot's element before `ngOnDestroy` runs, so the
panel may be detached for an instant, and the live scroll/focus record carries it across.

What M0 proved is unchanged: panels are created once by `PanelHost` on a library-owned element
and attached to `ApplicationRef`; only the trigger for a move differs. The M4 browser gate
re-asserts every M0 property through the real library, under both schedulers.
