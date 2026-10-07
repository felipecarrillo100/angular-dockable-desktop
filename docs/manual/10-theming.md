# 10. Theming and skins

## The approach

Every class the library renders is prefixed `ndd-`, and every design token is a CSS custom
property with the same prefix (`--ndd-accent-color`, `--ndd-bg-panel`, …). The stylesheet has no rules for your page, your `html`/`body`, or your
own elements — only for elements the library itself renders. Its `@keyframes` names are
prefixed too.

This matters because the library is meant to sit inside an application that already has a
styling framework. Bootstrap, Tailwind, Angular Material or plain CSS: none of them collide with
`ndd-`, and nothing in the stylesheet redefines a generic class such as `.active` or styles a
bare element selector. The library never loads any of those frameworks itself.

To put your company's colour and font on a built-in skin you need no skin of your own — see
[Brand your app](#brand-your-app).

The stylesheet is imported once, globally, through `angular.json` (see
[chapter 1](01-getting-started.md)):

```json
"styles": ["angular-dockable-desktop/styles.css", "src/styles.css"]
```

Keep your own stylesheet *after* the library's; the reason is under
[Defining your own](#defining-your-own). In development, `<ndd-desktop>` checks for the
`--ndd-styles-loaded` sentinel after its first render and logs an error naming the fix if the
stylesheet is missing, because without it the workspace renders as an unstyled box with no
other symptom.

## The coexistence base

A host page's framework reaches library chrome in two ways: chrome rendered outside the
workspace root (the sidebar strip, the toolbar, and everything portalled to `<body>` — the
context menu, modals, drawers, toasts, toolbar flyouts, the search dropdown) would otherwise
inherit the page's typography, and a CSS reset (Tailwind's preflight, Bootstrap's reboot)
removes the browser's default button padding and font that library buttons would otherwise rely
on.

So each chrome root states its own base — font family, `line-height: normal`, no
`text-transform`, normal `letter-spacing`, and `color: var(--ndd-text-primary)` — and every
library button starts from an explicit reset (`font: inherit`, zero padding and margin). Icons
inside library buttons are `display: block`, so neither Tailwind's `svg { display: block }` nor
Bootstrap's `vertical-align: middle` moves them. These are single-class rules placed early in
the stylesheet: they beat any element selector a framework uses, and the library's later rules
still decide the actual look.

The base font family is `var(--ndd-font-family)`. `:root` declares that token as the skin's own
font, `--ndd-skin-font-family` (see [Skin fonts](#skin-fonts)), and, for a skin that sets none,
`'Outfit', 'Inter', system-ui, -apple-system, sans-serif`. The library loads none of these
fonts: each is a stack of system fonts, and a machine uses the first one it has. Every rule that
sets a font reads the same token — the workspace, window title bars, tooltips and the context
menu included — so setting `--ndd-font-family` once, on `:root`, changes the font of all of the
chrome in every skin (see [Your brand font](#your-brand-font)).

Content *inside* a chrome root — a panel, a drawer tab, a modal body — inherits that base, and
your framework's own classes work there as usual.

## Retheming

Override the tokens. Anywhere that wins the cascade will do:

```css
:root {
  --ndd-brand-accent:  #7c3aed;
  --ndd-bg-primary:    #0b0b12;
  --ndd-bg-workspace:  #12121c;
  --ndd-bg-panel:      #181826;
  --ndd-text-primary:  #ececf5;
  --ndd-border-color:  rgba(255, 255, 255, 0.07);
}
```

Tokens are grouped by area, so you can retheme one part of the UI: after the prefix, the
families are `window-`, `modal-`, `side-panel-`, `taskbar-`, `tab-`, `sidebar-`,
`toolbar-`, `panel-toolbar-`, `panel-float-` and `scrollbar-`. The complete list is the [token reference](#token-reference) below.

The accent is set through `--ndd-brand-accent`, not `--ndd-accent-color`. Six of the seven
skins (all but `vscode`), and the light scheme, declare `--ndd-accent-color` themselves, with a
selector that also matches the workspace element, so a `:root` value of it is replaced there —
in every skin in light mode, and in all but `vscode` in dark. A skin's light block replaces it on
`<html>` as well, being more specific than `:root`. The same goes for any other token a skin
declares; a skin that should look different is the [skin of your own](#defining-your-own).

> Tokens live on `:root` by design. The context menu, toasts, modals, drawers, toolbar flyouts
> and the overlay search dropdown all render into `document.body`, and `<ndd-sidebar>` is
> normally an *ancestor* of `<ndd-desktop>`. CSS variables only cascade downward, so scoping
> them to the workspace element would leave those parts unthemed.

## Brand your app

Every built-in skin, in dark and light, takes your company's colour and font from three
variables set on `:root` — and, if you want them, [your surfaces](#your-surfaces) and
[corner shape](#corners) from three more:

```css
/* src/styles.css — listed after angular-dockable-desktop/styles.css in angular.json */
:root {
  --ndd-brand-accent: #e4002b;                 /* your brand colour */
  --ndd-brand-on-accent: #ffffff;              /* text on a brand-coloured fill (see below) */
  --ndd-font-family: 'Acme Sans', sans-serif;  /* your brand font */
}
```

That is all. Leave a variable unset and the skin keeps its own value.

| Variable | What follows it | Default |
|---|---|---|
| `--ndd-brand-accent` | Everything a skin draws in its accent: tab indicators, the active sidebar tab and toolbar button, hover and active tints, glows, the focused window's glow, the taskbar, the drop and snap highlights, the primary button. | Each skin's own accent |
| `--ndd-brand-on-accent` | Text drawn on a solid accent fill, in both schemes: the confirm dialog's primary button and the highlighted dock target while you drag. | `#090b11`; `#ffffff` on the primary button in light mode |
| `--ndd-font-family` | Every piece of chrome — tabs, title bars, toolbar, sidebar, menus, flyouts, toasts, drawers, modals — and panel content, which inherits the workspace font. | Each skin's own font |

Set them on `:root`, not on a wrapper around the workspace: the context menu, the toolbar
flyout, modals, drawers and toasts render straight into `document.body`, so a value set on a
wrapper does not reach them. And keep your stylesheet after the library's, as for any token
override: the library's own `:root` block declares `--ndd-font-family`, and the tie is settled by
order.

The library itself only ever *reads* `--ndd-brand-accent` and `--ndd-brand-on-accent`. Every
skin declares its accent as `var(--ndd-brand-accent, <its own colour>)`, and every tint of it —
hover fills, glows, the sidebar's card tokens — is a `color-mix()` of `--ndd-accent-color` at a
fixed percentage, so one colour drives them all.

> **Light brand colours.** The library cannot tell whether your colour is light or dark. With a
> light brand colour — yellow, lime, a pale cyan — set `--ndd-brand-on-accent` to a dark colour,
> so text on a brand-coloured button stays readable:
>
> ```css
> :root {
>   --ndd-brand-accent: #facc15;
>   --ndd-brand-on-accent: #1a1a1a;
> }
> ```
>
> It applies in both schemes. Unset, the defaults are as before: `#090b11`, and `#ffffff` on the
> primary button in light mode.

### A different brand colour for light mode

One brand colour applies to both schemes. If yours needs a darker shade on a light background,
scope a second value to the light scheme — the attribute your application already sets on
`<html>`:

```css
:root                            { --ndd-brand-accent: #ff5a5f; }
:root[data-color-scheme="light"] { --ndd-brand-accent: #d93b40; }
```

### Your brand font

The library never loads a font. Load your company font the way you already do — an
`@font-face` rule, a `<link>` to your font provider in `index.html`, your design system's font
package listed in `angular.json` — and name it in `--ndd-font-family`, followed by fallbacks:

```css
@font-face {
  font-family: 'Acme Sans';
  src: url('/fonts/acme-sans.woff2') format('woff2');
  font-display: swap;
}
:root {
  --ndd-font-family: 'Acme Sans', system-ui, sans-serif;
}
```

It replaces every skin's own font. A skin never declares `--ndd-font-family` itself (it sets
`--ndd-skin-font-family`, which the `:root` value falls back to), so yours wins in every skin,
portalled chrome included.

To use your page's own font instead, set `--ndd-font-family: inherit` on `:root`, or
`--ndd-font-family: initial` on `<body>`. Both leave the token without a value, and the chrome
then inherits the page's font. (`inherit` works only on `:root`: below it, a custom property set
to `inherit` just copies the skin's stack down. `initial` on a wrapper reaches only the chrome
inside that wrapper.)

### Use your UI framework's theme

The library depends on no UI framework ([ADR 0007](../decisions/0007-styling-agnostic.md)), so
it cannot read your theme by itself — but a framework's theme is already CSS variables on the
page, so pointing the brand variables at them is one line each, and the workspace then follows
your theme, including when it changes at runtime:

| Framework | Brand colour | Text on it | Font |
|---|---|---|---|
| Angular Material 3 | `var(--mat-sys-primary)` | `var(--mat-sys-on-primary)` | your typography's font family (`--mat-sys-body-medium-font`, or the family you gave `mat.theme`) |
| Bootstrap 5.3 | `var(--bs-primary)` | — | `var(--bs-body-font-family)` |
| Tailwind CSS v4 | a theme colour, e.g. `var(--color-indigo-600)` | — | `var(--font-sans)` |
| MUI (with `cssVariables: true` in `createTheme`) | `var(--mui-palette-primary-main)` | `var(--mui-palette-primary-contrastText)` | your `theme.typography.fontFamily` |
| shadcn/ui | `var(--primary)` — or `hsl(var(--primary))` in versions that store it as HSL numbers | `var(--primary-foreground)` (same rule) | your font |

With Angular Material, for example:

```css
/* src/styles.css, after the library's stylesheet and your mat.theme() */
:root {
  --ndd-brand-accent: var(--mat-sys-primary);
  --ndd-brand-on-accent: var(--mat-sys-on-primary);
}
```

The variable you point at must be defined on `:root` (or `<html>`), where the brand variables
are read. Angular Material 3 declares its `--mat-sys-*` tokens wherever you include
`mat.theme()`; include it on `html`, as Angular Material's theming guide does. The coexistence gate (M13) already
runs the workspace beside Bootstrap, Tailwind and Angular Material; their colours reach it only
through these variables, never by the library reading them.

### Your surfaces

Two more variables replace a skin's backgrounds and text with your own, per scheme: `--ndd-brand-surface` (the app background) and `--ndd-brand-text` (the main text colour). The library derives every other surface from those two — panels and the workspace a few percent towards the text, the tab bar and rail a little darker, borders and muted text as mixes of the two — so layers stay distinct and text stays readable:

```css
/* dark is the default: a missing data-color-scheme reads as dark */
:root:not([data-color-scheme="light"]) {
  --ndd-brand-surface: #0b1f3a;
  --ndd-brand-text: #e8eef7;
}
:root[data-color-scheme="light"] {
  --ndd-brand-surface: #f4f1ec;
  --ndd-brand-text: #2b2620;
}
```

- **Set both, or neither.** With only one of them set, every skin keeps its own surfaces — half a palette is the case most likely to be unreadable.
- **A scheme you leave out keeps the skin's surfaces.** Brand dark only, and light mode looks as it always did.
- **A skin keeps its shape and effects** — macOS's glass and window buttons, Chrome's tabs, the VS Code accent bar. Only the colours come from you, so with a brand surface set the skins differ by shape, not by colour. Each translucent surface (macOS panels, floating windows, modals) keeps the skin's own transparency.
- **Not affected:** the accent (that's `--ndd-brand-accent`), status colours (errors, warnings, the toast types), and shadows.

Pick a surface and a text colour with enough contrast between them — the text is used as-is on the panels. The M17 gate requires 4.5:1 for the main text on panels with the two colours above.

### Corners

`--ndd-radius-scale` multiplies every corner the library draws:

```css
:root { --ndd-radius-scale: 0; }    /* square corners, everywhere */
```

`1` (the default) is each skin's own shape, `0` is square, `1.5` is rounder; a skin keeps its own proportions at every scale, so macOS stays rounder than VS Code. Circles and pills stay round: macOS's window buttons and the taskbar's peek handle. It also scales the radius tokens you can set yourself (`--ndd-panel-float-radius`, `--ndd-panel-toolbar-btn-radius`, `--ndd-tab-btn-active-radius`).

### Your logo

The library draws no logo of its own — where one goes is your application's decision. Two
natural places:

- **Your own header or toolbar content**, outside the workspace — it is your markup, so anything
  goes.
- **The top of the `<ndd-sidebar>` rail**, where VS Code, Slack and Teams put theirs. A custom
  rail entry in `headerAction` renders your component as-is
  ([chapter 6](06-sidebar-toolbar.md#pinned-rail-entries)):

```ts
import { Component } from '@angular/core';
import { NddDesktop, NddSidebar } from 'angular-dockable-desktop';
import type { SidebarRailEntry, SidebarTab } from 'angular-dockable-desktop';

@Component({
  selector: 'app-logo',
  template: `<img src="/acme-mark.svg" alt="Acme" class="acme-logo" />`,
})
export class AppLogo {}

@Component({
  selector: 'app-root',
  imports: [NddSidebar, NddDesktop],
  template: `
    <ndd-sidebar [tabs]="tabs" [headerAction]="logo">
      <ndd-desktop class="ndd-fill-viewport" />
    </ndd-sidebar>
  `,
})
export class App {
  protected readonly tabs: SidebarTab[] = [];
  protected readonly logo: SidebarRailEntry = { custom: true, component: AppLogo };
}
```

The rail is narrow, so a square mark fits better than a wide wordmark. Adjust its spacing with
`--ndd-sidebar-header-area-padding-top` and `--ndd-sidebar-header-area-padding-bottom` (both
`8px`).

### Browser support

Branding relies on CSS `color-mix()`, available since Chrome 111, Edge 111, Safari 16.2 and
Firefox 113 (all 2023). In an older browser the tinted hover and active highlights lose their
colour; layout and behaviour are unaffected.

## Skins

A skin is a preset of tokens, selected by the desktop's `skin` input:

```html
<ndd-desktop skin="macos" />
```

or, bound to a signal:

```html
<ndd-desktop [skin]="skin()" />
```

Built in: `vscode` (the default), `macos`, `chrome`, `slate`, `nord`, `obsidian`, `tokyo`. Each
ships a dark and a light variant.

### Skin fonts

Each skin also brings its own font, the platform's UI font where it has a known one. They are
system font stacks — the library loads none of them, so each machine uses the first one it has —
and your `--ndd-font-family` replaces them all ([Your brand font](#your-brand-font)):

| Skin | Font (`--ndd-skin-font-family`) |
|---|---|
| `vscode` | VS Code's workbench font: `-apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif` |
| `macos` | San Francisco: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif` |
| `chrome` | Google's UI fonts: `'Google Sans Text', 'Google Sans', Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `slate` | Fluent's stack: `'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif` |
| `nord` | No official font; a softer humanist sans: `'Avenir Next', 'Nunito', 'Segoe UI', system-ui, sans-serif` |
| `obsidian` | The library's fallback stack: `'Outfit', 'Inter', system-ui, -apple-system, sans-serif` |
| `tokyo` | No official font; a terminal/editor feel: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

Panel content inherits the workspace font, so in `tokyo` your own panels turn monospace too
unless they set a font of their own.

A skin's font reaches the sidebar, the toolbar and everything portalled into `document.body`
for the same reason its colours do: `data-ndd-skin` is mirrored onto `<html>` (below), where
`:root` resolves `--ndd-font-family` from the skin's `--ndd-skin-font-family`, and every element
inherits the result.

The name is mirrored as a `data-ndd-skin` attribute onto **two** elements:

- `document.documentElement`, so chrome rendered into `document.body` (menus, toasts, modals,
  flyouts) picks up the skin's tokens too. `<ndd-desktop>` removes the attribute again when it is
  destroyed;
- the workspace element itself (the `<ndd-desktop>` host, class `ndd-workspace`), alongside
  `data-color-scheme` — see [Light and dark](#light-and-dark) for why that pairing matters.

The same effect mirrors the `animations` input (as the `ndd-no-animations` class) and the
workspace's `zIndexBase` (as `--ndd-z-base`) onto `<html>`. The root attributes are written in
the browser only; a server-rendered page carries them on the workspace element.

### Defining your own

Scope tokens to your skin's name and pass that name to `skin`. Nothing has to be registered.
The demo defines a `mono` skin this way at the bottom of `projects/demo/src/styles.css`; a
shortened version:

```css
/* src/styles.css — listed after angular-dockable-desktop/styles.css in angular.json */
[data-ndd-skin="mono"] {
  --ndd-bg-panel: #1a1a1a;
  --ndd-bg-tab-bar: #0f0f0f;
  --ndd-accent-color: var(--ndd-brand-accent, #e5e5e5);
  --ndd-accent-glow: color-mix(in srgb, var(--ndd-accent-color) 18%, transparent);
  --ndd-tab-indicator-focused: #ffffff;
  --ndd-panel-float-radius: 0;
}

[data-ndd-skin="mono"][data-color-scheme="light"] {
  --ndd-bg-panel: #ffffff;
  --ndd-bg-tab-bar: #e4e4e4;
  --ndd-accent-color: var(--ndd-brand-accent, #171717);
  --ndd-accent-glow: color-mix(in srgb, var(--ndd-accent-color) 12%, transparent);
  --ndd-tab-indicator-focused: #171717;
}
```

```html
<ndd-desktop skin="mono" />
```

Two rules to follow exactly:

**Leave the selector unqualified.** `html[data-ndd-skin="mono"]` looks stronger — and against
`:root` it is — but it cannot match the *workspace* element, where the library's own
`[data-color-scheme="light"]` block then re-declares the same tokens closer to your content and
wins. (Measured in the demo: the tab bar came back as the library's light default instead of the
skin's `#e4e4e4`.) A bare `[data-ndd-skin="mono"]` matches both elements and outranks the scheme
block at each, which is exactly how the built-in skins are written.

**Load your stylesheet after the library's.** A bare attribute selector and the library's
`:root` block have identical specificity, so the tie is broken by source order. Listing
`angular-dockable-desktop/styles.css` first in `angular.json`'s `styles` array, as
[chapter 1](01-getting-started.md) does, is enough. Component styles are the wrong place for a
skin: with the default emulated encapsulation their selectors are rewritten and will not match
`<html>`.

A skin is tokens, which recolour everything. The built-ins also carry a little element-level CSS
for treatments tokens cannot express — macOS's backdrop blur and traffic-light buttons, the
accent bar on an active tab — and your skin can add rules of that kind against `ndd-` classes,
scoped under `[data-ndd-skin="…"]`, if it wants them. `mono` deliberately uses tokens only.

Pick `mono` from the demo's skin dropdown to see it in both schemes.

> **Let your skin take a brand, as the built-in ones do.** Four habits keep a skin brandable:
>
> - Declare the accent as `var(--ndd-brand-accent, <your colour>)`, never as a bare colour.
> - Write every tint of it as `color-mix(in srgb, var(--ndd-accent-color) N%, transparent)`
>   instead of an `rgba()` of the same colour — then one accent drives them all.
> - Give your skin a font with `--ndd-skin-font-family`, never `--ndd-font-family`: declared in a
>   skin, `--ndd-font-family` would override the one an application sets on `:root`. Likewise,
>   never declare `--ndd-brand-accent`, `--ndd-brand-on-accent`, `--ndd-brand-surface` or
>   `--ndd-brand-text` in a skin — those belong to the application.
> - Write a corner radius your own rules add as `calc(6px * var(--ndd-radius-scale, 1))`, so
>   [`--ndd-radius-scale`](#corners) reaches it too.
>
> A skin of your own keeps its own surfaces: [brand surfaces](#your-surfaces) recolour the
> built-in skins, and a custom skin is where you choose every colour yourself.
>
> A skin that sets no accent of its own gets the default skin's (`#38bdf8` dark, `#0066cc` light),
> and one that sets no font gets the library's fallback stack. The library's own tints, the
> active tab icon and the sidebar's accent tokens all follow `--ndd-accent-color`, so a skin that
> sets only its accent is recoloured throughout.

## Light and dark

**Your application owns the scheme.** The library styles itself from a `data-color-scheme`
attribute on `document.documentElement` and never writes it there — which scheme is current is
an application decision, often tied to a user preference or `prefers-color-scheme`. The demo
does it with an effect:

```ts
import { Component, DOCUMENT, effect, inject, signal } from '@angular/core';
import { NddDesktop } from 'angular-dockable-desktop';

@Component({
  selector: 'app-root',
  imports: [NddDesktop],
  template: `<ndd-desktop class="ndd-fill-viewport" />`,
})
export class App {
  readonly scheme = signal<'dark' | 'light'>('dark');

  constructor() {
    const doc = inject(DOCUMENT);
    effect(() => {
      if (this.scheme() === 'light') doc.documentElement.setAttribute('data-color-scheme', 'light');
      else doc.documentElement.removeAttribute('data-color-scheme');
    });
  }
}
```

Only the value `'light'` means light. Anything else — including the attribute being absent, the
normal dark case — reads as dark, so there is no third state to handle. Dark is the base look:
its values are the `:root` defaults, and `[data-color-scheme="light"]` overrides them.

`<ndd-desktop>` reads that attribute and mirrors it onto the workspace element, next to
`data-ndd-skin`. That is not redundant: a skin's token block matches the workspace element as
well as the root, so without the scheme there too, a skin's dark tokens would be re-declared
closer to your content than the root's light ones and shadow them — the workspace would paint
dark panels with dark text in light mode.

Panel content can read the scheme — useful for a map's tile layer or an embedded editor's
theme — with `injectColorScheme()`. It returns a read-only `Signal<ColorScheme>` (`'dark' |
'light'`) that follows the attribute through a `MutationObserver`, disconnected when the calling
component is destroyed. Call it in an injection context:

```ts
import { Component, effect } from '@angular/core';
import { injectColorScheme } from 'angular-dockable-desktop';
import type { ColorScheme } from 'angular-dockable-desktop';

@Component({ selector: 'app-map-panel', template: `<div class="map"></div>` })
export class MapPanel {
  private readonly scheme = injectColorScheme();

  constructor() {
    effect(() => this.applyTheme(this.scheme()));
  }

  private applyTheme(scheme: ColorScheme): void {
    /* switch the map's tile layer */
  }
}
```

There is deliberately no setter: to change the scheme, change the attribute.

## Animations

```html
<ndd-desktop [animations]="false" />
```

Disables the library's own transitions only — tab hovers, dock previews, drawer collapse,
toast entry. Your application's animations are untouched. The setting is mirrored onto `<html>`
as the `ndd-no-animations` class, so menus and toasts rendered into `document.body` match.

The same happens on its own when the user has asked the system for less motion
(`prefers-reduced-motion: reduce`, 1.3.0) — whatever `[animations]` says, and again without
touching your own transitions.

## Frosted glass and your own overlays

Several skins draw floating windows, drawers, overlay widgets, frosted panel toolbars and (in
`macos`) docked panels as frosted glass. Since 1.3.0 the frost is drawn on each container's
`::before`, never on the container itself: a `backdrop-filter` makes its element the containing
block for `position: fixed` content, so a dropdown or overlay of yours inside a frosted window
used to be positioned against the window rather than the viewport — in some skins and not others.
Now `position: fixed` inside any library container means the viewport, in every skin.

If you write a skin of your own that frosts a container hosting content, do the same: put the
`backdrop-filter` (and the background it tints) on `::before`.

## Your own empty-workspace view

While no panel is docked, the workspace shows a built-in message. Replace it with anything (1.7.0):

```html
<ndd-desktop>
  <ng-template nddEmptyWorkspace>
    <app-welcome-screen />
  </ng-template>
</ndd-desktop>
```

Import `NddEmptyWorkspaceTemplate` next to `NddDesktop`. The view fills the empty group: floating
windows still show over it, and a window can still be dropped onto it to dock. Empty groups inside a
split keep the built-in message. To change only its text, override `emptyGroup` in `messages`.

## Your own tab content

An `<ng-template nddTabContent let-tab>` replaces what's inside each tab in the grid: the icon, the
title and the dirty marker (1.9.0). Use it for a badge, a status dot, a two-line title, a different
icon per state. It's given once, on the desktop; branch on `tab.component` for a per-kind look.

```html
<ndd-desktop>
  <ng-template nddTabContent let-tab>
    <ndd-icon [icon]="tab.icon" /> {{ tab.title }}
    @if (tab.dirty) { <span class="unsaved-dot"></span> }
    @if (tab.component === 'inbox') { <app-badge [count]="unread()" /> }
  </ng-template>
</ndd-desktop>
```

Import `NddTabContentTemplate` next to `NddDesktop` (and `NddIconView` for `<ndd-icon>`). `let-tab`
is a `TabContentProps`, typed in the template:

| Field | Type | |
|---|---|---|
| `panelId` | `string` | The panel's instance id. |
| `component` | `string` | The panel's registered kind. |
| `title` | `string` | The title, formatted: messages resolved, functions called. |
| `icon` | `NddIcon \| undefined` | The registration's icon, if it has one. |
| `dirty` | `boolean` | Has unsaved changes. |
| `selected` | `boolean` | The tab shown in its group. |
| `focused` | `boolean` | The workspace's active panel. |

The built-in content is `<ndd-icon [icon]="tab.icon" /> {{ tab.title }}{{ tab.dirty ? ' *' : '' }}`,
so starting from it is one line.

The tab itself stays the library's: dragging, keyboard navigation, `role="tab"`, its context menu,
its state attributes and classes, and the close button all keep working. Keep the content
non-interactive (no buttons or links): it sits inside the tab, which is the control. Floating-window
title bars and the taskbar are unchanged.

## Styling by state and by panel kind

Two hooks let your CSS target the desktop without depending on internal class names (1.7.0).
Each attribute is present while its state is true and absent otherwise:

| Attribute | On | Present while |
|-----------|----|---------------|
| `data-ndd-selected` | tab | it is the tab shown in its group |
| `data-ndd-focused` | tab, floating window | it is the workspace's active panel |
| `data-ndd-dirty` | tab | the panel has unsaved changes |
| `data-ndd-maximized` | floating window | it is maximised |

Tabs carry `data-ndd-tab="<panel id>"` and floating windows `data-ndd-window="<panel id>"`. And
`className` / `tabClassName` in a kind's registration options add your class to every panel of
that kind and to its tab ([Chapter 3](03-panels.md#registration-options)).

```css
[data-ndd-tab][data-ndd-dirty] { box-shadow: inset 0 -2px 0 #f59e0b; }
[data-ndd-window][data-ndd-focused] { outline: 2px solid var(--ndd-brand-accent); }
```

## Using it with Angular Material, PrimeNG, Bootstrap or Tailwind

Every class the library renders starts with `ndd-` and every variable with `--ndd-`, so nothing
collides with a framework's own classes. Colours and fonts:
[Use your UI framework's theme](#use-your-ui-frameworks-theme).

**Dark mode.** The desktop reads `data-color-scheme` on `<html>` (`"light"` is light; anything
else, or none, is dark) and never sets it. Wherever your app switches its theme (Angular
Material's `color-scheme`, a dark-mode class for PrimeNG or Tailwind, Bootstrap's
`data-bs-theme`), set the attribute too:

```ts
document.documentElement.setAttribute('data-color-scheme', dark ? 'dark' : 'light');
```

**Stacking.** With the default `zIndexBase` of 1000, floating windows start at 1001, and the
library's drawers are at 9000, context menus 9500, modals 10000 and toasts 10100. Two cases need
care:

- **Angular Material's menus, selects, autocompletes, tooltips and dialogs render into the CDK
  overlay container, at z-index 1000 by default: below the floating windows.** So a Material popup
  opened from a panel in a floating window appears behind that window. Raise the container above the
  library's whole range, which also covers the next case:
  ```css
  .cdk-overlay-container { z-index: 11000; }
  ```
- **A framework popup opened inside one of the library's modals or drawers appears behind it**
  when it renders into `<body>` (Material's overlays, as above; PrimeNG overlays appended to the
  body; Bootstrap's tooltips and popovers). Raise it (PrimeNG's `zIndex` setting; Bootstrap's
  `--bs-popover-zindex` / `--bs-tooltip-zindex`), or render it inside the modal (PrimeNG's
  `appendTo`; Bootstrap's `container` option).

**Overriding styles.** Prefer the `--ndd-*` variables, then the state attributes and your own
classes. A rule of yours on the library's classes needs equal specificity, and a declaration the
library marks `!important` needs `!important` too. A version of the stylesheet in a CSS cascade
layer, which would let any of your rules win, is planned for a later release.

## Stacking against your own overlays

If your application's dialogs and the workspace fight over `z-index`, move the library's whole
range in one go:

```ts
import { provideDockableDesktop } from 'angular-dockable-desktop';

export const providers = [provideDockableDesktop({ zIndexBase: 3000 })];
```

Floating windows and every piece of library chrome shift together, through `--ndd-z-base`. The
default is `1000`. Set it through the config, not the token: `<ndd-desktop>` writes the token
from the config.

## Custom classes on library containers

For targeted styling without fighting the cascade:

```ts
import { createWorkspace } from 'angular-dockable-desktop';

export const workspace = createWorkspace({
  classes: {
    window: 'my-window',     windowBody: 'my-window-body',
    modal: 'my-modal',       modalBody: 'my-modal-body',
    sidePanel: 'my-drawer',  sidePanelBody: 'my-drawer-body',
  },
});
```

Your classes are *added* to the library's own, so `ndd-` styling stays and yours layers on top.
This is the way in for a utility framework — Tailwind, Bootstrap, Angular Material's utility
classes — on elements that live inside the library's markup and that you otherwise cannot
reach. The `HostClasses` type lists the six fields.

## Giving the workspace a height

The library does not set `height: 100%` on `html`, `body` or your root component, as
react-dockable-desktop did, because that changes the page of any application that embeds a
workspace in part of a view. The workspace fills its container (`height: 100%`), so the
container needs a real height. In development, a workspace that measures under 10px tall logs a
warning naming the ancestor that broke the height chain.

For the common full-screen case there is an opt-in utility, `ndd-fill-viewport`
(`height: 100vh; overflow: hidden`). It works on your own container and on the desktop element
itself:

```html
<ndd-desktop class="ndd-fill-viewport" />
```

In vdd the class did nothing on the desktop element, because the later
`.vdd-workspace { height: 100% }` rule had the same specificity and won; ndd's selector includes
`.ndd-workspace.ndd-fill-viewport`, so it works in both places (PARITY.md N11, and
[chapter 12](12-migrating.md)).

## Token reference

Every token the library declares in the stylesheet's top-level `:root` block, with its default
(the dark look). This is the surface a skin or a retheme overrides; the built-in skins and the
`[data-color-scheme="light"]` block redefine these same names. 120 tokens in all. Where a
default below is "the accent at N%", it is `color-mix(in srgb, var(--ndd-accent-color) N%,
transparent)`.

### Branding — set by your application

Never declared by the library, only read. See [Brand your app](#brand-your-app).

| Token | Default | What it paints |
|---|---|---|
| `--ndd-brand-accent` | *(unset)* | Replaces every skin's accent, in dark and light. |
| `--ndd-brand-on-accent` | *(unset — `#090b11`; `#ffffff` on the primary button in light mode)* | Text on a solid accent fill, in both schemes: the primary button, the active dock target. |
| `--ndd-brand-surface` | *(unset)* | With `--ndd-brand-text`, replaces every skin's backgrounds; see [Your surfaces](#your-surfaces). |
| `--ndd-brand-text` | *(unset)* | With `--ndd-brand-surface`, replaces every skin's text; borders and muted text are mixes of the two. |
| `--ndd-radius-scale` | *(unset — `1`)* | Multiplies every corner; see [Corners](#corners). |

**Internal — don't set these.** `:root` also declares one value per surface token, each a mix of
`--ndd-brand-surface` and `--ndd-brand-text` built on `--ndd--b-base`, which is valid only while
both are set; every skin surface reads its own first. They are not API and may change in any
release; they are listed here only because the token reference names everything `:root`
declares: `--ndd--b-base` · `--ndd--b-bg-panel` · `--ndd--b-bg-primary` · `--ndd--b-bg-tab-bar` · `--ndd--b-bg-tab-hover` · `--ndd--b-bg-tab-inactive` · `--ndd--b-bg-workspace` · `--ndd--b-border-panel` · `--ndd--b-close-btn-active-color` · `--ndd--b-close-btn-color` · `--ndd--b-close-btn-hover-color` · `--ndd--b-custom-btn-hover-color` · `--ndd--b-dock-target-bg` · `--ndd--b-dock-target-center-bg` · `--ndd--b-modal-bg` · `--ndd--b-modal-close-hover-color` · `--ndd--b-modal-curtain-bg` · `--ndd--b-panel-card-bg` · `--ndd--b-panel-card-border` · `--ndd--b-panel-float-bg` · `--ndd--b-panel-text` · `--ndd--b-panel-toolbar-frosted-bg` · `--ndd--b-placeholder-bg` · `--ndd--b-side-panel-bg` · `--ndd--b-side-panel-close-hover-color` · `--ndd--b-sidebar-badge-bg` · `--ndd--b-sidebar-badge-text` · `--ndd--b-sidebar-bg` · `--ndd--b-sidebar-card-bg` · `--ndd--b-sidebar-tabs-bg` · `--ndd--b-sidebar-text-muted` · `--ndd--b-sidebar-text-title` · `--ndd--b-tab-bg-active-unfocused` · `--ndd--b-tab-btn-active-bg` · `--ndd--b-tab-icon-inactive` · `--ndd--b-tab-text-active-focused` · `--ndd--b-tab-text-active-unfocused` · `--ndd--b-taskbar-bg` · `--ndd--b-taskbar-item-bg` · `--ndd--b-taskbar-item-hover-bg` · `--ndd--b-text-primary` · `--ndd--b-text-secondary` · `--ndd--b-text-tab-active` · `--ndd--b-text-tab-hover` · `--ndd--b-text-tab-inactive` · `--ndd--b-toast-bg` · `--ndd--b-window-bg` · `--ndd--b-window-border` · `--ndd--b-window-border-focused` · `--ndd--b-window-header-bg` · `--ndd--b-window-text`.

### Fonts

| Token | Default | What it paints |
|---|---|---|
| `--ndd-font-family` | `var(--ndd-skin-font-family, 'Outfit', 'Inter', system-ui, -apple-system, sans-serif)` | Font of all of the chrome: the roots, the workspace, title bars, tooltips and the context menu (see [the coexistence base](#the-coexistence-base)). Set it on `:root` to brand the application. |

A skin sets its own font as `--ndd-skin-font-family` — declared by each built-in skin (see
[Skin fonts](#skin-fonts)), never on `:root` — which `--ndd-font-family` falls back to.

### Surfaces

| Token | Default | What it paints |
|---|---|---|
| `--ndd-bg-primary` | `#090b11` | Backdrop behind the whole workspace. |
| `--ndd-bg-workspace` | `#0f111a` | The grid area behind panels and dividers. |
| `--ndd-bg-panel` | `#141722` | A docked panel's body. |
| `--ndd-bg-tab-bar` | `#0d0f16` | The strip behind a group's tabs. |
| `--ndd-bg-tab-inactive` | `#0c0d12` | An unselected tab. |
| `--ndd-bg-tab-hover` | `#171a22` | A tab under the pointer. |
| `--ndd-border-color` | `rgba(255, 255, 255, 0.08)` | Default hairline between chrome surfaces. |
| `--ndd-border-panel` | `rgba(255, 255, 255, 0.08)` | Border around a docked panel. |
| `--ndd-resizer-bg` | `rgba(255, 255, 255, 0.08)` | The split divider between panels. |

### Text

| Token | Default | What it paints |
|---|---|---|
| `--ndd-text-primary` | `#f1f5f9` | Default text colour inside library chrome. |
| `--ndd-text-secondary` | `#94a3b8` | Muted text - hints, counts, placeholders. |
| `--ndd-text-tab-active` | `#ffffff` | Label of the selected tab. |
| `--ndd-text-tab-inactive` | `#858b99` | Label of an unselected tab. |
| `--ndd-text-tab-hover` | `#e2e8f0` | Label of a tab under the pointer. |

### Accent

| Token | Default | What it paints |
|---|---|---|
| `--ndd-accent-color` | `var(--ndd-brand-accent, #38bdf8)` (light: `#0066cc`) | The one colour that carries selection and focus throughout. Every tint of it in the library is a `color-mix()` of this token. |
| `--ndd-accent-glow` | the accent at 15% | Translucent halo behind accented elements. |

### Tabs

| Token | Default | What it paints |
|---|---|---|
| `--ndd-tab-bg-active-focused` | `var(--ndd-bg-panel)` | Selected tab in the active group. |
| `--ndd-tab-bg-active-unfocused` | `rgba(20, 23, 34, 0.55)` | Selected tab in an inactive group. |
| `--ndd-tab-text-active-focused` | `var(--ndd-text-tab-active, #ffffff)` | Label of the selected tab in the active group. |
| `--ndd-tab-text-active-unfocused` | `rgba(255, 255, 255, 0.65)` | Label of the selected tab in an inactive group. |
| `--ndd-tab-indicator-focused` | `var(--ndd-accent-color, #38bdf8)` | Accent bar on the selected tab of the active group. |
| `--ndd-tab-indicator-unfocused` | `rgba(255, 255, 255, 0.3)` | Accent bar on the selected tab of an inactive group. |
| `--ndd-tab-accent-bar-width` | `3px` | Thickness of that accent bar. |
| `--ndd-tab-btn-active-glow` | `none` | Halo behind an active sidebar tab button. |
| `--ndd-tab-btn-active-radius` | `0px` | Corner radius of an active sidebar tab button. |
| `--ndd-tab-btn-active-width` | `100%` | Width of the selected rail button, as a share of the rail's tab container — which floors at 44px, a button's own size. |

### Buttons

| Token | Default | What it paints |
|---|---|---|
| `--ndd-close-btn-color` | `#858b99` | A close glyph at rest. |
| `--ndd-close-btn-hover-bg` | `rgba(255, 255, 255, 0.12)` | Its background on hover. |
| `--ndd-close-btn-hover-color` | `#ffffff` | Its glyph on hover. |
| `--ndd-close-btn-active-color` | `#e2e8f0` | Its glyph while pressed. |
| `--ndd-custom-btn-bg` | `rgba(255, 255, 255, 0.03)` | Title-bar and tab-bar action buttons. |
| `--ndd-custom-btn-border` | `rgba(255, 255, 255, 0.05)` | Their border. |
| `--ndd-custom-btn-hover-bg` | `rgba(255, 255, 255, 0.12)` | Their background on hover. |
| `--ndd-custom-btn-hover-color` | `#ffffff` | Their glyph on hover. |
| `--ndd-header-button-gap` | `4px` | Spacing between title-bar action buttons. |

### Floating windows

| Token | Default | What it paints |
|---|---|---|
| `--ndd-window-bg` | `rgba(20, 22, 28, var(--ndd-window-opacity, 0.85))` | A floating window body. Reads `--ndd-window-opacity` if you set one. |
| `--ndd-window-border` | `rgba(255, 255, 255, 0.08)` | A floating window border, unfocused. |
| `--ndd-window-border-focused` | `rgba(255, 255, 255, 0.28)` | A floating window border when it is the active panel. |
| `--ndd-window-header-bg` | `rgba(0, 0, 0, 0.25)` | A floating window's title bar. |
| `--ndd-window-text` | `#f8f9fa` | Title-bar text and icons. |
| `--ndd-window-shadow` | `0 16px 40px rgba(0, 0, 0, 0.4)` | Drop shadow, unfocused. |
| `--ndd-window-shadow-focused` | `0 24px 50px rgba(0, 0, 0, 0.55)` | Drop shadow when focused. |

### Modals

| Token | Default | What it paints |
|---|---|---|
| `--ndd-modal-curtain-bg` | `rgba(9, 11, 17, 0.65)` | The dimming layer behind a modal. |
| `--ndd-modal-bg` | `rgba(20, 23, 34, 0.95)` | A modal's window box. |
| `--ndd-modal-border` | `rgba(255, 255, 255, 0.08)` | A modal's border. |
| `--ndd-modal-header-bg` | `rgba(0, 0, 0, 0.15)` | A modal's header strip. |
| `--ndd-modal-header-border` | `rgba(255, 255, 255, 0.06)` | Hairline under a modal header. |
| `--ndd-modal-close-hover-color` | `#ffffff` | A modal's close button on hover. |

### Side panels

| Token | Default | What it paints |
|---|---|---|
| `--ndd-side-panel-bg` | `rgba(20, 23, 34, 0.88)` | A side panel (drawer) body. |
| `--ndd-side-panel-border` | `rgba(255, 255, 255, 0.08)` | A drawer's edge border. |
| `--ndd-side-panel-header-bg` | `rgba(0, 0, 0, 0.15)` | A drawer's header strip. |
| `--ndd-side-panel-header-border` | `rgba(255, 255, 255, 0.06)` | Hairline under a drawer header. |
| `--ndd-side-panel-close-hover-color` | `#ffffff` | A drawer's close button on hover. |

### Taskbar

| Token | Default | What it paints |
|---|---|---|
| `--ndd-taskbar-bg` | `rgba(0, 0, 0, 0.75)` | The minimised-panel strip. |
| `--ndd-taskbar-border` | `rgba(255, 255, 255, 0.1)` | The strip edge. |
| `--ndd-taskbar-nav-color` | `rgba(255, 255, 255, 0.5)` | Its overflow arrows. |
| `--ndd-taskbar-item-bg` | `rgba(15, 23, 42, 0.6)` | A minimised panel icon tile. |
| `--ndd-taskbar-item-hover-bg` | `rgba(15, 23, 42, 0.8)` | That tile on hover. |
| `--ndd-taskbar-item-border` | `rgba(255, 255, 255, 0.08)` | The tile border. |
| `--ndd-taskbar-item-text` | `var(--ndd-accent-color, #38bdf8)` | The tile icon colour. |

### Scrollbars

| Token | Default | What it paints |
|---|---|---|
| `--ndd-scrollbar-thumb` | `rgba(255, 255, 255, 0.1)` | Scrollbar thumb inside library chrome. |
| `--ndd-scrollbar-thumb-hover` | `rgba(255, 255, 255, 0.2)` | Thumb on hover. |
| `--ndd-scrollbar-track` | `rgba(255, 255, 255, 0.01)` | Scrollbar track. |

### Focus rings

| Token | Default | What it paints |
|---|---|---|
| `--ndd-focus-ring` | `2px solid var(--ndd-accent-color)` | Outline on a toolbar, rail or panel toolbar button reached from the keyboard (`:focus-visible`). Read with that fallback rather than declared, so it follows the skin's or your brand's accent wherever it is drawn. |
| `--ndd-context-menu-focus-ring` | `var(--ndd-focus-ring)` | Outline on a context-menu item that has keyboard focus. |

### Panel overlay — toolbars

| Token | Default | What it paints |
|---|---|---|
| `--ndd-panel-toolbar-padding` | `8px` | Padding inside a panel toolbar strip. |
| `--ndd-panel-toolbar-gap` | `4px` | Gap between its buttons. |
| `--ndd-panel-toolbar-btn-size` | `32px` | Button hit size. |
| `--ndd-panel-toolbar-btn-radius` | `6px` | Button corner radius. |
| `--ndd-panel-toolbar-fg` | `rgba(255, 255, 255, 0.65)` | Button glyph at rest. |
| `--ndd-panel-toolbar-fg-hover` | `rgba(255, 255, 255, 0.95)` | Button glyph on hover. |
| `--ndd-panel-toolbar-btn-hover-bg` | `var(--ndd-toolbar-btn-hover-bg, rgba(255, 255, 255, 0.08))` | Button background on hover. |
| `--ndd-panel-toolbar-icon-size` | `20px` | Icon inside a panel toolbar button: icon fonts follow it as `font-size`, SVG icons as width and height. |
| `--ndd-panel-toolbar-btn-active-bg` | `color-mix(in srgb, var(--ndd-accent-color) 65%, #000000)`; light: `var(--ndd-accent-color)` | Background of a toggled-on button, the same in every `buttonVariant`. |
| `--ndd-panel-toolbar-btn-active-color` | `var(--ndd-brand-on-accent, #ffffff)` | Icon of a toggled-on button. |
| `--ndd-panel-toolbar-btn-bg` | `var(--ndd-panel-float-bg)` | `soft` button chip. |
| `--ndd-panel-toolbar-btn-bg-hover` | the chip, 14% toward the hover glyph colour | `soft` button chip on hover. |
| `--ndd-panel-toolbar-btn-border` | `1px solid var(--ndd-panel-float-border)` | `soft` button chip edge. |
| `--ndd-chrome-icon-size` | `22px` | Icon inside workspace toolbar buttons and sidebar rail buttons. |
| `--ndd-toolbar-btn-toggle-active-bg` | `color-mix(in srgb, var(--ndd-accent-color) 22%, transparent)`; light: `16%` | Background of a toggled-on workspace toolbar toggle. |
| `--ndd-toolbar-btn-toggle-active-color` | `var(--ndd-tab-icon-active)` | Its icon. |
| `--ndd-toolbar-btn-toggle-active-border` | `var(--ndd-tab-icon-active)` | Its 1px edge. |
| `--ndd-panel-toolbar-separator-color` | `var(--ndd-toolbar-separator-color, rgba(255, 255, 255, 0.09))` | Separator inside a panel toolbar. |

### Panel overlay — floating widgets

| Token | Default | What it paints |
|---|---|---|
| `--ndd-panel-float-bg` | `rgba(22, 24, 34, 0.92)` | A floating widget inside a panel. |
| `--ndd-panel-float-border` | `rgba(255, 255, 255, 0.1)` | That widget border. |
| `--ndd-panel-float-radius` | `8px` | Its corner radius. |
| `--ndd-panel-float-shadow` | `0 4px 16px rgba(0, 0, 0, 0.35)` | Its shadow when not on top. |
| `--ndd-panel-float-shadow-active` | `0 8px 28px rgba(0, 0, 0, 0.55)` | Its shadow when on top. |
| `--ndd-panel-float-header-bg` | `var(--ndd-window-header-bg, rgba(0, 0, 0, 0.25))` | Its header, when not on top. |
| `--ndd-panel-float-header-bg-active` | `var(--ndd-window-header-bg, rgba(0, 0, 0, 0.25))` | Its header, when on top. |
| `--ndd-panel-float-title-color` | `var(--ndd-window-text, #f8f9fa)` | Its title text, when not on top. |
| `--ndd-panel-float-title-color-active` | `var(--ndd-window-text, #f8f9fa)` | Its title text, when on top. |

### For panel content

| Token | Default | What it paints |
|---|---|---|
| `--ndd-panel-card-bg` | `rgba(0, 0, 0, 0.2)` | Card surface offered to panel content that wants to match the chrome. |
| `--ndd-panel-card-border` | `rgba(255, 255, 255, 0.1)` | That card border. |
| `--ndd-panel-text` | `var(--ndd-text-primary)` | Text colour for the same. |
| `--ndd-panel-title-color` | `var(--ndd-accent-color, #38bdf8)` | Heading colour for the same. |

### Sidebar — rail and drawer

| Token | Default | What it paints |
|---|---|---|
| `--ndd-sidebar-tabs-bg` | `#141619` | The activity rail behind the tab buttons. |
| `--ndd-sidebar-bg` | `#1e2024` | The drawer's surface. |
| `--ndd-sidebar-border` | `rgba(255, 255, 255, 0.08)` | Rail and drawer edges. |
| `--ndd-sidebar-drawer-header-bg` | `rgba(0, 0, 0, 0.12)` | The drawer's header strip. |
| `--ndd-sidebar-text-title` | `#f8f9fa` | Headings inside the drawer. |
| `--ndd-sidebar-text-muted` | `#8a90a0` | Secondary text inside the drawer. |
| `--ndd-tab-icon-inactive` | `#9ea4b0` | Icon of an unselected rail button. |
| `--ndd-tab-icon-active` | `var(--ndd-accent-color)` | Icon of the selected rail button, and of an active toolbar button. |
| `--ndd-tab-btn-active-bg` | `#1e2024` | The selected rail button behind its icon. |
| `--ndd-tab-btn-active-shadow` | `none` | Shadow behind it. |
| `--ndd-sidebar-btn-hover-bg` | `rgba(255, 255, 255, 0.05)` | A rail button under the pointer. |
| `--ndd-sidebar-badge-bg` | `#2d3139` | Badge behind a count on a rail button. |
| `--ndd-sidebar-badge-text` | `#b0b5c0` | That badge text. |
| `--ndd-sidebar-card-bg` | `rgba(255, 255, 255, 0.03)` | Card surface offered to drawer content. |
| `--ndd-sidebar-card-border` | `rgba(255, 255, 255, 0.08)` | That card border. |
| `--ndd-sidebar-card-hover-bg` | `rgba(255, 255, 255, 0.04)` | That card on hover. |
| `--ndd-sidebar-card-hover-border` | the accent at 25% | Its border on hover. |
| `--ndd-sidebar-card-active-bg` | the accent at 6% | That card when selected. |
| `--ndd-sidebar-card-active-border` | the accent at 30% | Its border when selected. |
| `--ndd-sidebar-card-active-shadow` | the accent at 8% | Its glow when selected. |
| `--ndd-sidebar-btn-front-bg` | `transparent` | Primary-button style offered to drawer content. |
| `--ndd-sidebar-btn-front-border` | `var(--ndd-accent-color)` | Its border. |
| `--ndd-sidebar-btn-front-text` | `var(--ndd-accent-color)` | Its label. |
| `--ndd-sidebar-btn-front-hover-bg` | the accent at 10% | Its background on hover. |

### Workspace toolbar

| Token | Default | What it paints |
|---|---|---|
| `--ndd-toolbar-btn-hover-bg` | `rgba(255, 255, 255, 0.06)` | A workspace-toolbar button under the pointer. |
| `--ndd-toolbar-btn-radio-active-bg` | the accent at 14% | The selected radio button in a workspace toolbar. |
| `--ndd-toolbar-btn-toggle-active-bg` | the accent at 8% | An engaged toggle in a workspace toolbar. |
| `--ndd-toolbar-btn-active-glow` | `none` | Halo behind an active workspace-toolbar button. |
| `--ndd-toolbar-btn-active-shadow` | `none` | Shadow behind either of those. |
| `--ndd-toolbar-accent-bar-width` | `3px` | Thickness of the accent bar on an active workspace-toolbar button. |
| `--ndd-toolbar-separator-color` | `rgba(255, 255, 255, 0.09)` | Separator between workspace-toolbar groups. |

### Machinery

| Token | Default | What it paints |
|---|---|---|
| `--ndd-z-base` | `1000` | Base stacking level for floating windows and all chrome. Set it through the `zIndexBase` field of `WorkspaceConfig`, not here. |
| `--ndd-styles-loaded` | `1` | Sentinel the library checks on mount to detect a missing stylesheet import. Do not override. |

### Toasts

The toast palette is declared in a second `:root` block beside the toast rules, and redefined
under `[data-color-scheme="light"]`. It is overridden the same way.

| Token | Dark default | What it paints |
|---|---|---|
| `--ndd-toast-info-color` | `#67e8f9` | Accent edge, icon and progress bar of an info toast. |
| `--ndd-toast-success-color` | `#4ade80` | The same, for a success toast. |
| `--ndd-toast-warning-color` | `#fbbf24` | The same, for a warning toast. |
| `--ndd-toast-error-color` | `#f87171` | The same, for an error toast. |
| `--ndd-toast-bg` | `#2a2d32` | A toast card's background. |
| `--ndd-toast-border` | `rgba(255, 255, 255, 0.14)` | A toast card's border. |

### Knobs with no base value

These are read by the stylesheet, always with a fallback, but declared nowhere on `:root`.
Leaving them unset is the supported state; set them (on `:root` or in a skin) to change the
fallback.

| Token | Fallback where read | What it paints |
|---|---|---|
| `--ndd-window-opacity` | `0.85` (the alpha inside `--ndd-window-bg`; skins use their own) | Opacity of a floating window's background. Read inside `--ndd-window-bg`, so it applies only while that token keeps the `var(--ndd-window-opacity, …)` form. |
| `--ndd-sidebar-header-area-padding-top` | `8px` | Space above the sidebar rail's header-action area. |
| `--ndd-sidebar-header-area-padding-bottom` | `8px` | Space below it. |
| `--ndd-sidebar-footer-area-padding-top` | `8px` | Space above the rail's footer-action area. |
| `--ndd-sidebar-footer-area-padding-bottom` | `8px` | Space below it. |
| `--ndd-toast-offset-top` | `0px` | Distance of a top-positioned toast container from the viewport top — for clearing an application header. |
| `--ndd-toast-offset-bottom` | `0px` | The same from the bottom, for bottom positions. |
| `--ndd-panel-muted-text` | `rgba(255, 255, 255, 0.5)` | The "loading" text shown while a lazy panel's chunk loads. |

No other custom property with the library's prefix is read by the stylesheet; setting one has
no effect.

## See also

- [Chapter 6](06-sidebar-toolbar.md) and [chapter 7](07-panel-overlay.md) for the elements the
  sidebar, toolbar and panel-overlay tokens paint.
- [Chapter 11](11-i18n.md) for right-to-left layout, which the stylesheet handles with logical
  properties and `[dir="rtl"]` rules rather than tokens.
- [Chapter 13](13-api-reference.md) for `NddDesktop`'s inputs, `injectColorScheme`,
  `ColorScheme` and `HostClasses`.
