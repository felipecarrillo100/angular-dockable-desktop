import { ChangeDetectionStrategy, Component } from '@angular/core';

type Status = 'online' | 'degraded' | 'offline';
const COLOURS: Record<Status, string> = { online: '#22c55e', degraded: '#f59e0b', offline: '#ef4444' };

/** A data table, for demonstrating a panel whose content scrolls independently. */
@Component({
  selector: 'dd-table-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
    th, td { padding: 0.25rem 0.4rem; }
    thead tr { text-align: start; opacity: 0.55; }
    tbody tr { border-top: 1px solid rgba(255, 255, 255, 0.06); }
    .mono { font-family: ui-monospace, monospace; }
    .end { text-align: end; }
  `,
  template: `
    <div class="dd-panel">
      <table>
        <thead>
          <tr><th>ID</th><th>Asset</th><th>Status</th><th class="end">Load</th></tr>
        </thead>
        <tbody>
          @for (row of rows; track row.id) {
            <tr>
              <td class="mono">{{ row.id }}</td>
              <td>{{ row.name }}</td>
              <td>
                <span class="dd-row"><span class="dd-swatch" [style.background]="colours[row.status]"></span>{{ row.status }}</span>
              </td>
              <td class="mono end">{{ row.load }}%</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class TablePanel {
  protected readonly colours = COLOURS;
  protected readonly rows = Array.from({ length: 60 }, (_, i) => ({
    id: 1000 + i,
    name: ['Substation', 'Feeder', 'Transformer', 'Switchgear'][i % 4] + ' ' + (i + 1),
    status: (['online', 'degraded', 'offline'] as const)[i % 3]!,
    load: Math.round(Math.random() * 100),
  }));
}
