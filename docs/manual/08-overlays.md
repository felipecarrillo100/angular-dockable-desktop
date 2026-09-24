# 8. Modals, side panels, toasts and context menus

Four things that appear over the workspace rather than inside it. All of them are driven from
plain calls that work anywhere — a component, a service, an HTTP interceptor, a route guard —
because the state behind them lives on the workspace (or, for toasts, at module scope), not in
a component.

Place the hosts once, in your root component:

```ts
import { Component } from '@angular/core';
import { NddContextMenu, NddDesktop, NddModals, NddSidePanels, NddToasts } from 'angular-dockable-desktop';

@Component({
  selector: 'app-root',
  imports: [NddDesktop, NddContextMenu, NddSidePanels, NddModals, NddToasts],
  template: `
    <ndd-desktop />
    <ndd-context-menu />
    <ndd-side-panels />
    <ndd-modals />
    <ndd-toasts position="top-right" />
  `,
})
export class App {}
```

Where they sit in the tree does not matter: each positions and stacks itself (`position: fixed`,
or portalled to the document body). What matters is that they are rendered — see "Place
`<ndd-modals>`" below for the one case where forgetting has a visible consequence.

## Modals

```ts
import { injectModals } from 'angular-dockable-desktop';

export class FeatureList {
  private readonly modals = injectModals();

  async edit(featureId: number) {
    const ref = this.modals.open<boolean>(EditFeature, { featureId }, { title: 'Edit feature', size: 'medium' });
    const saved = await ref.afterClosed();   // true, or undefined if dismissed
  }
}
```

`injectModals()` must be called in an injection context (a field initialiser or a constructor).
It returns `stack` and `topmost` (signals), `open`, `close(id, { force? })` and `closeAll()`.

`open<R>(component, inputs?, options?)` returns an `NddModalRef<R>`, shaped like Angular
Material's `MatDialogRef`:

| Member | |
|---|---|
| `id` | The overlay instance id — what `close(id)` takes. |
| `close(result?)` | Close now, handing `result` to `afterClosed()`. Skips the close guard and the dirty check. |
| `requestClose()` | Close as the × would: through the close guard and the unsaved-changes question. |
| `afterClosed()` | A promise that resolves once the modal is gone: with the `close(result)` value, or `undefined` for any other way out (Escape, backdrop, ×, `closeAll`). |

Modals stack, so opening one never closes another, and a modal opened from inside a modal
lands on top of it.

| Option | |
|---|---|
| `title` | Header title. A string or a message descriptor ([chapter 11](11-i18n.md)). |
| `icon` | An `NddIcon` — a component, a `TemplateRef` or a class string — shown before the title. |
| `size` | `'small'` · `'medium'` · `'large'` · `'fullscreen'` · `'auto'` (default) |
| `closable` | `false` removes the × *and* dismissal by Escape or backdrop click. Default `true`. |
| `bodyPadding` | A number (px) or any CSS value. Unset by default, so content goes edge-to-edge. |

`inputs` are applied to the component with `setInput`, and only the inputs the component
declares are passed — an extra key is ignored rather than raising NG0303. If the component
declares a `panelId` input, it receives the overlay's id, whatever `inputs` said.

### Inside a modal

The content component gets the same `injectPanel()` contract a docked panel gets, so one
component can be opened as a tab, a floating window, a drawer or a modal. It also gets
`injectModalRef()`, to close with a result:

```ts
import { Component, effect, input } from '@angular/core';
import { injectModalRef, injectPanel } from 'angular-dockable-desktop';

@Component({ selector: 'app-edit-feature', template: `…<button (click)="save()">Save</button>` })
export class EditFeature {
  readonly featureId = input.required<number>();
  private readonly panel = injectPanel();
  private readonly ref = injectModalRef<boolean>();

  constructor() {
    // PanelRef actions run untracked, so they are safe to call from an effect.
    effect(() => this.panel.setTitle(`Editing feature ${this.featureId()}`));
  }

  save() {
    // … persist …
    this.ref.close(true);
  }
}
```

