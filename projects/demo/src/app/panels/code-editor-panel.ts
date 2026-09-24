import { ChangeDetectionStrategy, Component, ElementRef, computed, signal, viewChild } from '@angular/core';
import { injectColorScheme, injectPanelContextMenu } from 'angular-dockable-desktop';
import { monacoEditor } from '../monaco';

const SAMPLE = `import { bootstrapApplication } from '@angular/platform-browser';
import { NddDesktop, provideDockableDesktop } from 'angular-dockable-desktop';

// The store is live before any component, so this is the whole setup.
bootstrapApplication(App, {
  providers: [
    provideDockableDesktop({
      panels: {
        editor: { component: CodeEditorPanel, defaultOptions: { title: 'Editor' } },
        map: { component: MapPanel, defaultOptions: { title: 'Map', canClose: false } },
      },
    }),
  ],
});

// ...and from anywhere that can inject(Workspace):
workspace.openPanel('editor-1', 'editor');
workspace.floatPanel('editor-1', { x: 80, y: 60, width: 520, height: 360 });
`;

/**
 * Monaco in a dockable panel — the sharpest demonstration of zero-unmount preservation.
 *
 * An editor is expensive to create and holds a great deal of state a user would notice
 * losing: the model, the undo stack, the cursor, the selection, folded regions, the scroll
 * position. Drag this panel to another group, float it, minimise it and restore it: all of it
 * survives, because the panel's DOM is *moved* rather than re-created (ADR 0002).
 *
 * Type something, undo it after a dock — the undo history is still there.
 */
@Component({
  selector: 'dd-code-editor-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel dd-panel--flush" style="display: flex; flex-direction: column">
      <div #host class="dd-monaco" data-demo-monaco style="flex: 1; min-height: 0"></div>
      <div
        style="flex-shrink: 0; padding: 0.2rem 0.6rem; font: 0.68rem ui-monospace, monospace;
               opacity: 0.55; border-block-start: 1px solid rgba(255,255,255,0.08)"
      >
        TypeScript · {{ lines() }} lines · undo history survives every dock
      </div>
    </div>
  `,
})
export class CodeEditorPanel {
  protected readonly source = signal(SAMPLE);
  protected readonly lines = computed(() => this.source().split('\n').length);
  private readonly wrap = signal(false);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');

  constructor() {
    // The editor follows the workspace's colour scheme, read from the attribute the application
    // sets. No input threading.
    const scheme = injectColorScheme();
    const theme = computed(() => (scheme() === 'light' ? 'vs' : 'vs-dark'));
    const editor = monacoEditor(this.host, this.source, { language: 'typescript', theme });

    // The panel contributes to its own context menu — on its tab, its title bar and its taskbar
    // icon — and the items are re-read every time the menu opens, so `disabled` tracks state.
    injectPanelContextMenu(() => [
      { label: 'Format document', action: () => this.source.update(s => s.replace(/[ \t]+$/gm, '')) },
      { label: 'Reset to sample', action: () => this.source.set(SAMPLE), disabled: this.source() === SAMPLE },
      { separator: true },
      {
        label: 'Word wrap',
        checkbox: { value: this.wrap() },
        action: () => {
          this.wrap.update(w => !w);
          editor()?.updateOptions({ wordWrap: this.wrap() ? 'on' : 'off' });
        },
      },
    ]);
  }
}
