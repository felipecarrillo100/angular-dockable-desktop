# angular-dockable-desktop — implementation plan

**Status:** approved 2026-09-24. Executed autonomously, start to finish.
**Targets:** feature parity with `react-dockable-desktop` **6.3.1** (rdd) and
`vue-dockable-desktop` **1.1.1** (vdd), on Angular **22.x** (current: 22.2.0).
**Short name:** ndd. Prefix `ndd-` (decision D1).

---

## Part A — What we are building

### A1. Non-negotiables

1. **Zero unmount.** A panel's component is created once and never destroyed while the panel
   is open. Docking, floating, tabbing, minimising and restoring *move its host element*, so a
   WebGL map, a Monaco model or a playing video survive every layout change. Scroll offsets
   and focus are saved and restored explicitly (vdd D6/D7).
2. **Layout JSON is byte-compatible** with rdd and vdd (`SerializedLayout`, `version: 2`). A
   layout saved by any of the three libraries loads in the others.
3. **It feels like Angular.** Standalone components, signals, `input()` / `model()` /
   `output()`, `inject()`, `provide*()` functions, `ng-template` for custom rendering,
   zoneless and OnPush. If an API exists only because React or Vue needed it, it does not
   survive the port.

### A2. The differentiators we must replicate

| Differentiator | Source of truth |
|---|---|
| Zero-unmount across dock, float **and** tab switching, by default, with no integration work | rdd RETROSPECTIVE §4, vdd ADR 0002 |
| Scroll + focus preserved across re-parenting | vdd ADR 0014 |
| Split-docking grid, tab groups, workspace-edge docking, drop crosses, tab reorder, self-drop no-op | rdd `WindowManager`, rdd 6.3.1 |
| Floating windows: 8-way resize, maximise, minimise, corner anchors with 8px stacking, clamp on resize | vdd `VddFloatingWindow` |
| Taskbar with **live** hover previews (the same DOM node as the running panel) | vdd M7 |
| Structural RTL: drop zones, flyouts and anchors all mirror | rdd `rtl.ts`, vdd |
| Imperative API usable outside the UI tree, before anything renders | rdd `WorkspaceClient`, vdd ADR 0004 |
| Panel lifecycle: dirty state, close guards, confirm-discard, dynamic title/icon, active/minimised/size | vdd `usePanel` |
| Panel overlay: anchored panel toolbars; floating inner widgets that dock to corners and stretch | vdd `VddPanelOverlay` / `VddFloatingWidget` |
| Sidebar + secondary sidebar; declarative toolbar with actions, toggles, radio, groups, flyouts, search | vdd |
| Per-panel contributions that follow the active panel | vdd `useContributions` |
| Side panels, modal stack, toasts (queue, pause-on-hover, promise, adapter), context menus | vdd |
| Typed event bus; layout save/load with serialisability pruning and repair pass | vdd, rdd 6.3.1 |
| 7 skins × light/dark, all CSS variables; prefixed classes, tokens and keyframes | vdd `index.css` |
| Dev-only self-diagnostics (missing stylesheet, zero-height workspace) | vdd diagnostics |
| Touch: long-press drag, coarse-pointer targets | vdd `dragDock` |
| Exported drag/resize primitives; zero runtime dependencies | rdd, vdd |

**vdd is the baseline.** It already fixes D1–D16 and R1, completes the CSS prefix, moves
load-bearing inline layout into CSS, and has **765 tests across 33 files**
(`test/baseline-counts.json`). We port from vdd, and consult rdd only for behaviour vdd
deliberately omitted.

### A3. Angular API design

