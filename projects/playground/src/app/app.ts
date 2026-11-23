import { ApplicationRef, Component, inject, signal } from '@angular/core';
import {
  NddConfirm,
  NddContextMenu,
  NddDesktop,
  NddModals,
  NddSidePanels,
  NddToasts,
  NddSecondarySidebar,
  NddSidebar,
  NddSidebarTabTemplate,
  NddToolbar,
  VERSION,
  Workspace,
  injectMergedToolbarItems,
  injectModals,
  toast,
} from 'angular-dockable-desktop';
import type { SidebarTab, ToolbarItem } from 'angular-dockable-desktop';
import { EditorPanel } from './editor-panel';
import { HostilePanel } from './hostile-panel';
import { pgLocale } from './locale';
import { RcWrapper } from './runtime-css';

const params = new URLSearchParams(location.search);

/**
 * The playground: the minimal harness the browser gates drive. Everything is reachable from
 * `window.__pg`, so a gate drives the same public API an application would.
 *
 * `?chrome` wraps the desktop in the application chrome M9 added — a primary sidebar on the
 * left, a secondary on the right and a toolbar — bound through real `[( )]` bindings, so the
 * gate can read and write the same signals an application would.
 *
 * `?skin=NAME` picks the skin (`__pg.skin`, a signal, switches it: M19's styles case); `?anim=0`
 * turns the library's transitions off.
 */
@Component({
  selector: 'pg-root',
  imports: [NddDesktop, NddContextMenu, NddModals, NddSidePanels, NddToasts, NddSidebar, NddSecondarySidebar, NddSidebarTabTemplate, NddToolbar],
  template: `
    @if (chrome) {
      <ndd-sidebar
        class="pg-chrome"
        position="left"
        [tabs]="primaryTabs"
        [(activeTabId)]="primaryTab"
        [(width)]="primaryWidth"
        [(visible)]="primaryVisible"
        [minWidth]="180"
        [maxWidth]="480"
      >
        <ng-template nddSidebarTab="files">
          <div class="pg-tab" data-pg-tab="files">Files</div>
        </ng-template>
        <ng-template nddSidebarTab="search">
          <div class="pg-tab" data-pg-tab="search">Search</div>
        </ng-template>
        <ndd-secondary-sidebar [tabs]="secondaryTabs" [(activeTabId)]="secondaryTab">
          <ng-template nddSidebarTab="props">
            <div class="pg-tab" data-pg-tab="props">Properties</div>
          </ng-template>
          <div class="pg-row">
            <ndd-toolbar position="left" [items]="mergedItems()" [(visible)]="toolbarVisible" />
            <ndd-desktop class="pg-desktop" [skin]="skin()" [animations]="animations" />
          </div>
        </ndd-secondary-sidebar>
      </ndd-sidebar>
    } @else {
      @if (popOut) {
        <!-- ?po=1 (M19): the pop-outs, from a real click; the result is kept for the gate. -->
        <div class="pg-po-bar">
          <button id="po-btn" (click)="poResult = popOutPanel('pp')">pop out pp</button>
          <button id="po-btn-q" (click)="popOutPanel('pq')">pop out q</button>
          @if (wo) {
            <!-- ?wo=1 (P5): the managed widget into its own window; ?opo=1: its owner panel. -->
            <button id="wo-po-btn" (click)="popOutWidget()">pop out wo</button>
            <button id="ov-po-btn" (click)="popOutPanel('ov')">pop out ov</button>
          }
        </div>
      }
      <ndd-desktop class="pg-desktop" [skin]="skin()" [animations]="animations" [popoutUrl]="popoutUrl" [popoutWrapper]="popoutWrapper" />
    }
    <ndd-context-menu />
    <ndd-side-panels />
    <ndd-modals />
    <ndd-toasts position="bottom-right" [progressBar]="true" />
  `,
})
export class App {
  protected readonly skin = signal(params.get('skin') ?? 'vscode');
  protected readonly chrome = params.has('chrome');
  protected readonly animations = params.get('anim') !== '0';
  /** ?po=1 (M19): the pop-out buttons; ?pourl=1: the playground's own pop-out page. */
  protected readonly popOut = params.get('po') === '1';
  protected readonly popoutUrl = params.get('pourl') === '1' ? 'popout.html' : undefined;
  /** ?rc=1 (M19, P4): the runtime CSS-in-JS stand-in's popoutWrapper (runtime-css.ts). */
  protected readonly popoutWrapper = params.get('rc') === '1' ? RcWrapper : undefined;
  /** ?wo=1 (M19, P5): the owner panel `ov` with its managed widget `wo` (pop-widget.ts). */
  protected readonly wo = params.get('wo') === '1';
  /** What the last #po-btn click's `popOutPanel('pp')` returned. */
  poResult: unknown = null;
  private readonly workspace = inject(Workspace);

