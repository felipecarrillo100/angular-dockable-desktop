/**
 * Panel contributions: toolbar items and sidebar sections a panel publishes, surfaced only
 * while that panel is the active one.
 *
 * Safe for the same reason as the rest of the library: a contribution is read from
 * `activePanelId`, and `activePanelId` never names a panel the user cannot see (vdd D2). On
 * the workspace rather than behind a provider, so the merge helpers are plain functions.
 */
import { computed, signal, untracked } from '@angular/core';
import type { Signal, Type } from '@angular/core';
import type { NddIcon } from './icon';
import type { SidebarTab } from './sidebar-types';
import type { ToolbarItem } from './toolbar-types';

/** One named section a panel contributes to the app's sidebar while it is active. */
export interface PanelSidebarSection {
  id: string;
  label: string;
  icon?: NddIcon;
  /** Rendered as the section's content. */
  component: Type<unknown>;
  inputs?: Record<string, unknown>;
}

/**
 * What a panel publishes. Both fields are optional and independent. The library assigns no
 * meaning to either: the shell merges them into its own `items` / `tabs`.
 */
export interface PanelContribution {
  toolbarItems?: ToolbarItem[];
  sidebarSections?: PanelSidebarSection[];
}

export interface Contributions {
  /**
   * Publish for one panel, replacing anything it published before. The returned function
   * withdraws it — but only if nothing has re-published for that id since, so a stale cleanup
   * cannot undo a newer publish.
   */
  publish(panelId: string, contribution: PanelContribution): () => void;
  /** What one panel has published, or `null`. Reactive. */
  get(panelId: string): PanelContribution | null;
  /** Every panel that has published something. Reactive. */
  ids(): string[];
}

export function createContributions(): Contributions {
  // Replaced, never mutated, so a signal of the map is enough to be tracked.
  const map = signal<ReadonlyMap<string, PanelContribution>>(new Map());
  return {
    publish(panelId, contribution) {
      const stored: PanelContribution = {
        toolbarItems: contribution.toolbarItems,
        sidebarSections: contribution.sidebarSections,
      };
      map.update(m => new Map(m).set(panelId, stored));
      return () => {
        if (untracked(map).get(panelId) === stored) {
          map.update(m => {
            const next = new Map(m);
            next.delete(panelId);
            return next;
          });
        }
      };
    },
    get: panelId => map().get(panelId) ?? null,
    ids: () => Array.from(map().keys()),
  };
}

// ── merge helpers ───────────────────────────────────────────────────────────

/**
 * Turn a contributed section into a sidebar tab. `eagerMount` / `preserveState` stay unset: a
 * contribution exists only while its panel is active, so neither has anything to mean here.
 */
export function sectionToTab(section: PanelSidebarSection, fallbackIcon?: NddIcon): SidebarTab {
  return {
    id: section.id,
    label: section.label,
    icon: section.icon ?? fallbackIcon,
    component: section.component,
    inputs: section.inputs,
  };
}

/** Append the active panel's contributed items to a static list, behind a separator. */
export function mergeToolbarItems(
  staticItems: ToolbarItem[],
  contribution: PanelContribution | null,
): ToolbarItem[] {
  const contributed = contribution?.toolbarItems;
  if (!contributed?.length) return staticItems;
  return [...staticItems, { type: 'separator' }, ...contributed];
}

/** Append the active panel's contributed sections to a static tab list. */
export function mergeSidebarTabs(
  staticTabs: SidebarTab[],
  contribution: PanelContribution | null,
  fallbackIcon?: NddIcon,
): SidebarTab[] {
  const sections = contribution?.sidebarSections;
  if (!sections?.length) return staticTabs;
  return [...staticTabs, ...sections.map(s => sectionToTab(s, fallbackIcon))];
}

/** @internal — the workspace exposes the active contribution as a signal. */
export function activeContributionSignal(
  contributions: Contributions,
  activePanelId: () => string | null,
): Signal<PanelContribution | null> {
  return computed(() => {
    const id = activePanelId();
    return id ? contributions.get(id) : null;
  });
}
