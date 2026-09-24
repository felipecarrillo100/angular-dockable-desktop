/**
 * A strip of tool buttons on any edge.
 *
 * rdd exposed `show`/`hide`/`toggle` through a ref; here visibility is a `model()`, so
 * `[(visible)]` binds it both ways. Items stay data — a toolbar is configuration, not markup —
 * so an rdd or vdd `items` array transfers verbatim, only the icons changing type.
 *
 * Selection state for uncontrolled items lives on the workspace (`injectToolbar()`), so a panel
 * or a service can read or set the active tool without the strip passing anything down.
 * Ported from vdd `VddToolbar.vue` and `VddToolbarGroupButton.vue`.
 */
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, Injector, input, model, signal, viewChild } from '@angular/core';
import type { ToolbarState } from '../core/toolbar-state';
import type { ToolbarGroupEntry, ToolbarGroupItem, ToolbarGroupSubItem, ToolbarItem, ToolbarToggleItem } from '../core/toolbar-types';
import { flyoutPlacement, isSubItem } from '../core/toolbar-types';
import { NddIconView } from '../common/icon';
import { NddPortal } from '../common/portal';
import { injectWorkspace } from '../workspace/provide';

import type { ToolbarPosition } from '../core/panel-overlay';

export type { ToolbarPosition } from '../core/panel-overlay';

/**
 * Toolbar selection state — which item is active in each radio group, and which toggles are
 * on — for items the caller has not taken control of.
 *
 * The state lives on the workspace, so this works anywhere `injectWorkspace()` does, a service
 * included. rdd needed a `<ToolbarProvider>` in the tree.
 */
export function injectToolbar(): ToolbarState {
  return injectWorkspace().toolbar;
}

/** The flyout currently open, and where it sits. */
interface OpenFlyout {
  id: string;
  placement: Record<string, number>;
}

