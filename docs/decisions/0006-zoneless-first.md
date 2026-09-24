# 0006 — Zoneless-first; zone.js supported and tested

**Status:** Accepted (delegated decision, 2026-09-24)

The library is designed, documented and demoed zoneless: every piece of UI state is a signal,
so rendering is scheduled by signal writes alone. Applications still on zone.js work with
nothing extra, because Angular schedules change detection for signal changes in zone apps too
and our components read only signals.

The one real hazard: in a zone app every `pointermove` during a drag or resize would trigger an
application-wide change detection pass. High-frequency listeners (`pointermove`, `wheel`,
`ResizeObserver`) are therefore registered through `NgZone.runOutsideAngular` — a no-op when
zoneless — and only write signals.

**Enforced by:** the playground boots with `?zone` on zone.js; every browser gate runs its
whole scenario under both schedulers (`scripts/gates/lib/browser.mjs`), and M13 bounds change
detection passes per drag in the zone build. M0 proved the zero-unmount mechanism under both.
