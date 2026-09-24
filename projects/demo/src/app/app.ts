import { ApplicationRef, ChangeDetectionStrategy, Component, DOCUMENT, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import {
  NddContextMenu, NddDesktop, NddModals, NddSecondarySidebar, NddSidePanels, NddSidebar, NddToasts, NddToolbar,
  Workspace, injectMergedSidebarTabs, injectMergedToolbarItems,
} from 'angular-dockable-desktop';
import type { SidebarRailEntry, SidebarTab, TaskbarVisibility, ToolbarItem } from 'angular-dockable-desktop';
import { PanelManagerForm } from './forms/panel-manager-form';
import { LOCALES, UI } from './i18n/messages';
import type { Locale } from './i18n/messages';
import { ICONS } from './icons';
import { locale } from './locale';
import { HelpPanel } from './panels/help-panel';
import { LayerTreePanel } from './panels/layer-tree-panel';

// `mono` is not the library's — it is defined in styles.css, as an application defines its own.
const SKINS = ['vscode', 'macos', 'chrome', 'slate', 'nord', 'obsidian', 'tokyo', 'mono'] as const;
type Skin = (typeof SKINS)[number];
type ToolbarSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * The demo's shell: a top bar, a sidebar, a toolbar, and the workspace inside them.
 *
 * Its whole purpose is to show what an application supplies versus what the library does.
 * The shell owns the chrome and the theme; the library owns the workspace. The two meet in
 * three places, all of them small: the merged toolbar items and sidebar tabs (panels
 * contribute to them), `formatMessage` (wired in `main.ts`), and the four hosts at the bottom.
 */
@Component({
  selector: 'dd-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NddDesktop, NddSidebar, NddSecondarySidebar, NddToolbar, NddContextMenu, NddSidePanels, NddModals, NddToasts],
  template: `
    <div class="dd-shell" [attr.dir]="ws.dir()">
      <header class="dd-topbar">
        <span class="dd-brand">angular-dockable-desktop <small>demo</small></span>

        <button type="button" data-demo-toggle-sidebar (click)="showSidebar.set(!showSidebar())">{{ showSidebar() ? 'Hide' : 'Show' }} sidebar</button>
        <button type="button" (click)="sidebarSide.set(sidebarSide() === 'left' ? 'right' : 'left')">Sidebar: {{ sidebarSide() }}</button>
        <button type="button" data-demo-toggle-toolbar (click)="showToolbar.set(!showToolbar())">{{ showToolbar() ? 'Hide' : 'Show' }} toolbar</button>
        <select data-demo-toolbar-side title="Toolbar edge" aria-label="Toolbar edge" [value]="toolbarSide()" (change)="toolbarSide.set($any($event.target).value)">
          @for (side of sides; track side) { <option [value]="side">Toolbar: {{ side }}</option> }
        </select>

        <span class="dd-spacer"></span>

        <select data-demo-taskbar title="Taskbar visibility" aria-label="Taskbar visibility" [value]="taskbar()" (change)="taskbar.set($any($event.target).value)">
          <option value="always">Taskbar: always</option>
          <option value="compact">Taskbar: compact</option>
          <option value="autohide">Taskbar: auto-hide</option>
        </select>
        <select data-demo-skin title="Workspace skin" aria-label="Workspace skin" [value]="skin()" (change)="skin.set($any($event.target).value)">
          @for (name of skins; track name) { <option [value]="name">{{ name }}</option> }
        </select>
        <select data-demo-locale title="Language" aria-label="Language" [value]="locale()" (change)="locale.set($any($event.target).value)">
          @for (option of locales; track option.id) { <option [value]="option.id">{{ option.label }}</option> }
        </select>
        <label class="dd-row" style="cursor: pointer" title="The library's own transitions">
          <input type="checkbox" data-demo-animations [checked]="animations()" (change)="animations.set($any($event.target).checked)" />
          <span>anim</span>
        </label>
        <button type="button" data-demo-theme [title]="themeLabel()" [attr.aria-label]="themeLabel()" (click)="scheme.set(scheme() === 'dark' ? 'light' : 'dark')">
          {{ scheme() === 'dark' ? '☾' : '☀' }}
        </button>
      </header>

      <div class="dd-main" [class.dd-main--column]="vertical()">
        @if (showToolbar() && (toolbarSide() === 'left' || toolbarSide() === 'top')) {
          <ndd-toolbar [position]="toolbarSide()" [items]="toolbarItems()" />
        }

        <ndd-sidebar
          class="dd-workspace"
          [position]="sidebarSide()"
          [tabs]="sidebarTabs()"
          [(activeTabId)]="openTab"
          [(visible)]="showSidebar"
          [headerAction]="headerAction"
          [footerAction]="footerAction"
          [showCloseButton]="true"
        >
          <ndd-secondary-sidebar [tabs]="secondaryTabs">
            <div class="dd-workspace">
              <ndd-desktop [skin]="skin()" [animations]="animations()" [taskbar]="taskbar()" [defaultPanelIcon]="icons.panel" />
            </div>
          </ndd-secondary-sidebar>
        </ndd-sidebar>

        @if (showToolbar() && (toolbarSide() === 'right' || toolbarSide() === 'bottom')) {
          <ndd-toolbar [position]="toolbarSide()" [items]="toolbarItems()" />
        }
      </div>

      <!-- The four hosts. Place each once; where they sit in the tree does not matter. -->
      <ndd-context-menu />
      <ndd-side-panels />
      <ndd-modals />
      <ndd-toasts position="top-right" [progressBar]="true" />
    </div>
  `,
})
export class App {
  protected readonly ws = inject(Workspace);
  protected readonly icons = ICONS;
  protected readonly skins = SKINS;
  protected readonly locales = LOCALES;
  protected readonly sides: ToolbarSide[] = ['left', 'right', 'top', 'bottom'];
  protected readonly locale = locale;

  // ── what the shell owns ─────────────────────────────────────────────────
  protected readonly skin = signal<Skin>('vscode');
  protected readonly scheme = signal<'dark' | 'light'>('dark');
  protected readonly animations = signal(true);
  protected readonly taskbar = signal<TaskbarVisibility>('always');
  protected readonly sidebarSide = signal<'left' | 'right'>('left');
  protected readonly toolbarSide = signal<ToolbarSide>('left');
  protected readonly showSidebar = signal(true);
  protected readonly showToolbar = signal(true);
  protected readonly openTab = signal<string | null>(null);

  protected readonly themeLabel = computed(() => UI[locale()]['theme'] ?? 'Theme');
  protected readonly vertical = computed(() => this.toolbarSide() === 'top' || this.toolbarSide() === 'bottom');

  private readonly openManager = () => this.ws.overlays.openLeftPanel(PanelManagerForm, {}, { title: 'Panel manager', width: 340 });
  protected readonly headerAction: SidebarRailEntry = { id: 'hamburger', icon: ICONS.hamburger, label: 'Panel manager', onClick: this.openManager };
  protected readonly footerAction: SidebarRailEntry = { id: 'help', icon: ICONS.help, label: 'Help', onClick: () => this.ws.openPanel('help', 'help') };
  protected readonly secondaryTabs: SidebarTab[] = [{ id: 'inspector', label: 'Inspector', icon: ICONS.eye, component: PanelManagerForm }];

  // ── the shell's own chrome, merged with whatever the active panel contributes ──
  /**
   * `injectMergedToolbarItems` and `injectMergedSidebarTabs` append the active panel's
   * contributions. Nothing is merged automatically: the library does not know what a
   * contributed item means for this application or where in its toolbar it belongs. Open the
   * Markdown or Tools panel and watch the toolbar grow; focus something else and it shrinks.
   */
  protected readonly toolbarItems = injectMergedToolbarItems((): ToolbarItem[] => [
    { type: 'action', id: 'app-control', label: 'Control Center', icon: ICONS.rocket, onClick: () => this.ws.openPanel('control', 'control') },
    { type: 'action', id: 'app-manager', label: 'Panel manager', icon: ICONS.panel, onClick: this.openManager },
    { type: 'separator' },
    { type: 'toggle', id: 'app-taskbar', label: 'Compact taskbar', icon: ICONS.locator, active: this.taskbar() === 'compact', onToggle: (on: boolean) => this.taskbar.set(on ? 'compact' : 'always') },
  ]);
  protected readonly sidebarTabs = injectMergedSidebarTabs(
    () => [
      { id: 'layers', label: 'Layers', icon: ICONS.layers, component: LayerTreePanel, preserveState: true },
      { id: 'search', label: 'Search', icon: ICONS.help, component: HelpPanel },
    ],
    ICONS.panel,
  );

  constructor() {
    const doc = inject(DOCUMENT);

    // The colour scheme is the *application's* attribute, not the library's: the library reads
    // `data-color-scheme` and styles itself from it, which is why `injectColorScheme()` is
    // read-only.
    effect(() => {
      if (this.scheme() === 'light') doc.documentElement.setAttribute('data-color-scheme', 'light');
      else doc.documentElement.removeAttribute('data-color-scheme');
    });

    // Picking a locale also picks its reading direction, which is the realistic case.
    let first = true;
    effect(() => {
      const next: Locale = locale();
      if (first) {
        first = false;
        return;
      }
      this.ws.setDirection(LOCALES.find(l => l.id === next)?.dir ?? 'ltr');
    });

    // A first layout, so the demo opens on something rather than on an empty grid.
    afterNextRender(() => {
      this.ws.openPanel('mainMap', 'mainMap');
      this.ws.openPanel('control', 'control');
      this.ws.openPanel('editor', 'editor');
      this.ws.dockPanelToWorkspaceEdge('control', 'right');
      this.ws.focusPanel('mainMap');
    });

    // The demo's own handle, so a browser gate can drive it the way a user would — through the
    // public API rather than through test-only shortcuts.
    (window as unknown as Record<string, unknown>)['__demo'] = {
      ready: true,
      workspace: this.ws,
      locale,
      appRef: inject(ApplicationRef),
      zone: typeof (window as unknown as Record<string, unknown>)['Zone'] !== 'undefined',
      shell: { skin: this.skin, scheme: this.scheme, taskbar: this.taskbar, toolbarSide: this.toolbarSide, sidebarSide: this.sidebarSide, showSidebar: this.showSidebar, showToolbar: this.showToolbar, openTab: this.openTab },
    };
  }
}