`injectModalRef()` throws outside a modal's content. Inside a drawer, use `injectPanel().close()`.

Inside any overlay, `PanelRef`'s actions — `setTitle`, `setIcon`, `setDirty`, `trackDirty`,
`close` — act on the overlay. Its signals describe a *workspace* panel, so in an overlay only
`id` and `containerType` (`'modal'`, `'left-panel'` or `'right-panel'`) are meaningful; the
others report their defaults. `onBeforeClose` and `onSaveState` register with the workspace
and do nothing in an overlay — see "Close guards" below for the overlay form.

## Side panels

Two drawers, one per edge:

```ts
import { injectSidePanels } from 'angular-dockable-desktop';

export class Shell {
  private readonly drawers = injectSidePanels();

  async showLayers() {
    const id = await this.drawers.openLeft(LayerList, { layers: this.layers() }, { title: 'Layers', width: 320 });
  }
}
```

`injectSidePanels()` returns `left` and `right` (signals of the open instance, or `null`),
`openLeft`, `openRight`, `close(id, { force? })` and `closeAll()`. Options are `title`, `icon`,
`width` (a number in px, or any CSS string such as `'30vw'`; default 400) and `bodyPadding`.
`<ndd-side-panels>` takes `defaultWidth` (default `400`), used when a drawer was opened without
a width, and `sides` (`'both'` by default, or `'left'` / `'right'` to render one edge only).

`openLeft` and `openRight` are **async**, and this is worth understanding: each side holds one
panel, so opening is also closing whatever was there. If the occupant has registered a close
guard and it refuses, nothing opens and the promise resolves to `null`:

```ts
const id = await this.drawers.openLeft(NewPanel);
if (id === null) {
  // the panel that was already there refused to go
}
```

A synchronous return would have to either ignore the guard or lie about the id. The
occupant's *dirty* state is not consulted when it is replaced — a guard is the way to object.

**Escape** closes a drawer only when no modal is open. A modal is always on top of a drawer,
so it always gets the key first.

## From a service

`injectModals()` and `injectSidePanels()` are conveniences over `workspace.overlays`, which is
reachable wherever the workspace is — a root service, an interceptor, an error handler:

```ts
import { Injectable, inject } from '@angular/core';
import { Workspace } from 'angular-dockable-desktop';

@Injectable({ providedIn: 'root' })
export class SessionExpiry {
  private readonly overlays = inject(Workspace).overlays;

  async warn(): Promise<void> {
    const id = this.overlays.openModal(SessionExpired, {}, { title: 'Session expired', closable: false });
    await this.overlays.whenClosed(id);
  }
}
```

| `workspace.overlays.*` | |
|---|---|
| `state` | Signal of `{ leftPanel, rightPanel, modals }`. `modals` is bottom to top. |
| `openModal(c, inputs?, options?)` | Pushes a modal; returns its id synchronously. |
| `openLeftPanel` / `openRightPanel` | As `openLeft` / `openRight`: `Promise<string \| null>`. |
| `close(id, result?)` | Removes an instance **immediately** — no guard, no dirty check. |
| `requestClose(id, { force?, confirm? })` | Honours the guard and dirty state. Without a `confirm`, a dirty instance stays open. |
| `whenClosed(id)` | Resolves once the instance is gone, with the `close(id, result)` value or `undefined`. An id that is not open resolves `undefined` at once. |
| `closeAll()` / `closeAllModals()` | Everything, or just the modal stack. Neither consults guards. |
| `registerCloseGuard(id, guard)` | Returns the function that removes it. |
| `setDirty(id, dirty, options?)` | As `PanelRef.setDirty`, by id. |
| `getInstance(id)` / `topmostModal()` | Untracked reads. |

