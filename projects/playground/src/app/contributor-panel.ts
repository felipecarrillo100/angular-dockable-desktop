import { Component, signal } from '@angular/core';
import { injectPanel, injectPanelContribution } from 'angular-dockable-desktop';

/**
 * A panel that contributes one toolbar toggle to the app shell while it is the active panel —
 * named after itself, so the gate can tell whose controls the shell is showing.
 */
@Component({
  selector: 'pg-contributor-panel',
  template: `<div class="pg-editor" [attr.data-contrib]="panel.id">contributes "c-{{ panel.id }}" · on={{ on() }}</div>`,
})
export class ContributorPanel {
  protected readonly panel = injectPanel();
  protected readonly on = signal(false);

  constructor() {
    injectPanelContribution(() => ({
      toolbarItems: [
        {
          type: 'toggle',
          id: `c-${this.panel.id}`,
          label: `Tool of ${this.panel.id}`,
          icon: 'pg-icon',
          active: this.on(),
          onToggle: next => this.on.set(next),
        },
      ],
    }));
  }
}
