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
import {
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { PanelHost } from '../panel/panel-host';
import { injectColorScheme } from '../core/color-scheme';
import { NddWorkspaceGrid } from './workspace-grid';
import { NddFloatingWindow } from './floating-window';
import { DragDock } from './drag-dock';
import { NddEdgeZones } from './edge-zones';
import { NddDragGhost } from './drag-ghost';
import { NddTaskbar } from './taskbar';
import type { TaskbarVisibility } from './taskbar';
import type { NddIcon } from '../core/icon';
import { openMenu, taskbarMenu } from './menus';
import { clampFloatingRect } from '../core/anchor-geometry';


@Component({
  selector: 'ndd-desktop',
  imports: [NddWorkspaceGrid, NddFloatingWindow, NddEdgeZones, NddDragGhost, NddTaskbar],
  encapsulation: ViewEncapsulation.None,
  providers: [{ provide: PanelHost, useFactory: () => new PanelHost(inject(DOCUMENT)) }, DragDock],
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
      @for (w of workspace.floating(); track w.id) {
        <ndd-floating-window [window]="w" />
      }
    </div>
    <ndd-taskbar [visibility]="taskbar()" [defaultIcon]="defaultPanelIcon()" (contextMenu)="onTaskbarMenu($event)" />
    <ndd-drag-ghost />
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

  private readonly host = inject(PanelHost);
  protected readonly drag = inject(DragDock);
  private readonly doc = inject(DOCUMENT);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Skin, animation state and the stacking base are mirrored onto <html>, so chrome rendered
    // into document.body — menus, toasts, flyouts, modals — inherits the same tokens.
    // `--ndd-z-base` is the easy one to forget: without it `zIndexBase` silently does nothing.
    effect(() => {
      if (!this.browser) return;
      const root = this.doc.documentElement;
      root.setAttribute('data-ndd-skin', this.skin());
      root.classList.toggle('ndd-no-animations', !this.animations());
      root.style.setProperty('--ndd-z-base', String(this.workspace.config.zIndexBase));
    });

    // Keep floating windows reachable when the workspace shrinks. `clampFloatingRect` returns
    // the *same object* when nothing needed to change — this effect writes to the very list it
    // reads, so writing on "a value changed" rather than "a bound was exceeded" would loop.
    effect(() => {
      const view = this.viewport();
      const windows = this.workspace.floating();
      untracked(() => {
        for (const w of windows) {
          const num = (v: number | string) => (typeof v === 'number' ? v : Number.parseFloat(String(v)));
          const current = { x: num(w.x), y: num(w.y), width: num(w.width), height: num(w.height) };
          const next = clampFloatingRect(current, view, w.anchor != null);
          if (next !== current) this.workspace.updateFloatingPosition(w.id, next);
        }
      });
    });

    afterNextRender(() => {
      this.diagnoseStylesheet();
      this.observeViewport();
    });

    this.destroyRef.onDestroy(() => {
      if (!this.browser) return;
      const root = this.doc.documentElement;
      root.removeAttribute('data-ndd-skin');
      root.classList.remove('ndd-no-animations');
      root.style.removeProperty('--ndd-z-base');
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