Note the difference in `close`: `overlays.close(id)` is immediate, whereas `injectModals().close(id)`
and `injectSidePanels().close(id)` ask — they go through the guard and the unsaved-changes
question, as the × does. `injectModals().closeAll()` and `injectSidePanels().closeAll()` do not
ask.

## Unsaved changes

Any panel — docked, floating, a drawer or a modal — can mark itself dirty:

```ts
private readonly panel = injectPanel();
protected readonly form = form(this.model);

constructor() {
  this.panel.trackDirty(() => this.form().dirty());   // or setDirty(true) by hand
}
```

A dirty panel shows an asterisk after its title, and closing it asks the user first, through
the library's own dialog:

> **Unsaved Changes**
> "Layers" has unsaved changes. Do you want to discard your changes and close?
> [No] [Yes]

Every close path goes through this: a tab's ×, a floating window's ×, the taskbar menu, a
drawer's or modal's ×, Escape, the backdrop, and `injectPanel().close()`. You do not wire it up
anywhere.

Customise the wording per panel:

```ts
this.panel.setDirty(true, {
  title: 'Discard measurements?',
  message: 'Three measurements have not been saved to the project.',
  alert: 'Depth field is still empty',
  alertType: 'warning',
});
```

`trackDirty` takes the same options, or a getter for them, so the dialog can say what is wrong
at the moment of closing. Skip the question entirely with `close({ force: true })` — which also
skips close guards, so use it for "discard" buttons, not for ordinary closes.

### Close guards

For anything more than a dirty flag, veto the close yourself. In a docked or floating panel:

```ts
this.panel.onBeforeClose(async () => {
  if (!this.hasUnsyncedEdits()) return true;
  return await this.askOurOwnWay();
});
```

In a drawer or a modal, register the guard on the overlay store under the overlay's id, and
remove it with the component:

```ts
import { DestroyRef, inject } from '@angular/core';
import { Workspace, injectPanel } from 'angular-dockable-desktop';

export class LayerList {
  constructor() {
    const { id } = injectPanel();
    const off = inject(Workspace).overlays.registerCloseGuard(id, () => this.canLeave());
    inject(DestroyRef).onDestroy(off);
  }
}
```

Return `false`, or a promise of `false`, to block. `onBeforeClose` is disposed through
`DestroyRef` on its own; there is nothing to unsubscribe. A guard runs *before* the dirty
check: if it returns `true` and the panel is dirty, the built-in question is still asked; if it
returns `false`, nothing is asked.

### Place `<ndd-modals>`

The unsaved-changes question is itself a modal, stacked on whatever is closing, so it needs
`<ndd-modals>` to appear. Without it, **a dirty close refuses instead of discarding** — the
panel simply stays open. That is deliberate: losing a user's edits because a host component
was missing is not a failure mode worth having. If closes are silently doing nothing, check
that `<ndd-modals>` is rendered.

### Escape

Escape belongs to the topmost modal, one modal per press, and reaches a drawer only when no
modal is open. A modal opened with `closable: false` ignores it — which is how you make a
dialog the user must answer. The overlay that answers calls `preventDefault()`, and every
overlay ignores an Escape whose default was already prevented, so one press never closes two
overlays (vdd's `stopPropagation()` did not stop a drawer listening on the same `document`;
see [PARITY N9](../PARITY.md)). Your own document-level Escape handlers can follow the same
rule: check `event.defaultPrevented` first.

## `<ndd-confirm>`

The dialog body the library uses, available for your own confirmations:

```ts
import { NddConfirm, injectModals } from 'angular-dockable-desktop';

export class Selection {
  private readonly modals = injectModals();

  confirmDelete() {
    this.modals.open(NddConfirm, {
      message: 'Delete 4 selected features? This cannot be undone.',
      alert: 'Two of them are referenced by other layers',
      alertType: 'danger',
      yesNo: true,
      onOk: () => this.deleteSelection(),
    }, { title: 'Delete features', size: 'small' });
  }
}
```

