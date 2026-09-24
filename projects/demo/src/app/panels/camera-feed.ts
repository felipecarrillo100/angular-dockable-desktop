import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** A mock camera feed. Its animation keeps running through every dock and float. */
@Component({
  selector: 'dd-camera-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-camera" [style.background]="background()">
      <div class="dd-camera__sweep"></div>
      <div class="dd-camera__label" [style.color]="colour()">● REC · {{ name() }}</div>
      <svg viewBox="0 0 100 70" style="width: 100%; height: 100%; opacity: 0.5">
        <g [attr.stroke]="colour()" stroke-width="0.4" fill="none" opacity="0.5">
          @for (i of lines; track i) { <path [attr.d]="'M0 ' + i * 10 + 'H100'" /> }
        </g>
        <circle cx="50" cy="35" r="9" [attr.fill]="colour()" opacity="0.3" />
        <circle cx="50" cy="35" r="3.5" [attr.fill]="colour()" />
      </svg>
    </div>
  `,
})
export class CameraFeed {
  readonly name = input.required<string>();
  readonly colour = input.required<string>();
  protected readonly lines = [1, 2, 3, 4, 5, 6, 7];
  protected readonly background = computed(() => `linear-gradient(160deg, ${this.colour()}22, #0c0f14)`);
}
