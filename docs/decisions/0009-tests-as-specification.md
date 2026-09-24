# 0009 — vdd's tests are the specification; gates keep "green" honest

**Status:** Accepted

The port is executed unattended, so a passing gate has to mean something without a reviewer.

- **vdd's 33 suites (765 tests) are the specification.** Each maps to an ndd spec
  (`test/port-map.json`) that keeps the test names and IDs (PO25, SB22, …). Only the driving
  code changes — `@vue/test-utils` → `TestBed`, `v-model` → `[( )]`, slot → `ng-template`.
  A file header maps every case that changed shape.
- **Integrity rules:** a gate is never edited to pass; a ported expectation is never weakened
  (an assertion ndd cannot meet becomes a numbered divergence in PARITY.md with a test pinning
  what ndd does); per-file counts are monotonic and each ported suite meets vdd's count; no
  skip/todo/only; non-vacuity is proven by stubbing modules and requiring red; every gate rule
  is proven able to fail by `npm run gate:selftest`.
- **Browser gates** carry negative controls where the property is structural (M0 set the
  pattern: the naive `inline` strategy and restoration-off must both be rejected).
