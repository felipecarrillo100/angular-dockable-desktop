# 0014 — Brand variables: read by the library, never declared by it

**Status:** Accepted (2026-09-27, M16, release 1.1.0). Ported from react-dockable-desktop 7.2.0,
which made the same decisions; vue-dockable-desktop 1.1.1 has no equivalent yet.

## Context

An application wants its own colour and font on a built-in skin. In 1.0.0 the only way was to
override tokens, and for the accent that did not work: every skin but `vscode` declares
`--ndd-accent-color` in a `[data-ndd-skin="…"]` block, and that block matches the workspace
element as well as `<html>` (the skin is mirrored onto both, see the theming chapter). A `:root`
override was therefore replaced on the workspace element, closer to every panel. Where it did
apply, it recoloured only half of the accent: 142 hover fills, active tints and glows were the
skin's accent copied by hand as fixed `rgba()` values, and some skins drew their active states in
colours that were not their accent at all (the default cyan left in other skins, `slate`'s and
`tokyo`'s separate blues, `obsidian`'s violet panel toolbar).

Fonts had the same shape of problem in reverse: `--ndd-font-family` was declared nowhere, each of
five rules carried its own fallback stack, and a skin had no way to bring a font without
declaring `--ndd-font-family` itself — which would override the application's value the same
way skins overrode the accent.

## Decision

1. **The brand variables are the application's.** `--ndd-brand-accent` and
   `--ndd-brand-on-accent` are set by the application on `:root`. The library only *reads* them;
   no rule in the stylesheet declares a `--ndd-brand-*` variable, since a declaration on the
   element carrying `data-ndd-skin` would override the application's value there.
2. **One accent source.** Every `--ndd-accent-color` declaration — `:root`, the light scheme, and
   each skin's dark and light blocks — is `var(--ndd-brand-accent, <that skin's colour>)`. Every
   tint of the accent is `color-mix(in srgb, var(--ndd-accent-color) N%, transparent)`, with N the
   old alpha × 100, so an unbranded skin renders exactly as before. The one place a literal
   accent colour may appear is a `var()` fallback. The accent-family literals a skin showed
   instead of its own accent are converted too, as intended visible fixes; in `obsidian`, whose
   accent is white/black, only the accent *roles* are (active states, glows, the focused window),
   and text, scrollbars and plain shadows stay neutral.
3. **Text on an accent fill** — the primary button and the armed dock target — reads
   `--ndd-brand-on-accent`, in both schemes, because the library cannot tell whether a brand
   colour is light or dark. The defaults are unchanged: `var(--ndd-brand-on-accent, #090b11)`,
   and `var(--ndd-brand-on-accent, #ffffff)` for the primary button in light mode.
4. **A skin's font is `--ndd-skin-font-family`.** `:root` declares
   `--ndd-font-family: var(--ndd-skin-font-family, <library stack>)`, and every chrome rule reads
   `var(--ndd-font-family)` with no fallback of its own. A skin sets `--ndd-skin-font-family` (in
   its dark block, which also applies in light mode) and never `--ndd-font-family`, so an
   application's `:root` value wins in every skin. The value resolves on `<html>`, which
   `<ndd-desktop>` gives `data-ndd-skin` too; chrome outside the workspace and portalled into
   `document.body` inherits it from there. No web font is loaded: every skin font is a system
   stack.
5. **Browser minimum: CSS `color-mix()`** — Chrome / Edge 111, Safari 16.2, Firefox 113.

## Consequences

- Three lines of CSS brand every built-in skin, dark and light, including chrome portalled to
  `<body>`; pointing them at a UI framework's variables (`--mat-sys-primary`, `--bs-primary`) makes
  the workspace follow that theme, without the library depending on the framework (ADR 0007).
- The rules above are pinned by `stylesheet.spec.ts` ("branding contract"); the rendered result by
  the M16 browser gate, which compares every skin and scheme with a 1.0.0 baseline and allows
  only the intended fixes.
- Visible changes for existing users, listed in the 1.1.0 changelog: the default skin's font is no
  longer Outfit, `vscode` light mode gains the accent `#0066cc`, the leftover colours now follow
  each skin's accent, and `tokyo` panels inherit a monospace font.
- A `:root` override of `--ndd-accent-color` is not supported; `--ndd-brand-accent` is. With the new
  light-scheme accent this now also holds for `vscode` in light mode.
- Custom skins stay brandable only if they follow the same three habits; the theming chapter says
  so, and the demo's `mono` skin does.
