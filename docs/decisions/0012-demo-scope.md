# 0012 — Demo: vdd's capabilities, no framework wrappers

**Status:** Accepted (2026-09-24, M14)

## Context

vdd's demo (after vdd ADR 0013) demonstrates every capability of the library with Monaco,
Leaflet and a `unified` markdown pipeline. Each has an Angular wrapper on npm
(`ngx-monaco-editor`, `@asymmetrik/ngx-leaflet`, `ngx-markdown`). A demo is also documentation:
what it depends on, readers assume they must depend on too.

## Decision

Port the demo panel for panel, with the same third-party libraries and **no Angular wrappers**.

- **Monaco** through a 60-line `monacoEditor()` helper: create after render, dispose with the
  component, sync a `WritableSignal` both ways with undoable edits. Workers are Angular CLI
  web workers (`new Worker(new URL(…, import.meta.url))`).
- **Leaflet** created outside Angular (`NgZone.runOutsideAngular`), so a pan costs no change
  detection; only the readout re-enters.
- **The markdown pipeline unchanged**: the same plugin set, rendered to HTML and bound with
  `[innerHTML]` through an explicit trust (Angular's sanitiser strips KaTeX's styles and MathML;
  the source is text the user typed into that panel).
- **i18n** is a plain formatter over a typed message table (`Record<MessageKey, string>`), as
  in vdd — the library needs only `(descriptor) => string`.
- **No UI kit**, consistent with [0007](0007-styling-agnostic.md): the demo's own `dd-` markup.
- The four heavy panels are **lazy** (`loadComponent`), which also demonstrates lazy panels.

## Consequences

The demo shows what an application needs and no more. M14's rules pin it: ADR's dependencies
present, framework wrappers absent, and the library itself without any runtime dependency.
