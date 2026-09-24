import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Workspace, injectPanel } from 'angular-dockable-desktop';

interface Row {
  kind: string;
  title: string;
  openIds: string[];
}

/**
 * A panel manager, as a side panel or a modal.
 *
 * Lists every registered panel kind and every open instance, and drives each with the same
 * API a click on a tab uses. Its point in the demo is that it is *not* a panel: it is a form
 * opened into a drawer or a modal, and it reaches the workspace through `inject(Workspace)`
 * exactly as a panel does — there is no second API for chrome.
 */
@Component({
  selector: 'dd-panel-manager-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel dd-col" style="gap: 0.7rem">
      <div class="dd-row" style="justify-content: space-between">
        <strong style="font-size: 0.85rem">Panel manager</strong>
        <span class="dd-note" style="margin: 0">{{ kinds.length }} registered · {{ openCount() }} open</span>
      </div>

      <input
        type="text" placeholder="Filter…" aria-label="Filter panels" data-demo-manager-filter style="width: 100%"
        [value]="query()" (input)="query.set($any($event.target).value)"
      />

      <div class="dd-col" style="gap: 0.35rem">
        @for (row of rows(); track row.kind) {
          <div style="padding: 0.4rem 0.5rem; border-radius: 5px; border: 1px solid var(--ndd-border-color, rgba(255,255,255,0.1))">
            <div class="dd-row" style="justify-content: space-between">
              <span>
                <strong style="font-size: 0.78rem">{{ row.title }}</strong>
                <code style="opacity: 0.5; font-size: 0.68rem; margin-inline-start: 0.35rem">{{ row.kind }}</code>
              </span>
              <button type="button" [attr.data-demo-open-kind]="row.kind" (click)="open(row.kind)">Open</button>
            </div>
            @if (row.openIds.length) {
              <div class="dd-row" style="margin-top: 0.3rem">
                @for (id of row.openIds; track id) {
                  <span class="dd-row" style="gap: 0.15rem; font-size: 0.7rem; font-family: ui-monospace, monospace">
                    <code>{{ id }}</code>
                    <button type="button" title="Focus" [attr.aria-label]="'Focus ' + id" (click)="ws.focusPanel(id)">◎</button>
                    <button type="button" title="Float" [attr.aria-label]="'Float ' + id" (click)="ws.floatPanel(id)">⧉</button>
                    <button type="button" title="Minimise" [attr.aria-label]="'Minimise ' + id" (click)="ws.minimizePanel(id)">▁</button>
                    <button type="button" title="Close" [attr.aria-label]="'Close ' + id" (click)="ws.requestClosePanel(id)">×</button>
                  </span>
                }
              </div>
            }
          </div>
        }
      </div>

      <div class="dd-row">
        <button type="button" data-demo-manager-close (click)="panel.close()">Close this form</button>
      </div>
      <p class="dd-note">
        Opened as a drawer or a modal, this form uses the same <code>inject(Workspace)</code> a
        panel does, and <code>injectPanel()</code> to close itself without knowing which kind of
        container it is in.
      </p>
    </div>
  `,
})
export class PanelManagerForm {
  protected readonly ws = inject(Workspace);
  protected readonly panel = injectPanel();
  protected readonly query = signal('');
  protected readonly kinds = this.ws.registry.keys();
  protected readonly openCount = computed(() => Object.keys(this.ws.panels()).length);

  protected readonly rows = computed<Row[]>(() => {
    const term = this.query().trim().toLowerCase();
    const open = Object.values(this.ws.panels());
    return this.kinds
      .map(kind => ({
        kind,
        title: this.ws.format(this.ws.registry.get(kind)?.defaultOptions?.title) || kind,
        openIds: open.filter(p => p.component === kind).map(p => p.id),
      }))
      .filter(row => !term || row.kind.toLowerCase().includes(term) || row.title.toLowerCase().includes(term));
  });

  /** Opening the same kind twice gives a second instance, with its own id. */
  protected open(kind: string): void {
    const existing = Object.values(this.ws.panels()).filter(p => p.component === kind).length;
    this.ws.openPanel(`${kind}-${existing + 1}`, kind);
  }
}
