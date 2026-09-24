/**
 * A panel detached from the grid: its own title bar, draggable, resizable on eight edges,
 * stackable by z-order, and optionally pinned to a workspace corner.
 *
 * Positioning is deliberately split. A free-floating window is placed by `left`/`top`, which
 * are physical. An **anchored** window is placed by CSS *logical* properties
 * (`inset-inline-start` / `inset-inline-end`) driven by the element's own `dir`, so switching
 * reading direction mirrors it with no JavaScript and no stored physical coordinates — which
 * is what lets a layout saved in one direction restore correctly in the other.
 *
 * Ported from vdd `VddFloatingWindow.vue`. Drag-to-dock arrives with M6, the title-bar context
 * menu with M8.
 * @internal
 */
import { Component, computed, inject, input } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import { computeResizedRect, startPointerDrag } from '../core/drag-resize';
import type { ResizeDir } from '../core/drag-resize';
import type { FloatingWindow } from '../core/types';
import { NddIconView } from '../common/icon';
import { NddPanelSlot } from '../panel/panel-slot';
import { DragDock } from './drag-dock';
import { openMenu, panelMenu } from './menus';

/** Inset from the workspace edge, and the gap between windows stacked in one corner. */
const CORNER_INSET = 8;
const CORNER_GAP = 8;
const HANDLES: ResizeDir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const px = (v: number | string) => (typeof v === 'number' ? `${v}px` : v);
const num = (v: number | string) => (typeof v === 'number' ? v : Number.parseFloat(String(v)));

/** Every positioning property of a window; `null` removes it. */
interface Placement {
  left: string | null;
  top: string | null;
  bottom: string | null;
  inlineStart: string | null;
  inlineEnd: string | null;
  width: string | null;
  height: string | null;
  transition: string | null;
}
const NONE: Placement = { left: null, top: null, bottom: null, inlineStart: null, inlineEnd: null, width: null, height: null, transition: null };

