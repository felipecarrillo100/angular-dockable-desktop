import { signal } from '@angular/core';
import type { MessageDescriptor } from 'angular-dockable-desktop';

/**
 * The playground's language: a signal the formatter reads, so switching it re-renders every
 * label the library draws — no reload, no reopen. That is how an application switches locale.
 */
export const pgLocale = signal<'en' | 'es'>('en');

const ES: Record<string, string> = {
  'ndd.closeTab': 'Cerrar pestaña',
  'ndd.minimizePanel': 'Minimizar panel',
  'ndd.floatWindow': 'Ventana flotante',
};

export const pgFormatMessage = (m: MessageDescriptor): string => {
  const text = pgLocale() === 'es' ? (ES[m.id] ?? m.defaultMessage ?? m.id) : (m.defaultMessage ?? m.id);
  return Object.entries(m.values ?? {}).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), text);
};
