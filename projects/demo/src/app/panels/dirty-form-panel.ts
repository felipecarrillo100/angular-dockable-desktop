import { ChangeDetectionStrategy, Component, effect, signal } from '@angular/core';
import { injectPanel } from 'angular-dockable-desktop';

/**
 * Dirty state and close interception — every path a close can take.
 *
 * The four behaviours worth trying in order:
 *
 *  1. Mark it dirty, then close the tab. The library asks before discarding, through its own
 *     dialog, in whatever locale the demo is set to.
 *  2. Turn on the guard and close. `onBeforeClose` returns `false`, so nothing happens — a
 *     guard takes precedence over the dirty question.
 *  3. Type a title. The tab, the window title bar and the taskbar icon all follow.
 *  4. Force-close. Skips the guard *and* the question, which is what a "discard" button does.
 */
@Component({
  selector: 'dd-dirty-form-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel dd-col" style="gap: 0.9rem">
      <div class="dd-section">
        <h5>1 · Unsaved changes</h5>
        <div class="dd-row">
          <button type="button" data-demo-dirty (click)="dirty.set(!dirty())">{{ dirty() ? '🔴 Dirty' : '🟢 Clean' }}</button>
          <span class="dd-note" style="margin: 0"><code>injectPanel().setDirty()</code> — the tab shows an asterisk</span>
        </div>
        <p class="dd-note">
          While dirty, closing asks first — the tab's ×, the taskbar menu, Delete on a focused tab
          and <code>close()</code> all route through the same question, so none of them can
          discard silently.
        </p>
      </div>

      <div class="dd-section">
        <h5>2 · A close guard</h5>
        <label class="dd-row" style="cursor: pointer">
          <input type="checkbox" data-demo-guard [checked]="guarded()" (change)="guarded.set($any($event.target).checked)" />
          <span>Block closing entirely</span>
        </label>
        <p class="dd-note">
          <code>onBeforeClose()</code> returning <code>false</code>. Blocked
          <strong data-demo-blocked>{{ blocked() }}</strong> attempt(s) so far. A guard wins over
          the dirty question, so the dialog never appears.
        </p>
      </div>

      <div class="dd-section">
        <h5>3 · A live title</h5>
        <input
          type="text" placeholder="Type a new panel title…" aria-label="Panel title" data-demo-title style="width: 100%"
          [value]="title()" (input)="title.set($any($event.target).value)"
        />
        <p class="dd-note">The tab, a floating title bar and the taskbar icon all follow it.</p>
      </div>

      <div class="dd-section">
        <h5>4 · Closing programmatically</h5>
        <div class="dd-row">
          <button type="button" data-demo-close (click)="panel.close()">Close</button>
          <button type="button" data-demo-force-close (click)="panel.close({ force: true })">Force close</button>
        </div>
        <p class="dd-note">Force skips the guard and the dirty question both.</p>
      </div>
    </div>
  `,
})
export class DirtyFormPanel {
  protected readonly panel = injectPanel();
  protected readonly dirty = signal(false);
  protected readonly guarded = signal(false);
  protected readonly title = signal('');
  protected readonly blocked = signal(0);

  constructor() {
    effect(() => this.panel.setDirty(this.dirty()));
    effect(() => this.panel.setTitle(this.title() || 'Intercept Form'));

    // Registered once, and it reads `guarded` when it runs rather than when it was registered —
    // so the switch works without re-registering anything. Disposed with the component.
    this.panel.onBeforeClose(() => {
      if (!this.guarded()) return true;
      this.blocked.update(n => n + 1);
      return false;
    });
  }
}
