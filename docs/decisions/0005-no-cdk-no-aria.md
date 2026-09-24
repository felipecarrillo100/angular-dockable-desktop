# 0005 — No dependency on `@angular/cdk` or `@angular/aria`

**Status:** Accepted (delegated decision, 2026-09-24)

"Zero runtime dependencies" is a promise across the whole family. Beyond the principle:

- **CDK.** `DragDrop` models sortable lists and free dragging — not dropping into a split
  cross, a workspace edge or a corner zone, 8-way resize, or pointer capture, which is the bulk
  of our drag code. `Overlay` would replace ~60 lines of clamping we already have tested;
  `Portal` is a weaker fit for zero-unmount than `createComponent({ hostElement })` (ADR 0002).
  The costs: a version-locked peer and a second global stylesheet.
- **Aria.** Stable in v22 and the right model, but our tab strip is also a drag source, a drop
  target and a long-press surface, and our menus/toolbars are data-driven. Building them on its
  directives would shape our internals around its model and force every consumer to install it.

Instead we implement the same WAI-ARIA patterns (tablist, menu, menubar, toolbar, dialog,
roving tabindex, `aria-*` states), lint templates with angular-eslint's accessibility rules,
and run an axe scan plus keyboard-only walkthroughs in the browser gates (M13). Revisit after
1.0 only if adopting aria would *delete* code.
