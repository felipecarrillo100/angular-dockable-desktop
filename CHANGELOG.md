# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release states which vue-dockable-desktop and react-dockable-desktop releases it
corresponds to, as a **Parity** line. The three libraries version independently; the
feature-by-feature map is [docs/PARITY.md](docs/PARITY.md).

## [Unreleased]

### Internal

Faster checks, the same checks. Nothing in the published package changes.

- **`npm run verify`** — types, lint, the unit suite and the stub sweep for only the modules
  changed since `HEAD`, about a minute: the check to run while working. **`npm run gate:release`** —
  `npm run gate -- M13 M14 M15 M16 M17 M18`, one pass: the check to run before a release.
- **One release pass, no repeated work.** Several milestones in one `npm run gate` call share one
  standing gate, and a sub-gate that already passed in the same call is not run again — M15
  re-ran every browser gate M13 had just run, plus the consumer smoke, the round trips and the vdd
  differential. A sub-gate that failed is never reused, nothing is reused outside such a call, and
  every run is listed with its time in `artifacts/gate-runs.jsonl` (`scripts/gates/lib/subgate.mjs`;
  three selftest cases, each seen failing with its rule broken).
- **The full non-vacuity sweep runs in parallel**, in copies of the workspace (three by default),
  never in the real source tree, so an interrupted sweep can no longer leave a stubbed file behind.
  Each copy first runs the unstubbed suite, which must be green. Every module still gets its own
  full run of the suite, and all 53 verdicts matched the serial sweep's.
- **The consumer smoke reuses the app `ng new` generates** for the same CLI version, for up to a
  week (`NDD_CONSUMER_FRESH=1` forces a fresh one; CI always starts fresh). The tarball install, the
  quick start, the build, the server render and the browser still run every time; a library made to
  throw still fails it.
- **The branding gates wait for the page to be still instead of sleeping**, with the old sleep as
  the ceiling; the wait after the pointer leaves a control stays fixed, since the timers it starts
  are invisible to such a check. M17 checks its three corner scales on one page per scene, and no
  longer runs the hover walk for corners, which never read it. M16 captures a scene twice only for
  an unexpected difference. Rewriting both baselines with the new code gave byte-identical fixtures,
  and a corner changed in the stylesheet still fails M17 at every scale.
- **The baselines key elements by library class, not position**, so a new wrapper element no longer
  renames everything after it. Both fixtures were regenerated once: every scene has the same
  entries with identical values, under the new keys.

### Fixed

- **The demo restyled the library's toolbar and rail buttons globally** (from 1.4.0), which M14
  forbids: its icon-sizing rule began with `.ndd-toolbar-btn`. It now starts from the demo's own
  `.dd-icon`, matching the same elements with the same specificity. No release pass had run M14
  since; `gate:release` does.
- **The stylesheet-sync unit test could time out on a loaded machine** (it starts a node process):
  it now allows 30 s. It was the one test the parallel sweep's control run found failing under load.

| | before | after |
|---|---|---|
| release pass, M13–M18 | 2,892 s (48 min) | 1,212 s (20 min) |
| non-vacuity sweep | 776 s | 349–384 s |
| M17 browser gate | 476 s | 115 s |
| M16 browser gate | 263 s | 186 s |
| M15 | 504 s | 9 s (its sub-gates already ran in the pass) |
| consumer smoke | 207 s | 38 s (cached app) |
| while working | a gate run | `npm run verify`, ≈1 min |

## [1.6.0] — 2026-10-05

**Parity: react-dockable-desktop 7.7.0** (vue-dockable-desktop 1.8.0 made the same port).
Ready-made dialogs: the confirmation shows an icon, a new alert dialog, and both as promises.

### Added

- **`<ndd-confirm>` shows an icon left of its message**: a question mark, coloured by
  `alertType` (info, success, warning, danger) with the toast colour tokens. The new `icon` input
  (an `NddIcon`) replaces it; `icon: null` hides it.
- **`NddAlert` (`<ndd-alert>`)**: a message with a single OK button, for telling rather than
  asking. Its icon follows `alertType`, with the same `icon` override. Inputs: `message`,
  `alertType`, `icon`, `okLabel`, `onSettled`. Focus starts on OK and Enter presses it; Escape, the
  backdrop and the × acknowledge it too, unless the modal is `closable: false`. Button hook:
  `data-ndd-alert-ok`.