| Input | |
|---|---|
| `message` | Required. A string or a message descriptor. |
| `alert` | Optional banner text above the message. |
| `alertType` | `'info'` (default) · `'warning'` · `'success'` · `'danger'` |
| `yesNo` | Label the buttons Yes/No instead of OK/Cancel. Default `false`. |
| `onOk` / `onCancel` | Called by the buttons. |
| `onSettled(ok)` | Called exactly once, however the dialog goes away — button, Escape, backdrop or ×. |

`<ndd-confirm>` closes itself without a result, so its `afterClosed()` resolves `undefined`
whichever button was pressed. To await an answer, wrap `onSettled`:

```ts
const ok = await new Promise<boolean>(resolve =>
  this.modals.open(NddConfirm, { message: 'Overwrite the saved layout?', onSettled: resolve }, { size: 'small' }),
);
```

The confirm button takes focus when the dialog opens, so Enter answers it.

## Toasts

```ts
import { toast } from 'angular-dockable-desktop';

toast.success('Layout saved');
toast.error('Upload failed', { duration: 0 });          // 0 = sticky
toast.info('Reprojecting…', { id: 'reproject' });       // same id updates in place
toast.dismiss('reproject');
toast.dismiss();                                        // all of them
```

`toast` is a plain import, not an injectable — call it from a service, an interceptor, an error
handler, anywhere. Nothing needs to be injected, and no injection context is needed. Every call
returns the toast's id. A toast raised with no `<ndd-toasts>` rendered is not lost: it waits in
the queue and appears when a container renders.

For code that prefers `inject()`, or wants to substitute the toaster in a test, `NddToaster` is
the same API as a root injectable, plus `items`, a signal of the live queue:

```ts
import { inject } from '@angular/core';
import { NddToaster } from 'angular-dockable-desktop';

export class Uploads {
  private readonly toaster = inject(NddToaster);
  done() { this.toaster.success('Upload complete'); }
}
```

It has `show` (the plain `toast(message, options)` call), `info`, `success`, `warning`,
`error`, `dismiss` and `promise`.

Per-toast options: `type`, `duration`, `id` (for deduplication), `closable`, `icon`, `content`
(a component, instead of the message string), `contentInputs` (its inputs) and `onClose`.

### Tracking a promise

```ts
await toast.promise(this.saveProject(), {
  pending: 'Saving project…',
  success: p => `Saved ${p.name}`,
  error: e => `Could not save: ${(e as Error).message}`,
});
```

A sticky "pending" toast appears immediately and is updated in place when the promise
settles — the same card, not a second one. The settled toast uses the `duration` you pass, or
5000 ms. The promise is returned unchanged, so this drops into an existing chain. For an
`Observable`, pass `firstValueFrom(obs$)`.

### `<ndd-toasts>`

| Input | Default | |
|---|---|---|
| `position` | `'top-right'` | also `'top-left'`, `'bottom-left'`, `'bottom-right'` |
| `maxVisible` | `3` | extras wait their turn |
| `defaultDuration` | `5000` | `0` makes every toast sticky |
| `defaultClosable` | `true` | show the × |
| `pauseOnHover` | `true` | hold the timer while the pointer is over a toast |
| `animation` | `'slide'` | also `'fade'`, `'none'` |
| `newestOnTop` | `false` | |
| `progressBar` | `false` | countdown bar along the bottom |
| `width` | `320` | card width in px |
| `adapter` | — | route every call elsewhere; see below |

Beyond `maxVisible`, toasts queue and are promoted as the ones on screen leave. A queued
toast can still be dismissed by id before it is ever shown. The container is a labelled
`role="region"` with `aria-live="polite"`, and each card is `role="status"` ([PARITY N14](../PARITY.md)).

### Using your own notification UI

Pass an `adapter` to `<ndd-toasts>` to hand `toast.*` calls to another library:

```ts
import type { ToastAdapter } from 'angular-dockable-desktop';

const adapter: ToastAdapter = {
  show: (id, message, options) => snackbar.show({ id, message, severity: options.type }),
  update: (id, message, patch) => snackbar.update(id, { message, severity: patch.type }),
  dismiss: id => snackbar.dismiss(id),
  component: null,   // the adapter owns its own DOM
};
```

```html
<ndd-toasts [adapter]="adapter" />
```

While an adapter is set, `<ndd-toasts>` renders no list of its own; give `component` a
component instead of `null` and it renders that, with a `position` input, in its place. That
component can read the queue through `inject(NddToaster).items`. The adapter receives every
call: `show(id, message, options)` for a new toast, with the defaults filled in (`type: 'info'`,
`duration: 5000`, `closable: true`); `update` for a repeated id and for `toast.promise`
settling; and `dismiss`. (vdd never calls `show`; see N16 in [PARITY.md](../PARITY.md).)

## Context menus

Place `<ndd-context-menu>` once, then open a menu from anywhere:

```ts
import { signal } from '@angular/core';
import { injectContextMenu } from 'angular-dockable-desktop';

export class FeatureTable {
  private readonly showMenu = injectContextMenu();
  private readonly snapping = signal(false);

  onRightClick(event: MouseEvent, feature: Feature) {
    this.showMenu({
      event,
      items: [
        { label: 'Zoom to', icon: 'bi bi-bullseye', action: () => this.zoomTo(feature) },
        { label: 'Snapping', checkbox: { value: this.snapping() }, action: () => this.snapping.update(s => !s) },
        { separator: true },
        { label: 'Export as', items: [
          { label: 'GeoJSON', action: () => this.exportAs('geojson') },
          { label: 'Shapefile', action: () => this.exportAs('shp'), disabled: !this.canShp() },
        ] },
        { separator: true },
        { label: 'Delete', action: () => this.remove(feature), disabled: feature.locked },
      ],
    });
  }
}
```

`injectContextMenu()` returns a function; outside an injection context, call
`workspace.showContextMenu(options)` and `workspace.closeContextMenu()` directly. Pass `event`
and the menu appears at the pointer (or the first touch) and the event's default is prevented;
pass `x`/`y` instead to place it yourself. It is pulled back inside the viewport once it has a
size, and closes on Escape, on an outside press, and when an item runs.

For the common case there is a directive. `[nddContextMenu]` opens its items on the host's
`contextmenu` event; it takes an array or a getter, read at the moment of opening, and does
nothing for an empty list:

```ts
import { Component } from '@angular/core';
import type { ContextMenuItem } from 'angular-dockable-desktop';
import { NddContextMenuTrigger } from 'angular-dockable-desktop';

@Component({
  selector: 'app-layer-row',
  imports: [NddContextMenuTrigger],
  template: `<div class="row" [nddContextMenu]="menu">{{ name }}</div>`,
})
export class LayerRow {
  name = 'Parcels';
  protected readonly menu = (): ContextMenuItem[] => [{ label: 'Rename', action: () => this.rename() }];
  rename() {}
}
```

Four item kinds:

| | |
|---|---|
| **simple** | `label`, optional `icon`, `title` (tooltip), `action`, `disabled`, `cyAction` (rendered as `data-cy-action`) |
| **checkbox** | a simple item with `checkbox: { value }`; `active: false` hides the column |
| **separator** | `{ separator: true }` |
| **submenu** | `label` plus `items`. One level deep. |

`label` and `title` are `Label`s, so a message descriptor follows the locale
([chapter 11](11-i18n.md)). A submenu opens after the pointer rests on its parent for 150 ms,
and stays open for 200 ms after the pointer leaves, long enough to travel into it. Opening
instantly makes the menu twitchy; closing instantly makes a submenu unreachable.

