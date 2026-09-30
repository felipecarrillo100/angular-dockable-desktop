# 0017 — Frost on a pseudo-element; the sidebar and toasts follow the workspace into RTL

**Status:** Accepted (2026-09-30, M18, release 1.3.0). Ported from react-dockable-desktop 7.4.0,
which made the same decisions after a consumer's field report.

## Context

- **Frost.** A `backdrop-filter` on an element makes that element the containing block for its
  `position: fixed` descendants. Five containers that host consumer content carried one — the
  floating window, the drawer, the overlay widget, the frosted panel toolbar and, in `macos`, the
  docked panel — so a consumer's fixed dropdown inside them was positioned against the container,
  and which containers did that depended on the skin. The consumer found it with a console probe.
- **Direction.** `<NddSidebar>` is usually an ancestor of `<NddDesktop>`, and toasts render into
  `<body>`, so the workspace's `dir` never reached them: `setDirection('rtl')` mirrored the
  desktop beside an unmirrored rail.

## Decision

1. **A container that hosts consumer content never carries a filter itself.** Its frost goes on its
   `::before` (`position: absolute; inset: 0; z-index: -1`, the container `isolation: isolate`),
   which is not an ancestor of the content. The container's background moves to the same pseudo,
   after the filter, as it was on the element, where the frost saturates (`saturate()` does not
   commute with the tint; the overlay widget's plain blur keeps its background);
   the pseudo extends 1px under a 1px border (`inset: -1px`), and not on a maximized window.
2. **The sidebar, everything inside it, and the toasts follow the workspace into RTL** (owner
   decision, 2026-09-30): `dir="rtl"` on their root while
   `workspace.dir()` is `'rtl'`; nothing otherwise, so a page-level `dir` still reaches them
   exactly as before. Everything inside the sidebar follows with it, a toolbar placed there
   included.
3. **Reduced motion** stops the library's own transitions and animations, with the same scope as
   `[animations]="false"`.

## Consequences

- Pinned by `stylesheet.spec.ts` ("consumer content contract") and the M18 browser gate,
  which also compares screenshots before and after (the frost moved back onto the element) within
  a small tolerance.
- The M16/M17 baselines see a new `::before` on those containers; their comparators fold it back
  onto the element, the one explicit equivalence they allow.
- A custom skin that frosts a container of its own should do the same; the theming chapter says so.
- Where a container clips its overflow (ndd's floating window and docked panel), the pseudo can't
  reach under the 1px border, so that band shows the page through the translucent border untinted —
  the one known difference; the pixel comparison covers the padding box.
- The `dir` goes on the sidebar's root, which wraps the application's own content, so the toolbar
  and any chrome placed inside a sidebar follow too: `setDirection('rtl')` makes the whole app RTL,
  which is the field report's ask. A toolbar outside any sidebar still follows the page. Chosen by
  the owner over mirroring only the rail and drawer.
- Two gates changed with it, as integrity rule 1 requires recording: M9's `rtl-desktop-only` case
  now expects the toolbar's flyout on the RTL side, and M14's contrast and skin-surface probes read a
  frosted container's `::before` background where the element's own is transparent.