| rdd | vdd | **ndd** |
|---|---|---|
| `new WorkspaceClient(cfg)` + `<DockableDesktopProvider>` | `createWorkspace(cfg)` + `app.use()` | `provideDockableDesktop(cfg)` in `bootstrapApplication`, then `inject(Workspace)`. `createWorkspace(cfg)` works before or outside DI, and `provideDockableDesktop(instance)` accepts that instance |
| `useWindowManagerState(selector)` | refs | Read-only **signals** on `Workspace`; derived state via `computed()` |
| `useFormContainer()` / `usePanelId()` / `usePanelSize()` | `usePanel()` | `injectPanel()` → `PanelRef`: signals `id`, `isActive`, `isMinimized`, `isFloating`, `containerType`, `size`, `dirty`, `title`; methods `setTitle`, `setIcon`, `setDirty`, `trackDirty`, `close`, `minimize`, `onBeforeClose`, `onSaveState` (auto-disposed through `DestroyRef`) |
| panel `props` | panel `props` | Panel **`input()`s** applied with `ComponentRef.setInput`. `openPanel(id, key, { inputs })`; the serialised key stays `props` |
| two-way prop + handle | `v-model` | **`model()`**: `[(activeTabId)]`, `[(visible)]`, `[(stripVisible)]`, `[(width)]`, `[(open)]`, `[(placement)]` |
| render props | scoped slots | **`ng-template` directives with typed contexts**: `nddSidebarTab`, `nddSidebarHeader`, `nddPanelActions`, `nddContextMenuTemplate`, `nddToastTemplate` |
| `openModal(Cmp, props)` | `useModals()` | `inject(NddModals).open(Cmp, opts)` → `NddModalRef<R>` (`closed: Promise<R>`, `result` signal); `NddSidePanels` the same |
| `toast.*` | `toast` | `inject(NddToaster)` plus the standalone `toast` function |
| event bus | same | `workspace.on(evt, cb)`, auto-disposed in an injection context; `workspace.events$(evt)` returns an `Observable` |
| `usePanelContextMenu` | same | `[nddContextMenu]` directive, or `injectPanel().contextMenu(() => items)` |
| `usePanelContribution` | getter | `providePanelContribution(() => ({ toolbar, sidebar }))` |
| `formatMessage` | workspace field | `provideDockableDesktop({ format })` or the `NDD_MESSAGE_FORMATTER` token; adapter recipes for `@angular/localize`, Transloco and ngx-translate |
| — | — | **Lazy panels:** `{ loadComponent: () => import(...) }`, as in the router |
| — | — | **Signal Forms:** `panel.trackDirty(() => form().dirty())` |

### A4. Architecture

**Zero unmount.** Each panel is created once with
`createComponent(Type, { environmentInjector, elementInjector, hostElement: cacheEl })` and
attached to `ApplicationRef`, never to a `ViewContainerRef` inside a leaf. A single
`PanelHostRegistry` (~60 lines) moves `cacheEl` into the resolved host: leaf body, floating
body, taskbar preview, or a hidden container. The placement effect watches the **resolved host
elements** and runs in `afterRenderEffect`. Scroll and focus are recorded per panel before
each move and re-applied after it, ported from vdd `panelDom.ts`.

**State.** `Workspace` is a plain class holding signals, with no DI in its constructor, and
exposes mutations only as methods. A single `resolveActive()` is called by every placement
action.

**Core reuse.** Ten vdd modules are framework-free and port verbatim: `layoutTree`,
`dragResize`, `anchorGeometry`, `stretch`, `serialize`, `eventBus`, `messages`, `panelMenu`,
`panelDom` and `panelOverlay`. The Vue-dependent ones are rewritten on signals: `workspace`,
`overlays`, `overlayState`, `toast`, `contributions`, `toolbarState`, `registry`,
`serializable` and the type files.

**Styling.** One global `styles.css`, ported from vdd `index.css` with the rename
`vdd-` → `ndd-`, exported through the package's `exports`. Components use
`ViewEncapsulation.None`, and skins are selected with `data-ndd-skin`.

**Change detection.** Zoneless and OnPush (the v22 default). High-frequency listeners are
registered through `NgZone.runOutsideAngular`, which is a no-op when zoneless (D4).

**SSR.** Nothing touches the DOM at construction time. Browser work starts in
`afterNextRender`, and the desktop host carries `ngSkipHydration`.

**Accessibility.** WAI-ARIA tablist, menu, toolbar and dialog patterns with roving tabindex,
checked by axe in the browser gate (D3).

**Library source layout** (`projects/angular-dockable-desktop/src/lib/`):

```
core/            framework-free logic (verbatim vdd ports) + signal rewrites
workspace/       Workspace, createWorkspace, provideDockableDesktop, registry, events
panel/           PanelHostRegistry, PanelRef, injectPanel, scroll/focus preservation
desktop/         NddDesktop, grid, leaf group, tab bar, drop/edge zones, drag ghost,
                 floating window, taskbar, taskbar preview
context-menu/    NddContextMenu, directive, service
sidebar/         NddSidebar, NddSecondarySidebar, rail, drawer, tab directives
toolbar/         NddToolbar, group button, search
overlays/        NddModals, NddSidePanels, NddConfirm, modal/side-panel refs
toast/           NddToasts, toast item, NddToaster, toast()
panel-overlay/   NddPanelOverlay, NddPanelToolbar + controls, NddFloatingWidget
contributions/   providePanelContribution, merge helpers
i18n/            formatter token, messages, direction, colour scheme
diagnostics/     dev-only stylesheet sentinel, zero-height ancestor walk
styles/          ndd.css → dist/styles.css
public-api.ts
```

