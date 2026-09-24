import { ChangeDetectionStrategy, Component, computed, effect, input, linkedSignal } from '@angular/core';
import { injectPanel } from 'angular-dockable-desktop';

const DEFAULT = '# Notes\n\nType here. The tab goes dirty; Save clears it.\n';

/**
 * The ordinary case: an editor that is dirty while it has unsaved edits.
 *
 * Also the case for `onSaveState()`. A panel's open-time inputs cannot describe what the user
 * has typed since, so `saveLayout()` pulls this panel's *current* content from the provider
 * below — fresh on every save, not captured once. Restoring passes it back as the `content`
 * input, and `linkedSignal` seeds the editable text from it.
 */
@Component({
  selector: 'dd-dirty-editor-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel dd-col" style="height: 100%">
      <div class="dd-row">
        <button type="button" data-demo-save [disabled]="!dirty()" (click)="saved.set(text())">Save</button>
        <button type="button" (click)="text.set(saved())">Revert</button>
        <span class="dd-note" style="margin: 0">{{ dirty() ? 'unsaved changes' : 'saved' }}</span>
      </div>
      <textarea
        data-demo-editor
        spellcheck="false"
        aria-label="Notes"
        style="flex: 1; min-height: 120px; width: 100%; resize: none; font-family: ui-monospace, monospace; font-size: 0.78rem"
        [value]="text()"
        (input)="text.set($any($event.target).value)"
      ></textarea>
      <p class="dd-note">
        Save the layout from the Control Center, reload the page and restore it — this text comes
        back, because <code>onSaveState()</code> contributed it.
      </p>
    </div>
  `,
})
export class DirtyEditorPanel {
  /** A restored layout hands the saved text back through this. */
  readonly content = input<string | undefined>(undefined);
  protected readonly text = linkedSignal(() => this.content() ?? DEFAULT);
  protected readonly saved = linkedSignal(() => this.content() ?? DEFAULT);
  protected readonly dirty = computed(() => this.text() !== this.saved());

  constructor() {
    const panel = injectPanel();
    effect(() => panel.setDirty(this.dirty()));
    /** Pulled on every `saveLayout()`, so a restored layout brings the text back. */
    panel.onSaveState(() => ({ content: this.text() }));
  }
}
