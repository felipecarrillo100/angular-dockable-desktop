/**
 * `<ndd-desktop>` — the workspace.
 *
 * Renders the layout (the recursive grid; floating windows and the taskbar arrive with M5/M7)
 * and owns the panel host, which creates every open panel exactly once and never re-creates it
 * as it moves (ADR 0002).
 *
 *   <ndd-desktop skin="nord" [animations]="true" />
 *
 * Give its container a height (100vh, or `flex: 1; min-height: 0` in a flex column). The
 * library styles nothing outside its own DOM (ADR 0007); in development a zero-height workspace
 * and a missing stylesheet are both diagnosed in the console.
 */
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, ElementRef, PLATFORM_ID, ViewEncapsulation, afterNextRender, computed, contentChild, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { EmptyWorkspaceSlot, NddEmptyWorkspaceTemplate } from './empty-workspace';
import { NddTabContentTemplate, TabContentSlot } from './tab-content';
import { PanelHost } from '../panel/panel-host';
import { injectColorScheme } from '../core/color-scheme';
import { claimDocumentMirror, releaseDocumentMirror } from '../core/document-mirror';
import { NddWorkspaceGrid } from './workspace-grid';
import { NddFloatingWindow } from './floating-window';
import { DragDock } from './drag-dock';
import { NddEdgeZones } from './edge-zones';
import { NddDragGhost } from './drag-ghost';
import { NddTaskbar } from './taskbar';
import type { TaskbarVisibility } from './taskbar';
import type { NddIcon } from '../core/icon';
import type { Type } from '@angular/core';
import type { PopoutWrapper } from '../panel/panel-window';
import { setPopoutWrapper } from '../panel/panel-window';
import { openMenu, taskbarMenu } from './menus';
import { clampFloatingRect } from '../core/anchor-geometry';
import { isElement } from '../core/dom-context';
import { eventDocument, listenOnDocuments } from '../core/document-registry';
import { createPopOutWindows } from '../core/pop-out-windows';
import { NddPopOutFrame, POP_OUT_WINDOWS } from './pop-out-frame';