vdd's 38 components map one-to-one to `Ndd*` components. Vue-only helpers such as
`VddSidebarTabScope` become injectors or directives rather than components.

### A5. Decisions (accepted)

- **D1 — Prefix `ndd-`.** Used for selectors, classes, custom properties and keyframes, and
  the skin attribute `data-ndd-skin`. Exported classes use `Ndd*`. `add` was rejected because
  it reads as the verb. `ngdd` was rejected because the style guide reserves the `ng` prefix
  for Angular, and it reads as a first-party API. `ngxdd` was rejected for its length.
- **D2 — Angular 22 only.** Peers are `@angular/core` and `@angular/common` `^22.0.0`, built
  with partial compilation.
- **D3 — No `@angular/cdk` or `@angular/aria` dependency.** We implement the same ARIA
  patterns ourselves and verify them with axe.
- **D4 — Zoneless-first.** zone.js apps are supported, with a zone build of the playground
  tested at every browser gate.
- **D5 — Name.** `angular-dockable-desktop`.
- **D6 — Agnostic about styling frameworks and component libraries**, as in rdd and vdd.
  - ndd depends on no styling framework or component library: not Angular Material, CDK,
    PrimeNG, Bootstrap or Tailwind. It works alongside any of them, and consumers choose.
  - The library styles only what it renders, through its own `ndd-`-prefixed classes and
    `--ndd-*` variables.
  - It ships no global reset and never styles `html`, `body` or the host app (vdd D8).
  - Its `box-sizing` rule targets only `ndd-` elements, so a host reset cannot resize library
    chrome.
  - Panel content is 100% the consumer's own markup.
  - Theming is CSS variables, so any design system can map its tokens onto `--ndd-*`. The
    manual has recipes for Material, Tailwind and Bootstrap.
  - The demo also uses no UI kit, only its own `dd-` markup.

---

## Part B — How it is executed

### B1. Autonomy contract

I run every milestone to its gate without checking in. The owner reviews the result at the
end.

**Loop per milestone:**
1. Implement the deliverables.
2. Run `npm run gate -- M<n>`.
3. If the gate is red, diagnose and fix the **implementation**, then re-run.
4. When green, append a row to `docs/PROGRESS.md`, write `docs/evidence/M<n>.md` (what was
   asserted and what was found), write the milestone's file-hash manifest
   (`docs/evidence/M<n>.tree.txt`), zip a backup (B5), and start the next milestone.

**When I am stuck** (a gate still red after 5 serious attempts), I do not stop and wait:

| Situation | Action |
|---|---|
| A core guarantee fails: zero-unmount, layout compatibility, the build | Switch to the fallback recorded in the relevant ADR (see B4), write an ADR explaining why, and continue |
| A non-core behaviour cannot match vdd | Record it as a numbered divergence in `docs/PARITY.md` §4 with the evidence, keep a test pinning what ndd *does* do, and continue |
| Scope turns out materially larger than planned | Split the milestone into a/b parts in this plan and continue |
| A decision this plan does not cover | Make it, write an ADR under `docs/decisions/`, and continue |

**Gate integrity.** This is what makes unattended "green" mean something:

1. A gate is never edited to make it pass. It is not loosened, skipped, deleted or narrowed.
   If a gate is genuinely wrong, the fix is a *new* ADR explaining why, made separately
   from any implementation change, and the old rule stays in the selftest.
2. Ported expectations are never weakened. A vdd assertion ndd cannot meet becomes a recorded
   divergence, never a silently edited `expect`.
3. Test counts are monotonic. `scripts/gates/counts.mjs` holds a per-file minimum, initialised
   from vdd's baseline per the mapping in B3.
4. There are no skipped, `todo` or `only` tests at a gate.
5. Non-vacuity is proven. At each test-porting milestone, the gate replaces each touched source
   module in turn with a broken stub (the original is copied aside and restored afterwards;
   there is no git to stash with) and requires the suite to go red.
6. `npm run gate:selftest` proves every gate rule can fail, using seeded violations.

