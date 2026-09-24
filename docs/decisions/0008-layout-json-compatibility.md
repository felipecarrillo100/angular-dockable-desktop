# 0008 — Layout JSON is byte-compatible with rdd and vdd

**Status:** Accepted — hard requirement

`saveLayout()` output is user data with a long life. `SerializedLayout` stays `version: 2`
and byte-compatible in both directions with rdd 6.2.0+ and vdd 1.x, exactly as vdd ADR 0009
defines it: `gridRoot` tree shape and leaf ids, `floating` rects/z/anchor/maximized,
`minimized`, `panels` metadata (`props`, `dedupeKey`, `serializable`, `previousState`,
`lastFloatingRect`, `lastLeafId`, `dirty`, `dirtyOptions`), optional `activePanelId`, and the
legacy `stickyRight`/`stickyBottom` migration.

Angular-specific consequence: a panel's inputs are serialised under the existing `props` key
— `openPanel(id, key, { inputs })` is the Angular spelling, the JSON does not change.

**Verified by:** vdd's rdd 6.2.0 fixtures (`test/fixtures/rdd-6.2.0/`), loaded and re-saved
deep-equal (M3); vdd-produced layouts round-tripped in both directions (M13); and M6's
differential gate, which drives the same gestures against the vdd and ndd playgrounds and
requires equal `saveLayout()` output.