@Component({
  selector: 'ndd-desktop',
  imports: [NddWorkspaceGrid, NddFloatingWindow, NddEdgeZones, NddDragGhost, NddTaskbar, NddPopOutFrame],
  encapsulation: ViewEncapsulation.None,
  providers: [
    { provide: PanelHost, useFactory: () => new PanelHost(inject(DOCUMENT)) },
    DragDock,
    EmptyWorkspaceSlot,
    TabContentSlot,
    // This desktop's pop-out windows (1.12.0): created here, bound to the workspace once rendered.
    { provide: POP_OUT_WINDOWS, useFactory: () => createPopOutWindows(inject(Workspace) as Workspace<never>) },
  ],
  host: {
    class: 'ndd-workspace',
    '[class.ndd-no-animations]': '!animations()',
    '[attr.data-ndd-skin]': 'skin()',
    '[attr.data-color-scheme]': 'colorScheme()',
    '[attr.dir]': 'workspace.dir()',
  },
  template: `
    <div class="ndd-workspace-viewport" #viewport>
      @if (drag.dragging()) {
        <ndd-edge-zones />
      }
      <ndd-workspace-grid [node]="workspace.gridRoot()" [path]="[]" />
      @for (w of shownWindows(); track w.id) {
        <ndd-floating-window [window]="w" />
      }
    </div>
    <ndd-taskbar [visibility]="taskbar()" [defaultIcon]="defaultPanelIcon()" (contextMenu)="onTaskbarMenu($event)" />
    <ndd-drag-ghost />
    <!-- Each pop-out window's frame (1.12.0), portalled into its window once its page is ready. -->
    @for (e of popOutFrames(); track e.key) {
      <ndd-popout-frame [id]="e.id" [doc]="e.doc!" [scope]="scopeEl" [defaultIcon]="defaultPanelIcon()" [wrapper]="wrapperType()" />
    }
  `,
})
export class NddDesktop {
  /** Built-in skin (`vscode`, `macos`, `chrome`, `slate`, `nord`, `obsidian`, `tokyo`), or your own. */
  readonly skin = input('vscode');
  /** The library's own transitions. Never affects the host app's animations. */
  readonly animations = input(true);
  /**
   * When the minimised-panel taskbar is shown: `'always'` a permanent strip; `'compact'` only
   * while something is minimised; `'autohide'` an overlay collapsed to a peek strip.
   */
  readonly taskbar = input<TaskbarVisibility>('always');
  /** Fallback icon for panels that register none. */
  readonly defaultPanelIcon = input<NddIcon | undefined>(undefined);
  /**
   * The page a pop-out window opens (1.12.0), for `provideDockableDesktop({ popOut: true })`: a
   * page of this origin, resolved against the main page's URL (`document.baseURI`, so a relative
   * path respects `--base-href`). Without it a pop-out is a blank window. A page that can't be
   * read, or doesn't load within 10 s, sends the panel back.
   */
  readonly popoutUrl = input<string | undefined>(undefined);
  /**
   * The app's component around what the library renders for a panel's window (1.12.0, with
   * `popOut: true`): around every panel's content for its whole life, and, in a pop-out only,
   * around the frame, a context menu shown there and that window's toasts. It declares the inputs
   * `window` and `document` ({@link PopoutWrapper}), the main ones, then the pop-out's while the
   * panel is in its own window, and an `<ng-content />`. What it provides reaches the components
   * rendered inside it (the panel, an icon, a menu item's icon), so a CSS-in-JS cache it provides
   * can follow the panel into that window's document: keep one cache per document, not per
   * wrapper. Read when each panel is created: give it from the start, and don't change it.
   */
  readonly popoutWrapper = input<Type<PopoutWrapper> | undefined>(undefined);
  /**
   * A right-click or long press on a taskbar icon, emitted *after* the library has opened its
   * own menu — so an application can observe it without rebuilding the standard items.
   */
  readonly taskbarContextMenu = output<{ panelId: string; event: PointerEvent | MouseEvent }>();

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  /**
   * The application's colour scheme, mirrored onto the workspace element. Not decoration: a
   * skin's token block is `[data-ndd-skin="macos"]`, which matches this element as well as
   * `<html>`; without the scheme here too, the skin's dark tokens shadow the light ones.
   */
  protected readonly colorScheme = injectColorScheme();
  /** The workspace's own measured size (not the window's — it is usually part of a page). */
  readonly viewport = signal({ width: 1024, height: 768 });
  /** The floating windows drawn here: a panel in its own browser window (1.12.0) keeps its entry, undrawn. */
  protected readonly shownWindows = computed(() => {
    const panels = this.workspace.panels();
    return this.workspace.floating().filter(w => !panels[w.id]?.poppedOut);
  });

  private readonly host = inject(PanelHost);
  /** This desktop's pop-out windows (1.12.0). */
  private readonly popOuts = inject(POP_OUT_WINDOWS);
  /** The open windows whose page is ready: one frame each. */
  protected readonly popOutFrames = computed(() => this.popOuts.entries().filter(e => e.doc !== null));
  /** The app's wrapper while the workspace has pop-outs (1.12.0); null otherwise. */
  protected readonly wrapperType = computed<Type<unknown> | null>(() => (this.popOuts.enabled ? (this.popoutWrapper() ?? null) : null));
  /** The app's `<ng-template nddEmptyWorkspace>`, if any (1.7.0). */
  private readonly emptyWorkspace = contentChild(NddEmptyWorkspaceTemplate);
  /** The app's `<ng-template nddTabContent let-tab>`, if any (1.9.0). */
  private readonly tabContent = contentChild(NddTabContentTemplate);
  protected readonly drag = inject(DragDock);
  private readonly doc = inject(DOCUMENT);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The workspace element whose scope (scheme, skin, no-animations) a pop-out's frame repeats (1.12.0). */
  protected readonly scopeEl: HTMLElement = this.el;
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Hand the app's empty-workspace template to the groups (1.7.0).
    const emptySlot = inject(EmptyWorkspaceSlot);
    effect(() => emptySlot.template.set(this.emptyWorkspace()?.template ?? null));
    // And its tab content, to every group (1.9.0).
    const tabSlot = inject(TabContentSlot);
    effect(() => tabSlot.template.set(this.tabContent()?.template ?? null));
    // Skin, animation state and the stacking base are mirrored onto <html>, so chrome rendered
    // into document.body — menus, toasts, flyouts, modals — inherits the same tokens.
    // `--ndd-z-base` is the easy one to forget: without it `zIndexBase` silently does nothing.
    // Through the document mirror, keyed by this desktop: with several on one page the newest wins,
    // and destroying one hands <html> back to the others rather than clearing it.
    effect(() => {
      if (!this.browser) return;
      claimDocumentMirror(
        this,
        { skin: this.skin(), noAnimations: !this.animations(), zBase: this.workspace.config.zIndexBase },
        this.doc,
      );
    });

