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

The base font family is `var(--ndd-font-family, 'Outfit', 'Inter', system-ui, -apple-system,
sans-serif)`. The library does not load Outfit or Inter; if neither is installed the system font
is used. Every rule that sets a font reads the same token — the workspace, window title bars,
tooltips and the context menu keep their own default stacks as fallbacks — so setting
`--ndd-font-family` once changes the font of all of the chrome.

Content *inside* a chrome root — a panel, a drawer tab, a modal body — inherits that base, and
your framework's own classes work there as usual.

## Retheming

Override the tokens. Anywhere that wins the cascade will do:

```css
:root {
  --ndd-accent-color:  #7c3aed;
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

> Tokens live on `:root` by design. The context menu, toasts, modals, drawers, toolbar flyouts
> and the overlay search dropdown all render into `document.body`, and `<ndd-sidebar>` is
> normally an *ancestor* of `<ndd-desktop>`. CSS variables only cascade downward, so scoping
> them to the workspace element would leave those parts unthemed.

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
  --ndd-accent-color: #e5e5e5;
  --ndd-tab-indicator-focused: #ffffff;
  --ndd-panel-float-radius: 0;
}

[data-ndd-skin="mono"][data-color-scheme="light"] {
  --ndd-bg-panel: #ffffff;
  --ndd-bg-tab-bar: #e4e4e4;
  --ndd-accent-color: #171717;
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
`[data-color-scheme="light"]` block redefine these same names. 119 tokens in all.

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
| `--ndd-accent-color` | `#38bdf8` | The one colour that carries selection and focus throughout. |
| `--ndd-accent-glow` | `rgba(56, 189, 248, 0.15)` | Translucent halo behind accented elements. |

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

### Panel overlay — toolbars

| Token | Default | What it paints |
|---|---|---|
| `--ndd-panel-toolbar-padding` | `8px` | Padding inside a panel toolbar strip. |
| `--ndd-panel-toolbar-gap` | `4px` | Gap between its buttons. |
| `--ndd-panel-toolbar-btn-size` | `32px` | Button hit size (a coarse-pointer media rule enlarges it). |
| `--ndd-panel-toolbar-btn-radius` | `6px` | Button corner radius. |
| `--ndd-panel-toolbar-fg` | `rgba(255, 255, 255, 0.65)` | Button glyph at rest. |
| `--ndd-panel-toolbar-fg-hover` | `rgba(255, 255, 255, 0.95)` | Button glyph on hover. |
| `--ndd-panel-toolbar-btn-hover-bg` | `var(--ndd-toolbar-btn-hover-bg, rgba(255, 255, 255, 0.08))` | Button background on hover. |
| `--ndd-panel-toolbar-btn-active-bg` | `var(--ndd-toolbar-btn-radio-active-bg, rgba(56, 189, 248, 0.14))` | Background of a toggled or selected button. |
| `--ndd-panel-toolbar-btn-active-color` | `var(--ndd-tab-icon-active, #38bdf8)` | Glyph of a toggled or selected button. |
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
| `--ndd-tab-icon-active` | `#38bdf8` | Icon of the selected rail button, and of an active toolbar button. |
| `--ndd-tab-btn-active-bg` | `#1e2024` | The selected rail button behind its icon. |
| `--ndd-tab-btn-active-shadow` | `none` | Shadow behind it. |
| `--ndd-sidebar-btn-hover-bg` | `rgba(255, 255, 255, 0.05)` | A rail button under the pointer. |
| `--ndd-sidebar-badge-bg` | `#2d3139` | Badge behind a count on a rail button. |
| `--ndd-sidebar-badge-text` | `#b0b5c0` | That badge text. |
| `--ndd-sidebar-card-bg` | `rgba(255, 255, 255, 0.03)` | Card surface offered to drawer content. |
| `--ndd-sidebar-card-border` | `rgba(255, 255, 255, 0.08)` | That card border. |
| `--ndd-sidebar-card-hover-bg` | `rgba(255, 255, 255, 0.04)` | That card on hover. |
| `--ndd-sidebar-card-hover-border` | `rgba(56, 189, 248, 0.25)` | Its border on hover. |
| `--ndd-sidebar-card-active-bg` | `rgba(56, 189, 248, 0.06)` | That card when selected. |
| `--ndd-sidebar-card-active-border` | `rgba(56, 189, 248, 0.3)` | Its border when selected. |
| `--ndd-sidebar-card-active-shadow` | `rgba(56, 189, 248, 0.08)` | Its glow when selected. |
| `--ndd-sidebar-btn-front-bg` | `transparent` | Primary-button style offered to drawer content. |
| `--ndd-sidebar-btn-front-border` | `#38bdf8` | Its border. |
| `--ndd-sidebar-btn-front-text` | `#38bdf8` | Its label. |
| `--ndd-sidebar-btn-front-hover-bg` | `rgba(56, 189, 248, 0.1)` | Its background on hover. |

### Workspace toolbar

| Token | Default | What it paints |
|---|---|---|
| `--ndd-toolbar-btn-hover-bg` | `rgba(255, 255, 255, 0.06)` | A workspace-toolbar button under the pointer. |
| `--ndd-toolbar-btn-radio-active-bg` | `rgba(56, 189, 248, 0.14)` | The selected radio button in a workspace toolbar. |
| `--ndd-toolbar-btn-toggle-active-bg` | `rgba(56, 189, 248, 0.08)` | An engaged toggle in a workspace toolbar. |
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
| `--ndd-font-family` | `'Outfit', 'Inter', system-ui, -apple-system, sans-serif` | Font of all of the chrome: the roots, the workspace, title bars, tooltips and the context menu (see [the coexistence base](#the-coexistence-base)). |
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
