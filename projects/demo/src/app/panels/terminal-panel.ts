import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { injectPanel } from 'angular-dockable-desktop';

/**
 * A terminal, and the simplest demonstration of zero-unmount preservation: its scroll
 * position and its accumulating log survive every dock, float, minimise and restore, because
 * the panel is never destroyed (ADR 0002).
 */
@Component({
  selector: 'dd-terminal-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #scroller class="dd-panel" data-demo-terminal>
      <pre style="margin: 0; font-size: 0.72rem; line-height: 1.5">{{ lines().join('\\n') }}</pre>
    </div>
  `,
})
export class TerminalPanel {
  protected readonly lines = signal(['$ ng build', 'Application bundle generation...', 'Building (48) src/main.ts']);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  constructor() {
    const panel = injectPanel();
    // A running log, so "the panel kept its state" is visible rather than asserted.
    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      this.lines.update(lines => {
        const next = [...lines, `✓ built chunk ${tick} in ${(Math.random() * 40 + 5).toFixed(1)}ms`];
        return next.length > 400 ? next.slice(100) : next;
      });
      requestAnimationFrame(() => {
        const el = this.scroller().nativeElement;
        el.scrollTop = el.scrollHeight;
      });
    }, 1200);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // The panel's own title reports how much it has logged, which is state the tab can show.
    effect(() => panel.setTitle(`Terminal (${this.lines().length})`));
  }
}