    // Keep floating windows reachable when the workspace shrinks. `clampFloatingRect` returns
    // the *same object* when nothing needed to change — this effect writes to the very list it
    // reads, so writing on "a value changed" rather than "a bound was exceeded" would loop.
    effect(() => {
      const view = this.viewport();
      const windows = this.workspace.floating();
      untracked(() => {
        for (const w of windows) {
          // A panel in its own window (1.12.0) isn't on this page: nothing to keep on screen.
          if (this.workspace.panels()[w.id]?.poppedOut) continue;
          const num = (v: number | string) => (typeof v === 'number' ? v : Number.parseFloat(String(v)));
          const current = { x: num(w.x), y: num(w.y), width: num(w.width), height: num(w.height) };
          const next = clampFloatingRect(current, view, w.anchor != null);
          if (next !== current) this.workspace.updateFloatingPosition(w.id, next);
        }
      });
    });

    // The pop-out page (1.12.0).
    effect(() => this.popOuts.setUrl(this.popoutUrl()));
    // The app's popoutWrapper (1.12.0): around each panel's content, from its creation...
    this.host.popOut = { enabled: this.popOuts.enabled, entries: this.popOuts.entries, wrapper: () => this.wrapperType() };
    // ...and, by document, around a menu and toasts shown in an open pop-out: they are mounted
    // beside the desktop, so they find it by the document they show in.
    effect(onCleanup => {
      const wrapper = this.wrapperType();
      const docs = this.popOutFrames().map(e => e.doc!);
      if (!wrapper) return;
      const undo = untracked(() => docs.map(doc => setPopoutWrapper(doc, wrapper)));
      onCleanup(() => undo.forEach(f => f()));
    });

    afterNextRender(() => {
      this.bindPopOuts();
      this.diagnoseStylesheet();
      this.observeViewport();
      this.destroyRef.onDestroy(listenOnDocuments('pointerdown', this.onPointerDownElsewhere));
      this.destroyRef.onDestroy(listenOnDocuments('focusin', this.onFocusInElsewhere));
    });

