# 0015 — The release gate checks the current version, not 1.0.0

**Status:** Accepted (owner decision, 2026-09-28, release 1.1.0). Changes a gate rule, so it is
recorded separately, as integrity rule 1 requires.

## Context

M15 was written as the 1.0.0 release gate, and `scripts/gates/m15.mjs` pinned the package
version: `libPkg.version === '1.0.0'`. CI (`.github/workflows/gate.yml`) runs M15 on every push.
1.0.0 is published on npm, and 1.1.0 (branding, ADR 0014) has to ship as a new version. With the
pin, the gate fails on the bump alone. Every later release would hit the same failure.

## Decision

The package version must equal `VERSION` (`src/lib/version.ts`, already checked) **and must have
its own `## [<version>]` entry in CHANGELOG.md**. Neither check names a version, so the rule holds
for every release. The checks on the 1.0.0 entry (it exists and states its parity line) stay: that
entry remains in the history.

## Consequences

- M15 passes on 1.1.0 and on later releases without editing the gate.
- A bump without a changelog entry now fails M15. Before, it failed only because of the pin.
- The rule was proven to fail by removing the version's changelog heading (a manual mutation
  check). M15 is a milestone gate, not a standing rule, so the selftest does not cover it.
