/**
 * Sidebar configuration shapes.
 *
 * rdd's `renderContent` becomes either an `nddSidebarTab` template or a `component` field.
 * Everything else keeps rdd's and vdd's names.
 */
import type { Signal, Type } from '@angular/core';
import type { NddIcon } from './icon';

/** One tab in the activity bar. */
export interface SidebarTab {
  id: string;
  label: string;
  /** Required unless `hidden` — a hidden tab renders no rail button, so it has no icon to show. */
  icon?: NddIcon;
  /**
   * Render no rail button, while the tab stays fully openable through `[(activeTabId)]` or
   * `injectSidebar().openTab()`. For menu-driven panels with no permanent icon.
   * @default false
   */
  hidden?: boolean;
  /** Mount as soon as the sidebar renders, not on first open. Implies `preserveState`. @default false */
  eagerMount?: boolean;
  /** Keep the content alive behind `display: none` when closed, instead of destroying it. @default false */
  preserveState?: boolean;
  /** Content, when it comes from data rather than a template. An `nddSidebarTab` template wins. */
  component?: Type<unknown>;
  /** Inputs for `component`. */
  inputs?: Record<string, unknown>;
}

/** A rail button that does not toggle the drawer — a hamburger, say. */
export interface SidebarActionButton {
  /** Needed only inside an array, for tracking. */
  id?: string;
  icon: NddIcon;
  /** Tooltip and accessible name. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** A rail entry the caller renders entirely themselves. */
export interface SidebarCustomEntry {
  id?: string;
  /** Rendered as-is, unwrapped, so the caller's own styling and behaviour are untouched. */
  component: Type<unknown>;
  inputs?: Record<string, unknown>;
  /** Marks this as a custom entry rather than a tab, since both carry `component`. */
  custom: true;
}

/** An entry in the header or footer area of the rail. */
export type SidebarRailEntry = SidebarTab | SidebarActionButton | SidebarCustomEntry;

export const isCustomEntry = (entry: SidebarRailEntry): entry is SidebarCustomEntry =>
  'custom' in entry && entry.custom === true;

export const isTabEntry = (entry: SidebarRailEntry): entry is SidebarTab =>
  !isCustomEntry(entry) && !('onClick' in entry);

export const isActionButton = (entry: SidebarRailEntry): entry is SidebarActionButton =>
  !isCustomEntry(entry) && 'onClick' in entry;

/** Normalise the single-or-array shape both areas accept. */
export const toRailArray = (
  value: SidebarRailEntry | SidebarRailEntry[] | undefined | null,
): SidebarRailEntry[] => (value == null ? [] : Array.isArray(value) ? value : [value]);

/** What `injectSidebar()` returns: control of the drawer from anywhere inside it. */
export interface SidebarContext {
  openTab: (id: string) => void;
  closeDrawer: () => void;
  /** The open tab, or `null`. */
  activeTabId: Signal<string | null>;
  position: 'left' | 'right';
  /** True for an `<ndd-secondary-sidebar>`. */
  isSecondary: boolean;
}

/** What `injectSidebarTab()` returns: control scoped to the tab you are inside. */
export interface SidebarTabContext {
  tabId: string;
  open: () => void;
  close: () => void;
  /** Switch to another tab. */
  openTab: (id: string) => void;
}
