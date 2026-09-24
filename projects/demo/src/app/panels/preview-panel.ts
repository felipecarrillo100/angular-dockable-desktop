import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

/** A live preview pane, with a counter that proves the panel was not re-created. */
@Component({
  selector: 'dd-preview-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel">
      <h4>Preview</h4>
      <p>
        This panel has been mounted for <strong data-demo-preview-seconds>{{ seconds() }}s</strong>. Dock it,
        float it, minimise it, drag it to another group — the number keeps climbing, because the
        panel is moved rather than re-created.
      </p>
      <div
        class="dd-fill"
        style="min-height: 120px; border-radius: 6px; display: grid; place-items: center;
               background: linear-gradient(135deg, rgba(56,189,248,0.12), rgba(168,85,247,0.12))"
      >
        <span style="font: 600 0.8rem ui-monospace, monospace; opacity: 0.7">rendered output</span>
      </div>
    </div>
  `,
})
export class PreviewPanel {
  protected readonly seconds = signal(0);

  constructor() {
    const timer = setInterval(() => this.seconds.update(s => s + 1), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
