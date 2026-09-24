import { provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideDockableDesktop } from 'angular-dockable-desktop';
import { App } from './app/app';
import { HostilePanel } from './app/hostile-panel';
import { EditorPanel } from './app/editor-panel';
import { OverlayPanel } from './app/overlay-panel';
import { ContributorPanel } from './app/contributor-panel';
import { pgFormatMessage } from './app/locale';

/**
 * The playground: the minimal harness the browser gates drive.
 *
 * `?zone` boots the same app on zone.js, so every browser gate runs under both schedulers
 * (ADR 0006). `?layout=two-leaf` starts from two side-by-side groups.
 */
const params = new URLSearchParams(location.search);
const zone = params.has('zone');
if (zone) await import('zone.js');

const TWO_LEAF = JSON.stringify({
  version: 2,
  gridRoot: {
    type: 'branch', orientation: 'horizontal', sizes: [0.5, 0.5],
    children: [
      { type: 'leaf', id: 'L', panels: [], activePanelId: null },
      { type: 'leaf', id: 'R', panels: [], activePanelId: null, keepOnEmpty: true },
    ],
  },
  floating: [], minimized: [], panels: {},
});

bootstrapApplication(App, {
  providers: [
    provideBrowserGlobalErrorListeners(),
    ...(zone ? [provideZoneChangeDetection()] : []),
    provideDockableDesktop({
      panels: {
        hostile: { component: HostilePanel, defaultOptions: { title: 'Hostile' } },
        editor: { component: EditorPanel, defaultOptions: { title: 'Editor' } },
        overlay: { component: OverlayPanel, defaultOptions: { title: 'Overlay' } },
        contributor: { component: ContributorPanel, defaultOptions: { title: 'Contributor' } },
      },
      initialState: params.get('layout') === 'two-leaf' ? TWO_LEAF : null,
      formatMessage: pgFormatMessage,
    }),
  ],
}).catch(err => console.error(err));