**Boundaries.** These hold regardless of the autonomy above:

- The sibling repos `react-dockable-desktop` and `vue-dockable-desktop` are **read-only**. I
  read, build and run them, but never edit them.
- **No git at all**: no `git init`, no commits. History is kept by per-milestone zip backups
  and file-hash manifests (B5). Nothing is pushed, published to npm or deployed. GitHub Actions
  workflows are *written*, not triggered.
- Nothing is installed globally. All dependencies are local devDependencies, and Chrome runs
  through `playwright-core` with `channel: 'chrome'`, so there is no browser download.
- Work happens only inside `angular-dockable-desktop/` plus the session scratchpad.

### B2. Tooling

| Concern | Tool |
|---|---|
| Workspace | Angular CLI 22 (local `@angular/cli` devDependency, run through `npx ng`): `ng new --no-create-application`, then `ng generate library angular-dockable-desktop --prefix ndd` and `ng generate application playground` / `demo` |
| Scaffolding | CLI schematics (`ng generate component/directive/service --project angular-dockable-desktop`) for every new building block, so files follow CLI conventions |
| Library build | `ng build angular-dockable-desktop` with the `@angular/build:ng-packagr` builder → Angular Package Format, partial compilation; `styles.css` shipped through ng-packagr `assets` and the package's `exports` map |
| Unit tests | Vitest via `@angular/build:unit-test`, jsdom, `TestBed` + `ComponentFixture` |
| Browser gates | `playwright-core` + system Chrome, against the production-built playground and demo served statically |
| Lint | `angular-eslint` + `typescript-eslint`, with selector-prefix rules set to `ndd` |
| Types | `tsc --noEmit` against the library, the demo and a strict-templates consumer check |
| TypeScript | `~6.0`, exactly what `ng new` for Angular 22.2 pins, rather than whatever `npm i typescript` resolves to (vdd ADR 0015 lesson) |

**Standing gate**, run at every milestone:

| Check | What fails it |
|---|---|
| types | any type error, strict templates on |
| lint | any error |
| unit | any failure, skip or `only` |
| build | `ng build angular-dockable-desktop` does not emit FESM + `.d.ts` + `styles.css` |
| counts | any file below its minimum |
| prefix | an unprefixed class, custom property or keyframe in `styles.css`; an unprefixed selector in components |
| api-surface | exports differ from `api-surface.json` |
| docs-api | a doc sample references a symbol that is not exported |
| zone | playground zone build fails to build or boot |
| browser | the milestone's browser rules, in both zoneless and zone builds |

### B3. Test porting method

vdd's suites are the executable specification. Each vdd test file maps to an ndd `*.spec.ts`
that keeps **the same test names and IDs** (PO25, SB22, D14, …). Only the driving code is
rewritten: `@vue/test-utils` becomes `TestBed`, `v-model` becomes `[( )]`, a slot becomes an
`ng-template`. Each file's header maps any case that changed shape. Per-file minimums equal
vdd's baseline; the target is **≥ 765** equivalents plus the Angular-specific additions (lazy
panels, `setInput`, zone build, SSR, Signal Forms, `Observable` events).

### B4. Fallbacks named in advance

| Risk | Primary | Fallback |
|---|---|---|
| A `hostElement` component misbehaves when reparented (CD, `setInput`, destroy) | `createComponent` + `hostElement` + `appRef.attachView` | Create the component into a persistent hidden `ViewContainerRef` and move its root nodes. Proven in the M0 spike alongside the primary, so switching is cheap |
| `afterRenderEffect` ordering does not have host refs ready | `afterRenderEffect` | `afterNextRender` plus an explicit host-registered signal |
| Vitest via the CLI builder cannot run a needed jsdom setup | CLI builder | Standalone Vitest with `@analogjs/vitest-angular` (dev-only) |
| Full SSR is out of reach | SSR-safe shell | Documented browser-only component with a server no-op, asserted by an SSR smoke test |

### B5. Backups, instead of version control

There is no git. After each green gate:

- `.backups/M<n>-<yyyymmdd-hhmm>.zip` is a zip of the whole project, excluding
  `node_modules`, `dist`, `.angular`, `artifacts` and `.backups` itself. It is written with
  `zip -r -q` and immediately verified with `unzip -t`.
- `docs/evidence/M<n>.tree.txt` holds a SHA-256 of every source file, so a regression can be
  located by diffing two manifests without extracting anything.
