import { ApplicationRef, Component, inject, signal } from '@angular/core';
import {
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

const params = new URLSearchParams(location.search);

/**
 * The playground: the minimal harness the browser gates drive. Everything is reachable from
 * `window.__pg`, so a gate drives the same public API an application would.
 *
 * `?chrome` wraps the desktop in the application chrome M9 added — a primary sidebar on the
 * left, a secondary on the right and a toolbar — bound through real `[( )]` bindings, so the
 * gate can read and write the same signals an application would.
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
            <ndd-desktop class="pg-desktop" [skin]="skin" />
          </div>
        </ndd-secondary-sidebar>
      </ndd-sidebar>
    } @else {
      <ndd-desktop class="pg-desktop" [skin]="skin" />
    }
    <ndd-context-menu />
    <ndd-side-panels />
    <ndd-modals />
    <ndd-toasts position="bottom-right" [progressBar]="true" />
  `,
})
export class App {
  protected readonly skin = params.get('skin') ?? 'vscode';
  protected readonly chrome = params.has('chrome');
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

  constructor() {
    (window as unknown as Record<string, unknown>)['__pg'] = {
      ready: true,
      version: VERSION,
      zone: typeof (window as unknown as Record<string, unknown>)['Zone'] !== 'undefined',
      ws: this.workspace,
      appRef: inject(ApplicationRef),
      modals: injectModals(),
      toast,
      components: { editor: EditorPanel, hostile: HostilePanel },
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
