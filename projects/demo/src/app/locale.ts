import { signal } from '@angular/core';
import { createFormatter } from './i18n/messages';
import type { Locale } from './i18n/messages';

/**
 * The locale lives outside the workspace, because the workspace only needs a *formatter* —
 * `(descriptor) => string`. Holding the locale in a signal and closing over it is the whole
 * integration: the library reads through the function inside its templates, so a locale
 * switch re-renders every label with nothing else wired.
 */
export const locale = signal<Locale>('en');
export const formatMessage = createFormatter(() => locale());
