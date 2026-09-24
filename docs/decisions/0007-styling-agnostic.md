# 0007 — Agnostic about styling frameworks and component libraries

**Status:** Accepted (owner decision, 2026-09-24 — the same principle as rdd and vdd)

ndd uses no styling framework or component library — not Angular Material, CDK, PrimeNG,
Bootstrap or Tailwind — and works alongside any of them. Consumers choose.

- The library styles **only what it renders**, through `ndd-` classes and `--ndd-*` variables.
- It ships no reset and never styles `html`, `body` or anything of the host (vdd D8).
- Its `box-sizing` rule targets only `ndd-` elements, so a host reset cannot resize chrome.
- Panel content is entirely the consumer's own markup.
- Theming is CSS variables; the manual maps Material, Tailwind and Bootstrap tokens onto them.
- The demo uses no UI kit either — its own `dd-` markup.

**Enforced by:** `css-prefix.mjs` rejects any stylesheet selector not anchored in library DOM;
M13's coexistence gate loads the Bootstrap reboot, the Tailwind preflight and an Angular
Material theme and requires the library's computed styles to be unchanged.
