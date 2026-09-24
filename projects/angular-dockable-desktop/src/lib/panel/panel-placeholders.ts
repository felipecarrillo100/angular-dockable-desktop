import { Component, input } from '@angular/core';

/**
 * Rendered in place of a panel whose component key is not registered — a diagnostic instead of
 * a crash, typically after loading a layout saved by a build with more panel types.
 * @internal
 */
@Component({
  selector: 'ndd-unregistered-panel',
  host: { class: 'ndd-unregistered-panel' },
  template: `<strong>Unregistered panel</strong>
    <span>No component is registered for key "{{ panelKey() }}".</span>`,
})
export class NddUnregisteredPanel {
  readonly panelKey = input('');
}

/** Rendered while a lazy panel's (`loadComponent`) chunk loads. @internal */
@Component({
  selector: 'ndd-panel-loading',
  host: { class: 'ndd-panel-loading', role: 'status', 'aria-busy': 'true' },
  template: `<span>Loading…</span>`,
})
export class NddPanelLoading {}
