/**
 * A tab group: a tab bar and the selected panel's body.
 *
 * The tab bar distinguishes *selected* from *globally active*: the selected tab of an inactive
 * group is drawn differently from the one the user is working in. Those must never disagree
 * with `activePanelId` — the invariant behind vdd D2.
 *
 * Only the selected tab has a slot. A background tab's panel is parked in the off-screen store,
 * alive and running, simply not shown.
 * @internal
 */
import { Component, DestroyRef, ElementRef, NgZone, afterNextRender, computed, inject, input, viewChild } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import type { LayoutLeafNode } from '../core/types';
import { NddIconView } from '../common/icon';
import { NddPanelSlot } from '../panel/panel-slot';
import { DragDock } from './drag-dock';
import { NddDropZones } from './drop-zones';
import { openMenu, panelMenu } from './menus';

@Component({
  selector: 'ndd-leaf-group',
  imports: [NddIconView, NddPanelSlot, NddDropZones],
  template: `
    <div
      class="ndd-workspace-panel"
      [attr.data-ndd-leaf]="leaf().id"
      [attr.data-active-panel-id]="selectedId() ?? ''"
      (pointerdown)="focusSelected()"
    >
      <div class="ndd-workspace-tab-bar">
        <div #tabBar class="ndd-tab-headers-container" role="tablist">
          @for (tab of tabs(); track tab.id; let i = $index) {
            <div
              class="ndd-workspace-tab"
              [class.ndd-active]="tab.id === selectedId()"
              [class.ndd-workspace-tab-active-focused]="tab.id === selectedId() && tab.id === activePanelId()"
              [class.ndd-workspace-tab-active-unfocused]="tab.id === selectedId() && tab.id !== activePanelId()"
              [class.ndd-workspace-tab-inactive]="tab.id !== selectedId()"
              [class.ndd-drag-hover-left]="isInsertion(tab.id, 'left')"
              [class.ndd-drag-hover-right]="isInsertion(tab.id, 'right')"
              [attr.data-ndd-tab]="tab.id"
              [attr.data-ndd-tab-leaf]="leaf().id"
              [attr.data-ndd-tab-index]="i"
              role="tab"
              [attr.aria-selected]="tab.id === selectedId()"
              [attr.tabindex]="tab.id === selectedId() ? 0 : -1"
              [style.cursor]="tab.canDrag ? 'pointer' : 'default'"
              (click)="workspace.focusPanel(tab.id)"
              (pointerdown)="tab.canDrag && drag.startTabDrag(tab.id, $event, openTabMenu(tab.id))"
              (contextmenu)="$event.preventDefault(); openTabMenu(tab.id)($event)"
              (keydown.enter)="workspace.focusPanel(tab.id)"
              (keydown.space)="workspace.focusPanel(tab.id); $event.preventDefault()"
              (keydown.delete)="tab.canClose && workspace.requestClosePanel(tab.id)"
              [attr.aria-keyshortcuts]="tab.canClose ? 'Delete' : null"
            >
              <span class="ndd-text-truncate">
                @if (tab.icon) {
                  <span class="ndd-workspace-tab-icon"><ndd-icon [icon]="tab.icon" /></span>
                }
                <span>{{ workspace.format(tab.title) }}{{ tab.dirty ? ' *' : '' }}</span>
              </span>
              @if (tab.canClose) {
                <!-- A pointer affordance only. A focusable control inside role="tab" is a nested
                     interactive (axe, M13); the keyboard closes the focused tab with Delete, the
                     WAI-ARIA tabs pattern, announced through aria-keyshortcuts (N4). -->
                <span
                  class="ndd-close-tab-x"
                  aria-hidden="true"
                  [attr.title]="workspace.format(workspace.messages.closeTab)"
                  [attr.data-ndd-close]="tab.id"
                  (click)="$event.stopPropagation(); workspace.requestClosePanel(tab.id)"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </span>
              }
            </div>
          }
        </div>
        @if (tabs().length === 0) {
          <div class="ndd-tab-header-actions">
            <button
              type="button"
              class="ndd-header-close-empty-group"
              [attr.title]="workspace.format(workspace.messages.closeEmptyGroup)"
              [attr.aria-label]="workspace.format(workspace.messages.closeEmptyGroup)"
              data-ndd-close-empty-group
              (click)="$event.stopPropagation(); workspace.closeLeafGroup(leaf().id)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        }
      </div>

      <div class="ndd-panel-body" role="tabpanel">
        @if (drag.dragging()) {
          <ndd-drop-zones [leafId]="leaf().id" />
        }
        <!-- Re-keyed by the selected panel, so a tab switch creates a new slot, which hands the
             panel host a new place to put the panel. The panel itself is never re-created.
             A derived key, not \`track id\`: identity tracking makes Angular warn (NG0956) on
             every tab switch, as if re-creating the one-item list were a mistake. It is the point. -->
        @for (id of selectedList(); track 'slot:' + id) {
          <div [nddPanelSlot]="id"></div>
        } @empty {
          <div class="ndd-empty-leaf-placeholder">
            <span>{{ workspace.format(workspace.messages.emptyGroup) }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class NddLeafGroup {
  readonly leaf = input.required<LayoutLeafNode>();

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  protected readonly activePanelId = this.workspace.activePanelId;
  protected readonly selectedId = computed(() => this.leaf().activePanelId);
  protected readonly selectedList = computed(() => {
    const id = this.selectedId();
    return id ? [id] : [];
  });
  protected readonly tabs = computed(() => {
    const panels = this.workspace.panels();
    return this.leaf().panels.flatMap(id => {
      const panel = panels[id];
      if (!panel) return [];
      const options = this.workspace.registry.get(panel.component)?.defaultOptions ?? {};
      return [
        {
          id,
          title: panel.title,
          dirty: panel.dirty === true,
          icon: options.icon,
          canClose: options.canClose !== false,
          canDrag: options.canDrag !== false,
        },
      ];
    });
  });

  protected readonly drag = inject(DragDock);

  protected isInsertion(id: string, side: 'left' | 'right'): boolean {
    const hovered = this.drag.tab();
    return hovered?.leafId === this.leaf().id && hovered.panelId === id && hovered.side === side;
  }

  private readonly tabBar = viewChild<ElementRef<HTMLElement>>('tabBar');

  constructor() {
    // Tab hover matters only mid-drag, and a template (pointermove) schedules change detection
    // for every move whether or not anything changed — 40 moves across an idle tab bar cost 40
    // ticks (measured in M13). One delegated listener outside Angular returns before touching
    // any state unless a drag is in flight; the signal it then writes schedules what is needed.
    const zone = inject(NgZone);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const bar = this.tabBar()?.nativeElement;
      if (!bar) return;
      const onMove = (event: PointerEvent) => this.onTabBarMove(event);
      const onLeave = () => this.drag.dragging() && this.drag.hoverTab(null);
      zone.runOutsideAngular(() => {
        bar.addEventListener('pointermove', onMove);
        bar.addEventListener('pointerleave', onLeave);
      });
      destroyRef.onDestroy(() => {
        bar.removeEventListener('pointermove', onMove);
        bar.removeEventListener('pointerleave', onLeave);
      });
    });
  }

  /** Which half of a tab the pointer is over decides which side the panel is inserted on. */
  private onTabBarMove(event: PointerEvent): void {
    if (!this.drag.dragging() || event.pointerType === 'touch') return;
    const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ndd-tab]') : null;
    if (!tab) return this.drag.hoverTab(null);
    const rect = tab.getBoundingClientRect();
    this.drag.hoverTab({
      leafId: this.leaf().id,
      panelId: tab.getAttribute('data-ndd-tab')!,
      index: Number(tab.getAttribute('data-ndd-tab-index') ?? 0),
      side: event.clientX - rect.left < rect.width / 2 ? 'left' : 'right',
    });
  }

  /** The standard panel menu plus what the panel contributed; also a touch long press's menu. */
  protected openTabMenu(id: string): (event: MouseEvent | PointerEvent) => void {
    return event => openMenu(this.workspace, event, panelMenu(this.workspace, id));
  }

  protected focusSelected(): void {
    const id = this.selectedId();
    if (id) this.workspace.focusPanel(id);
  }
}