- A red gate that I recover from by rolling back restores from the last zip, and the rollback
  is noted in `PROGRESS.md`.

The zips are local only and are not part of the package.

---

## Part C — Milestones

Sizes: S / M / L / XL. "Ports" names the vdd test files and minimum counts that land.

### M0 — Zero-unmount spike · S · architecture gate
Throwaway zoneless Angular 22 app in `spike/`. Three hostile panels (a live WebGL canvas, a
playing `<video>`, a long scrolled list with a focused input) are driven through docked →
tabbed → floating → minimised → restored → docked into another leaf. Both the primary
strategy and the B4 fallback are tried.
**Gate (browser):** at every step the same node is kept, `gl.isContextLost() === false`,
`currentTime` keeps advancing, scroll and focus are restored, and a `setInput` or signal change
still renders while the panel sits in a detached host. The `<iframe>` reload is characterised.
Run in both the zoneless and zone builds. **Output:** ADR 0002 records the strategy chosen,
with evidence.

### M1 — Scaffold · S
CLI workspace, library, playground and demo shells, ESLint, Vitest, `playwright-core`, gate
runner, the standing-gate scripts (adapted from vdd `scripts/gates/`), `api-surface.json`,
and ADRs 0001–0006 written from Part A.
**Gate:** standing gate green on a library exporting only `VERSION`; `gate:selftest` proves
every rule can fail.

### M2 — Pure core + stylesheet · M
The ten verbatim core modules, `styles.css` (renamed `vdd-` → `ndd-`), and the rdd 6.2.0
fixtures copied under `test/fixtures/`.
**Ports:** anchorGeometry 12, dragResize 10, layoutTree 40, stretch 12, serializable 12,
stylesheet 7 = **93**.
**Gate:** every fixture parses to the expected tree; zero unprefixed names; no `vdd`/`rdd`
strings left in the stylesheet.

### M3 — Workspace store · M
`Workspace` signal store, `createWorkspace`, `provideDockableDesktop`, the registry with lazy
entries, the event bus with `events$`, i18n plumbing, `resolveActive`, and save/load with
pruning and the repair pass.
**Ports:** registry 9, eventBus 11, stateTransitions 45, workspace 30, useWorkspace 9,
round-trip 26, rdd-fixtures 30, selfDrop 20 = **180**.
**Gate:** `openPanel()` works with no application bootstrapped; every placement action calls
`resolveActive` (checked statically); every fixture round-trips byte-identically.

### M4 — Desktop grid + zero unmount · L · first usable build
`NddDesktop`, grid, leaf group, tab bar, split resize, `PanelHostRegistry`, scroll and focus
preservation, `injectPanel()` (the read-only part), `setInput` inputs, and lazy-panel
placeholders.
**Ports:** desktop 24, usePanel 14 = **38**, plus ndd additions: lazy panels and `setInput`.
**Gate (browser):** a counter, a WebGL context and a scroll offset survive tab switch, split,
split-resize and re-dock, with the same node kept, in both zoneless and zone builds.

### M5 — Floating windows · M
Drag, 8-way resize, maximise, corner anchors with stacking, focus and z-order, clamp.
**Ports:** floatingWindows 25.
**Gate (browser):** real-pointer drag and resize produce exact geometry; D5 per-handle hit
area via `elementFromPoint`; D9 (maximised style applies).

### M6 — Drag and dock · L
Drop crosses, edge zones, corner zones, tab reorder with index correction, drag ghost, touch
long-press, RTL mirroring, self-drop no-op.
**Ports:** dragDock 27.
**Gate (browser):** each drop target yields the expected tree, with mouse and emulated touch,
LTR and RTL. **Differential gate:** one scripted gesture sequence is run against the vdd
playground and the ndd playground, and the two `saveLayout()` JSONs must be equal.

### M7 — Minimise, taskbar, live previews · M
**Ports:** taskbar 20.
**Gate (browser):** the hover preview contains the same DOM node as the running panel; D3,
D4 and D11 regressions.

### M8 — Context menus · S
`NddContextMenu`, the `nddContextMenu` directive, submenus, clamping, the template override.
**Ports:** contextMenu 33.
**Gate:** D1 regression; keyboard navigation per the ARIA menu pattern.

### M9 — Sidebar + toolbar · XL
`NddSidebar`, `NddSecondarySidebar`, `NddToolbar` with `model()`s and template directives.
**Ports:** sidebar 91, toolbar 42 = **133**.
**Gate:** every vdd `v-model` test has a `[( )]` counterpart, tabulated in each file header;
no inline layout declarations except per-render sizes (D12).

