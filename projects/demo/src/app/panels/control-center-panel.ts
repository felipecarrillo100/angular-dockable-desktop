import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Workspace, injectModals, injectSidePanels, toast } from 'angular-dockable-desktop';
import { PanelManagerForm } from '../forms/panel-manager-form';

type Tab = 'tour' | 'layout' | 'overlays' | 'events';

const TABS: [Tab, string][] = [['tour', 'Tour'], ['layout', 'Layout'], ['overlays', 'Overlays'], ['events', 'Events']];
const STEPS: [string, string][] = [
  ['drag', "Drag a tab onto another group's edge to split it"],
  ['float', 'Drag a tab into the middle of the workspace to float it'],
  ['anchor', 'Drag a floating window into a corner to anchor it'],
  ['minimise', 'Minimise a panel, then hover its taskbar icon'],
  ['dirty', 'Mark the Intercept Form dirty, then close its tab'],
  ['drawer', 'Open a side drawer, then press Escape'],
  ['save', 'Save the layout, reload the page, restore it'],
];
const KINDS = ['editor', 'markdownEditor', 'mainMap', 'leafletMap', 'layers', 'tools', 'table', 'terminal', 'preview', 'help', 'timeControl', 'overview', 'dirtyForm', 'dirtyEditor', 'rtl'];
const EVENTS = ['panel:opened', 'panel:closed', 'panel:minimized', 'panel:restored', 'panel:activated', 'layout:changed'] as const;
const EDGES = ['left', 'right', 'top', 'bottom'] as const;
const LAYOUT_KEY = 'ndd-demo-layout';

/**
 * The Control Center: every capability of the library, driven from one panel.
 *
 * Its own point is that it is an ordinary panel. Everything it does — opening panels,
 * floating them, saving the layout, raising modals and toasts — it does through the same
 * `inject(Workspace)` any component gets, with no privileged access.
 */
