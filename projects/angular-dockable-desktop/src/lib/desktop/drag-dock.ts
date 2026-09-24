/**
 * The drag-and-dock state machine: one source of truth for a gesture in progress — what is
 * dragged, where the pointer is, which drop target is armed. One per `<ndd-desktop>`, consumed
 * by the tab bars, the drop-zone overlays, the floating windows and the ghost.
 *
 * Two input paths, deliberately different (ported from vdd `useDragDock.ts`):
 *   - **mouse and pen** — listeners on `window`, with **no** `setPointerCapture`: capture would
 *     suppress `pointerenter`/`pointerleave` on the drop zones, which is how hover is tracked.
 *     A 5 px threshold distinguishes a drag from a click.
 *   - **touch** — a 300 ms long press *with* capture, so a drag is never confused with a
 *     scroll; moving more than 8 px first cancels it. Capture suppresses hover events, so the
 *     armed target is resolved by hit-testing the pointer instead.
 *
 * Drop resolution order is fixed: workspace edge, then a tab (a precise intent), then a leaf's
 * cross, then a corner anchor, then a free float. A leaf's cross commonly overlaps the edge zones
 * beneath it, and the more specific target must win.
 *
 * High-frequency listeners are registered outside Angular's zone (a no-op when zoneless, ADR
 * 0006): they only write signals, which schedule rendering by themselves.
 * @internal
 */
import { DOCUMENT } from '@angular/common';
import { NgZone, computed, inject, signal } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { flipZoneHorizontal } from '../core/anchor-geometry';
import { findLeaf } from '../core/layout-tree';
import type { DropPosition, FloatAnchor, SplitDirection } from '../core/types';

/** How far a mouse must move before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 5;
/** How long a touch must rest before it becomes a drag. */
export const LONG_PRESS_MS = 300;
/** How far a touch may wander before the long press is abandoned. */
export const CANCEL_MOVE_PX = 8;

/** Which tab a dragged panel would be inserted next to. */
export interface TabTarget {
  leafId: string;
  panelId: string;
  index: number;
  side: 'left' | 'right';
}

export class DragDock {
  private readonly workspace = inject(Workspace) as Workspace<never>;
  private readonly zone = inject(NgZone);
  private readonly doc = inject(DOCUMENT);

  /** The panel being dragged, or `null`. */
  readonly draggedId = signal<string | null>(null);
  /** Pointer position, for the ghost. */
  readonly pointer = signal({ x: 0, y: 0 });
  /** The armed leaf cross target. */
  readonly zoneTarget = signal<{ leafId: string; position: DropPosition } | null>(null);
  /** The armed workspace edge. */
  readonly edge = signal<SplitDirection | null>(null);
  /** The armed corner anchor. */
  readonly corner = signal<FloatAnchor | null>(null);
  /** The armed tab insertion point. */
  readonly tab = signal<TabTarget | null>(null);
  /** True while a gesture is in progress. */
  readonly dragging = computed(() => this.draggedId() !== null);

  /** Mirror a physical drop side to a logical one under RTL. */
  private flip(position: DropPosition): DropPosition {
    if (!this.workspace.isRtl()) return position;
    if (position === 'left') return 'right';
    if (position === 'right') return 'left';
    return position;
  }

  private reset(): void {
    this.draggedId.set(null);
    this.zoneTarget.set(null);
    this.edge.set(null);
    this.corner.set(null);
    this.tab.set(null);
    this.workspace.setDraggedPanelId(null);
    this.doc.body.classList.remove('ndd-dragging-active');
  }

  /** Begin a gesture that another component drives (a floating window's title bar). */
  beginDrag(panelId: string): void {
    this.draggedId.set(panelId);
    this.workspace.setDraggedPanelId(panelId);
    this.doc.body.classList.add('ndd-dragging-active');
  }

  hoverZone(leafId: string, position: DropPosition | null): void {
    this.zoneTarget.set(position ? { leafId, position } : null);
    // The cross overlaps the edge and corner zones beneath it; the more specific target wins.
    if (position) {
      this.edge.set(null);
      this.corner.set(null);
    }
  }

