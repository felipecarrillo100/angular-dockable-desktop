/**
 * `<ndd-popout-frame>` — one pop-out window's content (1.12.0, rdd 7.12.1's `PopOutWindow` in
 * `PopOutWindows.tsx`, vdd 1.14.0's `VddPopOutFrame.vue`): the library's frame (icon, title,
 * "Return to desktop") around the panel's ordinary slot, portalled into the child window's
 * `<body>`. The slot is the one a tab or a floating window uses (`[nddPanelSlot]`), so the panel's
 * element moves into the child window and back and its component is never re-created (ADR 0002).
 *
 * `<ndd-desktop>` renders one per open window whose page is ready, from the windows registry
 * (`core/pop-out-windows.ts`), which the desktop creates and provides ({@link POP_OUT_WINDOWS}).
 * The host element stays in the page, empty and not displayed; only the frame moves.
 *
 * Only the full-size layout is inline (rdd's `FRAME_STYLE`, `BODY_STYLE`, `fillWindow`,
 * `fillSlot`), so the content stays usable without any stylesheet in the window; the rest of the
 * frame's look is in the `popout` stylesheet part. `startPopOutStyles` (`core/pop-out-styles.ts`)
 * copies the page's stylesheets, `<html>` / `<body>` and the workspace's scope into the window
 * while the panel is out, and the frame stays hidden until they are ready ({@link NddPopOutFrame.styled}).
 * @internal
 */
import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, InjectionToken, NgZone, ViewEncapsulation, afterRenderEffect, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import type { Type } from '@angular/core';
import type { PopOutWindows } from '../core/pop-out-windows';
import type { PopOutMenu } from '../core/panel-menu';
import type { NddIcon } from '../core/icon';
import { optionsFor } from '../core/panel-options';
import { startPopOutStyles } from '../core/pop-out-styles';
import { isHTMLElement } from '../core/dom-context';
import { menuEventBelow } from '../core/context-menu';
import { toast } from '../toast/toast';
import { NddPortal } from '../common/portal';
import { NddPopoutWrap } from '../common/popout-wrap';
import { NddIconView } from '../common/icon';
import { NddPanelSlot } from '../panel/panel-slot';
import { PanelHost } from '../panel/panel-host';

/** @internal `<ndd-desktop>`'s pop-out windows (1.12.0), for the components inside it. */
export const POP_OUT_WINDOWS = new InjectionToken<PopOutWindows>('ndd-popout-windows');

/**
 * @internal "Open in new window" for the tab and floating-window menus (1.12.0), or undefined when
 * the workspace has no pop-out windows. From the menu, a blocked pop-up is the user's to know
 * about: a toast says so. A call from app code shows nothing. Call in an injection context.
 */
export function injectPopOutMenu(): PopOutMenu | undefined {
  const windows = inject(POP_OUT_WINDOWS, { optional: true });
  if (!windows?.enabled) return undefined;
  const ws = inject(Workspace) as Workspace<never>;
  return {
    canPopOut: windows.canPopOut,
    popOut: id => {
      const result = ws.popOutPanel(id);
      if (!result.ok && result.reason === 'blocked') toast.warning(ws.format(ws.messages.popOutBlocked));
    },
  };
}

/** The slot and the panel's own elements inside it fill the frame's body. */
const FILL =
  ':scope > .ndd-panel-slot, :scope > .ndd-panel-slot > .ndd-panel-mount, :scope > .ndd-panel-slot > .ndd-panel-mount > .ndd-panel-content, ' +
  // Inside the app's popoutWrapper (1.12.0) when its template is only `<ng-content />`.
  ':scope > .ndd-panel-slot > .ndd-panel-mount > .ndd-popout-wrapper > .ndd-panel-content';

/** The child page fills its window: no margin, full height. */
function fillWindow(doc: Document): void {
  for (const el of [doc.documentElement, doc.body]) {
    el.style.margin = '0';
    el.style.height = '100%';
  }
}

/** Sizes the slot and the panel's elements to the frame's body while they are in it; undone on return. */
function fillSlot(body: HTMLElement): () => void {
  const els = Array.from(body.querySelectorAll<HTMLElement>(FILL));
  for (const el of els) {
    el.style.width = '100%';
    el.style.height = '100%';
  }
  return () => {
    for (const el of els) {
      el.style.removeProperty('width');
      el.style.removeProperty('height');
    }
  };
}