### M10 — Overlays, toasts, lifecycle · L
`NddModals`, `NddSidePanels`, `NddConfirm`, `NddToasts`, `NddToaster`/`toast`, dirty state,
close guards, `trackDirty` (Signal Forms), `onSaveState`.
**Ports:** overlays 6, useOverlays 9, toast 16, panelLifecycle 25 = **56**, plus Signal Forms
additions.
**Gate:** lifecycle ordering pinned against Angular's `effect` scheduling (the D14
equivalent); a dirty panel's close is blocked behind the confirm dialog in the browser.

### M11 — Panel overlay · XL
`NddPanelOverlay`, `NddPanelToolbar` and its controls, `NddFloatingWidget`, stretch/snap,
`injectFloatingWidgets()`.
**Ports:** panelOverlay 69, panelToolbarControls 16 = **85**.
**Gate (browser):** D5 hit areas; R1 cannot recur (a real pointer drag on a managed widget
keeps its placement across unrelated re-renders).

### M12 — Contributions, i18n, RTL, diagnostics · M
**Ports:** contributions 21, i18n 25, diagnostics 14 = **60**, plus colour scheme.
**Gate:** a hidden panel's contribution is not surfaced; diagnostics are absent from
production builds (a grep of the production bundle).

### M13 — Parity, compatibility, hardening · L
- **Ports:** styleHookups 14, smoke 1.
- **Checks:**
  - full suite ≥ 765 equivalents;
  - every emitted `ndd-` class has a matching stylesheet rule and vice versa (browser);
  - rdd ↔ ndd and vdd ↔ ndd fixture round-trips in both directions;
  - an axe scan of every chrome surface;
  - a keyboard-only walkthrough;
  - an SSR smoke test (server render without errors);
  - a zone-build drag performance bound;
  - a **coexistence gate (D6):** the playground is re-run with the Bootstrap reboot, the
    Tailwind preflight and an Angular Material theme loaded (each a devDependency used only
    by this test). The computed styles of the library chrome must equal the unstyled
    baseline, and none of those frameworks' generic classes (`.active`, `.btn`, `.hidden`, …)
    may match a library element;
  - a non-vacuity sweep over every source module.
- **Consumer smoke:** `npm pack` the library and install the tarball into a fresh
  `ng new` app in the scratchpad (zoneless, strict, SSR). The quick-start from the README must
  build and render there.
- **Written:** `docs/PARITY.md` complete, with no "TBD".

### M14 — Demo · L
Port vdd's demo: all 18 panels, Leaflet, Monaco, the markdown pipeline, 6 locales, RTL, skins,
and the panel manager form. Demo-only classes use `dd-` and never leak into the library.
**Gate (browser):** a scripted walkthrough opens every panel type, docks, floats, minimises,
restores, saves, reloads and restores, with zero console errors, in both builds.
Screenshots are kept in `artifacts/M14/`.

### M15 — Documentation and release readiness · M
README (quick start, features, API), a user manual (chapters mirroring vdd's), all ADRs,
`PARITY.md`, `CHANGELOG.md` (1.0.0), a migration guide from rdd and vdd, a GitHub Actions
gate workflow and Pages workflow (written, not run remotely), and `LICENSE` (MIT).
**Gate:** the full standing gate plus every browser gate from M4–M14 re-run from a clean
install (`rm -rf node_modules dist && npm ci`); docs-api clean; the consumer smoke re-run.

**Totals:** 16 milestones, ≥ 765 ported test equivalents, and three gates that could force an
architectural fallback (M0, M3, M13), each with its fallback named in B4.

---

## Part D — What "ready" means at the end

- `dist/angular-dockable-desktop/` is a publishable APF package (not published), and its
  `npm pack` tarball is proven in a fresh Angular 22 app.
- `projects/demo` is a full demo app, runnable with `npm run demo`, with a production build
  that passes the walkthrough.
- `projects/playground` is the minimal harness.
- The test suite has ≥ 765 tests, is green, and has been proven non-vacuous.
- `docs/` contains the manual, ADRs, PARITY, PROGRESS (one row per gate run) and evidence
  (one file per milestone).
- `.backups/` holds one zip per milestone, plus a hash manifest per milestone in `docs/evidence/`.
- A final report lists what was built, every divergence from vdd, every fallback taken, and
  anything left open.
