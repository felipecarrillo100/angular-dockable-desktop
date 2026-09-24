import { provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';

// `?zone` boots the same app on zone.js, so every assertion runs under both schedulers (D4).
const zone = new URLSearchParams(location.search).has('zone');
if (zone) await import('zone.js');

bootstrapApplication(App, {
  providers: [provideBrowserGlobalErrorListeners(), ...(zone ? [provideZoneChangeDetection()] : [])],
}).catch(err => console.error(err));
