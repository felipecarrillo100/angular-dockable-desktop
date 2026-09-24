# Progress

One row per gate run that passed, newest last. The per-milestone account is in
[evidence/](evidence/).

| Milestone | Date | Result | Tests | Notes |
|---|---|---|---|---|
| M0 | 2026-09-24 | PASS | browser: 4 configs + 2 negative controls | host-element strategy chosen (ADR 0002); live scroll/focus tracking needed for host destruction; Chrome fires focusout during removal |
| M1 | 2026-09-24 | PASS | 1 unit; selftest 29/29 | CLI workspace, gates, port map (765), ADRs 0001–0010 |
| M2 | 2026-09-24 | PASS | 126 (+125); selftest 32/32; non-vacuity 6/6 | verbatim core, stylesheet complete, rdd fixtures landed early; ADR 0011 (token-only unscoped selectors) |
| M3 | 2026-09-24 | PASS | 284 (+158); non-vacuity 4/4 (+6 from M2 still red) | Workspace on signals, DI providers, lazy panels; TestBed made zoneless (the CLI ran it on zone.js); run 2 stalled (host suspended), re-run clean |
| M4 | 2026-09-24 | PASS | 330 (+46); non-vacuity 8/8; browser zoneless+zone | desktop grid, PanelHost, slots, injectPanel, lazy panels, inputs; tab close made keyboard-accessible |
| M5 | 2026-09-24 | PASS | 355 (+25); non-vacuity 1/1; browser zoneless+zone + rdd-handle control rejected | floating windows, logical-inset anchoring, viewport clamp; D5 containment+coverage; launch retry for a Chrome start stall |
| M6 | 2026-09-24 | PASS | 382 (+27); non-vacuity 4/4; browser mouse+touch, LTR+RTL, zoneless+zone | drag-and-dock; **differential gate: 12/12 gesture sequences byte-identical to vdd**, planted-bug control caught |
| M7 | 2026-09-24 | PASS | 402 (+20); non-vacuity 3/3; browser zoneless+zone + rdd D11 control rejected | taskbar (3 modes), live preview = the same node (video plays inside it), portal directive |
| M8 | 2026-09-24 | PASS | 440 (+38); non-vacuity 5/5; browser zoneless+zone + N2 control rejected | `<ndd-context-menu>`, typed custom template, WAI-ARIA keyboard, standard tab/window/taskbar menus, D1 Maximize, N2 tooltip overlap fixed |
| M9 | 2026-09-24 | PASS | 599 (+159); non-vacuity 5/5; browser zoneless+zone + D12 control rejected; every vdd model test twinned with `[( )]` | `<ndd-sidebar>`, `<ndd-secondary-sidebar>` (one template), `<ndd-toolbar>`, typed tab/header templates, `injectSidebar`/`injectSidebarTab`/`injectToolbar`; N5–N7 |
| M10 | 2026-09-24 | PASS | 669 (+70); non-vacuity 6/6; browser zoneless+zone + "never asks" control rejected | `<ndd-modals>`, `<ndd-side-panels>`, `<ndd-confirm>`, `<ndd-toasts>`, `toast`/`NddToaster`, `NddModalRef.afterClosed()`, `trackDirty()` with Signal Forms; panelId spoof fixed; N8–N9 |
| M11 | 2026-09-24 | PASS | 756 (+87); non-vacuity 6/6; browser zoneless+zone + rdd -4px-handle control rejected | `<ndd-panel-overlay>`, `<ndd-panel-toolbar>`, `<ndd-floating-widget>` (`[(open)]`, `[(placement)]`), `injectFloatingWidgets()`, toolbar controls + search; inline-host defect found and gated; N10 |
| M12 | 2026-09-24 | PASS | 817 (+61); non-vacuity 3/3; browser zoneless+zone; prod bundle free of 8 dev-only messages (dev-build control) | `injectPanelContribution`/`injectActiveContribution`/`injectMerged*`, live locale, RTL, diagnostics; dev guards made foldable |
| M13 | 2026-09-24 | PASS | 834 (+17 vs M12); non-vacuity 51/51 (full sweep); round trips 34 layouts + control; consumer smoke (ng new --ssr --zoneless); coexistence Bootstrap/Tailwind/Material + control; axe 0 violations; ticks idle 0 / hover 0 / drag 1 per move; every earlier browser gate + vdd differential | Closing gate: parity, class↔rule sweep, a11y (N4, N13, N14), SSR fix (N12), fill-viewport (N11), coexistence base, tab-hover delegated outside Angular |
| M14 | 2026-09-24 | PASS | 837 (+3); M14 rules (34 capabilities, 3 mutations caught); walkthrough zoneless+zone, zero console errors | The demo: 16 panel kinds (4 lazy), 6 locales, 8 skins, RTL, Monaco/Leaflet/unified with no wrappers; PanelRef-in-effect loop found and fixed; library now has zero runtime dependencies (tslib dropped) |
| M15 | 2026-09-24 | PASS | 839 (+2); from rm -rf node_modules dist && npm ci; every browser gate M4–M15 zoneless+zone, controls rejected; round trips, coexistence, consumer smoke (1.0.0 tarball); selftest 33/33 | README, 13-chapter manual, CHANGELOG 1.0.0, LICENSE, ADRs 0012–0013, CI workflows (written); N15–N17 and the toast effect loop fixed |