The built-in menu follows the WAI-ARIA menu pattern ([PARITY N3](../PARITY.md)): focus moves
into it on open, ArrowUp/ArrowDown/Home/End rove across enabled items, ArrowRight enters a
submenu and ArrowLeft leaves it (mirrored under RTL), Escape closes and returns focus to where
it was, and checkbox items are `menuitemcheckbox`. `<ndd-context-menu>` has one input, `theme`
(default `'dark'`), mirrored onto the menu as `ndd-context-menu--<theme>`.

### A panel's own menu

To contribute items to a *panel's own* menu — the one on its tab, its window title bar and its
taskbar icon — call `injectPanelContextMenu` in the panel. Pass a getter: it is read every time
the menu opens, so `disabled` and `checkbox` follow the panel's state:

```ts
import { injectPanelContextMenu } from 'angular-dockable-desktop';

export class CodeEditorPanel {
  constructor() {
    injectPanelContextMenu(() => [
      { label: 'Reset to sample', action: () => this.reset(), disabled: this.source() === SAMPLE },
      { separator: true },
      { label: 'Word wrap', checkbox: { value: this.wrap() }, action: () => this.wrap.update(w => !w) },
    ]);
  }
}
```

The items are withdrawn with the component. Outside a panel it does nothing, with a
development warning. See [Panels](03-panels.md) for where the items appear.

### Rendering the menu yourself

Give `<ndd-context-menu>` an `nddContextMenuTemplate` and it hands you the pending menu
instead of drawing one:

```html
<ndd-context-menu>
  <ng-template nddContextMenuTemplate let-items let-x="x" let-y="y" let-close="close">
    <my-menu [items]="items" [style.left.px]="x" [style.top.px]="y" (dismiss)="close()" />
  </ng-template>
</ndd-context-menu>
```

Import `NddContextMenuTemplate` alongside `NddContextMenu`. The context is typed
(`NddContextMenuContext`, through `ngTemplateContextGuard`): `$implicit` and `items` are the
`ContextMenuItem[]`, `x`/`y` the requested position in viewport pixels, and `close()` dismisses
the menu. Because `items` is a union, narrow it (`'label' in item`) before reading a label.

Positioning, viewport clamping, focus and keyboard handling become yours. The library's
dismissal listeners stay active while a request is pending: Escape and a pointer press
*outside* close the menu. Your template renders inside `<ndd-context-menu>`, and a press inside
that host counts as inside, so your items' `(click)` handlers work with a real pointer (N17);
call `close()` after acting. If you portal your menu elsewhere, the library can no longer see
it, and a press there counts as outside.

## Coming from vue-dockable-desktop

| vdd | ndd |
|---|---|
| `<VddModals>` / `<VddSidePanels>` / `<VddConfirm>` | `<ndd-modals>` / `<ndd-side-panels>` / `<ndd-confirm>` |
| `useModals().open(C, props, o)` → id | `injectModals().open(C, inputs, o)` → `NddModalRef` (`.id`, `.afterClosed()`) |
| — | `injectModalRef()` inside the modal, `close(result)` |
| `useSidePanels()` | `injectSidePanels()` |
| `usePanel().onBeforeClose` | `injectPanel().onBeforeClose` (workspace panels); `overlays.registerCloseGuard` (overlays) |
| `<VddToasts>` + `toast()` | `<ndd-toasts>` + `toast()`, and `NddToaster` for `inject()` |
| `useContextMenu()` | `injectContextMenu()`, or the `[nddContextMenu]` directive |
| `usePanelContextMenu(items)` | `injectPanelContextMenu(() => items)` |
| `<VddContextMenu>`'s default slot | `<ng-template nddContextMenuTemplate>` |

Behavioural differences: Escape closes exactly one overlay even when a drawer was opened after
a modal ([N9](../PARITY.md)); the built-in context menu is keyboard-operable ([N3](../PARITY.md));
the toast container is a labelled region ([N14](../PARITY.md)).