@Component({
  selector: 'ndd-toolbar',
  imports: [NddIconView, NddPortal],
  host: {
    class: 'ndd-toolbar-strip',
    '[class.ndd-left]': "position() === 'left'",
    '[class.ndd-right]': "position() === 'right'",
    '[class.ndd-top]': "position() === 'top'",
    '[class.ndd-bottom]': "position() === 'bottom'",
    '[style.width]': "collapsed() && vertical() ? '0px' : null",
    '[style.height]': "collapsed() && !vertical() ? '0px' : null",
    '[class.ndd-toolbar-strip--collapsed]': 'collapsed()',
    '[attr.data-ndd-toolbar]': 'position()',
    role: 'toolbar',
    '[attr.aria-orientation]': "vertical() ? 'vertical' : 'horizontal'",
  },
  template: `
    @for (item of items(); track key(item, $index)) {
      @if (item.type === 'separator') {
        <div class="ndd-toolbar-separator" role="separator"></div>
      } @else if (item.type === 'action') {
        <button
          type="button"
          class="ndd-toolbar-btn ndd-toolbar-btn-action"
          [attr.title]="item.label"
          [attr.aria-label]="item.label"
          [disabled]="item.disabled"
          [attr.data-ndd-toolbar-item]="item.id"
          (click)="item.onClick()"
        ><ndd-icon [icon]="item.icon" /></button>
      } @else if (item.type === 'radio') {
        <button
          type="button"
          class="ndd-toolbar-btn ndd-toolbar-btn-radio"
          [class.ndd-active]="isRadioActive(item.group, item.id)"
          [attr.title]="item.label"
          [attr.aria-label]="item.label"
          [attr.aria-pressed]="isRadioActive(item.group, item.id)"
          [disabled]="item.disabled"
          [attr.data-ndd-toolbar-item]="item.id"
          (click)="activateRadio(item.group, item.id, item.onActivate)"
        ><ndd-icon [icon]="item.icon" /></button>
      } @else if (item.type === 'toggle') {
        <button
          type="button"
          class="ndd-toolbar-btn ndd-toolbar-btn-toggle"
          [class.ndd-active]="isToggleOn(item)"
          [attr.title]="item.label"
          [attr.aria-label]="item.label"
          [attr.aria-pressed]="isToggleOn(item)"
          [disabled]="item.disabled"
          [attr.data-ndd-toolbar-item]="item.id"
          (click)="flipToggle(item)"
        ><ndd-icon [icon]="item.icon" /></button>
      } @else {
        <button
          type="button"
          class="ndd-toolbar-btn ndd-toolbar-btn-group"
          [class.ndd-active]="groupActiveId(item) !== null"
          [attr.title]="groupLabel(item)"
          [attr.aria-label]="groupLabel(item)"
          [attr.aria-expanded]="flyout()?.id === item.id"
          aria-haspopup="menu"
          [disabled]="item.disabled"
          [attr.data-ndd-toolbar-item]="item.id"
          (click)="toggleGroup(item, $event)"
        ><ndd-icon [icon]="groupIcon(item)" /></button>

        @if (flyout(); as open) {
          @if (open.id === item.id) {
            <!-- In document.body, so the strip's own overflow: hidden cannot clip it. -->
            <div
              #flyoutEl
              nddPortal
              class="ndd-toolbar-group-flyout"
              [class]="'ndd-' + position()"
              [style]="flyoutStyle(open.placement)"
              [attr.dir]="workspace.dir()"
              [attr.data-ndd-flyout]="item.id"
              role="menu"
            >
              @for (entry of item.items; track $index) {
                @if (asSub(entry); as sub) {
                  <button
                    type="button"
                    class="ndd-toolbar-group-flyout-item"
                    [class.ndd-active]="groupActiveId(item) === sub.id"
                    [disabled]="sub.disabled"
                    role="menuitemradio"
                    [attr.aria-checked]="groupActiveId(item) === sub.id"
                    [attr.data-ndd-flyout-item]="sub.id"
                    (click)="select(item, sub)"
                  >
                    <span class="ndd-toolbar-group-flyout-icon"><ndd-icon [icon]="sub.icon" /></span>
                    <span class="ndd-toolbar-group-flyout-label">{{ sub.label }}</span>
                    @if (sub.shortcut) {
                      <span class="ndd-toolbar-group-flyout-shortcut">{{ sub.shortcut }}</span>
                    }
                  </button>
                } @else {
                  <div class="ndd-toolbar-group-flyout-sep" role="separator"></div>
                }
              }
            </div>
          }
        }
      }
    }
  `,
})
export class NddToolbar {
  /** Which edge the strip is attached to; also decides its orientation. */
  readonly position = input<ToolbarPosition>('left');
  readonly items = input.required<readonly ToolbarItem[]>();
  /** Collapse the strip to nothing. Its items are kept, not destroyed. */
  readonly visible = model(true);

  protected readonly workspace = injectWorkspace();
  private readonly toolbar = this.workspace.toolbar;
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly flyoutEl = viewChild<ElementRef<HTMLElement>>('flyoutEl');

