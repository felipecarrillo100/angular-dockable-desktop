import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { injectPanelContribution } from 'angular-dockable-desktop';
import { ICONS } from '../icons';

type Tool = 'pan' | 'draw' | 'measure';

/** The section the Tools panel contributes to the application's sidebar. */
@Component({
  selector: 'dd-tool-sections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="dd-panel"><p class="dd-note">Contributed by the Tools panel while it is active.</p></div>`,
})
export class ToolSections {}

const DESCRIPTIONS: Record<Tool, string> = {
  pan: 'Drag to move the view. The default tool.',
  draw: 'Click to place vertices; double-click to finish.',
  measure: 'Click two points to measure the distance between them.',
};

/**
 * A tool palette that publishes itself to the application's own toolbar and sidebar.
 *
 * This is what `injectPanelContribution` is for: the shell has no idea these tools exist, and
 * they appear in its toolbar only while this panel is the active one. Focus another panel and
 * they are gone — which is the invariant the library guarantees, since `activePanelId` never
 * names a panel the user cannot see.
 */
@Component({
  selector: 'dd-tool-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel">
      <div class="dd-section">
        <h5>Active tool</h5>
        <div class="dd-row">
          <span [class]="icons[tool()]" aria-hidden="true"></span>
          <strong data-demo-tool>{{ tool() }}</strong>
        </div>
        <p class="dd-note">{{ description() }}</p>
      </div>
      <p class="dd-note">
        These three tools are in the application's toolbar and the sidebar right now, contributed
        by this panel. Focus a different panel and they disappear — a contribution is surfaced
        only while its own panel is the active one.
      </p>
    </div>
  `,
})
export class ToolPanel {
  protected readonly icons = ICONS;
  protected readonly tool = signal<Tool>('pan');
  protected readonly description = computed(() => DESCRIPTIONS[this.tool()]);

  constructor() {
    injectPanelContribution(() => ({
      toolbarItems: (['pan', 'draw', 'measure'] as const).map(id => ({
        type: 'radio' as const,
        id: `tool-${id}`,
        group: 'demo-tool',
        label: id[0]!.toUpperCase() + id.slice(1),
        icon: ICONS[id],
        onActivate: () => this.tool.set(id),
      })),
      sidebarSections: [{ id: 'contributed-tools', label: 'Tool options', icon: ICONS.draw, component: ToolSections }],
    }));
  }
}