  protected readonly primaryTabs: SidebarTab[] = [
    { id: 'files', label: 'Files', icon: 'pg-icon' },
    { id: 'search', label: 'Search', icon: 'pg-icon', preserveState: true },
  ];
  protected readonly secondaryTabs: SidebarTab[] = [{ id: 'props', label: 'Properties', icon: 'pg-icon' }];
  protected readonly toolbarItems: ToolbarItem[] = [
    { type: 'radio', id: 'select', group: 'tool', label: 'Select', icon: 'pg-icon' },
    { type: 'radio', id: 'pan', group: 'tool', label: 'Pan', icon: 'pg-icon' },
    { type: 'separator' },
    {
      type: 'group',
      id: 'shapes',
      label: 'Shapes',
      defaultIcon: 'pg-icon',
      items: [
        { id: 'rect', label: 'Rectangle', icon: 'pg-icon pg-icon-rect', shortcut: 'R' },
        { id: 'ellipse', label: 'Ellipse', icon: 'pg-icon pg-icon-ellipse', shortcut: 'E' },
        { type: 'separator' },
        { id: 'line', label: 'Line', icon: 'pg-icon pg-icon-line', shortcut: 'L' },
      ],
    },
    { type: 'toggle', id: 'snap', label: 'Snap to grid', icon: 'pg-icon' },
  ];

  /** The shell's own items, with the active panel's contributions appended (M12). */
  protected readonly mergedItems = injectMergedToolbarItems(() => this.toolbarItems);

  readonly primaryTab = signal<string | null>(null);
  readonly primaryWidth = signal(280);
  readonly primaryVisible = signal(true);
  readonly secondaryTab = signal<string | null>(null);
  readonly toolbarVisible = signal(true);

  protected popOutPanel(id: string): unknown {
    return this.workspace.popOutPanel(id);
  }

  /** `injectFloatingWidgets().popOut('wo')` from a real click in the page (P5). */
  protected popOutWidget(): void {
    const w = window as unknown as { __wo?: { api: { popOut(id: string): unknown } }; __woPopResult?: unknown };
    w.__woPopResult = w.__wo?.api.popOut('wo');
  }

  constructor() {
    if (this.popOut) {
      this.workspace.openPanel('p1', 'hostile', { title: 'Panel One' });
      this.workspace.openPanel('pp', 'popper', { title: 'Pop', dockTo: { panel: 'p1', position: 'center' } });
      if (params.get('po2') === '1') this.workspace.openPanel('pq', 'popper', { title: 'Pop Q', dockTo: { panel: 'p1', position: 'center' } });
      if (this.wo) this.workspace.openPanel('ov', 'wover', { title: 'Owner', dockTo: { panel: 'p1', position: 'right' } });
    }
    (window as unknown as Record<string, unknown>)['__pg'] = {
      ready: true,
      version: VERSION,
      zone: typeof (window as unknown as Record<string, unknown>)['Zone'] !== 'undefined',
      ws: this.workspace,
      skin: this.skin,
      popOutResult: () => this.poResult,
      appRef: inject(ApplicationRef),
      modals: injectModals(),
      toast,
      components: { editor: EditorPanel, hostile: HostilePanel, confirm: NddConfirm },
      locale: pgLocale,
      chrome: this.chrome
        ? {
            primaryTab: this.primaryTab,
            primaryWidth: this.primaryWidth,
            primaryVisible: this.primaryVisible,
            secondaryTab: this.secondaryTab,
            toolbarVisible: this.toolbarVisible,
          }
        : null,
    };
  }
}
