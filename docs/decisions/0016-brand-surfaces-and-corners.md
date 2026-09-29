# 0016 — Brand surfaces and corner scale: derived, guarded, never declared by the library

**Status:** Accepted (2026-09-30, M17, release 1.2.0). Ported from react-dockable-desktop 7.3.0,
which made the same decisions. It extends [0014](0014-brand-variables.md), which covered the
accent and fonts.

## Context

After 1.1.0 an application could put its accent and font on any built-in skin, but not its
backgrounds, text or corner shape. Those were literals in every skin: 240 colour declarations
across the base, the light scheme and the 7 skins × 2 schemes, plus 55 hard-coded corner radii.
Overriding the tokens meant knowing about 100 names, and a skin re-declared many of them on the
workspace element anyway (the same cascade trap as the accent in 0014).

## Decision

1. **Two surface inputs, set by the application:** `--ndd-brand-surface` (the app background) and
   `--ndd-brand-text` (the main text colour), per scheme. The library only reads them, as it
   does the 1.1.0 brand variables.
2. **Everything else is derived, by role.** Each surface token has one internal derived value,
   `--ndd--b-<token>`, declared once on `:root`: layers are the surface mixed a few percent
   towards the text (or towards black for the tab bar and rail); text is the text colour or a
   62% mix with the surface; borders and tints are mixes at the percentage each role needs. Every
   skin declaration reads it first: `var(--ndd--b-bg-panel, <skin colour>)`, and a translucent
   one keeps the skin's alpha as `color-mix(in srgb, var(--ndd--b-…, rgb(r g b)) A%, transparent)`.
   One formula for every skin: with a brand surface set, skins differ by shape and effects only.
3. **Both inputs or neither.** Every derived value is built on `--ndd--b-base`, a mix of the two
   inputs with no fallback, so while either input is unset every derived value is invalid at
   computed-value time and every `var()` falls back to the skin's own colour. No conditional logic,
   and half a palette — the case most likely to be unreadable — does nothing.
4. **Untouched:** translucent pure white and black (neutral tints and shades, right over any
   surface), shadows, status colours, the accent and its tints, `transparent`, and macOS's window
   buttons. ndd's unregistered-panel message keeps its danger red (rdd reads a token there).
5. **`--ndd-radius-scale`** multiplies every corner length:
   `calc(<length> * var(--ndd-radius-scale, 1))`, including the three radius tokens where they are
   read. Circles and pills (`50%`, `999px`), `0` and `inherit` are not scaled.
6. **The derived values are internal.** They are not API and may change in a release; the
   documented surface is the three variables above.

## Consequences

- Unset, every skin renders as 1.1.0 did: M16's browser gate (colours, against its 1.0.0 baseline)
  still passes unchanged, and M17's corner baseline, captured from 1.1.0, matches.
- The contract is unit-tested in `stylesheet.spec.ts` ("corner contract", "surface
  contract"); the rendered result by the M17 browser gate.
- The mix percentages are a matter of taste, tuned against a contact sheet in rdd. Changing them
  later changes only branded renderings, never an unbranded one, so it needs no baseline change.
- Custom skins keep their own surfaces; they can scale their own corners by the same `calc()`.
- Two stylesheet fixes ride along from rdd 7.3.0: the workspace-edge drop preview used Bootstrap
  blue instead of the accent, and the dock-target chips, the light-mode outline button and the
  frosted panel toolbar painted literal colours no token reached.
- **M16's version pin is lifted by ADR 0015's rule.** `scripts/gates/m16.mjs` pinned the package
  version to 1.1.0, the same shape ADR 0015 removed from M15; bumping to 1.2.0 failed it on the bump
  alone. It now requires what 0015 requires — the current version has its own CHANGELOG entry —
  and still checks the 1.1.0 entry, which introduced branding. The same rule, applied to the gate
  the owner's 0015 decision did not reach; M17 is written that way from the start.
