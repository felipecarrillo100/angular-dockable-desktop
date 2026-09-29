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
 *
 * Set before bootstrap, as an application would (the M16 branding gate):
 * `?cs=light` puts `data-color-scheme="light"` on <html> (dark is the attribute's absence);
 * `?ba=HEX` / `?bon=HEX` set `--ndd-brand-accent` / `--ndd-brand-on-accent` on :root (hex without `#`).
 */
const params = new URLSearchParams(location.search);
const zone = params.has('zone');
if (zone) await import('zone.js');
if (params.get('cs') === 'light') document.documentElement.setAttribute('data-color-scheme', 'light');
if (params.get('ba')) document.documentElement.style.setProperty('--ndd-brand-accent', `#${params.get('ba')}`);
if (params.get('bon')) document.documentElement.style.setProperty('--ndd-brand-on-accent', `#${params.get('bon')}`);
// The M17 gate: `?bs=HEX` / `?bt=HEX` set --ndd-brand-surface / --ndd-brand-text, `?rs=N` --ndd-radius-scale.
if (params.get('bs')) document.documentElement.style.setProperty('--ndd-brand-surface', `#${params.get('bs')}`);
if (params.get('bt')) document.documentElement.style.setProperty('--ndd-brand-text', `#${params.get('bt')}`);
if (params.get('rs')) document.documentElement.style.setProperty('--ndd-radius-scale', params.get('rs')!);

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
