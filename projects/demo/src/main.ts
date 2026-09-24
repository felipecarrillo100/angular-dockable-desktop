import { provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideDockableDesktop } from 'angular-dockable-desktop';
import { App } from './app/app';
import { ICONS } from './app/icons';
import { formatMessage } from './app/locale';
import { ControlCenterPanel } from './app/panels/control-center-panel';
import { DirtyEditorPanel } from './app/panels/dirty-editor-panel';
import { DirtyFormPanel } from './app/panels/dirty-form-panel';
import { HelpPanel } from './app/panels/help-panel';
import { LayerTreePanel } from './app/panels/layer-tree-panel';
import { OverviewMapPanel } from './app/panels/overview-map-panel';
import { PreviewPanel } from './app/panels/preview-panel';
import { RtlShowcasePanel } from './app/panels/rtl-showcase-panel';
import { TablePanel } from './app/panels/table-panel';
import { TerminalPanel } from './app/panels/terminal-panel';
import { TimeControlPanel } from './app/panels/time-control-panel';
import { ToolPanel } from './app/panels/tool-panel';

/**
 * The demo. Zoneless, as a new Angular application is; `?zone` boots the same app on zone.js,
 * so the walkthrough gate runs it under both schedulers.
 */
const zone = new URLSearchParams(location.search).has('zone');
if (zone) await import('zone.js');

bootstrapApplication(App, {
  providers: [
    provideBrowserGlobalErrorListeners(),
    ...(zone ? [provideZoneChangeDetection()] : []),
    provideDockableDesktop({
      formatMessage,
      panels: {
        control: { component: ControlCenterPanel, defaultOptions: { title: 'Control Center', icon: ICONS.rocket } },
        // The four heavy panels are lazy — `loadComponent`, the router's shape — so Monaco,
        // Leaflet and the markdown pipeline load with the first panel that needs them rather
        // than with the application.
        editor: { loadComponent: () => import('./app/panels/code-editor-panel').then(m => m.CodeEditorPanel), defaultOptions: { title: 'Code Editor', icon: ICONS.code } },
        markdownEditor: { loadComponent: () => import('./app/panels/markdown-editor-panel').then(m => m.MarkdownEditorPanel), defaultOptions: { title: 'Markdown', icon: ICONS.document } },

        // The workspace's primary view: not closable, and not worth scaling into a thumbnail.
        mainMap: { loadComponent: () => import('./app/panels/main-map-panel').then(m => m.MainMapPanel), defaultOptions: { title: 'Main Map', icon: ICONS.map, canClose: false, disableLivePreview: true } },
        leafletMap: { loadComponent: () => import('./app/panels/leaflet-map-panel').then(m => m.LeafletMapPanel), defaultOptions: { title: 'Leaflet Map', icon: ICONS.globe, disableLivePreview: true } },

        layers: { component: LayerTreePanel, defaultOptions: { title: 'Layers', icon: ICONS.layers } },
        tools: { component: ToolPanel, defaultOptions: { title: 'Tools', icon: ICONS.tools } },
        table: { component: TablePanel, defaultOptions: { title: 'Assets', icon: ICONS.table } },
        terminal: { component: TerminalPanel, defaultOptions: { title: 'Terminal', icon: ICONS.terminal } },
        preview: { component: PreviewPanel, defaultOptions: { title: 'Preview', icon: ICONS.eye } },
        help: { component: HelpPanel, defaultOptions: { title: 'Help', icon: ICONS.help } },
        timeControl: { component: TimeControlPanel, defaultOptions: { title: 'Timeline', icon: ICONS.clock } },
        overview: { component: OverviewMapPanel, defaultOptions: { title: 'Locator', icon: ICONS.locator } },

        dirtyForm: { component: DirtyFormPanel, defaultOptions: { title: 'Intercept Form', icon: ICONS.warning, initialTarget: 'floating' } },
        dirtyEditor: { component: DirtyEditorPanel, defaultOptions: { title: 'Notes', icon: ICONS.pencil } },
        rtl: { component: RtlShowcasePanel, defaultOptions: { title: 'RTL', icon: ICONS.rtl } },
      },
    }),
  ],
}).catch(err => console.error(err));
