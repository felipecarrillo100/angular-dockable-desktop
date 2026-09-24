/**
 * Panel contributions: toolbar items and sidebar sections a panel publishes, for the app shell
 * to surface while that panel is the active one. Ported from vdd `useContributions.ts`.
 *
 * rdd asked callers to memoise the object and re-call the hook on every render, because a new
 * literal each render meant republishing each render. Here the contribution is a *getter* read in
 * an effect: it republishes when the panel's own signals change, and never otherwise.
 */
import { DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import type { NddIcon } from '../core/icon';
import { mergeSidebarTabs, mergeToolbarItems } from '../core/contributions';
import type { PanelContribution } from '../core/contributions';
import type { SidebarTab } from '../core/sidebar-types';
import type { ToolbarItem } from '../core/toolbar-types';
import { injectPanel } from '../panel/panel-ref';
import { injectWorkspace } from '../workspace/provide';


/**
 * Publish this panel's toolbar items and sidebar sections while it exists, for the shell to
 * surface while it is the active panel. Call in the panel component's injection context.
 *
 * ```ts
 * protected readonly tool = signal<'pan' | 'draw'>('pan');
 * constructor() {
 *   injectPanelContribution(() => ({
 *     toolbarItems: [{ type: 'toggle', id: 'draw', label: 'Draw', icon: Pencil,
 *       active: this.tool() === 'draw', onToggle: on => this.tool.set(on ? 'draw' : 'pan') }],
 *     sidebarSections: [{ id: 'layers', label: 'Layers', component: LayerList }],
 *   }));
 * }
 * ```
 *
 * Withdrawn with the component — nothing to unsubscribe.
 */
export function injectPanelContribution(contribution: () => PanelContribution): void {
  const workspace = injectWorkspace();
  const { id } = injectPanel();
  if (id === 'standalone') {
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      console.warn(
        '[angular-dockable-desktop] injectPanelContribution() was called outside a panel, so it did nothing. ' +
          'This is expected when a panel component is rendered standalone.',
      );
    }
    return;
  }

  // Published once now, so the contribution exists even before the first render, then
  // re-published by the effect: on its first run — which sees the inputs, unset when the
  // constructor ran — and whenever what the getter reads changes.
  let withdraw = workspace.contributions.publish(id, untracked(contribution));
  effect(() => {
    const next = contribution();
    untracked(() => {
      // Publish the new one *first*, then withdraw the old registration. The other order leaves
      // a moment where this panel has published nothing, which anything reading the active
      // contribution in between would observe as a disappearance. The store's withdraw is a
      // no-op once something newer has replaced it, which is what makes this order safe.
      const previous = withdraw;
      withdraw = workspace.contributions.publish(id, next);
      previous();
    });
  });
  inject(DestroyRef).onDestroy(() => withdraw());
}

/**
 * What the active panel has published, or `null` — for the shell to merge into its own
 * `<ndd-toolbar [items]>` and `<ndd-sidebar [tabs]>`. Nothing is merged automatically: the
 * library does not know what a contributed item means for your domain, or where it belongs.
 */
export function injectActiveContribution(): Signal<PanelContribution | null> {
  return injectWorkspace().activeContribution;
}

/**
 * A static toolbar list with the active panel's contributed items appended behind a separator.
 * `mergeToolbarItems` is the plain function underneath, for a different position or separator.
 */
export function injectMergedToolbarItems(staticItems: () => ToolbarItem[]): Signal<ToolbarItem[]> {
  const active = injectActiveContribution();
  return computed(() => mergeToolbarItems(staticItems(), active()));
}

/** A static tab list with the active panel's contributed sections appended. */
export function injectMergedSidebarTabs(staticTabs: () => SidebarTab[], fallbackIcon?: NddIcon): Signal<SidebarTab[]> {
  const active = injectActiveContribution();
  return computed(() => mergeSidebarTabs(staticTabs(), active(), fallbackIcon));
}
