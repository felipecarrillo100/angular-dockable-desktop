/**
 * The label that follows the pointer during a tab drag. Only for a tab: dragging a floating
 * window moves the window itself, so a ghost would be a second thing to look at.
 * @internal
 */
import { Component, computed, inject } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { DragDock } from './drag-dock';

@Component({
  selector: 'ndd-drag-ghost',
  template: `
    @if (isTabDrag()) {
      <div class="ndd-drag-ghost-tab" data-ndd-ghost [style.left.px]="drag.pointer().x + 12" [style.top.px]="drag.pointer().y + 12">
        {{ label() }}
      </div>
    }
  `,
})
export class NddDragGhost {
  protected readonly drag = inject(DragDock);
  private readonly workspace = inject(Workspace) as Workspace<never>;
  protected readonly label = computed(() => {
    const id = this.drag.draggedId();
    if (!id) return '';
    const panel = this.workspace.panels()[id];
    return panel ? this.workspace.format(panel.title) : id;
  });
  protected readonly isTabDrag = computed(() => {
    const id = this.drag.draggedId();
    return !!id && !this.workspace.floating().some(w => w.id === id);
  });
}
