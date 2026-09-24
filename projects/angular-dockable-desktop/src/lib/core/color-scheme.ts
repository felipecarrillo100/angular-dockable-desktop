/**
 * The application's colour scheme, as the library reads it: `data-color-scheme="light"` on
 * `<html>` means light; anything else (usually no attribute) means dark, the base look. This is
 * the family's documented contract (ADR 0011), read here and never written.
 */
import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';

export type ColorScheme = 'dark' | 'light';

const read = (doc: Document): ColorScheme =>
  doc.documentElement?.getAttribute('data-color-scheme') === 'light' ? 'light' : 'dark';

/**
 * A signal of the current colour scheme, following the attribute as the application changes it.
 * Call in an injection context; the observer is disconnected with it.
 */
export function injectColorScheme(): Signal<ColorScheme> {
  const doc = inject(DOCUMENT);
  const scheme = signal<ColorScheme>(read(doc));
  if (typeof MutationObserver !== 'undefined' && doc.documentElement) {
    const observer = new MutationObserver(() => scheme.set(read(doc)));
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] });
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
  return scheme.asReadonly();
}