@Component({
  selector: 'ndd-popout-frame',
  imports: [NddPortal, NddPopoutWrap, NddIconView, NddPanelSlot],
  encapsulation: ViewEncapsulation.None,
  // The frame moves into the child window; what stays in the page is an empty host.
  host: { style: 'display: none' },
  template: `
    @if (shown()) {
      <!-- The app's popoutWrapper (1.12.0) around the whole frame, with this window: what the app
           hands the frame (the icon) gets what the wrapper provides. The slot inside only moves
           DOM, so the panel's content (wrapped by its own) is not re-created. -->
      <ng-container *nddPopoutWrap="doc(); type: wrapper()">
      <!-- ndd-workspace too: what is scoped to the workspace (its colours, scrollbars) applies here.
           The minimum layout is inline, so the content stays usable without the stylesheet. -->
      <div
        #frame
        [nddPortal]="doc()"
        class="ndd-workspace ndd-popout-frame"
        style="position: fixed; inset: 0; display: flex; flex-direction: column"
        [style.visibility]="styled() ? null : 'hidden'"
        [attr.data-ndd-popout]="id()"
        [attr.data-ndd-popout-kind]="hosted() ? 'widget' : 'panel'"
        [attr.data-ndd-focused]="focused() ? '' : null"
        [attr.dir]="workspace.dir()"
      >
        <div class="ndd-popout-frame__header">
          @if (widgetMenu()) {
            <!-- A managed widget's window (P5): the icon opens the widget's titleMenu. A press on it
                 is not one on the frame (activation, a menu's dismissal); its click doesn't reach the
                 window, whose click closes the menu again (rdd's S7 bug). -->
            <button
              type="button"
              class="ndd-popout-frame__icon ndd-popout-frame__icon--menu"
              aria-haspopup="menu"
              [attr.aria-label]="title()"
              (pointerdown)="$event.stopPropagation()"
              (click)="openWidgetMenu($event)"
            >
              @if (icon(); as icon) {
                <ndd-icon [icon]="icon" />
              } @else {
                <!-- No icon: the menu glyph, as the widget's title button in the panel shows. -->
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                </svg>
              }
            </button>
          } @else {
            <span class="ndd-popout-frame__icon">
              @if (icon(); as icon) {
                <ndd-icon [icon]="icon" />
              }
            </span>
          }
          <span class="ndd-popout-frame__title">{{ title() }}{{ panel().dirty ? ' *' : '' }}</span>
          <!-- A title-bar button in the skin, as a floating window's: its label is the tooltip and the name. -->
          <button
            type="button"
            class="ndd-custom-tab-btn ndd-popout-frame__return"
            [attr.title]="returnLabel()"
            [attr.aria-label]="returnLabel()"
            (click)="windows.returnPanel(id())"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 4L9 15" />
              <path d="M9 8v7h7" />
              <path d="M4 20h16" />
            </svg>
          </button>
        </div>
        <div #body class="ndd-popout-frame__body" style="flex: auto; min-height: 0; position: relative">
          <div [nddPanelSlot]="id()"></div>
        </div>
      </div>
      </ng-container>
    }
  `,
})
export class NddPopOutFrame {
  /** The panel shown in this window. */
  readonly id = input.required<string>();
  /** The window's document: written to (its title, `<html>`), never replaced; a new window is a new frame. */
  readonly doc = input.required<Document>();
  /** The desktop's fallback icon for a panel that registers none. */
  readonly defaultIcon = input<NddIcon | undefined>(undefined);
  /** The workspace element whose scope (scheme, skin, no-animations) the frame repeats; none, nothing is repeated. */
  readonly scope = input<Element | null>(null);
  /** The app's popoutWrapper (1.12.0), around the frame; null for none. */
  readonly wrapper = input<Type<unknown> | null>(null);

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  protected readonly windows = inject(POP_OUT_WINDOWS);
  private readonly host = inject(PanelHost);
  private readonly mainDoc = inject(DOCUMENT);
  private readonly zone = inject(NgZone);

