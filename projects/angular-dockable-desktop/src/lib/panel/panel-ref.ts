/**
 * What a panel sees of itself and its container.
 *
 *   export class MapPanel {
 *     private readonly panel = injectPanel();
 *     constructor() {
 *       effect(() => this.panel.isActive() && this.map.focus());
 *       effect(() => { const s = this.panel.size(); if (s) this.map.resize(s.width, s.height); });
 *       this.panel.onBeforeClose(() => confirm('Leave?'));
 *     }
 *   }
 *
 * rdd exposed six subscription methods plus two size APIs for this (React cannot hand a
 * component live state); vdd made them refs; here they are signals, so a panel reacts with
 * `computed()` / `effect()` like any other Angular code. Registrations are disposed with the
 * component that made them (`DestroyRef`) — nothing to unsubscribe.
 *
 * Works outside any container too: the signals report a `'standalone'` panel and the actions
 * are no-ops with a development warning, so a panel component renders on its own — in a test,
 * a story, or a route — without special-casing.
 */
import { DestroyRef, InjectionToken, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import { Workspace } from '../workspace/workspace';
import type { NddIcon } from '../core/icon';
import type { ContainerType, DirtyStateOptions, Label } from '../core/types';

/** What a panel's container tells it about itself. @internal */
export interface PanelContext {
  id: string;
  containerType: Signal<ContainerType>;
  /** The rendered size, or `null` until laid out. */
  size?: Signal<{ width: number; height: number } | null>;
  /** Set by containers that are not the workspace (a modal, a side panel). */
  close?: (options?: { force?: boolean }) => void | Promise<void>;
  setTitle?: (title: Label) => void;
  setIcon?: (icon: NddIcon) => void;
  setDirty?: (dirty: boolean, options?: DirtyStateOptions) => void;
}

/** @internal — provided by each container to its content. */
export const PANEL_CONTEXT = new InjectionToken<PanelContext>('ndd.PanelContext');

/** What {@link injectPanel} returns. */
export interface PanelRef {
  /** This panel's instance id. */
  readonly id: string;
  /** Live title. */
  readonly title: Signal<Label>;
  /** Whether this is the globally active panel — the one contributions are read from. */
  readonly isActive: Signal<boolean>;
  /** Whether this panel is minimised. It is still alive and still running. */
  readonly isMinimized: Signal<boolean>;
  /** Whether this panel is a floating window. */
  readonly isFloating: Signal<boolean>;
  /** Where this panel is rendered. A minimised panel reports where it will be restored to. */
  readonly containerType: Signal<ContainerType>;
  /** The panel's rendered size, or `null` before it has been laid out. */
  readonly size: Signal<{ width: number; height: number } | null>;
  /** Unsaved changes. */
  readonly dirty: Signal<boolean>;
  setTitle(title: Label): void;
  setIcon(icon: NddIcon): void;
  setDirty(dirty: boolean, options?: DirtyStateOptions): void;
  /** Close, honouring dirty state and any `onBeforeClose` guard. */
  close(options?: { force?: boolean }): void | Promise<void>;
  minimize(): void;
  /**
   * Veto a close. Return `false` (or a promise of it) to block. Disposed with the component
   * that called `injectPanel()`.
   */
  onBeforeClose(guard: () => boolean | Promise<boolean>): void;
  /**
   * Contribute this panel's live state to `saveLayout()`, pulled fresh on every save — for
   * state that accumulates after opening. Must be synchronous and JSON-serialisable. Saved as
   * the panel's `props`, and applied to its inputs when the layout is restored.
   */
  onSaveState(provider: () => unknown): void;
  /**
   * Keep the dirty flag in step with a signal — a Signal Forms form's `dirty()`, say — instead
   * of calling `setDirty` by hand on every change:
   *
   * ```ts
   * protected readonly form = form(this.model);
   * constructor() { injectPanel().trackDirty(() => this.form().dirty()); }
   * ```
   *
   * `options` may be a getter, so the unsaved-changes dialog can say what is wrong right now
   * (`() => ({ alert: this.form().valid() ? undefined : 'Some fields are invalid' })`). Stops
   * with the component that called `injectPanel()`.
   */
  trackDirty(source: () => boolean, options?: DirtyStateOptions | (() => DirtyStateOptions | undefined)): void;
}

const STANDALONE = 'standalone';

/**
 * This panel's {@link PanelRef}. Call in an injection context — a field initialiser or the
 * constructor of the panel component (or of anything inside it).
 */
export function injectPanel(): PanelRef {
  const ctx = inject(PANEL_CONTEXT, { optional: true });
  const workspace = inject(Workspace, { optional: true }) as Workspace<never> | null;
  const destroyRef = inject(DestroyRef, { optional: true });
  const injector = inject(Injector);
  const id = ctx?.id ?? STANDALONE;

  const warnStandalone = (what: string) => {
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      console.warn(
        `[angular-dockable-desktop] injectPanel().${what} was called outside a panel container, ` +
          `so it did nothing. This is expected when a panel component is rendered standalone.`,
      );
    }
  };
  const info = computed(() => (workspace ? workspace.panels()[id] : undefined));
  /** Untracked: see the note on the actions below. */
  const isKnown = () => untracked(() => !!workspace && !!workspace.state().panels[id]);
  const fallbackSize = signal<{ width: number; height: number } | null>(null).asReadonly();
  const register = (off: () => void) => destroyRef?.onDestroy(off);

  // Every action below runs untracked. They are called from effects — `effect(() =>
  // panel.setTitle(...))` is the documented form — and each reads state on its way (the
  // workspace's panel record, an overlay's instance signal), so a tracked read made the calling
  // effect depend on the very state the call changes, and it re-ran forever. The workspace's own
  // actions are untracked for the same reason. Found by the M14 demo walkthrough.
  const ref: PanelRef = {
    id,
    title: computed(() => info()?.title ?? id),
    isActive: computed(() => !!workspace && workspace.activePanelId() === id),
    isMinimized: computed(() => info()?.state === 'minimized'),
    isFloating: computed(() => info()?.state === 'floating'),
    containerType: computed(() => ctx?.containerType() ?? STANDALONE),
    size: ctx?.size ?? fallbackSize,
    dirty: computed(() => info()?.dirty === true),

    setTitle: title => untracked(() => {
      if (ctx?.setTitle) ctx.setTitle(title);
      else if (workspace && isKnown()) workspace.updatePanelTitle(id, title);
      else warnStandalone('setTitle');
    }),
    setIcon: icon => untracked(() => {
      if (ctx?.setIcon) ctx.setIcon(icon);
      else warnStandalone('setIcon');
    }),
    setDirty: (dirty, options) => untracked(() => {
      if (ctx?.setDirty) ctx.setDirty(dirty, options);
      else if (workspace && isKnown()) workspace.setPanelDirty(id, dirty, options);
      else warnStandalone('setDirty');
    }),
    close: options => untracked(() => {
      if (ctx?.close) return ctx.close(options);
      if (workspace && isKnown()) return workspace.requestClosePanel(id, options);
      warnStandalone('close');
      return undefined;
    }),
    minimize: () => untracked(() => {
      if (workspace && isKnown()) workspace.minimizePanel(id);
      else warnStandalone('minimize');
    }),
    onBeforeClose: guard => {
      if (!workspace || !isKnown()) return warnStandalone('onBeforeClose');
      register(workspace.registerCloseGuard(id, guard));
    },
    onSaveState: provider => {
      if (!workspace || !isKnown()) return warnStandalone('onSaveState');
      register(workspace.registerStateProvider(id, provider));
    },
    trackDirty: (source, options) => {
      effect(
        () => {
          const dirty = source();
          const opts = typeof options === 'function' ? options() : options;
          untracked(() => ref.setDirty(dirty, opts));
        },
        { injector },
      );
    },
  };
  return ref;
}