  hoverEdge(value: SplitDirection | null): void {
    this.edge.set(value);
  }

  hoverCorner(value: FloatAnchor | null): void {
    this.corner.set(value);
    if (value) this.edge.set(null);
  }

  hoverTab(value: TabTarget | null): void {
    this.tab.set(value);
  }

  /**
   * Update the pointer and re-resolve the armed target by hit-testing — needed whenever the
   * gesture holds pointer capture (touch, a window's title bar), since then the drop zones get
   * no hover events. The dragged window sets `pointer-events: none` on itself, so the zones
   * beneath it are what the hit test finds.
   */
  trackPointer(x: number, y: number): void {
    this.pointer.set({ x, y });
    this.resolveFromPoint(x, y);
  }

  private resolveFromPoint(x: number, y: number): void {
    const elements = typeof this.doc.elementsFromPoint === 'function' ? this.doc.elementsFromPoint(x, y) : [];
    let foundZone = false;
    let foundEdge = false;
    let foundTab = false;
    for (const el of elements) {
      if (!(el instanceof HTMLElement)) continue;
      const d = el.dataset;
      if (!foundZone && d['nddDropZone'] && d['nddLeaf']) {
        this.zoneTarget.set({ leafId: d['nddLeaf'], position: d['nddDropZone'] as DropPosition });
        foundZone = true;
      }
      if (!foundTab && d['nddTab'] && d['nddTabLeaf']) {
        const rect = el.getBoundingClientRect();
        this.tab.set({
          leafId: d['nddTabLeaf'],
          panelId: d['nddTab'],
          index: Number.parseInt(d['nddTabIndex'] ?? '0', 10),
          side: x - rect.left < rect.width / 2 ? 'left' : 'right',
        });
        foundTab = true;
      }
      if (!foundEdge && d['nddEdge']) {
        this.edge.set(d['nddEdge'] as SplitDirection);
        foundEdge = true;
      }
      if (!foundZone && d['nddCorner']) this.corner.set(d['nddCorner'] as FloatAnchor);
      if (foundZone && foundEdge && foundTab) break;
    }
    if (!foundZone) this.zoneTarget.set(null);
    if (!foundEdge) this.edge.set(null);
    if (!foundTab) this.tab.set(null);
  }

  /** Apply the armed target, then end the gesture. */
  finishDrag(panelId: string, event: { clientX: number; clientY: number }): void {
    const ws = this.workspace;
    const armedEdge = this.edge();
    const armedTab = this.tab();
    const armedZone = this.zoneTarget();
    const armedCorner = this.corner();

    if (armedEdge) {
      ws.dockPanelToWorkspaceEdge(panelId, this.flip(armedEdge) as SplitDirection);
    } else if (armedTab) {
      let index = armedTab.index;
      if (armedTab.side === 'right') index += 1;
      // Tab indices come from the DOM, which is pre-removal: `movePanelOrder` removes the panel
      // first, shifting later positions in the same leaf down by one.
      const leaf = findLeaf(ws.state().gridRoot, armedTab.leafId);
      if (leaf) {
        const current = leaf.panels.indexOf(panelId);
        if (current !== -1 && current < index) index -= 1;
      }
      ws.movePanelOrder(panelId, armedTab.leafId, index);
    } else if (armedZone) {
      ws.dockPanelToGroup(panelId, armedZone.leafId, this.flip(armedZone.position));
    } else if (armedCorner) {
      ws.floatPanel(panelId, undefined, ws.isRtl() ? flipZoneHorizontal(armedCorner) : armedCorner);
    } else {
      // Nothing armed: float it where the pointer let go, the title bar under the cursor.
      ws.floatPanel(panelId, { x: event.clientX - 150, y: event.clientY - 15, width: 450, height: 350 });
    }
    this.reset();
  }

  cancel(): void {
    this.reset();
  }