  protected readonly panel = computed(() => this.workspace.panels()[this.id()]);
  protected readonly title = computed(() => this.workspace.format(this.panel()?.title));
  /** Out in its window: what the store says, with this window's entry the registry's. */
  protected readonly shown = computed(() => !!this.panel()?.poppedOut && this.panel()!.state === 'floating');
  /** The active panel: the frame carries `data-ndd-focused`, as a floating window does (1.12.0, rdd 7.12.0). */
  protected readonly focused = computed(() => this.workspace.activePanelId() === this.id());
  /** A managed widget's panel (P5): its button goes back into its panel. */
  protected readonly hosted = computed(() => !!this.panel()?.owner);
  protected readonly returnLabel = computed(() =>
    this.workspace.format(this.hosted() ? this.workspace.messages.backIntoPanel : this.workspace.messages.returnToDesktop),
  );
  /**
   * A managed widget's panel (P5): its title icon is a button opening the widget's `titleMenu` (the
   * items its overlay registered for the panel), when it has one.
   */
  protected readonly widgetMenu = computed(() => this.hosted() && this.workspace.panelMenuItems(this.id()).length > 0);
  protected readonly icon = computed(() => {
    const p = this.panel();
    return p ? (p.icon ?? optionsFor(this.workspace.registry, p)?.icon ?? this.defaultIcon()) : undefined;
  });
  /**
   * Whether the window's styles are ready: false until `startPopOutStyles`' `onReady`. The frame
   * is hidden meanwhile, and `panel:popped-out` waits for it (the registry's `placed` reads the
   * frame's `visibility`).
   */
  readonly styled = signal(false);

  /**
   * Opens the widget's `titleMenu` in this window. The menu closes on a click that reaches its
   * window: without the `stopPropagation`, the click that opens it closes it. From the keyboard
   * (Enter or Space: `detail` 0, no pointer position) it opens below the icon on its first item,
   * through a stand-in event at the icon's corner whose target is the icon, so it still shows in
   * this window's body.
   */
  protected openWidgetMenu(event: MouseEvent): void {
    event.stopPropagation();
    const items = this.workspace.panelMenuItems(this.id());
    if (items.length === 0) return;
    const button = event.currentTarget;
    if (event.detail === 0 && isHTMLElement(button)) {
      this.workspace.showContextMenu({ event: menuEventBelow(button), items, initialFocus: 'first-item' });
    } else {
      this.workspace.showContextMenu({ event, items });
    }
  }

  private readonly frameEl = viewChild<ElementRef<HTMLElement>>('frame');
  private readonly bodyEl = viewChild<ElementRef<HTMLElement>>('body');

  constructor() {
    // The window's title follows the panel's.
    effect(() => {
      this.doc().title = this.title();
    });
    // The workspace's direction on the window's `<html>` when the page's sets none. The page's own
    // `dir` and `lang` come with the mirror of `<html>`'s attributes (`startPopOutStyles`).
    effect(() => {
      const html = this.doc().documentElement;
      if (!this.mainDoc.documentElement.hasAttribute('dir')) html.dir = this.workspace.dir();
    });
    effect(() => {
      const doc = this.doc();
      untracked(() => fillWindow(doc));
    });
    // The page's styles, <html>/<body> and the workspace's scope, kept in step while the panel is
    // out; stopped on return. Started outside the Angular zone: the observers, the links' listeners
    // and the timer only touch the DOM (`onReady` writes a signal, which schedules the render).
    afterRenderEffect(onCleanup => {
      const frame = this.frameEl()?.nativeElement;
      if (!frame) return;
      const doc = untracked(this.doc);
      const scope = this.scope();
      const stop = this.zone.runOutsideAngular(() =>
        startPopOutStyles({ child: doc, frame, scope, main: this.mainDoc, onReady: () => this.styled.set(true) }),
      );
      onCleanup(stop);
    });
    // After the slot has moved the panel's element in: it fills the frame's body, and its size
    // observer is rebuilt from this window's constructor (an observer only works from the
    // element's own window). Undone when the frame goes: by then the element is back in the page,
    // and the observer is rebuilt from the page's.
    afterRenderEffect(onCleanup => {
      const body = this.bodyEl()?.nativeElement;
      if (!this.frameEl() || !body) return;
      const id = untracked(this.id);
      const unfill = fillSlot(body);
      this.host.reobserve(id);
      onCleanup(() => {
        unfill();
        this.host.reobserve(id);
      });
    });
  }
}