    this.destroyRef.onDestroy(() => {
      if (!this.browser) return;
      releaseDocumentMirror(this, this.doc);
    });
  }

  /**
   * Click-to-activate in the other documents that hold panel content (1.12.0): a pop-out window's,
   * once it registers. Through the document registry, `pointerdown` on each document.
   *
   * In the main document the elements answer for themselves — the group's `(pointerdown)` and the
   * floating window's `(pointerdown.capture)` — exactly as before, so this listener leaves that
   * document alone. Elsewhere the press makes the panel it lands in the active one: a floating
   * window's, or the selected tab of the group it is in; inside a pop-out window's frame, its
   * panel (its window is already in front, so it isn't focused again).
   */
  private readonly onPointerDownElsewhere = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (eventDocument(event) === this.doc) return;
    const target = event.target;
    if (!isElement(target)) return;
    const popOutId = this.popOutPanelOf(target);
    if (popOutId) {
      this.activate(popOutId);
      return;
    }
    const id =
      target.closest('[data-ndd-window]')?.getAttribute('data-ndd-window') ||
      target.closest('.ndd-workspace-panel')?.getAttribute('data-active-panel-id');
    if (id && untracked(this.workspace.panels)[id]) this.workspace.focusPanel(id);
  };

  /**
   * Focus moving into a pop-out (a Tab, a click on a field, the window coming forward on its
   * element) activates its panel too (1.12.0, rdd 7.12.0). Only there: in the page, focus alone
   * never activates.
   */
  private readonly onFocusInElsewhere = (event: FocusEvent): void => {
    const id = this.popOutPanelOf(event.target);
    if (id) this.activate(id);
  };

  /** The panel whose pop-out frame holds `target`, or null (1.12.0). */
  private popOutPanelOf(target: EventTarget | null): string | null {
    return isElement(target) ? (target.closest('[data-ndd-popout]')?.getAttribute('data-ndd-popout') ?? null) : null;
  }

  private activate(id: string): void {
    if (untracked(this.workspace.panels)[id]) this.workspace.activatePanel(id);
  }

  /**
   * Binds this desktop's pop-out windows (1.12.0): the workspace's `popOutPanel` / `returnPanel` /
   * `focusPanelWindow` reach them, and they are lent the panel cache. Destroying the desktop brings
   * every panel back first, while the cache can still take its element.
   */
  private bindPopOuts(): void {
    const dom = this.host.dom;
    const unbind = this.popOuts.bind();
    const unbindHost = this.popOuts.bindHost({
      // Synchronous, so a child's `pagehide` handler has the element back before its document goes.
      park: id => {
        if (dom.has(id)) dom.moveTo(id, null);
      },
      rectOf: id => {
        if (!dom.has(id)) return null;
        const r = dom.elementFor(id).getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r : null;
      },
      element: id => (dom.has(id) ? dom.elementFor(id) : null),
      isParked: id => dom.isParked(id),
    });
    this.destroyRef.onDestroy(() => {
      unbindHost();
      unbind();
    });
  }

  /** The menu for a minimised panel — restore, maximise (which rdd's never did), close. */
  protected onTaskbarMenu(e: { panelId: string; event: PointerEvent | MouseEvent }): void {
    openMenu(this.workspace, e.event, taskbarMenu(this.workspace, e.panelId));
    this.taskbarContextMenu.emit(e);
  }

  /** @internal — the persistence port, for the taskbar preview and tests. */
  get panelHost(): PanelHost {
    return this.host;
  }

  /**
   * The stylesheet carries `--ndd-styles-loaded: 1`. Without the import the workspace renders
   * as an unstyled rectangle with nothing in the console — a hard first hour. Development only.
   */
  private diagnoseStylesheet(): void {
    if (!(typeof ngDevMode === 'undefined' || ngDevMode)) return;
    try {
      const sentinel = getComputedStyle(this.doc.documentElement).getPropertyValue('--ndd-styles-loaded').trim();
      if (sentinel !== '1') {
        console.error(
          '[angular-dockable-desktop] the stylesheet is not loaded.\n' +
            'Add it to angular.json → projects → <app> → architect → build → options → styles:\n' +
            '  "styles": ["angular-dockable-desktop/styles.css", "src/styles.css"]\n' +
            'Without it the workspace renders as an unstyled box, with no other error.',
        );
      }
    } catch {
      /* no getComputedStyle */
    }
  }

  private observeViewport(): void {
    const viewportEl = this.el.querySelector<HTMLElement>('.ndd-workspace-viewport');
    if (!viewportEl || typeof ResizeObserver === 'undefined') return;
    let warnedZeroHeight = false;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      this.viewport.set({ width: Math.max(100, rect.width), height: Math.max(100, rect.height) });
      // A zero-height workspace is invisible with no error anywhere; the cause is always a
      // percentage-height chain broken by an ancestor with `height: auto`. Name the ancestor.
      if ((typeof ngDevMode === 'undefined' || ngDevMode) && rect.height < 10 && !warnedZeroHeight) {
        warnedZeroHeight = true;
        let culprit: Element = viewportEl;
        let cursor = this.el as Element | null;
        while (cursor && cursor !== this.doc.documentElement) {
          if (cursor.getBoundingClientRect().height < 10) culprit = cursor;
          else break;
          cursor = cursor.parentElement;
        }
        const describe =
          culprit === viewportEl
            ? 'the workspace element itself'
            : `<${culprit.tagName.toLowerCase()}${culprit.id ? ` id="${culprit.id}"` : ''}${culprit.className ? ` class="${culprit.className}"` : ''}>`;
        console.warn(
          `[angular-dockable-desktop] The workspace has no height, so it is invisible.\n\n` +
            `Zero height starts at: ${describe}\n\n` +
            `In CSS, height: 100% only resolves when every ancestor has a real height. If any one of ` +
            `them is height: auto (a div's default), the chain breaks.\n\n` +
            `Give the workspace's container a height — 100vh, or flex: 1 with min-height: 0 inside a ` +
            `flex column. The library deliberately does not style your page; .ndd-fill-viewport is ` +
            `available for the simple case.`,
        );
      }
    });
    observer.observe(viewportEl);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