@Component({
  selector: 'ndd-floating-window',
  imports: [NddIconView, NddPanelSlot],
  host: {
    class: 'ndd-floating-window',
    '[class]': 'workspace.classes.window',
    '[class.ndd-maximized]': 'window().maximized === true',
    '[class.ndd-window-focused]': 'isFocused()',
    '[attr.data-ndd-window]': 'window().id',
    '[attr.dir]': 'workspace.dir()',
    role: 'dialog',
    '[attr.aria-label]': 'title()',
    '[style.position]': '"absolute"',
    '[style.z-index]': 'window().z',
    '[style.pointer-events]': 'isDragged() ? "none" : "auto"',
    '[style.left]': 'place().left',
    '[style.top]': 'place().top',
    '[style.bottom]': 'place().bottom',
    '[style.inset-inline-start]': 'place().inlineStart',
    '[style.inset-inline-end]': 'place().inlineEnd',
    '[style.width]': 'place().width',
    '[style.height]': 'place().height',
    '[style.transition]': 'place().transition',
    '(pointerdown.capture)': 'workspace.focusPanel(window().id)',
  },
  template: `
    @if (panel(); as panel) {
      <div
        class="ndd-floating-window-titlebar"
        [attr.data-ndd-titlebar]="window().id"
        [style.cursor]="window().maximized || !canDrag() ? 'default' : 'move'"
        (pointerdown)="onTitlePointerDown($event)"
        (dblclick)="workspace.maximizePanel(window().id)"
        (contextmenu)="$event.preventDefault(); onTitleMenu($event)"
      >
        <span class="ndd-floating-window-title">
          @if (options().icon; as icon) {
            <span class="ndd-window-title-icon"><ndd-icon [icon]="icon" /></span>
          }
          <span>{{ title() }}{{ panel.dirty ? ' *' : '' }}</span>
        </span>
        <div class="ndd-titlebar-actions" (pointerdown)="$event.stopPropagation()">
          @if (contributed().length > 0) {
            <button
              type="button"
              class="ndd-custom-tab-btn ndd-btn-more-actions"
              [attr.data-ndd-more]="window().id"
              [attr.title]="workspace.format(workspace.messages.moreActions)"
              [attr.aria-label]="workspace.format(workspace.messages.moreActions)"
              aria-haspopup="menu"
              (click)="onMoreActions($event)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="ndd-icon-block">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          }
          <button
            type="button"
            class="ndd-custom-tab-btn ndd-btn-maximize-tab"
            [attr.data-ndd-maximize]="window().id"
            [attr.title]="workspace.format(window().maximized ? workspace.messages.restoreSize : workspace.messages.maximize)"
            [attr.aria-label]="workspace.format(window().maximized ? workspace.messages.restoreSize : workspace.messages.maximize)"
            (click)="workspace.maximizePanel(window().id)"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="4" y="4" width="16" height="16" rx="1.5" />
            </svg>
          </button>
          @if (options().canMinimize !== false) {
            <button
              type="button"
              class="ndd-custom-tab-btn ndd-btn-minimize-tab"
              [attr.data-ndd-minimize]="window().id"
              [attr.title]="workspace.format(workspace.messages.minimize)"
              [attr.aria-label]="workspace.format(workspace.messages.minimize)"
              (click)="workspace.minimizePanel(window().id)"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12h14" /></svg>
            </button>
          }
          @if (options().canClose !== false) {
            <button
              type="button"
              class="ndd-custom-tab-btn ndd-btn-close-tab"
              [attr.data-ndd-close-window]="window().id"
              [attr.title]="workspace.format(workspace.messages.close)"
              [attr.aria-label]="workspace.format(workspace.messages.close)"
              (click)="workspace.requestClosePanel(window().id)"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          }
        </div>
      </div>

      <div class="ndd-floating-window-body" [class]="workspace.classes.windowBody">
        <div [nddPanelSlot]="window().id"></div>
      </div>

      @if (!window().maximized) {
        @for (dir of handles; track dir) {
          <div
            class="ndd-resize-handle"
            [class.ndd-resize-n]="dir === 'n'"
            [class.ndd-resize-ne]="dir === 'ne'"
            [class.ndd-resize-e]="dir === 'e'"
            [class.ndd-resize-se]="dir === 'se'"
            [class.ndd-resize-s]="dir === 's'"
            [class.ndd-resize-sw]="dir === 'sw'"
            [class.ndd-resize-w]="dir === 'w'"
            [class.ndd-resize-nw]="dir === 'nw'"
            [attr.data-ndd-handle]="window().id + ':' + dir"
            (pointerdown)="onHandlePointerDown(dir, $event)"
          ></div>
        }
      }
    }
  `,
})
export class NddFloatingWindow {
  readonly window = input.required<FloatingWindow>();

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  private readonly drag = inject(DragDock);
  protected readonly handles = HANDLES;

  protected readonly panel = computed(() => this.workspace.panels()[this.window().id]);
  protected readonly options = computed(() => {
    const panel = this.panel();
    return (panel && this.workspace.registry.get(panel.component)?.defaultOptions) || {};
  });
  protected readonly canDrag = computed(() => this.options().canDrag !== false);
  protected readonly title = computed(() => this.workspace.format(this.panel()?.title));
  protected readonly isFocused = computed(() => this.workspace.activePanelId() === this.window().id);
  protected readonly isDragged = computed(() => this.workspace.draggedPanelId() === this.window().id);

  /** Windows sharing this corner, in stack order. */
  private readonly stackOffset = computed(() => {
    const w = this.window();
    if (!w.anchor) return 0;
    const stack = this.workspace.floating().filter(o => o.anchor === w.anchor && !o.maximized);
    const index = stack.findIndex(o => o.id === w.id);
    let offset = CORNER_INSET;
    for (let i = 0; i < index; i++) offset += num(stack[i]!.height) + CORNER_GAP;
    return offset;
  });

