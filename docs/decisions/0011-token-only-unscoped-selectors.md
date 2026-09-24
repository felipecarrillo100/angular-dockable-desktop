# 0011 — Unscoped selectors may declare only `--ndd-*` tokens

**Status:** Accepted (M2). A refinement of the D6 rule in `css-prefix.mjs`, recorded
separately from any implementation change, as integrity rule 1 requires.

## Context

The M1 rule rejected every stylesheet selector not anchored in library DOM (`.ndd-…`,
`[data-ndd-…]`, `:root`). On its first contact with the real stylesheet it rejected two
blocks:

```css
[data-color-scheme="light"] { --ndd-…: …; /* 95 declarations, all tokens */ }
[data-color-scheme="light"] { --ndd-…: …; /* 6 declarations, all tokens */ }
```

`data-color-scheme="light"` on `<html>` is the **documented public contract of the whole
family**: rdd and vdd both tell applications to set it to switch the library to its light
tokens, and `useColorScheme()` reads it. Renaming it would break that contract for no gain.

What D6 protects against is the library *restyling the host*. A block that declares only
`--ndd-*` custom properties cannot do that: the properties are namespaced, and inert on any
element that does not read them.

## Decision

A selector not anchored in library DOM is allowed **only if every declaration in its block is
an `--ndd-*` custom property**. Anything else on an unscoped selector — `margin`, `color`,
`box-sizing`, or an unprefixed token — still fails.

## Consequences

- The two light-scheme token blocks pass; `body { margin: 0 }` and `button { … }` still fail.
- The selftest gains two cases: an unscoped token-only block must pass, and an unscoped block
  with one real property must fail.
- `data-color-scheme` stays the one unprefixed attribute the library reads. It is documented
  as family API in the theming chapter.
