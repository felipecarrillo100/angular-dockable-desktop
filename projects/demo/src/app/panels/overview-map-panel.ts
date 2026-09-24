import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A locator inset — a small panel whose content is pure SVG, for the corner of a layout. */
@Component({
  selector: 'dd-overview-map-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel dd-panel--flush" style="display: grid; place-items: center; background: #14171c">
      <svg viewBox="0 0 120 80" style="width: 100%; height: 100%; max-height: 100%">
        <rect width="120" height="80" fill="#14171c" />
        <g stroke="rgba(120,160,200,0.22)" stroke-width="0.6" fill="none">
          @for (x of columns; track x) { <path [attr.d]="'M' + x * 10 + ' 0V80'" /> }
          @for (y of rows; track y) { <path [attr.d]="'M0 ' + y * 10 + 'H120'" /> }
        </g>
        <path d="M8 58 Q34 46 52 52 T96 40" stroke="#38bdf8" stroke-width="1.6" fill="none" opacity="0.8" />
        <rect x="40" y="26" width="34" height="24" fill="none" stroke="#f59e0b" stroke-width="1.2" />
        <circle cx="57" cy="38" r="2.2" fill="#f59e0b" />
        <text x="60" y="72" fill="rgba(200,220,240,0.45)" font-size="5" text-anchor="middle" font-family="ui-monospace, monospace">
          LOCATOR · 1:250 000
        </text>
      </svg>
    </div>
  `,
})
export class OverviewMapPanel {
  protected readonly columns = Array.from({ length: 11 }, (_, i) => i + 1);
  protected readonly rows = Array.from({ length: 7 }, (_, i) => i + 1);
}
