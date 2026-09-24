# 0003 — The `ndd-` prefix

**Status:** Accepted (owner decision, 2026-09-24)

Everything the library owns in the DOM and in CSS is prefixed: element selectors
(`ndd-desktop`), attribute directives (`nddSidebarTab`), classes (`ndd-tab`), custom
properties (`--ndd-accent-color`), `@keyframes` names, and the skin hook (`data-ndd-skin`).
Exported classes and tokens use `Ndd` / `NDD_` (`NddDesktop`, `NDD_MESSAGE_FORMATTER`).

**Why `ndd`:** it follows the family (**r**dd, **v**dd, **n**dd — a*n*gular / *ng*) and
collides with nothing in Angular, Material, PrimeNG, Bootstrap or Tailwind.

**Rejected:**
- `add` reads as the English verb (`add-panel`, `AddSidebar`).
- `ngdd` — the Angular style guide reserves the `ng` prefix for the framework
  (*"Don't prefix a directive name with ng … that prefix is reserved for Angular"*);
  `ngddSidebarTab` next to `ngIf`/`ngModel` reads as first-party, and lint and reviewers
  flag it.
- `ngxdd` — compliant (community convention) but long in every selector and class; the
  package name `angular-dockable-desktop` already carries the association.

**Enforced by:** `scripts/gates/css-prefix.mjs` (stylesheet selectors, properties,
keyframes, animation references, and every class a component emits) and the
angular-eslint selector rules (`prefix: 'ndd'`). vdd D13 is the reason keyframes are
included: a host stylesheet defining its own `fadeIn` silently replaces an unprefixed one.
