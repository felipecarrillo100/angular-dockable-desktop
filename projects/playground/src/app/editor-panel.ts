import { Component, signal } from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';
import { injectPanel } from 'angular-dockable-desktop';

/**
 * A panel with unsaved state: a Signal Forms form whose `dirty()` the panel tracks, so the
 * workspace asks before discarding it — from a tab's ×, a window's ×, a menu or `close()`.
 */
@Component({
  selector: 'pg-editor-panel',
  imports: [FormField],
  template: `
    <div class="pg-editor" [attr.data-editor]="panel.id">
      <label>Name <input [formField]="form.name" [attr.data-editor-input]="panel.id" /></label>
      <span [attr.data-editor-dirty]="panel.id">{{ form().dirty() ? 'dirty' : 'clean' }}</span>
    </div>
  `,
})
export class EditorPanel {
  protected readonly panel = injectPanel();
  private readonly model = signal({ name: '' });
  protected readonly form = form(this.model, path => required(path.name));

  constructor() {
    this.panel.trackDirty(
      () => this.form().dirty(),
      () => ({ alert: this.form().valid() ? undefined : 'Name is required' }),
    );
  }
}
