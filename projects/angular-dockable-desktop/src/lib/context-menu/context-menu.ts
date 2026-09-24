/**
 * `<ndd-context-menu>` — the context-menu host.
 *
 * Renders whatever menu the workspace has pending, so `workspace.showContextMenu()` works from
 * any component — or from no component at all. rdd needed a provider, an adapter ref and a
 * registration handshake for that; here the request is state. Mount one, alongside
 * `<ndd-desktop>`.
 *
 * Replace the whole menu with your own UI kit through a template (rdd's `ContextMenuAdapter`,
 * vdd's default slot):
 *
 *   <ndd-context-menu>
 *     <ng-template nddContextMenuTemplate let-items let-x="x" let-y="y" let-close="close">…</ng-template>
 *   </ndd-context-menu>
 *
 * The built-in menu follows the WAI-ARIA menu pattern (ADR 0005): focus moves into it on open;
 * ArrowUp/ArrowDown/Home/End rove across enabled items; ArrowRight (ArrowLeft under RTL) opens
 * a submenu and enters it, ArrowLeft/Escape leave it; Escape closes and returns focus to where it
 * was. Ported from vdd `VddContextMenu.vue`, which offered Escape only.
 */
import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  TemplateRef,
  afterNextRender,
  computed,
  contentChild,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Workspace } from '../workspace/workspace';
import { clampToViewport, isSeparator, isSubMenu } from '../core/context-menu';
import type {
  ContextMenuItem,
  ContextMenuSimpleItem,
  ContextMenuSubMenu,
} from '../core/context-menu';
import { NddIconView } from '../common/icon';
import { NddPortal } from '../common/portal';

/** What a custom menu template receives. */
export interface NddContextMenuContext {
  /** The pending items (also `let-items`). */
  $implicit: ContextMenuItem[];
  items: ContextMenuItem[];
  /** The requested position, in viewport pixels. */
  x: number;
  y: number;
  /** Dismiss the menu. */
  close: () => void;
}

/** Marks the `<ng-template>` that replaces the built-in menu. */
@Directive({ selector: 'ng-template[nddContextMenuTemplate]' })
export class NddContextMenuTemplate {
  readonly template = inject<TemplateRef<NddContextMenuContext>>(TemplateRef);
  static ngTemplateContextGuard(
    _dir: NddContextMenuTemplate,
    _ctx: unknown,
  ): _ctx is NddContextMenuContext {
    return true;
  }
}

/** How long the pointer must rest on a submenu parent before it opens. */
const SUBMENU_OPEN_MS = 150;
/** Grace period before a submenu closes, so the pointer can travel into it. */
const SUBMENU_CLOSE_MS = 200;

