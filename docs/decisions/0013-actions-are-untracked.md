# 0013 — Every action is untracked, and an unchanged write publishes nothing

**Status:** Accepted (2026-09-24, M14)

## Context

Angular's idiomatic way to drive library state from a signal is an effect:
`effect(() => panel.setTitle(`Log (${lines().length})`))`. An action that *reads* a signal on
its way — to find the panel's record, or an overlay's instance — subscribes the calling effect
to that signal, and if the action then writes it, the effect re-runs; if the write always
produces a new object, it re-runs forever (`NG0103`). The workspace's own actions were
untracked from M3, but `PanelRef`'s were not, and the M14 demo's Terminal panel froze the page.

## Decision

1. Every public **action** — workspace methods, `PanelRef` methods, overlay and toast calls —
   performs its reads with `untracked`, so calling it from an effect makes that effect depend
   only on what the caller itself read.
2. A write that changes nothing **publishes nothing**: an unchanged title or dirty flag returns
   early instead of replacing the record.

## Consequences

`effect(() => panel.setDirty(form().dirty()))` is safe and runs once per change, which is what
the manual documents. Pinned by `panel-lifecycle.spec.ts` ("PanelRef actions called from an
effect"); restoring the tracked reads fails it with `NG0103`.