@Component({
  selector: 'dd-control-center-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel dd-col" style="gap: 0.7rem">
      <div class="dd-row" role="tablist" aria-label="Control Center">
        @for (t of tabs; track t[0]) {
          <button
            type="button" role="tab"
            [attr.aria-selected]="tab() === t[0]"
            [attr.data-demo-cc-tab]="t[0]"
            [style.opacity]="tab() === t[0] ? 1 : 0.55"
            (click)="tab.set(t[0])"
          >{{ t[1] }}</button>
        }
      </div>

      @switch (tab()) {
        @case ('tour') {
          <div class="dd-section">
            <h5>Try these — {{ progress() }}/{{ steps.length }}</h5>
            <div class="dd-col" style="gap: 0.2rem">
              @for (s of steps; track s[0]) {
                <label class="dd-row" style="cursor: pointer">
                  <input type="checkbox" [checked]="done()[s[0]]" (change)="mark(s[0], $any($event.target).checked)" />
                  <span [style.opacity]="done()[s[0]] ? 0.5 : 1" [style.text-decoration]="done()[s[0]] ? 'line-through' : 'none'">{{ s[1] }}</span>
                </label>
              }
            </div>
          </div>
          <p class="dd-note">Every one of these is also a method call — this panel makes them from the same <code>inject(Workspace)</code> your own components get.</p>
        }

        @case ('layout') {
          <div class="dd-section">
            <h5>Open a panel</h5>
            <div class="dd-grid">
              @for (kind of kinds; track kind) {
                <button type="button" [attr.data-demo-open]="kind" (click)="openKind(kind)">{{ titleOf(kind) }}</button>
              }
            </div>
            <p class="dd-note">Opening the same kind again gives a second instance, with its own state.</p>
          </div>

          <div class="dd-section">
            <h5>Place the active panel</h5>
            <div class="dd-row">
              <button type="button" data-demo-float [disabled]="!active()" (click)="ws.floatPanel(active()!); mark('float')">Float</button>
              <button type="button" [disabled]="!active()" (click)="ws.dockPanel(active()!)">Dock</button>
              <button type="button" data-demo-minimise [disabled]="!active()" (click)="ws.minimizePanel(active()!); mark('minimise')">Minimise</button>
              <button type="button" [disabled]="!active()" (click)="ws.maximizePanel(active()!)">Maximise</button>
            </div>
            <div class="dd-row" style="margin-top: 0.3rem">
              @for (edge of edges; track edge) {
                <button type="button" [disabled]="!active()" (click)="ws.dockPanelToWorkspaceEdge(active()!, edge)">→ {{ edge }} edge</button>
              }
            </div>
          </div>

          <div class="dd-section">
            <h5>Persistence</h5>
            <div class="dd-row">
              <button type="button" data-demo-save-layout (click)="saveLayout()">Save layout</button>
              <button type="button" data-demo-restore-layout (click)="restoreLayout()">Restore</button>
              <button type="button" (click)="clearLayout()">Clear</button>
            </div>
            <p class="dd-note">
              Saved as JSON to <code>localStorage</code>. Reload the page and restore it: the grid,
              the floating rects, the minimised set, the active tab and each panel's own saved
              state all come back — and the format is byte-compatible with
              react-dockable-desktop's and vue-dockable-desktop's, so a layout saved there loads here.
            </p>
          </div>
        }

        @case ('overlays') {
          <div class="dd-section">
            <h5>Drawers</h5>
            <div class="dd-row">
              <button type="button" data-demo-left-drawer (click)="sidePanels.openLeft(manager, {}, { title: 'Panel manager', width: 340 }); mark('drawer')">Left drawer</button>
              <button type="button" data-demo-right-drawer (click)="sidePanels.openRight(manager, {}, { title: 'Panel manager', width: 340 })">Right drawer</button>
              <button type="button" (click)="sidePanels.closeAll()">Close drawers</button>
            </div>
            <p class="dd-note">Escape closes a drawer — but only when no modal is open above it.</p>
          </div>

          <div class="dd-section">
            <h5>Modals</h5>
            <div class="dd-row">
              <button type="button" data-demo-modal (click)="modals.open(manager, {}, { title: 'Panel manager', size: 'medium' })">Modal</button>
              <button type="button" (click)="modals.open(manager, {}, { title: 'Stacked', size: 'small' })">Stack another</button>
              <button type="button" (click)="modals.closeAll()">Close all</button>
            </div>
          </div>

          <div class="dd-section">
            <h5>Toasts</h5>
            <div class="dd-row">
              <button type="button" data-demo-toast (click)="toast.info('An informational message')">info</button>
              <button type="button" (click)="toast.success('Saved successfully')">success</button>
              <button type="button" (click)="toast.warning('Check the highlighted fields')">warning</button>
              <button type="button" (click)="toast.error('Upload failed', { duration: 0 })">error (sticky)</button>
              <button type="button" (click)="promiseToast()">promise</button>
            </div>
            <p class="dd-note"><code>toast</code> is a plain import — callable from a service or an error handler, with nothing injected. <code>NddToaster</code> is the same thing for <code>inject()</code>.</p>
          </div>
        }

        @default {
          <div class="dd-section">
            <h5>Workspace state</h5>
            <dl class="dd-kv">
              <dt>active</dt><dd data-demo-active>{{ active() ?? '—' }}</dd>
              <dt>open</dt><dd>{{ openCount() }}</dd>
              <dt>floating</dt><dd>{{ ws.floating().length }}</dd>
              <dt>minimised</dt><dd>{{ ws.minimized().length }}</dd>
              <dt>direction</dt><dd>{{ ws.dir() }}</dd>
            </dl>
            <p class="dd-note">Read from the store's signals directly. <code>activePanelId</code> never names a panel you cannot see — every action that could invalidate it resolves it through one path.</p>
          </div>

          <div class="dd-section">
            <h5>Event bus</h5>
            <div class="dd-col" style="gap: 0.1rem; font: 0.7rem ui-monospace, monospace">
              @for (entry of log(); track $index) {
                <div class="dd-row" style="gap: 0.5rem">
                  <span style="opacity: 0.55; min-width: 9.5rem">{{ entry.event }}</span>
                  <span>{{ entry.id }}</span>
                </div>
              } @empty {
                <p class="dd-note">Open or close a panel to see events here.</p>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class ControlCenterPanel {
  protected readonly ws = inject(Workspace);
  protected readonly modals = injectModals();
  protected readonly sidePanels = injectSidePanels();
  protected readonly toast = toast;
  protected readonly manager = PanelManagerForm;
  protected readonly tabs = TABS;
  protected readonly steps = STEPS;
  protected readonly kinds = KINDS;
  protected readonly edges = EDGES;

  protected readonly tab = signal<Tab>('tour');
  protected readonly done = signal<Record<string, boolean>>({});
  protected readonly progress = computed(() => STEPS.filter(([id]) => this.done()[id]).length);
  protected readonly active = this.ws.activePanelId;
  protected readonly openCount = computed(() => Object.keys(this.ws.panels()).length);
  protected readonly log = signal<{ event: string; id: string }[]>([]);

  constructor() {
    for (const event of EVENTS) {
      // Subscribed in an injection context, so each is disposed with this panel.
      this.ws.subscribe(event, (data: unknown) => {
        const id = (data as { id?: string } | undefined)?.id ?? '';
        this.log.update(log => [{ event, id }, ...log].slice(0, 14));
      });
    }
  }

  protected mark(step: string, value = true): void {
    this.done.update(d => ({ ...d, [step]: value }));
  }

  protected titleOf(kind: string): string {
    return this.ws.format(this.ws.registry.get(kind)?.defaultOptions?.title) || kind;
  }

  protected openKind(kind: string): void {
    const existing = Object.values(this.ws.panels()).filter(p => p.component === kind).length;
    this.ws.openPanel(existing === 0 ? kind : `${kind}-${existing + 1}`, kind);
  }

  protected saveLayout(): void {
    localStorage.setItem(LAYOUT_KEY, this.ws.saveLayout());
    this.mark('save');
    toast.success('Layout saved to localStorage');
  }

  protected restoreLayout(): void {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (!saved) {
      toast.warning('Nothing saved yet');
      return;
    }
    if (this.ws.loadLayout(saved)) toast.success('Layout restored');
    else toast.error('Could not restore that layout');
  }

  protected clearLayout(): void {
    localStorage.removeItem(LAYOUT_KEY);
    toast.info('Saved layout cleared');
  }

  protected promiseToast(): void {
    void toast.promise(new Promise(resolve => setTimeout(resolve, 1400)), { pending: 'Uploading…', success: 'Uploaded', error: 'Failed' });
  }
}
