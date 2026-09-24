# 0001 — An Angular-native rewrite, not a transliteration

**Status:** Accepted

## Context

rdd (React) and vdd (Vue) are the same library written twice, and vdd showed that the right way
to port it is to keep the **features, the vocabulary and the serialised format**, and redesign
everything else in the target framework's own idioms. The owner's instruction for ndd: *"it
should feel like a native Angular library, built for Angular users by Angular users, with real
modern Angular components according to the latest standards."*

## Decision

Same feature set, same domain names (`LayoutNode`, `PanelInfo`, `FloatAnchor`, `openPanel`,
`dockPanelToGroup`, …), same `SerializedLayout`. Everything else is designed from the Angular
side:

| rdd / vdd | ndd |
|---|---|
| `WorkspaceClient` + providers / `createWorkspace()` + `app.use()` | `provideDockableDesktop(cfg)` and `inject(Workspace)`. `createWorkspace()` works before bootstrap |
| hooks / refs | read-only **signals**, derived state as `computed()` |
| `useFormContainer()` / `usePanel()` | `injectPanel()` → `PanelRef`; registrations auto-dispose via `DestroyRef` |
| panel props | the panel's own `input()`s, applied with `ComponentRef.setInput` |
| handles / `v-model` | `model()` → `[(x)]` two-way binding |
| render props / slots | `ng-template` directives with typed contexts (`ngTemplateContextGuard`) |
| `openModal(Cmp, props)` | `inject(NddModals).open(Cmp, opts)` → `NddModalRef<R>` (the MatDialog shape) |
| subscriptions | signals and `effect()`; `events$()` Observables for RxJS users |
| — | lazy panels (`loadComponent`), Signal Forms (`trackDirty`) |

Components are standalone, OnPush (the v22 default), use built-in control flow, signal
queries (`viewChild()`), `host: {}` metadata rather than `@HostBinding`/`@HostListener`, and
follow the 2025 style guide (no `Component` suffix; `Ndd` class prefix as `Mat` in Material).

## Consequences

- vdd's source is the reference implementation; vdd's tests are the specification (ADR 0009).
- A user migrating from rdd or vdd rewrites call sites; their users' saved layouts survive
  (ADR 0008).
