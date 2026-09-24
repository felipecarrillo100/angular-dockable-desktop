/**
 * The recursive grid: a branch renders its children with a draggable divider between each
 * pair; a leaf renders a tab group. `path` is the index route from the root to this node —
 * what `updateSplitSizes` addresses.
 * @internal
 */
import { Component, computed, inject, input } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { startPointerDrag } from '../core/drag-resize';
import type { LayoutGridNode, LayoutLeafNode, LayoutNode } from '../core/types';
import { NddLeafGroup } from './leaf-group';

@Component({
  selector: 'ndd-workspace-grid',
  imports: [NddLeafGroup],
  template: `
    @if (leaf(); as leaf) {
      <ndd-leaf-group [leaf]="leaf" />
    } @else if (branch(); as branch) {
      <div class="ndd-workspace-branch" [class.ndd-row]="isRow()" [class.ndd-column]="!isRow()">
        @for (child of branch.children; track $index; let i = $index, last = $last) {
          <div
            class="ndd-branch-child"
            [style.flex-grow]="branch.sizes[i]"
            [style.flex-basis.%]="(branch.sizes[i] ?? 0) * 100"
          >
            <ndd-workspace-grid [node]="child" [path]="childPath(i)" />
          </div>
          @if (!last) {
            <div
              class="ndd-resizer-bar"
              role="separator"
              [attr.aria-orientation]="isRow() ? 'vertical' : 'horizontal'"
              [attr.data-ndd-divider]="childPath(i).join('-')"
              (pointerdown)="onDividerDown(i, $event)"
            ></div>
          }
        }
      </div>
    }
  `,
})
export class NddWorkspaceGrid {
  readonly node = input.required<LayoutNode>();
  readonly path = input<number[]>([]);

  private readonly workspace = inject(Workspace) as Workspace<never>;
  protected readonly leaf = computed(() => {
    const n = this.node();
    return n.type === 'leaf' ? (n as LayoutLeafNode) : null;
  });
  protected readonly branch = computed(() => {
    const n = this.node();
    return n.type === 'branch' ? (n as LayoutGridNode) : null;
  });
  protected readonly isRow = computed(() => this.branch()?.orientation === 'horizontal');

  protected childPath(i: number): number[] {
    return [...this.path(), i];
  }

  protected onDividerDown(index: number, event: PointerEvent): void {
    const branch = this.branch();
    if (!branch) return;
    event.preventDefault();
    const divider = event.currentTarget as HTMLElement;
    const parent = divider.parentElement;
    const isRow = this.isRow();
    const extent = parent ? (isRow ? parent.clientWidth : parent.clientHeight) : isRow ? 1000 : 800;
    const path = this.path();
    // A row runs right to left under RTL, so children[index] is on the divider's *right*: a
    // rightward drag must shrink it. The pointer's delta is physical, the sizes are logical
    // (N15; vdd drags the divider away from the pointer here).
    const sign = isRow && parent && getComputedStyle(parent).direction === 'rtl' ? -1 : 1;
    startPointerDrag({
      element: divider,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      captureStart: () => [...branch.sizes],
      activeClasses: [
        { el: divider, classes: ['ndd-active'] },
        { el: document.body, classes: ['ndd-resizing-active', isRow ? 'ndd-resizing-col-active' : 'ndd-resizing-row-active'] },
      ],
      onMove: (dx, dy, start) => {
        const delta = (sign * (isRow ? dx : dy)) / extent;
        const next = [...start];
        next[index] = (start[index] ?? 0) + delta;
        next[index + 1] = (start[index + 1] ?? 0) - delta;
        // Neither neighbour may collapse; below this the divider simply stops.
        if ((next[index] ?? 0) > 0.05 && (next[index + 1] ?? 0) > 0.05) this.workspace.updateSplitSizes(path, next);
      },
    });
  }
}
