# 0004 — Angular 22 only

**Status:** Accepted (owner decision, 2026-09-24)

Peer dependencies are `@angular/core` and `@angular/common` `^22.0.0`, and nothing else
(`tslib` is the only dependency). Built and tested on 22.x; published in Angular Package
Format with partial compilation, so later 22.x minors — and 23 once it is tested and the
range widened in a deliberate release — consume the same build.

What this allows without branches: OnPush as the default change detection; stable Signal
Forms (so `PanelRef.trackDirty()` is core API); stable zoneless; stable `resource` APIs.

**Toolchain pins** (vdd ADR 0015's lesson — pin what the framework pins, say why): TypeScript
`~6.0`, exactly what `ng new` for 22.2 installs. Everything else follows the CLI.