  protected readonly place = computed<Placement>(() => {
    const w = this.window();
    if (w.maximized) return { ...NONE, left: '0px', top: '0px', width: '100%', height: '100%' };
    if (w.anchor) {
      const isTop = w.anchor.startsWith('top');
      const isEnd = w.anchor.endsWith('-right');
      const offset = `${this.stackOffset()}px`;
      return {
        ...NONE,
        inlineStart: isEnd ? null : `${CORNER_INSET}px`,
        inlineEnd: isEnd ? `${CORNER_INSET}px` : null,
        top: isTop ? offset : null,
        bottom: isTop ? null : offset,
        width: px(w.width),
        height: px(w.height),
        transition: this.isDragged() ? 'none' : 'top 0.2s ease, bottom 0.2s ease',
      };
    }
    return { ...NONE, left: px(w.x), top: px(w.y), width: px(w.width), height: px(w.height) };
  });

  /** Items the panel contributed to its own menu; reactive to (un)registration. */
  protected readonly contributed = computed(() => this.workspace.panelMenuItems(this.window().id));

  protected onTitleMenu(event: MouseEvent): void {
    openMenu(this.workspace, event, panelMenu(this.workspace, this.window().id));
  }

  /** The more-actions button offers only what the panel contributed. */
  protected onMoreActions(event: MouseEvent): void {
    openMenu(this.workspace, event, this.workspace.panelMenuItems(this.window().id));
  }

  protected onTitlePointerDown(event: PointerEvent): void {
    const w = this.window();
    if (!this.canDrag() || w.maximized || event.button !== 0) return;
    event.preventDefault();
    this.workspace.focusPanel(w.id);
    const el = (event.currentTarget as HTMLElement).closest('.ndd-floating-window') as HTMLElement | null;
    const start = { x: el?.offsetLeft ?? 0, y: el?.offsetTop ?? 0 };
    const originX = event.clientX;
    const originY = event.clientY;
    let moved = false;
    startPointerDrag({
      element: event.currentTarget as HTMLElement,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      captureStart: () => start,
      activeClasses: [{ el: document.body, classes: ['ndd-dragging-active'] }],
      onMove: (dx, dy, s) => {
        // A window dragged over a drop target docks there on release, exactly like a tab — so
        // the gesture is registered with the drag machine, which makes the zones appear.
        if (!moved) {
          moved = true;
          this.drag.beginDrag(w.id);
        }
        // Dragging a pinned window unpins it: a corner anchor and a free position are mutually
        // exclusive, and the user has just chosen the position.
        this.workspace.updateFloatingPosition(w.id, { x: s.x + dx, y: s.y + dy, anchor: null });
        // startPointerDrag holds pointer capture, so the zones get no hover events: resolve the
        // armed target by hit-testing instead.
        this.drag.trackPointer(originX + dx, originY + dy);
      },
      onEnd: () => {
        if (!moved) return;
        const armed = this.drag.zoneTarget() ?? this.drag.edge() ?? this.drag.corner() ?? this.drag.tab();
        // Released over nothing: the window simply stays where the drag left it.
        if (armed) this.drag.finishDrag(w.id, { clientX: 0, clientY: 0 });
        else this.drag.cancel();
      },
    });
  }

  protected onHandlePointerDown(dir: ResizeDir, event: PointerEvent): void {
    const w = this.window();
    if (w.maximized || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.workspace.focusPanel(w.id);
    const el = (event.currentTarget as HTMLElement).closest('.ndd-floating-window') as HTMLElement | null;
    const start = { x: el?.offsetLeft ?? 0, y: el?.offsetTop ?? 0, w: el?.offsetWidth ?? 400, h: el?.offsetHeight ?? 300 };
    startPointerDrag({
      element: event.currentTarget as HTMLElement,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      captureStart: () => start,
      activeClasses: [{ el: document.body, classes: ['ndd-resizing-active'] }],
      // No max/min position: a window may grow past the viewport and be dragged off-screen,
      // matching rdd. The clamp on workspace *resize* pulls it back into reach.
      onMove: (dx, dy, from) => {
        const r = computeResizedRect(dir, dx, dy, from, { minW: 200, minH: 150 });
        this.workspace.updateFloatingPosition(w.id, { x: r.x, y: r.y, width: r.w, height: r.h });
      },
    });
  }
}