@Component({
  selector: 'ndd-context-menu',
  imports: [NgTemplateOutlet, NddIconView, NddPortal],
  template: `
    @if (request(); as req) {
      @if (custom(); as custom) {
        <ng-container
          [ngTemplateOutlet]="custom.template"
          [ngTemplateOutletContext]="{
            $implicit: req.items,
            items: req.items,
            x: position().x,
            y: position().y,
            close: closeFn,
          }"
        />
      } @else {
        <div
          nddPortal
          #root
          class="ndd-context-menu"
          [class]="'ndd-context-menu--' + theme()"
          [style.position]="'fixed'"
          [style.left.px]="position().x"
          [style.top.px]="position().y"
          [attr.dir]="workspace.dir()"
          data-ndd-menu
          role="menu"
          tabindex="-1"
          aria-orientation="vertical"
          (keydown)="onMenuKey($event, false)"
        >
          @for (item of req.items; track $index; let i = $index) {
            @if (isSeparator(item)) {
              <hr class="ndd-context-menu__separator" />
            } @else if (isSubMenu(item)) {
              <button
                type="button"
                class="ndd-context-menu__item ndd-context-menu__item--has-submenu"
                [class.ndd-context-menu__item--submenu-open]="openSubmenu() === i"
                [attr.title]="sub(item).title ? workspace.format(sub(item).title) : null"
                [attr.data-ndd-menu-submenu]="workspace.format(sub(item).label)"
                [attr.data-ndd-menu-index]="i"
                role="menuitem"
                aria-haspopup="menu"
                [attr.aria-expanded]="openSubmenu() === i"
                tabindex="-1"
                (pointerenter)="onItemEnter(i, item, $event)"
                (pointerleave)="onItemLeave(item)"
              >
                <span class="ndd-context-menu__icon" aria-hidden="true"></span>
                <span class="ndd-context-menu__label">{{ workspace.format(sub(item).label) }}</span>
                <span class="ndd-context-menu__chevron" aria-hidden="true">›</span>
              </button>
            } @else {
              <button
                type="button"
                class="ndd-context-menu__item"
                [class.ndd-context-menu__item--disabled]="isDisabled(item)"
                [disabled]="isDisabled(item)"
                [attr.title]="simple(item).title ? workspace.format(simple(item).title) : null"
                [attr.data-cy-action]="simple(item).cyAction ?? null"
                [attr.data-ndd-menu-item]="workspace.format(simple(item).label)"
                [attr.data-ndd-menu-index]="i"
                [attr.role]="showsCheckbox(item) ? 'menuitemcheckbox' : 'menuitem'"
                [attr.aria-checked]="showsCheckbox(item) ? isChecked(item) : null"
                tabindex="-1"
                (click)="activate(item)"
                (pointerenter)="onItemEnter(i, item, $event)"
                (pointerleave)="onItemLeave(item)"
              >
                <span
                  class="ndd-context-menu__icon"
                  [attr.aria-hidden]="simple(item).icon ? null : 'true'"
                >
                  @if (simple(item).icon; as icon) {
                    <ndd-icon [icon]="icon" />
                  }
                </span>
                <span class="ndd-context-menu__label">{{
                  workspace.format(simple(item).label)
                }}</span>
                @if (showsCheckbox(item)) {
                  <span
                    class="ndd-context-menu__checkbox"
                    [class.ndd-context-menu__checkbox--checked]="isChecked(item)"
                    aria-hidden="true"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <rect
                        x="0.75"
                        y="0.75"
                        width="10.5"
                        height="10.5"
                        rx="2"
                        [attr.fill]="isChecked(item) ? 'currentColor' : 'none'"
                        stroke="currentColor"
                        stroke-width="1.5"
                      />
                      @if (isChecked(item)) {
                        <path
                          d="M2.5 6 L4.5 8.5 L9.5 3.5"
                          stroke="white"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      }
                    </svg>
                  </span>
                }
              </button>
            }
          }
        </div>

        @if (openSubmenu() !== null && submenuItems().length) {
          <div
            nddPortal
            #submenuRoot
            class="ndd-context-menu ndd-context-menu--submenu"
            [class]="'ndd-context-menu--' + theme()"
            [style.position]="'fixed'"
            [style.left.px]="workspace.isRtl() ? null : submenuPosition().x"
            [style.right.px]="workspace.isRtl() ? submenuPosition().x : null"
            [style.top.px]="submenuPosition().y"
            [attr.dir]="workspace.dir()"
            data-ndd-submenu
            role="menu"
            tabindex="-1"
            (pointerenter)="clearTimers()"
            (pointerleave)="openSubmenu.set(null)"
            (keydown)="onMenuKey($event, true)"
          >
            @for (item of submenuItems(); track $index) {
              @if (isSeparator(item)) {
                <hr class="ndd-context-menu__separator" />
              } @else {
                <button
                  type="button"
                  class="ndd-context-menu__item"
                  [class.ndd-context-menu__item--disabled]="isDisabled(item)"
                  [disabled]="isDisabled(item)"
                  [attr.data-ndd-menu-item]="workspace.format(simple(item).label)"
                  role="menuitem"
                  tabindex="-1"
                  (click)="activate(item)"
                >
                  <span
                    class="ndd-context-menu__icon"
                    [attr.aria-hidden]="simple(item).icon ? null : 'true'"
                  >
                    @if (simple(item).icon; as icon) {
                      <ndd-icon [icon]="icon" />
                    }
                  </span>
                  <span class="ndd-context-menu__label">{{
                    workspace.format(simple(item).label)
                  }}</span>
                </button>
              }
            }
          </div>
        }
      }
    }
  `,
})
export class NddContextMenu {
  /** Visual theme hook, mirrored onto the menu's class. */
  readonly theme = input('dark');

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  /** A custom template renders inside this host, so the host is "inside" in custom mode. */
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly custom = contentChild(NddContextMenuTemplate);
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly submenuRoot = viewChild<ElementRef<HTMLElement>>('submenuRoot');

