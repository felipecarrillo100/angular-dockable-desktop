import type { Label, MessageDescriptor, MessageFormatter } from './types';

/**
 * The library's own UI strings.
 *
 * Each `id` is the key an application defines in its i18n message table; `defaultMessage`
 * is the fallback when no formatter is supplied. Override any subset via
 * `createWorkspace({ messages })` — the object is merged, so partial overrides work.
 */
export const defaultMessages = {
  floatWindow: { id: 'ndd.floatWindow', defaultMessage: 'Float Window' },
  minimizePanel: { id: 'ndd.minimizePanel', defaultMessage: 'Minimize Panel' },
  closeTab: { id: 'ndd.closeTab', defaultMessage: 'Close Tab' },
  restorePanel: { id: 'ndd.restorePanel', defaultMessage: 'Restore Panel' },
  maximizePanel: { id: 'ndd.maximizePanel', defaultMessage: 'Maximize Panel' },
  closePanel: { id: 'ndd.closePanel', defaultMessage: 'Close Panel' },
  dockWindow: { id: 'ndd.dockWindow', defaultMessage: 'Dock Window' },
  minimize: { id: 'ndd.minimize', defaultMessage: 'Minimize' },
  maximize: { id: 'ndd.maximize', defaultMessage: 'Maximize' },
  restoreSize: { id: 'ndd.restoreSize', defaultMessage: 'Restore Size' },
  close: { id: 'ndd.close', defaultMessage: 'Close' },
  closeEmptyGroup: { id: 'ndd.closeEmptyGroup', defaultMessage: 'Close empty split group' },
  emptyGroup: { id: 'ndd.emptyGroup', defaultMessage: 'Empty workspace section' },
  unsavedChangesTitle: { id: 'ndd.unsavedChangesTitle', defaultMessage: 'Unsaved Changes' },
  unsavedChangesMessage: {
    id: 'ndd.unsavedChangesMessage',
    defaultMessage: '"{title}" has unsaved changes. Do you want to discard your changes and close?',
  },
  discardChanges: { id: 'ndd.discardChanges', defaultMessage: 'Discard Changes' },
  cancel: { id: 'ndd.cancel', defaultMessage: 'Cancel' },
  yes: { id: 'ndd.yes', defaultMessage: 'Yes' },
  no: { id: 'ndd.no', defaultMessage: 'No' },
  ok: { id: 'ndd.ok', defaultMessage: 'OK' },
  // The default titles of injectModals().confirm() and .alert() (1.6.0).
  confirmTitle: { id: 'ndd.confirmTitle', defaultMessage: 'Confirmation' },
  alertTitle: { id: 'ndd.alertTitle', defaultMessage: 'Information' },
  closeTooltip: { id: 'ndd.closeTooltip', defaultMessage: 'Close' },
  scrollTabsLeft: { id: 'ndd.scrollTabsLeft', defaultMessage: 'Scroll tabs left' },
  scrollTabsRight: { id: 'ndd.scrollTabsRight', defaultMessage: 'Scroll tabs right' },
  moreActions: { id: 'ndd.moreActions', defaultMessage: 'More actions' },
  search: { id: 'ndd.search', defaultMessage: 'Search' },
} as const satisfies Record<string, MessageDescriptor>;

/**
 * Every message key. Import it in your own message table to get a compile-time guarantee
 * that all keys are present and none are misspelled.
 */
export type MessageKey = keyof typeof defaultMessages;

/**
 * Resolve a label with a formatter, falling back to its `defaultMessage` then its `id`, with each
 * `{key}` replaced by its value — every occurrence (1.3.1; it replaced only the first).
 */
export function formatLabel(label: Label | undefined, format?: MessageFormatter): string {
  if (label === undefined || label === null) return '';
  if (typeof label === 'string') return label;
  if (typeof label === 'function') return label();
  if (format) return format(label);
  let text = label.defaultMessage ?? label.id;
  if (label.values) {
    for (const [key, value] of Object.entries(label.values)) {
      text = text.split(`{${key}}`).join(String(value));
    }
  }
  return text;
}
