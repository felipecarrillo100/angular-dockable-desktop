/**
 * `<ndd-floating-widget>`: a floating widget inside a panel — docked to a corner, dragged free
 * of it, dropped back onto one — and optionally spanning the panel on either axis instead of
 * carrying a size.
 *
 * rdd's `PanelFloatingWindow` needed nine refs mirroring state to dodge stale closures, a `key`
 * remount trick and a controlled/uncontrolled branch for `stretch`. None of that is here: a
 * signal read inside a handler is the current value, and `open` and `placement` are `model()`s.
 *
 * Anchor and stretch are **one** model, because one gesture can change both — releasing a
 * stretched axis re-pins the anchor — and reporting them separately would surface a state that
 * is never valid. Ported from vdd `VddFloatingWidget.vue`.
 */
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { NddIcon } from '../core/icon';
import type { FloatAnchor, Label } from '../core/types';
import { computeResizedRect, startPointerDrag } from '../core/drag-resize';
import type { ResizeDir } from '../core/drag-resize';
import {
  DOCK_INSET,
  DRAG_THRESHOLD,
  MIN_H,
  MIN_W,
  SNAP_IN,
  SNAP_OUT,
  anchorAfterRelease,
  dockedBand,
  flipZoneHorizontal,
  handleDirs,
  hoveredZone,
  stackOffset,
} from '../core/panel-overlay';
import { addAxis, bucketsFor, releaseAxis, stretchesBlock, stretchesInline } from '../core/stretch';
import type { PanelFloatPlacement, Stretch } from '../core/stretch';
import { NddIconView } from '../common/icon';
import { Workspace } from '../workspace/workspace';
import { PANEL_OVERLAY } from './overlay-store';

const NO_INSETS = { top: 0, bottom: 0, inlineStart: 0, inlineEnd: 0 };

@Component({
  selector: 'ndd-floating-widget',
  imports: [NddIconView],
  host: { style: 'display: contents' },
  template: `
    @if (open()) {
      <div
        #el
        class="ndd-panel-float"
        [class.ndd-panel-float--active]="isActive()"
        [class.ndd-panel-float--snapping]="snapArmed().inline || snapArmed().block"
        [style]="widgetStyle()"
        [attr.dir]="workspace.dir()"
        [attr.data-ndd-widget]="widgetId()"
        (pointerdown)="store?.focus(widgetId())"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp()"
        (pointercancel)="onPointerCancel()"
      >
        <div class="ndd-panel-float__header" data-ndd-widget-header (pointerdown)="onHeaderDown($event)">
          @if (icon(); as i) {
            <span class="ndd-panel-float__icon"><ndd-icon [icon]="i" /></span>
          }
          <span class="ndd-panel-float__title">{{ workspace.format(title()) }}</span>
          <button
            type="button"
            class="ndd-panel-float__close"
            [attr.title]="workspace.format(workspace.messages.close)"
            [attr.aria-label]="workspace.format(workspace.messages.close)"
            data-ndd-widget-close
            (click)="open.set(false)"
            (pointerdown)="$event.stopPropagation()"
          >
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </div>
        <div class="ndd-panel-float__body"><ng-content /></div>
        @for (dir of dirs(); track dir) {
          <div class="ndd-resize-handle" [class]="'ndd-resize-' + dir" [attr.data-ndd-widget-resize]="dir" (pointerdown)="onResizeDown(dir, $event)"></div>
        }
      </div>
    }
  `,
})
export class NddFloatingWidget {
  /** Unique within this panel's overlay. Drives z-order and stack membership. */
  readonly widgetId = input.required<string>();
  /** Header text: plain, or a localisable descriptor resolved on every render. */
  readonly title = input.required<Label>();
  readonly icon = input<NddIcon | undefined>(undefined);
  /** Width in pixels. Ignored while the inline axis is stretched, and returned to on release. */
  readonly width = input(320);
  /** Height in pixels. Ignored while the block axis is stretched, and returned to on release. */
  readonly height = input(240);
  /** `false` disables resize-to-stretch snapping, for content that needs a bounded size. */
  readonly stretchable = input(true);

  /** Whether the widget is shown. `[(open)]` replaces rdd's `usePanelFloatingWindow()`. */
  readonly open = model(true);
  /**
   * Where the widget sits: its corner, and which axes span the panel. Bind `[(placement)]` to
   * own and persist it — the library serialises nothing about inner widgets. Leave it unbound
   * and the widget keeps its own.
   */
  readonly placement = model<PanelFloatPlacement>({ anchor: 'top-right', stretch: null });

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  protected readonly store = inject(PANEL_OVERLAY, { optional: true });
  private readonly el = viewChild<ElementRef<HTMLElement>>('el');