  /**
   * Start a tab drag from its `pointerdown`.
   * @param onLongPressWithoutDrag touch only: a long press that never moved (a context menu).
   */
  startTabDrag(panelId: string, event: PointerEvent, onLongPressWithoutDrag?: (e: PointerEvent) => void): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const el = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startY = event.clientY;
    if (event.pointerType === 'touch') this.startTouch(panelId, el, event, startX, startY, onLongPressWithoutDrag);
    else this.startMouse(panelId, startX, startY);
  }

  private startMouse(panelId: string, startX: number, startY: number): void {
    const win = this.doc.defaultView!;
    let dragStarted = false;
    const onMove = (e: PointerEvent) => {
      if (!dragStarted) {
        if (Math.abs(e.clientX - startX) <= DRAG_THRESHOLD_PX && Math.abs(e.clientY - startY) <= DRAG_THRESHOLD_PX) return;
        dragStarted = true;
        this.beginDrag(panelId);
      }
      this.pointer.set({ x: e.clientX, y: e.clientY });
    };
    const teardown = () => {
      win.removeEventListener('pointermove', onMove);
      win.removeEventListener('pointerup', onUp);
      win.removeEventListener('pointercancel', onCancel);
    };
    const onUp = (e: PointerEvent) => {
      teardown();
      if (dragStarted) this.finishDrag(panelId, e);
      else this.doc.body.classList.remove('ndd-dragging-active');
    };
    const onCancel = () => {
      teardown();
      this.reset();
    };
    this.zone.runOutsideAngular(() => {
      win.addEventListener('pointermove', onMove);
      win.addEventListener('pointerup', onUp);
      win.addEventListener('pointercancel', onCancel);
    });
  }

  private startTouch(
    panelId: string,
    el: HTMLElement,
    event: PointerEvent,
    startX: number,
    startY: number,
    onLongPressWithoutDrag?: (e: PointerEvent) => void,
  ): void {
    const pointerId = event.pointerId;
    let cancelled = false;
    let dragStarted = false;
    const cleanupPre = () => {
      clearTimeout(timer);
      el.removeEventListener('pointermove', onPreMove);
      el.removeEventListener('pointerup', onPreUp);
      el.removeEventListener('pointercancel', onPreUp);
    };
    const onPreMove = (e: PointerEvent) => {
      // A finger that travels before the press completes is scrolling, not dragging.
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > CANCEL_MOVE_PX) {
        cancelled = true;
        cleanupPre();
      }
    };
    const onPreUp = () => {
      cancelled = true;
      cleanupPre();
    };
    const timer = setTimeout(() => {
      if (cancelled) return;
      cleanupPre();
      try {
        el.setPointerCapture(pointerId);
      } catch {
        return;
      }
      el.classList.add('ndd-long-press-active');
      this.doc.body.classList.add('ndd-dragging-active');
      navigator.vibrate?.(10);
      const onMove = (e: PointerEvent) => {
        if (!dragStarted) {
          dragStarted = true;
          this.beginDrag(panelId);
        }
        this.trackPointer(e.clientX, e.clientY);
      };
      const detach = () => {
        el.classList.remove('ndd-long-press-active');
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onEnd);
        el.removeEventListener('pointercancel', onCancel);
      };
      const onEnd = (e: PointerEvent) => {
        detach();
        if (dragStarted) this.finishDrag(panelId, e);
        else {
          this.doc.body.classList.remove('ndd-dragging-active');
          onLongPressWithoutDrag?.(e);
        }
      };
      const onCancel = () => {
        detach();
        this.reset();
      };
      this.zone.runOutsideAngular(() => {
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onEnd);
        el.addEventListener('pointercancel', onCancel);
      });
    }, LONG_PRESS_MS);
    this.zone.runOutsideAngular(() => {
      el.addEventListener('pointermove', onPreMove);
      el.addEventListener('pointerup', onPreUp);
      el.addEventListener('pointercancel', onPreUp);
    });
  }
}