  protected readonly request = this.workspace.contextMenu;
  protected readonly position = signal({ x: 0, y: 0 });
  protected readonly openSubmenu = signal<number | null>(null);
  protected readonly submenuPosition = signal({ x: 0, y: 0 });
  protected readonly closeFn = () => this.workspace.closeContextMenu();
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Where focus was before the menu opened, to return it on Escape. */
  private returnFocus: HTMLElement | null = null;

  protected readonly isSeparator = isSeparator;
  protected readonly isSubMenu = isSubMenu;
  protected readonly simple = (item: ContextMenuItem) => item as ContextMenuSimpleItem;
  protected readonly sub = (item: ContextMenuItem) => item as ContextMenuSubMenu;

  protected readonly submenuItems = computed<ContextMenuItem[]>(() => {
    const index = this.openSubmenu();
    const req = this.request();
    if (index === null || !req) return [];
    const item = req.items[index];
    return item && isSubMenu(item) ? (item.items ?? []) : [];
  });

  constructor() {
    const onOutside = (event: Event) => this.onOutside(event);
    const onKey = (event: KeyboardEvent) => {
      // Escape anywhere closes; everything else is handled on the menu element itself.
      if (event.key === 'Escape' && !this.root()?.nativeElement.contains(event.target as Node)) {
        event.stopPropagation();
        this.close(true);
      }
    };
    let listening = false;
    effect(() => {
      const req = this.request();
      untracked(() => {
        if (req) {
          this.returnFocus = (this.doc.activeElement as HTMLElement | null) ?? null;
          this.position.set({ x: req.x, y: req.y });
          this.openSubmenu.set(null);
          // Pull the menu back inside the viewport once it has a size, then move focus in.
          afterNextRender(() => this.settle(req.x, req.y), { injector: this.injector });
          if (!listening) {
            // Two dismissal listeners, because one is not enough: `pointerdown` in the capture
            // phase runs before any canvas or map gesture handler can swallow it, and a bubbled
            // `click` on window survives a `stopPropagation` on pointerdown, which WebGL
            // canvases commonly do. rdd learned this against real mapping libraries.
            this.doc.addEventListener('pointerdown', onOutside, { capture: true });
            this.doc.defaultView?.addEventListener('click', onOutside);
            this.doc.addEventListener('keydown', onKey);
            listening = true;
          }
        } else {
          this.openSubmenu.set(null);
          if (listening) {
            this.doc.removeEventListener('pointerdown', onOutside, { capture: true });
            this.doc.defaultView?.removeEventListener('click', onOutside);
            this.doc.removeEventListener('keydown', onKey);
            listening = false;
          }
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.clearTimers();
      this.doc.removeEventListener('pointerdown', onOutside, { capture: true });
      this.doc.defaultView?.removeEventListener('click', onOutside);
      this.doc.removeEventListener('keydown', onKey);
    });
  }

  private settle(x: number, y: number): void {
    const el = this.root()?.nativeElement;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const view = this.doc.defaultView;
    this.position.set(
      clampToViewport(
        { x, y },
        { width: box.width, height: box.height },
        { width: view?.innerWidth ?? 1024, height: view?.innerHeight ?? 768 },
      ),
    );
    this.items(el)[0]?.focus({ preventScroll: true });
  }

  protected clearTimers(): void {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
  }

  private close(restoreFocus = false): void {
    this.clearTimers();
    this.openSubmenu.set(null);
    this.workspace.closeContextMenu();
    if (restoreFocus && this.returnFocus?.isConnected)
      this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  private onOutside(event: Event): void {
    const target = event.target;
    // `contains()` throws for a non-Node, and an event target need not be one (a click
    // dispatched on window). If we cannot tell it was inside, it was not the menu: close.
    if (!(target instanceof Node)) return this.close();
    if (
      this.root()?.nativeElement.contains(target) ||
      this.submenuRoot()?.nativeElement.contains(target) ||
      // A custom template has no #root: it is rendered in place, inside the host. Without this,
      // pressing anything inside a custom menu dismissed it on pointerdown, before its click.
      (this.custom() && this.host.nativeElement.contains(target))
    )
      return;
    this.close();
  }

  // ── items ──────────────────────────────────────────────────────────────────

  protected showsCheckbox(item: ContextMenuItem): boolean {
    const box = this.simple(item).checkbox;
    return !!box && box.active !== false;
  }

  protected isChecked(item: ContextMenuItem): boolean {
    return this.showsCheckbox(item) && this.simple(item).checkbox!.value === true;
  }

  protected isDisabled(item: ContextMenuItem): boolean {
    return (
      this.simple(item).disabled === true ||
      (this.showsCheckbox(item) && this.simple(item).checkbox!.enabled === false)
    );
  }

  protected activate(item: ContextMenuItem): void {
    if (this.isDisabled(item)) return;
    this.simple(item).action?.();
    this.close(true);
  }

  protected onItemEnter(index: number, item: ContextMenuItem, event: PointerEvent): void {
    clearTimeout(this.closeTimer);
    const open = this.openSubmenu();
    if (open !== null && open !== index) {
      clearTimeout(this.openTimer);
      this.openSubmenu.set(null);
    }
    if (isSubMenu(item) && item.items?.length) {
      const el = event.currentTarget as HTMLElement;
      clearTimeout(this.openTimer);
      this.openTimer = setTimeout(() => this.openSubmenuAt(index, el), SUBMENU_OPEN_MS);
    } else {
      clearTimeout(this.openTimer);
      if (this.openSubmenu() !== null)
        this.closeTimer = setTimeout(() => this.openSubmenu.set(null), SUBMENU_CLOSE_MS);
    }
  }

  protected onItemLeave(item: ContextMenuItem): void {
    clearTimeout(this.openTimer);
    if (isSubMenu(item) && item.items?.length)
      this.closeTimer = setTimeout(() => this.openSubmenu.set(null), SUBMENU_CLOSE_MS);
  }

  /** Open a submenu beside its parent item — rightwards under LTR, leftwards under RTL. */
  private openSubmenuAt(index: number, el: HTMLElement, focusFirst = false): void {
    const box = el.getBoundingClientRect();
    const width = this.doc.defaultView?.innerWidth ?? 1024;
    this.submenuPosition.set(
      this.workspace.isRtl()
        ? { x: width - box.left + 2, y: box.top }
        : { x: box.right + 2, y: box.top },
    );
    this.openSubmenu.set(index);
    if (focusFirst)
      afterNextRender(
        () => {
          const sub = this.submenuRoot()?.nativeElement;
          if (sub) this.items(sub)[0]?.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
  }

  // ── keyboard (WAI-ARIA menu pattern) ───────────────────────────────────────

  private items(menu: HTMLElement): HTMLElement[] {
    return [
      ...menu.querySelectorAll<HTMLElement>(':scope > button[role^="menuitem"]:not([disabled])'),
    ];
  }

  protected onMenuKey(event: KeyboardEvent, inSubmenu: boolean): void {
    const menu = event.currentTarget as HTMLElement;
    const items = this.items(menu);
    const current = items.indexOf(this.doc.activeElement as HTMLElement);
    const focus = (i: number) =>
      items[(i + items.length) % items.length]?.focus({ preventScroll: true });
    const rtl = this.workspace.isRtl();
    const into = rtl ? 'ArrowLeft' : 'ArrowRight';
    const outOf = rtl ? 'ArrowRight' : 'ArrowLeft';
    switch (event.key) {
      case 'ArrowDown':
        focus(current + 1);
        break;
      case 'ArrowUp':
        focus(current < 0 ? items.length - 1 : current - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(items.length - 1);
        break;
      case into: {
        const el = items[current];
        const index = Number(el?.getAttribute('data-ndd-menu-index'));
        if (!inSubmenu && el?.getAttribute('aria-haspopup') && !Number.isNaN(index))
          this.openSubmenuAt(index, el, true);
        else return;
        break;
      }
      case outOf:
        if (!inSubmenu) return;
        this.closeSubmenuToParent();
        break;
      case 'Escape':
        if (inSubmenu) this.closeSubmenuToParent();
        else this.close(true);
        break;
      case 'Tab':
        this.close();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  private closeSubmenuToParent(): void {
    const index = this.openSubmenu();
    this.openSubmenu.set(null);
    this.root()
      ?.nativeElement.querySelector<HTMLElement>(`[data-ndd-menu-index="${index}"]`)
      ?.focus({ preventScroll: true });
  }
}