  private readonly isRtl = this.workspace.isRtl;
  private readonly anchor = computed(() => this.placement().anchor);
  private readonly stretch = computed(() => this.placement().stretch);

  /** `docked` tracks a corner; `free` positions from an explicit box. */
  private readonly mode = signal<'docked' | 'free'>('docked');
  private readonly freePos = signal<{ x: number; y: number } | null>(null);
  /**
   * The widget's own size. Left untouched while an axis is stretched — the render simply stops
   * reading it — so releasing the axis restores the previous size with no bookkeeping.
   * Seeded from the inputs once they are set.
   */
  private readonly size = signal<{ w: number; h: number } | null>(null);
  private readonly sized = computed(() => this.size() ?? { w: this.width(), h: this.height() });
  /** Which axes would snap to stretched if the drag ended now. Drives the visual cue. */
  protected readonly snapArmed = signal({ inline: false, block: false });

  constructor() {
    // Stack membership depends on the whole placement, not only the anchor.
    effect(() => {
      const isOpen = this.open();
      const mode = this.mode();
      const anchor = this.anchor();
      const stretch = this.stretch();
      const id = this.widgetId();
      untracked(() => {
        if (!this.store || !isOpen) return;
        if (mode !== 'docked') this.store.undock(id);
        else this.store.dock(id, anchor, stretch);
      });
    });
    effect(() => {
      const h = this.sized().h;
      const id = this.widgetId();
      untracked(() => this.store?.reportSize(id, h));
    });
    inject(DestroyRef).onDestroy(() => this.store?.undock(this.widgetId()));

    // A block-stretched widget spans the very axis stacking uses to separate siblings, so it
    // cannot stack — it overlaps them and z-order decides. Worth saying once.
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      let warned = false;
      effect(() => {
        const mode = this.mode();
        const anchor = this.anchor();
        const stretch = this.stretch();
        const stacks = this.store?.stacks();
        if (warned || !stacks || mode !== 'docked' || !stretchesBlock(stretch)) return;
        const half = anchor.endsWith('-right') ? 'right' : 'left';
        const id = this.widgetId();
        const neighbours = ([`top-${half}`, `bottom-${half}`] as FloatAnchor[]).flatMap(b => stacks[b]).filter(o => o !== id);
        if (neighbours.length === 0) return;
        warned = true;
        console.warn(
          `[angular-dockable-desktop] <ndd-floating-widget> "${id}" stretches the block axis ("${stretch}") while ` +
            `${neighbours.length} other widget(s) are anchored to the same side (${neighbours.join(', ')}). A block-stretched ` +
            `widget spans the axis stacking uses to separate siblings, so it cannot stack and will overlap them — z-order ` +
            `decides which is on top. Give it a fixed height, or move the others to the opposite side.`,
        );
      });
    }
  }

  /** The single write path for placement, so a listener never sees a half-applied transition. */
  private applyPlacement(anchor: FloatAnchor, stretch: Stretch | null): void {
    this.placement.set({ anchor, stretch });
  }

  // ── geometry ─────────────────────────────────────────────────────────────

  private readonly zOrder = computed(() => this.store?.zOrders()[this.widgetId()] ?? 101);
  protected readonly isActive = computed(() => !this.store || this.store.topId() === this.widgetId());
  private band() {
    return dockedBand(this.store ? untracked(this.store.insets) : NO_INSETS, untracked(this.isRtl));
  }

  private containerBounds(): { cw: number; ch: number } {
    const parent = this.el()?.nativeElement.offsetParent as HTMLElement | null;
    return { cw: parent?.clientWidth ?? 9999, ch: parent?.clientHeight ?? 9999 };
  }

  private readonly stack = computed(() => {
    if (!this.store || this.mode() !== 'docked') return { offset: 0, registered: true };
    return stackOffset(
      this.widgetId(),
      bucketsFor(this.anchor(), this.stretch()),
      this.store.stacks(),
      this.store.dockedSizes(),
      this.height(),
    );
  });

  /**
   * Inline axis: one inset plus an explicit width, or **both** insets and no width at all.
   * Setting both ends is the whole stretch mechanism — CSS keeps the widget spanning the panel,
   * with no observer and no JavaScript.
   */
  protected readonly widgetStyle = computed<Record<string, string | number | null>>(() => {
    const size = this.sized();
    if (this.mode() !== 'docked' || !this.store) {
      const pos = this.freePos();
      return { left: `${pos?.x ?? 0}px`, top: `${pos?.y ?? 0}px`, width: `${size.w}px`, height: `${size.h}px`, 'z-index': this.zOrder() };
    }
    const insets = this.store.insets();
    const b = dockedBand(insets, this.isRtl());
    const stack = this.stack();
    const anchor = this.anchor();
    const stretch = this.stretch();
    const style: Record<string, string | number | null> = {
      'z-index': this.zOrder(),
      // Hidden until its first stack registration lands, so it never paints at the wrong offset.
      opacity: stack.registered ? null : 0,
      'pointer-events': stack.registered ? null : 'none',
    };
    if (stretchesInline(stretch)) {
      style['inset-inline-start'] = `${insets.inlineStart + DOCK_INSET}px`;
      style['inset-inline-end'] = `${insets.inlineEnd + DOCK_INSET}px`;
    } else {
      style[anchor.endsWith('-right') ? 'inset-inline-end' : 'inset-inline-start'] = `${DOCK_INSET}px`;
      style['width'] = `${size.w}px`;
    }
    // The block insets carry no gutter: a docked widget sits flush against a top or bottom toolbar.
    if (stretchesBlock(stretch)) {
      style['top'] = `${b.top}px`;
      style['bottom'] = `${b.bottom}px`;
    } else if (anchor.startsWith('top-')) {
      style['top'] = `${b.top + stack.offset}px`;
      style['height'] = `${size.h}px`;
    } else {
      style['bottom'] = `${b.bottom + stack.offset}px`;
      style['height'] = `${size.h}px`;
    }
    return style;
  });

  protected readonly dirs = computed(() => handleDirs(this.mode(), this.anchor(), this.stretch(), this.isRtl()));

  // ── header drag ──────────────────────────────────────────────────────────

  private drag: { mouseX: number; mouseY: number; posX: number; posY: number; moved: boolean } | null = null;

  protected onHeaderDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    let startX: number;
    let startY: number;
    if (this.mode() === 'docked') {
      // Snapshot the rendered position so that *if* this becomes a real drag, switching to free
      // positioning causes no jump. Undocking waits for the threshold: doing it on the press
      // meant a plain click tore the widget off its anchor, and its stacked siblings reflowed.
      const node = this.el()?.nativeElement;
      const container = this.store?.container();
      if (node && container) {
        const r = node.getBoundingClientRect();
        const c = container.getBoundingClientRect();
        startX = r.left - c.left;
        startY = r.top - c.top;
      } else {
        startX = DOCK_INSET;
        startY = this.store ? this.store.insets().top : 0;
      }
    } else {
      startX = this.freePos()?.x ?? 0;
      startY = this.freePos()?.y ?? 0;
    }
    this.drag = { mouseX: event.clientX, mouseY: event.clientY, posX: startX, posY: startY, moved: false };
    this.el()?.nativeElement.setPointerCapture(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.mouseX) + Math.abs(event.clientY - drag.mouseY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      if (this.mode() === 'docked') {
        // A stretched axis carries no size, so free mode — positioned from an explicit box —
        // would snap back to the size before stretching. Materialise what is on screen, then
        // clear stretch: free and spanning are mutually exclusive.
        if (this.stretch()) {
          const r = this.el()?.nativeElement.getBoundingClientRect();
          if (r) this.size.set({ w: Math.round(r.width), h: Math.round(r.height) });
          this.applyPlacement(this.anchor(), null);
        }
        this.store?.undock(this.widgetId());
        this.mode.set('free');
      }
      document.body.classList.add('ndd-dragging-active');
      this.store?.draggingId.set(this.widgetId());
    }

    const { cw, ch } = this.containerBounds();
    const size = this.sized();
    this.freePos.set({
      x: Math.max(0, Math.min(drag.posX + event.clientX - drag.mouseX, cw - size.w)),
      y: Math.max(0, Math.min(drag.posY + event.clientY - drag.mouseY, ch - size.h)),
    });
    const container = this.store?.container();
    if (container && this.store) {
      const raw = hoveredZone(container.getBoundingClientRect(), event.clientX, event.clientY);
      this.store.hovered.set(raw && this.isRtl() ? flipZoneHorizontal(raw) : raw);
    }
  }

  protected onPointerUp(): void {
    if (this.drag?.moved && this.store) {
      const zone = this.store.hovered();
      if (zone) {
        this.mode.set('docked');
        this.freePos.set(null);
        this.applyPlacement(zone, this.stretch());
      }
      this.store.hovered.set(null);
      this.store.draggingId.set(null);
    }
    document.body.classList.remove('ndd-dragging-active');
    this.drag = null;
  }

  protected onPointerCancel(): void {
    if (this.drag?.moved && this.store) {
      this.store.hovered.set(null);
      this.store.draggingId.set(null);
    }
    document.body.classList.remove('ndd-dragging-active');
    this.drag = null;
  }

  // ── resize ───────────────────────────────────────────────────────────────

  protected onResizeDown(dir: ResizeDir, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const node = this.el()?.nativeElement;
    let startX = 0;
    let startY = 0;
    if (this.mode() === 'free') {
      startX = this.freePos()?.x ?? 0;
      startY = this.freePos()?.y ?? 0;
    } else {
      const parent = node?.offsetParent as HTMLElement | null;
      if (node && parent) {
        const r = node.getBoundingClientRect();
        const p = parent.getBoundingClientRect();
        startX = r.left - p.left;
        startY = r.top - p.top;
      }
    }
    // A stretched axis's stored size is stale by design, so the drag starts from the *measured*
    // extent or the widget jumps on the first move.
    const measured = node?.getBoundingClientRect();
    const size = this.sized();
    const start = {
      x: startX,
      y: startY,
      w: stretchesInline(this.stretch()) && measured ? measured.width : size.w,
      h: stretchesBlock(this.stretch()) && measured ? measured.height : size.h,
    };

    const dragsInline = dir.includes('e') || dir.includes('w');
    const dragsBlock = dir.includes('n') || dir.includes('s');
    let released = false;
    let armed = { inline: false, block: false };

    /**
     * Dragging an end of a stretched axis releases it: the edge under the pointer becomes the
     * moving one and the opposite end the new pin, so it reads like an ordinary resize. Once
     * per drag.
     */
    const releaseIfNeeded = () => {
      if (released || this.mode() !== 'docked') return;
      const current = this.stretch();
      const axes = { inline: dragsInline && stretchesInline(current), block: dragsBlock && stretchesBlock(current) };
      if (!axes.inline && !axes.block) return;
      released = true;
      let next = current;
      if (axes.inline) next = releaseAxis(next, 'inline');
      if (axes.block) next = releaseAxis(next, 'block');
      this.applyPlacement(anchorAfterRelease(this.anchor(), dir, axes, this.isRtl()), next);
    };

    startPointerDrag({
      element: event.currentTarget as HTMLElement,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      captureStart: () => start,
      activeClasses: [{ el: document.body, classes: ['ndd-resizing-active'] }],
      onMove: (dx, dy, from) => {
        // Re-measured every move: the container can change size mid-drag.
        const { cw, ch } = this.containerBounds();
        // Docked widgets stop at the toolbar band; free ones only at the container.
        const b = this.mode() === 'docked' ? this.band() : { left: 0, right: 0, top: 0, bottom: 0 };
        const rect = computeResizedRect(dir, dx, dy, from, {
          minW: MIN_W,
          minH: MIN_H,
          maxW: cw - b.right - from.x,
          maxH: ch - b.bottom - from.y,
          minX: b.left,
          minY: b.top,
        });
        releaseIfNeeded();

        // Resize-to-stretch snapping. The clamps above already stop growth exactly where a
        // stretched axis would sit, so the cue is an outline, not a ghost.
        if (this.mode() === 'docked' && this.stretchable()) {
          const fullInline = cw - b.left - b.right;
          const fullBlock = ch - b.top - b.bottom - this.stack().offset;
          const current = this.stretch();
          const next = { ...armed };
          if (dragsInline && !stretchesInline(current)) {
            if (rect.w >= fullInline - SNAP_IN) next.inline = true;
            else if (armed.inline && rect.w < fullInline - SNAP_OUT) next.inline = false;
          }
          if (dragsBlock && !stretchesBlock(current)) {
            if (rect.h >= fullBlock - SNAP_IN) next.block = true;
            else if (armed.block && rect.h < fullBlock - SNAP_OUT) next.block = false;
          }
          if (next.inline !== armed.inline || next.block !== armed.block) {
            armed = next;
            this.snapArmed.set(next);
          }
        }

        // Only write an axis that carries a size. A still-stretched axis keeps its stored value,
        // so releasing it later restores the size it had before stretching.
        const effective = released
          ? releaseAxis(releaseAxis(this.stretch(), dragsInline ? 'inline' : 'block'), dragsBlock ? 'block' : 'inline')
          : this.stretch();
        const current = this.sized();
        this.size.set({ w: stretchesInline(effective) ? current.w : rect.w, h: stretchesBlock(effective) ? current.h : rect.h });
        if (this.mode() === 'free') this.freePos.set({ x: rect.x, y: rect.y });
      },
      onEnd: from => {
        if (!armed.inline && !armed.block) {
          const cue = this.snapArmed();
          if (cue.inline || cue.block) this.snapArmed.set({ inline: false, block: false });
          return;
        }
        // Restore the size the axis had *before* this drag: releasing a stretched axis returns
        // to the size the user last chose deliberately, not the full-bleed one passed through.
        const current = this.sized();
        this.size.set({ w: armed.inline ? from.w : current.w, h: armed.block ? from.h : current.h });
        let next = this.stretch();
        if (armed.inline) next = addAxis(next, 'inline');
        if (armed.block) next = addAxis(next, 'block');
        this.applyPlacement(this.anchor(), next);
        this.snapArmed.set({ inline: false, block: false });
      },
    });
  }
}