- **`injectModals().confirm(options)` and `injectModals().alert(options)`** open those dialogs
  (size `'small'`) and return a promise: `confirm` resolves `true` for the confirm button and
  `false` for cancel or any dismissal; `alert` resolves once it is closed. Option types:
  `ConfirmOptions`, `AlertOptions`.
- **Message keys `confirmTitle`** ("Confirmation") **and `alertTitle`** ("Information"), the
  helpers' default titles. A table typed `Record<MessageKey, string>` needs the two new keys.
- New classes: `ndd-dialog-content`, `ndd-dialog-icon`, `ndd-dialog-icon-{info|success|warning|danger}`.

rdd 7.7.0 also fixed an `RddConfirm` that never answered when dismissed, and one that overwrote
the modal's header icon. Neither applied here: `NddConfirm` already settled on destroy and never
set a header icon.

### Upgrading

- A confirmation now draws a question mark beside its message. Pass `icon: null` to keep the
  old look.
- The line under a confirmation's message is now the border of the new icon row,
  `.ndd-dialog-content`, so it spans the icon too; it was `.ndd-confirmation-message`'s own
  `border-bottom`. A stylesheet that restyled that border should target `.ndd-dialog-content`.

### Tests

- `test/components/dialogs.spec.ts` (ported from vdd's `dialogs.test.ts`): settle-once for every
  exit of both dialogs (Escape, backdrop, ×, `closeAllModals`, `close(id)`, the buttons); default,
  custom and hidden icons; the header icon left alone; alert focus, label and `closable: false`;
  both promise helpers, including that an option left out keeps the input's default. Each
  assertion was seen failing with its code removed.
- M10 checks that `<ndd-alert>` settles on destroy and only once, and requires two of the new
  tests; `alert.ts` and `dialog-icon.ts` join the M10 non-vacuity sweep.
- `stylesheet.spec.ts`: every dialog-icon class has a rule coloured from a toast token, and the
  separator is the icon row's border, not the message's (seen failing with each removed).
- The M16 colour baseline (`scripts/gates/browser/fixtures/m16-branding-baseline.json`, which M17
  also reads) is regenerated on purpose: its scenes include a confirmation, whose message now sits
  in the icon row. Nothing outside that modal changed.

## [1.5.1] — 2026-10-04

**Parity: react-dockable-desktop 7.6.1** (internal restructuring; vue-dockable-desktop 1.7.1 made
the same change). No behaviour, API or visual change.

### Internal

- **The stylesheet is built from area files.**
  `projects/angular-dockable-desktop/src/styles/parts/NN-area.css` (tokens, base, coexistence,
  tabs, grid, taskbar, floating windows, context menu, drop zones, one file per skin, sidebar,
  modals, drawers, RTL, toolbar, panel overlay, toasts, the Angular port's own structure…) are
  concatenated in file-name order into `styles.css` next to them, which is generated and committed,
  and published as `angular-dockable-desktop/styles.css` (the area files are not shipped). The
  published stylesheet is byte-identical to 1.5.0 apart from a header comment. To change a style,
  edit the area file and run `npm run css` (or `npm run css:watch`); `npm run css:check` and a unit
  test fail if `styles.css` is out of date. The gates read `styles.css` as before.

### Tests

- The M16 colour baseline (`scripts/gates/browser/fixtures/m16-branding-baseline.json`, which M17
  also reads) is regenerated for 1.4.0's intended toolbar changes (toggle "on" colours and edge,
  the new tokens, the vscode/macos light-mode hover), which 1.4.0 shipped without refreshing it.
  Nothing in this release changes a colour.

## [1.5.0] — 2026-10-04

**Parity: react-dockable-desktop 7.6.0** (vue-dockable-desktop 1.7.0 made the same port).
Context menus open with nothing highlighted, the same every time.

### Changed

- **A context menu opens with focus on the menu itself, no item highlighted.** It used to focus
  its first item, and whether the browser then drew a focus ring depended on the user's previous
  interaction: a menu opened from script (a map library's right-click calling `showContextMenu`,
  say) showed a ring after a page load or a key press and none after a mouse click. ArrowDown
  reaches the first item and ArrowUp the last.
- **Menus opened from the keyboard still start on their first item**: a keyboard `contextmenu`
  event (the ContextMenu key or Shift+F10, which report no pointer position), a button menu opened
  with Enter or Space (the floating window's ⋮), and `initialFocus: 'first-item'`.

### Added

- **`initialFocus?: 'menu' | 'first-item'`** on `ShowContextMenuOptions`
  (`workspace.showContextMenu`, `injectContextMenu()`).
- **`--ndd-context-menu-focus-ring`**: the outline on a menu item with keyboard focus, by default
  `--ndd-focus-ring` (the skin's accent). Both are now documented in the theming chapter. They are
  read with a fallback rather than declared: a value declared on `:root` would be computed there
  once and stop following the skin's or your brand's accent.

### Fixed

- **Menu items drew the browser's default focus ring** instead of the skin's.

### Upgrading

- Nothing to change for menus opened with the mouse or from script. If you open a menu from your
  own keyboard shortcut, pass `initialFocus: 'first-item'` so it starts on an item.
- Tests that expected the first item to have focus right after `showContextMenu` should press
  ArrowDown first, or open the menu with `initialFocus: 'first-item'`.

### Tests

- `context-menu.spec.ts`: the menu itself is focused on open; ArrowUp from it; `initialFocus`;
  keyboard and mouse `contextmenu` events; a keyboard click on a button menu. Each was seen
  failing with its part of the fix removed.
- The M8 browser gate checks the new opening deliberately (an intended behaviour change): the
  menu is focused with no item highlighted, ArrowDown reaches "First", ArrowDown and Enter run
  "Second", and `initialFocus: 'first-item'` opens on "First".

### Documentation

- Overlays chapter: initial focus, the option, keys, the focus ring. Theming chapter: a "Focus
  rings" table. API reference: `ShowContextMenuOptions.initialFocus`. PARITY: N3 updated, a 1.5.0
  table.

## [1.4.0] — 2026-10-04

**Parity: react-dockable-desktop 7.5.0** (vue-dockable-desktop 1.6.0 made the same port).
Toolbar buttons: the library sizes the icon inside its own buttons, and a toggle that is on can be
told from one that is off at a glance, on chrome and over panel content alike. No inputs were added
or removed; everything new is a CSS custom property.

### Added

- **Icon size tokens.** `--ndd-panel-toolbar-icon-size` (`20px`) sizes icons in
  `<ndd-panel-toolbar>` buttons and toggles; `--ndd-chrome-icon-size` (`22px`) sizes them in the
  workspace toolbar and the sidebar rail. Icon fonts follow the button's `font-size`; SVG icons,
  inline or inside an icon component or `<ndd-icon>`, follow the token's width and height, even
  when the SVG has its own `width`/`height` attributes.
- **`soft` chip tokens**: `--ndd-panel-toolbar-btn-bg`, `--ndd-panel-toolbar-btn-bg-hover`,
  `--ndd-panel-toolbar-btn-border`.
- **Workspace toolbar toggle tokens**: `--ndd-toolbar-btn-toggle-active-color` and
  `--ndd-toolbar-btn-toggle-active-border`.

### Changed

- **Panel toolbar "on" state** is a solid chip with a white icon, the same in every
  `buttonVariant`: in dark the accent mixed 65% with black, in light the plain accent. The icon is
  `--ndd-brand-on-accent` when a brand sets it. It clears WCAG's 3:1 non-text contrast. Before, it
  was a 14–15% accent tint.
- **`buttonVariant="soft"`** is a near-opaque chip with a hairline edge, readable over panel
  content. Before, it was a 6% (dark) / 4% (light) wash.
- **Workspace toolbar toggle "on"**: the accent tint goes from 6–8% to 22% (dark) / 16% (light),
  with a 1px accent edge and the accent icon.
- **Icons in toolbar and rail buttons are larger by default**: 20px in panel toolbars, 22px in
  the workspace toolbar and rail.

### Fixed

- **Keyboard focus was invisible on toolbar and rail buttons**: `.ndd-toolbar-btn` and
  `.ndd-sidebar-tab-btn` removed the outline with nothing in its place. They, and panel toolbar
  buttons, show a focus ring for keyboard focus now (`--ndd-focus-ring`, default a 2px accent
  outline), as rdd does.
- **`filled` toggles looked the same on and off**; it now rests on an accent tint with an accent
  edge, and "on" is the solid chip.
- **vscode and macos painted a white hover tint in light mode** on panel toolbar buttons; it now
  applies in dark only.
- **`buttonSize` was documented as the icon size.** It sets the button size.
- The theming chapter no longer claims a coarse-pointer rule enlarges panel toolbar buttons, and
  `NddIcon`'s documentation says where a class string goes (a `<span>` inside `<ndd-icon>`).

### Upgrading

- Remove per-icon sizes inside toolbar and rail buttons: set `--ndd-panel-toolbar-icon-size` /
  `--ndd-chrome-icon-size` instead. An inline `style` size, and a wrapper with its own fixed size
  such as `mat-icon`, still win; give those `width: 1em; height: 1em` (and `font-size: inherit`).
- If you added shadows to keep toolbar icons readable over panel content, remove them and use
  `buttonVariant="soft"` or a `frosted`/`solid` toolbar.
- To restyle "on", set `--ndd-panel-toolbar-btn-active-bg` and `--ndd-panel-toolbar-btn-active-color`
  (recipes in the panel overlay chapter).

### Documentation

- Panel overlay chapter: "Styling toolbar buttons" (what the library owns, icon sizes, variants,
  the "on" tokens, recipes); corrected `buttonSize`.
- Theming chapter: new icon and toggle tokens; panel toolbar defaults updated.

### Demo

- The demo's mask icons follow the icon size inside library buttons (`width/height: 1em`), and a
  "Toolbar Buttons" panel shows every `buttonVariant` in every state over light, dark and busy
  content, with icon-size sliders.

## [1.3.1] — 2026-10-01

**Parity: react-dockable-desktop 7.4.1 fixes** (vue-dockable-desktop 1.5.1 made the same port).
From a review of 7.4.0. No API changes.

### Fixed

- **A message's placeholder was filled only once**: in `'{n} of {n}'` the second `{n}` stayed as
  written. The default formatter (used when you configure no `formatMessage`) replaces every
  occurrence now, in `formatLabel()` and the workspace's `format()` alike — one copy, which the
  workspace calls.
- **A drag survived the browser window losing focus**: after an alt-tab mid-drag, the armed drop
  target, the drop zones and `ndd-dragging-active` stayed, and the next click anywhere docked the
  panel into the zone it had been over. The window losing focus now ends the drag as a
  `pointercancel` does — a tab drag (mouse or touch) and a floating window dragged by its title
  bar alike.
- **Layout repair** also drops a group's panel id that the layout's `panels` doesn't have
  (re-deriving the group's active tab), and gives a split whose sizes don't match its children,
  or aren't finite positive numbers, even sizes — before, a child got `flex-basis: NaN%`. Each is
  reported in the load warning, as the other repairs are; a layout this version saved has neither.
- **A throwing event subscriber stopped delivery to the others**, and the error escaped into the
  action that published — `loadLayout()` stopped before `layout:changed`. Each subscriber's error
  is now logged (`[angular-dockable-desktop] A subscriber to "<event>" threw:`) and delivery
  continues.

rdd 7.4.1's other two fixes were already in place: a restored window's stacking order (the z
counter is raised to the restored windows' in the constructor and in `loadLayout()`), and the
toolbar search aborting its search and clearing its debounce when destroyed.

### Tests

- `review-fixes.spec.ts` (placeholders, layout repair, the event bus) and `drag-blur.spec.ts`
  (window blur during a mouse, touch and floating-window drag, with uninterrupted drags as
  controls), ported from rdd 7.4.1's `Patch741.test.ts` and `DragBlur.test.tsx`. Each was seen
  failing before its fix and again with the fix removed.

## [1.3.0] — 2026-09-30

**Parity: vue-dockable-desktop 1.1.1, react-dockable-desktop 6.3.1, plus react-dockable-desktop
7.2.0–7.4.0's skin branding and field-report fixes** (vue-dockable-desktop 1.5.0 made the same
port). From a consumer's field report: fixed dropdowns inside frosted windows, direction for the
sidebar and toasts, translated titles, and a quieter restore.

### Added

- **Title functions**: a title (a panel's, a window's, a drawer's, a modal's, a widget's) can be
  `() => string`. The library calls it each time it renders the title, so a function that reads
  your locale signal follows a language change on its own — a translated *string* is fixed in the
  language active when the panel opened. A function isn't saved in a layout: the restored panel
  takes the title its type is registered with. `Label` is now
  `string | MessageDescriptor | (() => string)`.
- **The npm package includes this CHANGELOG** (copied into the library project by
  `scripts/sync-package-readme.mjs`, since ng-packagr copies assets only from there).
- **Reduced motion**: the library's own transitions and animations stop when the user has asked
  the system for reduced motion (`prefers-reduced-motion: reduce`), as with
  `[animations]="false"`. Your own are untouched.

### Fixed

- **A `position: fixed` element inside a frosted container was positioned against the
  container, not the viewport** — so a dropdown, popover or date picker of yours inside a
  floating window, a drawer, an overlay widget, a frosted panel toolbar or (in `macos`) a docked
  panel opened in the wrong place, in some skins and not others. A `backdrop-filter` makes its
  element the containing block for fixed content; the frost now sits on each container's
  `::before` (with the background it tints, where the frost saturates). What is drawn is unchanged.
- **`setDirection('rtl')` did not mirror the sidebar or the toasts**: they followed only the
  page's `dir`. They follow the workspace into RTL now, and so does everything inside the sidebar
  (a toolbar, your own chrome); while the workspace is left-to-right they still follow the page,
  as before.
- **A saved window with unusable geometry reached the window's style**: a `NaN` saved as `null`,
  an `Infinity` or a missing size. Such values are replaced on load by the default a new floating
  window gets, with a warning naming the window.

### Tests

- **M18 browser gate** (`scripts/gates/browser/m18.mjs`, real Chrome, both schedulers): a fixed
  child of each of the 7 frosted cases lands on the viewport, and each renders as before within a
  small tolerance; reduced motion stops every library transition and leaves the page's; the
  sidebar and toasts follow `setDirection` and still follow the page while LTR.
- `field-report.spec.ts` (title functions, finite geometry) and `stylesheet.spec.ts` (the
  consumer content contract), ported from rdd 7.4.0.
- The M16 colour and M17 corner baselines compare a frosted container's `::before` as its
  element: where it is drawn changed, what is drawn did not.
- M18 rules (`scripts/gates/m18.mjs`), including that the package's CHANGELOG copy has not drifted.

### Docs

- Theming: Frosted glass and your own overlays; reduced motion under Animations. i18n: title
  functions; the sidebar and toasts follow `setDirection`; **Angular Material and the CDK** — a
  `provideWorkspaceDirectionality()` recipe that keeps the CDK's `Directionality` in step with the
  workspace (the library takes no CDK dependency). ADR 0017; PARITY.md; the plan's M18.


## [1.2.0] — 2026-09-30

**Parity: vue-dockable-desktop 1.1.1, react-dockable-desktop 6.3.1, plus react-dockable-desktop
7.2.0 and 7.3.0's skin branding** (vue-dockable-desktop 1.4.0 made the same port). Branding, part
two: your own surfaces and corner shape on any built-in skin. See
[Your surfaces](docs/manual/10-theming.md#your-surfaces) and [Corners](docs/manual/10-theming.md#corners).

### Added

- **`--ndd-brand-surface`** and **`--ndd-brand-text`**: set per scheme on `:root`, they replace
  every built-in skin's backgrounds and text — the workspace, panels, tab bar, sidebar, floating
  windows, modals, drawers, the taskbar, toasts, borders and muted text are all derived from the
  two. Set both or neither: with only one set, every skin keeps its own surfaces. A skin keeps
  its shape and effects (macOS's glass, Chrome's tabs, the VS Code accent bar) and each
  translucent surface keeps the skin's own transparency; the accent, status colours and shadows
  are not affected.
- **`--ndd-radius-scale`**: multiplies every corner the library draws — `0` square, `1` each
  skin's own (the default), `1.5` rounder. Circles and pills stay round. It also scales the
  radius tokens you set yourself (`--ndd-panel-float-radius`, `--ndd-panel-toolbar-btn-radius`,
  `--ndd-tab-btn-active-radius`).
- Manual: **Your surfaces** and **Corners** under Brand your app, the corner habit for custom
  skins, and the three variables in the token reference.

### Fixed

- **The workspace-edge drop preview was Bootstrap blue** (`#007bff`) in every skin, instead of
  the skin's accent. It follows `--ndd-accent-color` and `--ndd-brand-accent` now. It shows only
  while you drag a panel to a workspace edge.
- **Colours no token reached**: the dock-target chips, the light-mode outline button (the
  confirm dialog's Cancel) and the frosted panel toolbar painted literal colours in their own
  rules. They read the surface tokens now, and follow a brand surface; unbranded they are
  unchanged.

### Tests

- **M17 browser gate** (`scripts/gates/browser/m17.mjs`, real Chrome, both schedulers): the corner
  radii of every library element and pseudo-element, in all 7 skins × dark/light, match a 1.1.0
  baseline with the scale unset, are `0px` at scale `0` and 1.5× at `1.5`, with circles and pills
  unchanged; with a brand surface set, no colour of any skin's own palette remains — rendered,
  hovered or as a token — the workspace, panel and tab bar stay distinct, and text on panels meets
  4.5:1 (muted 3:1); with only one of the two set, a scene matches M16's baseline. M16's gate still
  holds with no brand set.
- `stylesheet.spec.ts`, ported from rdd 7.3.0: every corner length is scaled and the library never
  declares the scale; every coloured surface reads a derived value first, declared only on `:root`
  and built on the guarded base; no element rule paints a colour of its own.
- M17 rules (`scripts/gates/m17.mjs`). M16's scene helpers moved to
  `scripts/gates/lib/branding-scenes.mjs`, shared with M17. The playground takes `?bs=`, `?bt=` and
  `?rs=`.
- **M16 no longer pins version 1.1.0**: the current version must have its own CHANGELOG entry, the
  rule ADR 0015 set for M15 (ADR 0016).

### Docs

- Theming chapter: Your surfaces, Corners, the fourth brandable-skin habit, token rows; README
  snippet; ADR 0016; PARITY.md; the plan's M17.


## [1.1.0] — 2026-09-27

**Parity: vue-dockable-desktop 1.1.1, react-dockable-desktop 6.3.1, plus react-dockable-desktop
7.2.0's skin branding.** Put your company's colour and font on any built-in skin with a few CSS
variables — no skin of your own needed. See
[Brand your app](docs/manual/10-theming.md#brand-your-app).

### Added

- **`--ndd-brand-accent`**: set on `:root`, it replaces the accent of every built-in skin in dark
  and light — tab indicators, active sidebar tabs and toolbar buttons, hover and active tints,
  glows, the focused window's glow, the taskbar, the drop and snap highlights, the
  primary button. Unset, each skin keeps its own accent.
- **`--ndd-brand-on-accent`**: the text colour on a solid accent fill (the confirm dialog's
  primary button, the highlighted dock target), for light brand colours such as yellow — in both
  schemes. Defaults as before: `#090b11`, and `#ffffff` on the primary button in light mode.
- **Per-skin fonts** through `--ndd-skin-font-family`: `vscode` uses VS Code's workbench font,
  `macos` San Francisco, `chrome` Google's UI fonts, `slate` Fluent's Segoe UI stack, `nord` a
  humanist sans (Avenir Next) and `tokyo` a monospace (JetBrains Mono); `obsidian` keeps the
  library stack. All are system font stacks — the library still loads no fonts — and your own
  `--ndd-font-family` replaces them all, portalled chrome included.
- **`--ndd-font-family` is declared on `:root`**, as `var(--ndd-skin-font-family, 'Outfit',
  'Inter', system-ui, -apple-system, sans-serif)`, and every chrome rule reads it without a
  fallback of its own. Before, it was declared nowhere and five rules each carried their own
  default stack (the context menu fell back to `-apple-system`, a window title to `'Outfit',
  sans-serif`).
- Manual: **Brand your app** — the brand variables, a per-scheme brand colour, loading your own
  font, following a UI framework's theme (Angular Material 3, Bootstrap, Tailwind, MUI,
  shadcn/ui), where to put a logo (a custom `headerAction` entry on `<ndd-sidebar>`), and how to
  keep a custom skin brandable.

### Changed

- **Browser minimum**: CSS `color-mix()` — Chrome / Edge 111, Safari 16.2, Firefox 113 (all
  2023). In an older browser the tinted hover and active highlights lose their colour; layout and
  behaviour are unaffected.
- **The default skin's font** is VS Code's workbench stack (`-apple-system, BlinkMacSystemFont,
  'Segoe WPC', 'Segoe UI', …`) instead of `'Outfit', 'Inter', …`, which is now the fallback for
  skins that set no font (`obsidian`, and custom skins). If you loaded Outfit for the library,
  set `--ndd-font-family` to it. In `tokyo`, `nord`, `macos`, `chrome` and `slate` the font changes
  too — and panel content inherits it, so in `tokyo` your panels turn monospace unless they set a
  font of their own.
- **Every tint of the accent is derived from it** (`color-mix()` of `--ndd-accent-color`) instead
  of a hand-copied `rgba()`. With the built-in skins and no brand set, the look is unchanged
  except for the fixes below.
- `vscode` light mode has an accent of its own, `#0066cc` — the blue its light-mode tokens
  already used. The primary button, the taskbar's peek handle and the other accent uses, which
  were cyan on a light background, are that blue now. A custom skin that sets no accent gets it
  in light mode too.
- **Set the accent with `--ndd-brand-accent`, not `--ndd-accent-color`.** Every skin and the light
  scheme declare `--ndd-accent-color` with a selector that also matches the workspace element, so
  a `:root` override of it is replaced inside the workspace — now in `vscode` light mode as well,
  where 1.0.0 had no light accent to replace it with.

### Fixed

- **Overriding `--ndd-accent-color` on `:root` had no effect in 6 of the 7 skins**: each skin
  redeclared it on the workspace element. `--ndd-brand-accent`, which every skin reads first, is
  the supported way to rebrand.
- **Changing the accent left the old colour behind**: 142 hover, active and glow colours were
  copies of a skin's accent written as fixed `rgba()` values. They follow the accent now.
- **Skins showed colours that weren't theirs**: the default cyan (and `#0066cc` in light mode)
  left in other skins — the taskbar hover glow, the dock preview and corner-snap highlights, the
  floating-widget drop zones, the light-mode focused-tab indicator and taskbar text, the
  `--ndd-sidebar-card-*` and `--ndd-sidebar-btn-front-*` tokens — now show each skin's own
  accent. `slate` and `tokyo` drew their active states in a blue that wasn't their accent, and
  `obsidian`'s panel toolbar in a violet; they use their accent now. `obsidian`'s dark-mode white
  glows no longer show in light mode, where its accent is black.

### Tests

- **M16 browser gate** (`scripts/gates/browser/m16.mjs`, real Chrome, both schedulers): with no
  brand set, the computed colours of every library element, its pseudo-elements, 8 hover states
  and every token (inside the workspace, in the toolbar outside it, and on `<body>`), in all
  7 skins × dark/light with the chrome opened, match a 1.0.0 baseline — except exactly the fixes
  above; with a brand set, no trace of any original accent remains; a light brand with a dark
  on-accent colour is readable on the primary button in dark and light; each skin's font reaches every piece of
  chrome, and a brand font set on `:root` wins in every skin, portalled chrome included. Its
  `--control` run (a skin that redeclares its accent and its font) is rejected.
- `stylesheet.spec.ts`, ported from rdd 7.2.0's branding contract: every `--ndd-accent-color`
  reads `--ndd-brand-accent` first, nothing in the library declares a `--ndd-brand-*` variable,
  no accent colour is written as a literal outside its one declaration, only `:root` declares
  `--ndd-font-family`, and text on accent fills reads `--ndd-brand-on-accent`.
- M16 rules (`scripts/gates/m16.mjs`): the release files, ADR 0014, the manual's skin-font table
  against the stylesheet, the browser minimum in the READMEs and chapter 1, and PARITY.md.
- The playground takes `?cs=light`, `?ba=` / `?bon=` (brand variables before bootstrap) and
  `?anim=0`, and exposes `NddConfirm` to the gates.
- **The release gate (M15, which CI runs) no longer pins version 1.0.0**: the package version
  must equal `VERSION` and have its own CHANGELOG entry, so it passes on 1.1.0 and every later
  release (ADR 0015).

### Docs

- Theming chapter: **Brand your app**, **Skin fonts**, brandable custom skins (the demo's `mono`
  skin now reads `--ndd-brand-accent` too), and the token reference (branding and font tables;
  tints listed as "the accent at N%").
- The browser minimum in the README and chapter 1; a Branding item in the README's features;
  the rdd 7.2.0 names in the migration chapter; ADR 0014; ADR 0015 (the release gate follows
  the current version); PARITY.md.

## [1.0.0] — 2026-09-24

**Parity: vue-dockable-desktop 1.1.1, react-dockable-desktop 6.3.1.** The first release: a native
Angular 22 implementation of the family's window manager, with the same capabilities and the
same saved-layout format.

### Added

- **The workspace.** `provideDockableDesktop(config)` or `createWorkspace(config)` +
  `provideDockableDesktop(ws)`; `inject(Workspace)` / `injectWorkspace()`. State is signals
  (`state()`, `panels()`, `floating()`, `minimized()`, `activePanelId()`, `dir()`, `isRtl()`),
  deep-frozen in development. Every action of the family (`openPanel`, `floatPanel`,
  `dockPanelToGroup`, `dockPanelToWorkspaceEdge`, `minimizePanel`, `saveLayout`, …) with the same
  names and signatures. A workspace created at module scope works before bootstrap. Lazy panels
  through `loadComponent`, the router's shape. A typed event bus whose subscriptions made in an
  injection context are disposed with it.
- **`<ndd-desktop>`**: the split/tab/edge docking grid, floating windows with eight-direction
  resize, maximise and corner anchors, the taskbar (always, compact, auto-hide) with live
  previews, touch support (long-press drag), structural RTL, seven skins.
- **Zero unmount**: a panel component is created once, into a library-owned host element, and
  moved between the grid, a window, the taskbar preview and a hidden store — never re-created.
  Scroll offsets and focus are restored explicitly.
- **`injectPanel()` → `PanelRef`**: `title`, `isActive`, `isMinimized`, `isFloating`,
  `containerType`, `size` and `dirty` as signals; `setTitle`, `setIcon`, `setDirty`, `close`,
  `minimize`; `onBeforeClose` and `onSaveState`, disposed with the component; and
  **`trackDirty()`**, which follows a Signal Forms form (or any signal). Panel options are
  `input()`s, set through `setInput`.
- **Chrome**: `<ndd-sidebar>` and `<ndd-secondary-sidebar>` (one template), `<ndd-toolbar>`, with
  their state as `model()`s bound through `[( )]`; typed `nddSidebarTab` and `nddSidebarHeader`
  templates; `injectSidebar()`, `injectSidebarTab()`, `injectToolbar()`.
- **Overlays**: `<ndd-modals>` with `injectModals().open()` returning an `NddModalRef<R>`
  (`afterClosed()`, and `injectModalRef()` inside), `<ndd-side-panels>`, `<ndd-confirm>` and the
  built-in unsaved-changes question; `<ndd-toasts>` with a plain `toast` function callable from
  anywhere and the injectable `NddToaster`; `<ndd-context-menu>` with the standard tab, window
  and taskbar menus, `injectPanelContextMenu()`, `[nddContextMenu]`, and a typed custom template.
- **Inside a panel**: `<ndd-panel-overlay>`, `<ndd-panel-toolbar>` and its controls,
  `<ndd-toolbar-search>`, `<ndd-floating-widget>` (`[(open)]`, `[(placement)]`, corner docking and
  stretch placements) and `injectFloatingWidgets()` for widgets opened from data.
- **Contributions**: `injectPanelContribution()`, `injectActiveContribution()`,
  `injectMergedToolbarItems()` and `injectMergedSidebarTabs()` — a panel contributes to the
  application's toolbar and sidebar only while it is the active, visible one.
- **i18n**: one `formatMessage(descriptor)` function for every string; a formatter that reads a
  signal relabels the chrome live. `setDirection('rtl')` mirrors the workspace.
- **Theming**: 125 documented `--ndd-*` tokens, light and dark through the application's
  `data-color-scheme`, `injectColorScheme()`, and the `ndd-fill-viewport` utility.
- **Server-side rendering and hydration**, zoneless-first with zone.js supported.
- **Development diagnostics** — a missing stylesheet, a zero-height desktop, misuse outside a
  panel, layout repair — guarded inline by `ngDevMode`, so a production bundle carries none of
  them.
- **The demo** (`projects/demo`): 16 panel kinds with Monaco, Leaflet and a `unified` markdown
  pipeline without framework wrappers, six locales, eight skins, RTL.
- **The manual** (`docs/manual/`, 13 chapters), including migration from rdd and vdd and a token
  reference.

### Compatibility

- The saved layout is byte-compatible with react-dockable-desktop and vue-dockable-desktop:
  rdd 6.2.0's fixtures and both libraries' saves load and re-save identically in all directions.
- Every vdd test suite is ported (839 tests against vdd's 765), with vdd's test names.

### Differences from vue-dockable-desktop 1.1.1

All sixteen of vdd's fixes to rdd (D1–D16) are carried. ndd also fixes seventeen things vdd
does differently (N1–N17), most of them back-portable. Among them:

- a split divider dragged under RTL follows the pointer (N15);
- a `ToastAdapter` receives `show` as well as `update` and `dismiss` (N16);
- a custom context-menu template's own buttons work with a real pointer (N17);
- the tab close button is not a nested control; Delete closes a focused tab (N4);
- server rendering works (N12); `ndd-fill-viewport` works on the desktop itself (N11).

The full list, each pinned by a test or a gate, is [docs/PARITY.md §4](docs/PARITY.md).

### Dependencies

- Peer: `@angular/core` and `@angular/common` `^22.0.0`. **No runtime dependencies** beyond `tslib`,
  which ng-packagr declares for every Angular library (the bundle itself imports only
  `@angular/core` and `@angular/common`), and no dependency on `@angular/cdk` or `@angular/aria`.

[Unreleased]: https://github.com/felipecarrillo100/angular-dockable-desktop/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/felipecarrillo100/angular-dockable-desktop/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/felipecarrillo100/angular-dockable-desktop/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/felipecarrillo100/angular-dockable-desktop/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/felipecarrillo100/angular-dockable-desktop/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/felipecarrillo100/angular-dockable-desktop/releases/tag/v1.0.0
