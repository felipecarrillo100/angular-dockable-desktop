import type { Type } from '@angular/core';
import type { NddIcon } from './icon';
import type { FloatAnchor, Label } from './types';

/** Defaults applied to every instance of a registered panel. All optional. */
export interface PanelDefaultOptions {
  /** Tab and window title. */
  title?: Label;
  /** Icon shown in the tab, title bar and taskbar. */
  icon?: NddIcon;
  /** Where the panel goes when first opened. @default 'docked' */
  initialTarget?: 'floating' | 'docked' | 'tabbed';
  /** Bounds used the first time the panel is floated. Numbers are px; strings any CSS length. */
  favoritePosition?: {
    x: number | string;
    y: number | string;
    width: number | string;
    height: number | string;
  };
  /** Corner to pin newly-floated windows to. */
  defaultAnchor?: FloatAnchor;
  /** Show the close button. @default true */
  canClose?: boolean;
  /** Show the minimise button. @default true */
  canMinimize?: boolean;
  /** Allow dragging the tab, which is also what allows floating by drag. @default true */
  canDrag?: boolean;
  /** Show a letter tile instead of a live thumbnail in the taskbar hover preview. @default false */
  disableLivePreview?: boolean;
  /**
   * Restore scroll offsets after the panel is re-parented. Turn off for a panel that manages
   * virtualised scrolling itself and would rather react to `isMinimized`.
   * @default true
   */
  preserveScroll?: boolean;
  /**
   * Class added to each panel of this kind, on its own content element (`.ndd-panel-content`),
   * which moves with the panel between groups, windows and the taskbar preview. (1.7.0)
   */
  className?: string;
  /** Class added to the tab of each panel of this kind. (1.7.0) */
  tabClassName?: string;
  /**
   * `false` destroys the panel's component while it is hidden (an unselected tab, or minimised)
   * and creates it afresh when shown, to free what a heavy, rarely shown panel holds. Its own
   * state is lost each time, and a guard it registered is not active while it is destroyed (its
   * dirty flag still is). Its tab, title, size and container carry on, and the taskbar shows a
   * letter tile instead of a live preview. @default true
   * @see docs/decisions/0018-opt-in-unmount-while-hidden.md
   */
  keepAlive?: boolean;
}

/** A lazily loaded panel component — the same shape as the router's `loadComponent`. */
export type PanelLoader = () => Promise<Type<unknown> | { default: Type<unknown> }>;

/** A registered panel kind: an eager `component`, or a `loadComponent` resolved on first use. */
export interface PanelRegistryEntry {
  component?: Type<unknown>;
  loadComponent?: PanelLoader;
  defaultOptions?: PanelDefaultOptions;
}

/**
 * The panel catalogue: component keys → components.
 *
 * One instance per workspace, never a module-level singleton, so two workspaces on a page
 * cannot see each other's panels (rdd had a global one; vdd moved it onto the workspace).
 */
export class PanelRegistry {
  private entries = new Map<string, PanelRegistryEntry>();
  private loading = new Map<string, Promise<Type<unknown>>>();

  /** Register a panel kind with an eagerly available component. */
  register(id: string, component: Type<unknown>, defaultOptions?: PanelDefaultOptions): void {
    this.loading.delete(id);
    this.entries.set(id, { component, ...(defaultOptions ? { defaultOptions } : {}) });
  }

  /**
   * Register a panel kind whose component is loaded on first use, so it lands in its own
   * chunk. `resolve()` loads it once and caches the result on the entry.
   */
  registerLazy(id: string, loadComponent: PanelLoader, defaultOptions?: PanelDefaultOptions): void {
    this.loading.delete(id);
    this.entries.set(id, { loadComponent, ...(defaultOptions ? { defaultOptions } : {}) });
  }

  /** Look up a panel kind, or `undefined` if the key was never registered. */
  get(id: string): PanelRegistryEntry | undefined {
    return this.entries.get(id);
  }

  /** Whether a key is registered. */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Every registered key. */
  keys(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * The component for a key, loading it first if it is lazy. Rejects for an unknown key.
   * Concurrent calls share one load.
   */
  resolve(id: string): Promise<Type<unknown>> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.reject(new Error(`No panel is registered under "${id}".`));
    if (entry.component) return Promise.resolve(entry.component);
    let pending = this.loading.get(id);
    if (!pending) {
      pending = entry.loadComponent!().then(m => {
        const component = 'default' in m ? m.default : m;
        // Only cache if the registration was not replaced while loading.
        if (this.entries.get(id) === entry) entry.component = component;
        return component;
      });
      this.loading.set(id, pending);
    }
    return pending;
  }
}
