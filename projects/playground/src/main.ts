import { provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideDockableDesktop } from 'angular-dockable-desktop';
import { App } from './app/app';
import { HostilePanel } from './app/hostile-panel';
import { EditorPanel } from './app/editor-panel';
import { OverlayPanel } from './app/overlay-panel';
import { ContributorPanel } from './app/contributor-panel';
import { EmbedFrame } from './app/embed-frame';
import { pgFormatMessage } from './app/locale';
import { PopPanel } from './app/pop-panel';
import { rcIcon } from './app/runtime-css';
import { WoOwner } from './app/pop-widget';

/**
 * The playground: the minimal harness the browser gates drive.
 *
 * `?zone` boots the same app on zone.js, so every browser gate runs under both schedulers
 * (ADR 0006). `?layout=two-leaf` starts from two side-by-side groups.
 *
 * Set before bootstrap, as an application would (the M16 branding gate):
 * `?cs=light` puts `data-color-scheme="light"` on <html> (dark is the attribute's absence);
 * `?ba=HEX` / `?bon=HEX` set `--ndd-brand-accent` / `--ndd-brand-on-accent` on :root (hex without `#`).
 *
 * The M19 gate (1.12.0): `?po=1` gives the workspace pop-out windows, starts from one group (as
 * rdd's harness does: no kept-empty group in its splits) and opens `pp` (type `popper`,
 * canPopOut) as a tab beside `p1`; `?po2=1` adds `pq`, another tab there. `?pourl=1` makes the
 * playground's own `popout.html` the pop-out page (app.ts).
 *
 * `?wo=1` (P5): the owner panel `ov` (type `wover`, pop-widget.ts) docked beside p1, with a managed
 * widget `wo` (canPopOut, a titleMenu) opened in it; `?opo=1`: the owner type can pop out too, and
 * its #wo-po-in pops the widget out from inside it (rdd 7.12.1's harness `opo=1`).
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

const POPOUT = params.get('po') === '1';
// `?rc=1` (P4): `popper`'s icon is styled only by the runtime CSS-in-JS stand-in (runtime-css.ts), so
// it shows in a pop-out's frame only through the app's popoutWrapper.
const RC = params.get('rc') === '1';
const OPO = params.get('opo') === '1';
const ONE_LEAF = JSON.stringify({
  version: 2,
  gridRoot: { type: 'leaf', id: 'L', panels: [], activePanelId: null },
  floating: [], minimized: [], panels: {},
});

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
      popOut: POPOUT,
      panels: {
        popper: { component: PopPanel, defaultOptions: { title: 'Pop', canPopOut: true, ...(RC ? { icon: rcIcon('frame') } : {}) } },
        hostile: { component: HostilePanel, defaultOptions: { title: 'Hostile' } },
        wover: { component: WoOwner, defaultOptions: { title: 'Owner', ...(OPO ? { canPopOut: true } : {}) } },
        editor: { component: EditorPanel, defaultOptions: { title: 'Editor' } },
        overlay: { component: OverlayPanel, defaultOptions: { title: 'Overlay' } },
        contributor: { component: ContributorPanel, defaultOptions: { title: 'Contributor' } },
        // M11 gate (7.11): an iframe in a panel type with preserveEmbeds, and one without.
        embedKept: { component: EmbedFrame, defaultOptions: { title: 'Kept', preserveEmbeds: true } },
        embedBare: { component: EmbedFrame, defaultOptions: { title: 'Bare' } },
      },
      initialState: POPOUT ? ONE_LEAF : params.get('layout') === 'two-leaf' ? TWO_LEAF : null,
      formatMessage: pgFormatMessage,
    }),
  ],
}).catch(err => console.error(err));
