/**
 * The taskbar: one icon per minimised panel, with a live hover preview.
 *
 * Three visibility modes:
 *   - `always`   — a permanent strip;
 *   - `compact`  — present only while something is minimised;
 *   - `autohide` — an overlay collapsed to an 8 px peek strip, expanding on hover. It also
 *                  flashes open for two seconds when a panel is minimised, so the panel is seen
 *                  going somewhere rather than just vanishing.
 *
 * On touch there is no hover, so the first tap opens the preview and a second restores; a long
 * press asks the host for a context menu. Ported from vdd `VddTaskbar.vue`.
 * @internal
 */
import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import type { NddIcon } from '../core/icon';
import { NddIconView } from '../common/icon';
import { CANCEL_MOVE_PX, LONG_PRESS_MS } from './drag-dock';
import { NddTaskbarPreview } from './taskbar-preview';

export type TaskbarVisibility = 'always' | 'compact' | 'autohide';

/** More than this many icons and the strip gets scroll arrows. */
const SCROLL_AFTER = 4;
const COLLAPSE_DELAY_MS = 400;
const FLASH_MS = 2000;

interface Hovered {
  id: string;
  anchor: { left: number; top: number; width: number };
  fromTouch: boolean;
}

@Component({
  selector: 'ndd-taskbar',
  imports: [NddIconView, NddTaskbarPreview],
  template: `
    @if (visible()) {
      <div
        class="ndd-taskbar-footer-container"
        [class.ndd-taskbar-mode-always]="visibility() === 'always'"
        [class.ndd-taskbar-mode-compact]="visibility() === 'compact'"
        [class.ndd-taskbar-mode-autohide]="visibility() === 'autohide'"
        [class.ndd-taskbar-expanded]="visibility() === 'autohide' && expanded()"
        data-ndd-taskbar
        role="toolbar"
        [attr.data-ndd-taskbar-mode]="visibility()"
        (pointerenter)="visibility() === 'autohide' && expand()"
        (pointerleave)="visibility() === 'autohide' && scheduleCollapse()"
      >
        @if (visibility() === 'autohide') {
          <div class="ndd-taskbar-peek-handle" data-ndd-peek></div>
        }
        @if (scrollable()) {
          <button
            type="button"
            class="ndd-taskbar-nav-btn"
            data-ndd-taskbar-scroll="left"
            [attr.aria-label]="workspace.format(workspace.messages.scrollTabsLeft)"
            (click)="scrollBy(-1)"
          >◀</button>
        }
        <div #strip class="ndd-taskbar-items-container">
          @for (item of items(); track item.id) {
            <div
              class="ndd-taskbar-glassmorphic-item"
              role="button"
              tabindex="0"
              [attr.data-ndd-taskbar-item]="item.id"
              [attr.title]="workspace.format(item.title)"
              [attr.aria-label]="workspace.format(item.title)"
              (click)="onIconClick(item.id)"
              (keydown.enter)="restoreFromTaskbar(item.id)"
              (contextmenu)="$event.preventDefault(); contextMenu.emit({ panelId: item.id, event: $event })"
              (pointerdown)="onIconPointerDown(item.id, $event)"
              (pointerenter)="onIconEnter(item.id, $event)"
              (pointerleave)="dismissPreview()"
            >
              <span class="ndd-taskbar-item-icon">
                @if (item.icon ?? defaultIcon(); as icon) {
                  <ndd-icon [icon]="icon" />
                } @else {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="9" rx="1" />
                    <rect x="14" y="3" width="7" height="5" rx="1" />
                    <rect x="14" y="12" width="7" height="9" rx="1" />
                    <rect x="3" y="16" width="7" height="5" rx="1" />
                  </svg>
                }
              </span>
            </div>
          }
        </div>
        @if (scrollable()) {
          <button
            type="button"
            class="ndd-taskbar-nav-btn"
            data-ndd-taskbar-scroll="right"
            [attr.aria-label]="workspace.format(workspace.messages.scrollTabsRight)"
            (click)="scrollBy(1)"
          >▶</button>
        }
        @for (h of hoveredList(); track h.id) {
          <ndd-taskbar-preview
            [panelId]="h.id"
            [anchor]="h.anchor"
            (keep)="keepPreview()"
            (restore)="restoreFromTaskbar(h.id)"
            (closeRequest)="closeFromPreview(h.id)"
            (dismiss)="dismissPreview()"
          />
        }
      </div>
    }
  `,
})
export class NddTaskbar {
  readonly visibility = input<TaskbarVisibility>('always');
  /** Fallback icon for panels that register none. */
  readonly defaultIcon = input<NddIcon | undefined>(undefined);
  /** A right-click or long press on an icon: the desktop opens the taskbar menu for it. */
  readonly contextMenu = output<{ panelId: string; event: PointerEvent | MouseEvent }>();

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');
  protected readonly expanded = signal(false);
  private readonly hovered = signal<Hovered | null>(null);
  /** Keyed by the hovered panel, so a different panel gets a fresh preview. */
  protected readonly hoveredList = computed(() => {
    const h = this.hovered();
    return h ? [h] : [];
  });
  private collapseTimer: ReturnType<typeof setTimeout> | undefined;
  private dismissTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly items = computed(() =>
    this.workspace.minimized().map(entry => ({
      ...entry,
      icon: this.workspace.registry.get(entry.component)?.defaultOptions?.icon,
    })),
  );
  protected readonly visible = computed(() => this.visibility() === 'always' || this.items().length > 0);
  protected readonly scrollable = computed(() => this.items().length > SCROLL_AFTER);

