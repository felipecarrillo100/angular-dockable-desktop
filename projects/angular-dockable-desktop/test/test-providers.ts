/**
 * Providers for every unit test (angular.json → test → providersFile).
 *
 * The CLI's unit-test builder bootstraps TestBed on zone.js whenever zone.js is installed in
 * the workspace — and it is, for the zone-build playground (ADR 0006). Left alone, the whole
 * unit suite would run under zone.js with manual change detection, which is exactly the setup
 * this library is *not* designed around. So TestBed is zoneless here, like a new Angular 22
 * application; the zone.js path is covered by every browser gate instead. Found in M3.
 */
import { provideZonelessChangeDetection } from '@angular/core';

export default [provideZonelessChangeDetection()];
