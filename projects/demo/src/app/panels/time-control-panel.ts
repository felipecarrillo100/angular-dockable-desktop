import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';

/**
 * A playback strip: the case for a panel docked to a workspace edge as a full-width row.
 *
 * Its running frame counter is also the simplest proof that a docked panel dragged to a new
 * group is moved rather than re-created.
 */
@Component({
  selector: 'dd-time-control-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel dd-row" style="height: 100%; padding: 0.5rem 0.8rem; overflow: hidden">
      <button type="button" data-demo-play style="min-width: 5.5rem" (click)="toggle()">
        {{ playing() ? '⏸ Pause' : '▶ Play' }}
      </button>
      <input
        type="range" min="0" max="100" style="flex: 1; min-width: 80px" aria-label="Frame"
        [value]="frame()" (input)="frame.set(+$any($event.target).value)"
      />
      <span style="font-family: ui-monospace, monospace; white-space: nowrap">{{ clock() }} · frame {{ frame() }}/100</span>
    </div>
  `,
})
export class TimeControlPanel {
  protected readonly playing = signal(false);
  protected readonly frame = signal(50);
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly clock = computed(() => {
    const total = Math.round((this.frame() / 100) * 24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected toggle(): void {
    this.playing.update(p => !p);
    if (this.playing()) this.timer = setInterval(() => this.frame.update(f => (f + 1) % 101), 120);
    else this.stop();
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