  constructor() {
    // autohide: flash open when something is minimised.
    let previous = this.workspace.minimized().length;
    effect(() => {
      const now = this.workspace.minimized().length;
      untracked(() => {
        if (this.visibility() === 'autohide' && now > previous) {
          this.expand();
          this.collapseTimer = setTimeout(() => this.expanded.set(false), FLASH_MS);
        }
        previous = now;
      });
    });
    // A preview must not outlive its panel: restoring or closing it elsewhere closes it.
    effect(() => {
      const ids = this.workspace.minimized().map(m => m.id);
      untracked(() => {
        const h = this.hovered();
        if (h && !ids.includes(h.id)) this.hovered.set(null);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.collapseTimer);
      clearTimeout(this.dismissTimer);
    });
  }

  protected scrollBy(direction: -1 | 1): void {
    this.strip()?.nativeElement.scrollBy({ left: direction * 150, behavior: 'smooth' });
  }

  protected expand(): void {
    clearTimeout(this.collapseTimer);
    this.expanded.set(true);
  }

  protected scheduleCollapse(): void {
    clearTimeout(this.collapseTimer);
    this.collapseTimer = setTimeout(() => this.expanded.set(false), COLLAPSE_DELAY_MS);
  }

  private showPreview(id: string, el: HTMLElement, fromTouch: boolean): void {
    clearTimeout(this.dismissTimer);
    const r = el.getBoundingClientRect();
    this.hovered.set({ id, anchor: { left: r.left, top: r.top, width: r.width }, fromTouch });
  }

  /** A short grace period, so the pointer can travel from the icon to the preview. */
  protected dismissPreview(): void {
    clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => this.hovered.set(null), 150);
  }

  protected keepPreview(): void {
    clearTimeout(this.dismissTimer);
  }

  protected onIconEnter(id: string, event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    const el = event.currentTarget as HTMLElement;
    // A pointerenter can fire for a stationary cursor when the strip scrolls or reflows under
    // it; ignoring an enter outside the icon keeps stray previews away.
    const r = el.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) return;
    this.showPreview(id, el, false);
  }

  protected restoreFromTaskbar(id: string): void {
    this.hovered.set(null);
    this.workspace.restorePanel(id);
  }

  protected closeFromPreview(id: string): void {
    this.hovered.set(null);
    void this.workspace.requestClosePanel(id);
  }

  /** On touch the first tap previews and only a second restores; the click after a tap is ignored. */
  protected onIconClick(id: string): void {
    if (this.hovered()?.fromTouch) return;
    this.restoreFromTaskbar(id);
  }

  /** Touch: tap toggles the preview, long press asks for a context menu. */
  protected onIconPointerDown(id: string, event: PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    const el = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startY = event.clientY;
    let cancelled = false;
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', cleanup);
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > CANCEL_MOVE_PX) {
        cancelled = true;
        cleanup();
      }
    };
    const onUp = () => {
      cleanup();
      if (cancelled) return;
      if (this.hovered()?.id === id) this.restoreFromTaskbar(id);
      else this.showPreview(id, el, true);
    };
    const timer = setTimeout(() => {
      if (cancelled) return;
      cleanup();
      navigator.vibrate?.(10);
      this.contextMenu.emit({ panelId: id, event });
    }, LONG_PRESS_MS);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', cleanup);
  }
}
