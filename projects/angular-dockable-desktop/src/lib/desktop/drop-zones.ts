/**
 * The cross of drop targets over one leaf: four sides plus the centre.
 *
 * Armed state comes from the drag machine, not CSS `:hover`: `:hover` is unreliable during an
 * active drag in some browsers and does not exist on touch, whereas the machine already tracks
 * the armed target for every input type. Ported from vdd `VddDropZones.vue`.
 * @internal
 */
import { Component, computed, inject, input } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import type { DropPosition } from '../core/types';
import { DragDock } from './drag-dock';
import { isDropAllowed } from '../core/dock-rules';

const POSITIONS: DropPosition[] = ['top', 'bottom', 'left', 'right', 'center'];
const GLYPH: Record<DropPosition, string> = { top: '▲', bottom: '▼', left: '◀', right: '▶', center: '▣' };

@Component({
  selector: 'ndd-drop-zones',
  template: `
    <div class="ndd-dock-drop-zone-overlay">
      <div class="ndd-dock-target-cross">
        @for (position of positions(); track position) {
          <div
            class="ndd-dock-target-box"
            [class.ndd-dock-target-top]="position === 'top'"
            [class.ndd-dock-target-bottom]="position === 'bottom'"
            [class.ndd-dock-target-left]="position === 'left'"
            [class.ndd-dock-target-right]="position === 'right'"
            [class.ndd-dock-target-center]="position === 'center'"
            [class.ndd-dock-target-box--active]="isArmed(position)"
            [attr.data-ndd-drop-zone]="position"
            [attr.data-ndd-leaf]="leafId()"
            (pointerenter)="drag.hoverZone(leafId(), position)"
            (pointerleave)="drag.hoverZone(leafId(), null)"
          >{{ glyph[position] }}</div>
        }
      </div>
    </div>
    @if (preview(); as p) {
      <div class="ndd-dock-preview-highlight" [style.left]="p.left" [style.top]="p.top" [style.width]="p.width" [style.height]="p.height"></div>
    }
  `,
})
export class NddDropZones {
  readonly leafId = input.required<string>();
  protected readonly drag = inject(DragDock);
  private readonly workspace = inject(Workspace) as Workspace<never>;
  /**
   * A target the rules forbid isn't offered at all (1.8.0). Zones are drawn by screen side; the move
   * flips left and right under RTL, and `canDrop` sees the side the move applies.
   */
  protected readonly positions = computed(() => {
    const dragged = this.drag.draggedId();
    if (dragged === null) return POSITIONS;
    const rtl = this.workspace.isRtl();
    const applied = (p: DropPosition): DropPosition => (rtl && (p === 'left' || p === 'right') ? (p === 'left' ? 'right' : 'left') : p);
    return POSITIONS.filter(p => isDropAllowed(this.workspace, dragged, { kind: 'group', leafId: this.leafId(), position: applied(p) }));
  });
  protected readonly glyph = GLYPH;

  protected isArmed(position: DropPosition): boolean {
    const armed = this.drag.zoneTarget();
    return armed?.leafId === this.leafId() && armed.position === position;
  }

  /** The preview fills the share of the leaf the drop would actually take. */
  protected readonly preview = computed(() => {
    const armed = this.drag.zoneTarget();
    if (!armed || armed.leafId !== this.leafId()) return null;
    const ratio = this.workspace.state().splitRatio;
    const share = `${ratio * 100}%`;
    const rest = `${(1 - ratio) * 100}%`;
    const p = armed.position;
    return {
      left: p === 'right' ? rest : '0',
      top: p === 'bottom' ? rest : '0',
      width: p === 'left' || p === 'right' ? share : '100%',
      height: p === 'top' || p === 'bottom' ? share : '100%',
    };
  });
}
