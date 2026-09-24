/**
 * Workspace-level drop targets: the four outer edges, and the four corners. An edge dock
 * creates a full-width or full-height row; a corner **floats** the panel pinned to that corner —
 * different outcomes from adjacent gestures, which is why a corner disarms the edge it overlaps.
 * Ported from vdd `VddEdgeZones.vue`.
 * @internal
 */
import { Component, computed, inject } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import type { FloatAnchor, SplitDirection } from '../core/types';
import { DragDock } from './drag-dock';

/** Every property of the edge-dock preview; `null` removes it. */
interface EdgePreview {
  left: string | null;
  right: string | null;
  top: string | null;
  bottom: string | null;
  width: string | null;
  height: string | null;
}

@Component({
  selector: 'ndd-edge-zones',
  template: `
    @for (e of edges; track e) {
      <div
        class="ndd-workspace-edge-trigger"
        [class.ndd-edge-trigger-left]="e === 'left'"
        [class.ndd-edge-trigger-right]="e === 'right'"
        [class.ndd-edge-trigger-top]="e === 'top'"
        [class.ndd-edge-trigger-bottom]="e === 'bottom'"
        [attr.data-ndd-edge]="e"
        (pointerenter)="drag.hoverEdge(e)"
        (pointerleave)="drag.hoverEdge(null)"
      ></div>
    }
    @for (c of corners; track c) {
      <div
        class="ndd-corner-zone"
        [class.ndd-corner-zone--top-left]="c === 'top-left'"
        [class.ndd-corner-zone--top-right]="c === 'top-right'"
        [class.ndd-corner-zone--bottom-left]="c === 'bottom-left'"
        [class.ndd-corner-zone--bottom-right]="c === 'bottom-right'"
        [class.ndd-corner-zone--hovered]="drag.corner() === c"
        [attr.data-ndd-corner]="c"
        aria-hidden="true"
        (pointerenter)="drag.hoverCorner(c)"
        (pointerleave)="drag.hoverCorner(null)"
      ></div>
    }
    @if (preview(); as p) {
      <div
        class="ndd-workspace-edge-preview"
        [style.left]="p.left"
        [style.right]="p.right"
        [style.top]="p.top"
        [style.bottom]="p.bottom"
        [style.width]="p.width"
        [style.height]="p.height"
      ></div>
    }
  `,
})
export class NddEdgeZones {
  protected readonly drag = inject(DragDock);
  private readonly workspace = inject(Workspace) as Workspace<never>;
  protected readonly edges: SplitDirection[] = ['left', 'right', 'top', 'bottom'];
  protected readonly corners: FloatAnchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

  /** The share of the workspace an edge dock would take. */
  protected readonly preview = computed<EdgePreview | null>(() => {
    const armed = this.drag.edge();
    if (!armed) return null;
    const share = `${this.workspace.state().edgeSplitRatio * 100}%`;
    const none: EdgePreview = { left: null, right: null, top: null, bottom: null, width: null, height: null };
    switch (armed) {
      case 'left':
        return { ...none, left: '0', top: '0', bottom: '0', width: share };
      case 'right':
        return { ...none, right: '0', top: '0', bottom: '0', width: share };
      case 'top':
        return { ...none, top: '0', left: '0', right: '0', height: share };
      default:
        return { ...none, bottom: '0', left: '0', right: '0', height: share };
    }
  });
}