  protected readonly vertical = computed(() => this.position() === 'left' || this.position() === 'right');
  /**
   * Only the collapsed size is set inline. The open size belongs to the stylesheet, including
   * its coarse-pointer override — an inline size would quietly undo the larger touch targets.
   */
  protected readonly collapsed = computed(() => this.visible() === false);
  protected readonly flyout = signal<OpenFlyout | null>(null);
  /** The group button that opened the flyout, for outside-click detection. */
  private flyoutButton: HTMLElement | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.closeFlyout());
  }

  protected key(item: ToolbarItem, index: number): string {
    return item.type === 'separator' ? `sep-${index}` : item.id;
  }

  protected isRadioActive(group: string, id: string): boolean {
    return this.toolbar.activeInGroup(group) === id;
  }

  protected activateRadio(group: string, id: string, onActivate?: (id: string) => void): void {
    this.toolbar.setActiveInGroup(group, id);
    onActivate?.(id);
  }

  /** A toggle is controlled when `active` is present at all, `false` included. */
  protected isToggleOn(item: ToolbarToggleItem): boolean {
    return item.active !== undefined ? item.active : this.toolbar.isToggled(item.id);
  }

  protected flipToggle(item: ToolbarToggleItem): void {
    const next = !this.isToggleOn(item);
    if (item.active === undefined) this.toolbar.setToggled(item.id, next);
    item.onToggle?.(next);
  }

  // ── groups ───────────────────────────────────────────────────────────────

  /** Controlled when `activeItemId` is present at all — `null` means "nothing selected", not "unset". */
  protected groupActiveId(item: ToolbarGroupItem): string | null {
    return item.activeItemId !== undefined ? item.activeItemId : this.toolbar.activeInGroup(item.id);
  }

  private activeSub(item: ToolbarGroupItem): ToolbarGroupSubItem | undefined {
    const id = this.groupActiveId(item);
    return item.items.filter(isSubItem).find(e => e.id === id);
  }

  /** The button wears the selected tool's icon, so the strip shows the state while collapsed. */
  protected groupIcon(item: ToolbarGroupItem) {
    return this.activeSub(item)?.icon ?? item.defaultIcon;
  }

  protected groupLabel(item: ToolbarGroupItem): string {
    return this.activeSub(item)?.label ?? item.label;
  }

  protected asSub(entry: ToolbarGroupEntry): ToolbarGroupSubItem | null {
    return isSubItem(entry) ? entry : null;
  }

  protected flyoutStyle(placement: Record<string, number>): Record<string, string> {
    const css: Record<string, string> = { position: 'fixed' };
    for (const [key, value] of Object.entries(placement)) css[key] = `${value}px`;
    return css;
  }

  protected toggleGroup(item: ToolbarGroupItem, event: MouseEvent): void {
    if (item.disabled) return;
    if (this.flyout()?.id === item.id) {
      this.closeFlyout();
      return;
    }
    this.closeFlyout();
    const button = event.currentTarget as HTMLElement;
    this.flyoutButton = button;
    // The strip's own direction, not the workspace's: a 'left' strip sits on the right only
    // when its container is actually laid out right-to-left. vdd read the workspace, which is
    // right only when the app also mirrors the chrome around the desktop (divergence N5).
    const rtl = getComputedStyle(this.host).direction === 'rtl';
    const placement = flyoutPlacement(
      button.getBoundingClientRect(),
      this.position(),
      { width: window.innerWidth, height: window.innerHeight },
      rtl,
    );
    this.flyout.set({ id: item.id, placement });
    afterNextRender({ read: () => this.clampIntoView() }, { injector: this.injector });
    document.addEventListener('pointerdown', this.onOutside, { capture: true });
    document.addEventListener('keydown', this.onKey);
  }

  protected select(item: ToolbarGroupItem, sub: ToolbarGroupSubItem): void {
    if (item.activeItemId !== undefined) item.onActiveItemChange?.(sub.id);
    else this.toolbar.setActiveInGroup(item.id, sub.id);
    sub.onActivate?.(sub.id);
    this.closeFlyout();
  }

  private closeFlyout(): void {
    this.flyout.set(null);
    this.flyoutButton = null;
    document.removeEventListener('pointerdown', this.onOutside, { capture: true });
    document.removeEventListener('keydown', this.onKey);
  }

  /** Nudge the flyout back on screen: it is placed before it has a size, so this is a second pass. */
  private clampIntoView(): void {
    const el = this.flyoutEl()?.nativeElement;
    const open = this.flyout();
    if (!el || !open) return;
    const rect = el.getBoundingClientRect();
    // Not laid out (no size yet, or no layout engine at all): nothing to clamp.
    if (rect.width === 0 && rect.height === 0) return;
    const pad = 8;
    const next = { ...open.placement };
    if (rect.right > window.innerWidth - pad) {
      next['left'] = Math.max(pad, window.innerWidth - rect.width - pad);
      delete next['right'];
    }
    if (rect.left < pad) {
      next['left'] = pad;
      delete next['right'];
    }
    if (rect.bottom > window.innerHeight - pad) {
      next['top'] = Math.max(pad, window.innerHeight - rect.height - pad);
      delete next['bottom'];
    }
    if (rect.top < pad) {
      next['top'] = pad;
      delete next['bottom'];
    }
    this.flyout.set({ ...open, placement: next });
  }

  private readonly onOutside = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node)) return this.closeFlyout();
    if (this.flyoutButton?.contains(target) || this.flyoutEl()?.nativeElement.contains(target)) return;
    this.closeFlyout();
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.closeFlyout();
  };
}
