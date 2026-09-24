/**
 * Side panels and modals: two drawers and a modal stack, all rendered outside the workspace.
 *
 * On the workspace rather than behind a provider, so opening a modal works from a service, a
 * guard or an event handler — none of which are components. `requestClose` here is the *only*
 * implementation of close-with-guards-and-dirty-check; rdd had it twice (in each renderer),
 * which is how two containers end up disagreeing about what a dirty panel does.
 *
 * Ported from vdd `src/core/overlays.ts` onto signals. Instances are replaced, never mutated.
 */
import { signal, untracked } from '@angular/core';
import type { Signal, Type } from '@angular/core';
import type { NddIcon } from './icon';
import type { DirtyStateOptions, Label } from './types';

/** Which of the three overlay slots an instance occupies. */
export type OverlayKind = 'left-panel' | 'right-panel' | 'modal';

/** Options for a side panel (drawer). */
export interface SidePanelOptions {
  title?: Label;
  /** Rendered in the header, before the title. */
  icon?: NddIcon;
  /** A number is pixels; a string is used as-is (`'40vw'`). @default 400 */
  width?: number | string;
  /**
   * Padding for the body. A number is pixels; a string is any CSS value or shorthand. Unset by
   * default, so the stylesheet decides and content can go edge-to-edge.
   */
  bodyPadding?: number | string;
}

/** Options for a modal. */
export interface ModalOptions {
  title?: Label;
  icon?: NddIcon;
  /** Maps to a `max-width` rule. @default 'auto' */
  size?: 'small' | 'medium' | 'large' | 'fullscreen' | 'auto';
  /** `false` removes the close button *and* dismissal by backdrop click or Escape. @default true */
  closable?: boolean;
  /** As `SidePanelOptions.bodyPadding`. */
  bodyPadding?: number | string;
}

/** One open side panel or modal. */
export interface OverlayInstance {
  id: string;
  component: Type<unknown>;
  /** Applied to the component with `ComponentRef.setInput`. */
  inputs: Record<string, unknown>;
  kind: OverlayKind;
  options: SidePanelOptions & ModalOptions;
  dirty: boolean;
  dirtyOptions?: DirtyStateOptions;
}

export interface OverlayState {
  leftPanel: OverlayInstance | null;
  rightPanel: OverlayInstance | null;
  /** Bottom to top: the last entry is the topmost modal. */
  modals: readonly OverlayInstance[];
}

/** What the built-in unsaved-changes question needs to know. */
export interface DiscardRequest {
  /** The thing being closed, already formatted — it appears in the message. */
  title: string;
  dirtyOptions?: DirtyStateOptions;
}

/** Ask the user whether to discard unsaved changes. Resolves `false` for every refusal. */
export type ConfirmDiscard = (request: DiscardRequest) => Promise<boolean>;

/** Supplied by `<ndd-modals>`: opens the question and resolves the user's answer. @internal */
export type ConfirmRenderer = (request: DiscardRequest) => Promise<boolean>;

export interface Overlays {
  /** The drawers and the modal stack. */
  readonly state: Signal<OverlayState>;
  /**
   * Open a drawer on the left. Resolves to the new instance's id, or `null` when a panel was
   * already open there and its close guard refused — a drawer is a single slot, so opening one
   * is also closing the other.
   */
  openLeftPanel(component: Type<unknown>, inputs?: Record<string, unknown>, options?: SidePanelOptions): Promise<string | null>;
  openRightPanel(component: Type<unknown>, inputs?: Record<string, unknown>, options?: SidePanelOptions): Promise<string | null>;
  /** Push a modal onto the stack. Synchronous: a stack has room for another. */
  openModal(component: Type<unknown>, inputs?: Record<string, unknown>, options?: ModalOptions): string;
  /**
   * Remove an instance immediately, with no guard and no dirty check. `result` is what
   * {@link Overlays.whenClosed} resolves to — how a modal hands back an answer.
   */
  close(id: string, result?: unknown): void;
  /**
   * Resolves once the instance is gone, however it went: `close(id, result)` gives `result`;
   * Escape, the backdrop, the ×, `closeAll` or eviction from a drawer give `undefined`.
   * An id that is not open resolves `undefined` at once.
   */
  whenClosed(id: string): Promise<unknown>;
  closeAll(): void;
  closeAllModals(): void;
  getInstance(id: string): OverlayInstance | undefined;
  updateInstance(id: string, updates: Partial<Pick<OverlayInstance, 'inputs' | 'options' | 'dirty' | 'dirtyOptions'>>): void;
  setDirty(id: string, dirty: boolean, options?: DirtyStateOptions): void;
  /**
   * Close, honouring this instance's close guard and its dirty state. `force` skips both.
   * Without a `confirm`, a dirty instance stays open rather than discarding edits silently.
   */
  requestClose(id: string, options?: { force?: boolean; confirm?: (instance: OverlayInstance) => Promise<boolean> }): Promise<void>;
  /** Veto an instance's close. Returning `false` blocks it. */
  registerCloseGuard(id: string, guard: () => boolean | Promise<boolean>): () => void;
  /** The topmost modal, or `null`. */
  topmostModal(): OverlayInstance | null;
  /**
   * Ask the user whether to discard unsaved changes, as a modal on top of the stack. Resolves
   * `false` when nothing can render the question — so a dirty close with no `<ndd-modals>`
   * mounted refuses instead of discarding. Every close path in the library routes through it.
   */
  confirmDiscard: ConfirmDiscard;
  /** Register the renderer for that question. Called by `<ndd-modals>` on init. @internal */
  setConfirmRenderer(renderer: ConfirmRenderer | null): void;
  /** @internal */
  dispose(): void;
}

export function createOverlays(): Overlays {
  const state = signal<OverlayState>({ leftPanel: null, rightPanel: null, modals: [] });
  const read = () => untracked(state);
  const guards = new Map<string, () => boolean | Promise<boolean>>();
  const closedWaiters = new Map<string, ((result: unknown) => void)[]>();
  /** Every removal path ends here, so a waiter can never be left hanging. */
  const settle = (id: string, result?: unknown) => {
    const waiters = closedWaiters.get(id);
    closedWaiters.delete(id);
    waiters?.forEach(resolve => resolve(result));
  };
  let confirmRenderer: ConfirmRenderer | null = null;
  // Per instance, not module-level: two workspaces must not share anything (vdd ADR 0004).
  let counter = 0;
  const nextId = (kind: OverlayKind) => `ndd-${kind}-${++counter}`;

  const instances = (s: OverlayState): OverlayInstance[] =>
    [s.leftPanel, s.rightPanel, ...s.modals].filter((i): i is OverlayInstance => i !== null);
  const getInstance = (id: string) => instances(read()).find(i => i.id === id);

  const make = (
    kind: OverlayKind,
    component: Type<unknown>,
    inputs: Record<string, unknown>,
    options: SidePanelOptions & ModalOptions,
  ): OverlayInstance => ({ id: nextId(kind), component, inputs, kind, options, dirty: false });

  /** A drawer holds one panel, so opening asks the occupant's guard before evicting it. */
  async function openDrawer(
    slot: 'leftPanel' | 'rightPanel',
    kind: OverlayKind,
    component: Type<unknown>,
    inputs: Record<string, unknown> = {},
    options: SidePanelOptions = {},
  ): Promise<string | null> {
    const current = read()[slot];
    if (current) {
      const guard = guards.get(current.id);
      if (guard && !(await guard())) return null;
      // The occupant's dirty state is deliberately *not* consulted: the caller is replacing the
      // panel, and a guard is the documented way to object.
      guards.delete(current.id);
    }
    const instance = make(kind, component, inputs, options);
    state.update(s => ({ ...s, [slot]: instance }));
    if (current) settle(current.id);
    return instance.id;
  }

  function close(id: string, result?: unknown): void {
    guards.delete(id);
    state.update(s => {
      if (s.leftPanel?.id === id) return { ...s, leftPanel: null };
      if (s.rightPanel?.id === id) return { ...s, rightPanel: null };
      if (!s.modals.some(m => m.id === id)) return s;
      return { ...s, modals: s.modals.filter(m => m.id !== id) };
    });
    settle(id, result);
  }

  function updateInstance(
    id: string,
    updates: Partial<Pick<OverlayInstance, 'inputs' | 'options' | 'dirty' | 'dirtyOptions'>>,
  ): void {
    state.update(s => {
      if (s.leftPanel?.id === id) return { ...s, leftPanel: { ...s.leftPanel, ...updates } };
      if (s.rightPanel?.id === id) return { ...s, rightPanel: { ...s.rightPanel, ...updates } };
      if (!s.modals.some(m => m.id === id)) return s;
      return { ...s, modals: s.modals.map(m => (m.id === id ? { ...m, ...updates } : m)) };
    });
  }

  async function requestClose(
    id: string,
    options?: { force?: boolean; confirm?: (instance: OverlayInstance) => Promise<boolean> },
  ): Promise<void> {
    if (options?.force) {
      close(id);
      return;
    }
    const guard = guards.get(id);
    if (guard && !(await guard())) return;
    const instance = getInstance(id);
    if (instance?.dirty) {
      if (!options?.confirm) return; // no way to ask: refuse rather than discard
      if (!(await options.confirm(instance))) return;
    }
    close(id);
  }

  return {
    state: state.asReadonly(),
    openLeftPanel: (c, i, o) => openDrawer('leftPanel', 'left-panel', c, i, o),
    openRightPanel: (c, i, o) => openDrawer('rightPanel', 'right-panel', c, i, o),
    openModal: (component, inputs = {}, options = {}) => {
      const instance = make('modal', component, inputs, options);
      state.update(s => ({ ...s, modals: [...s.modals, instance] }));
      return instance.id;
    },
    close,
    whenClosed: id =>
      getInstance(id)
        ? new Promise<unknown>(resolve => closedWaiters.set(id, [...(closedWaiters.get(id) ?? []), resolve]))
        : Promise.resolve(undefined),
    closeAll: () => {
      const ids = instances(read()).map(i => i.id);
      guards.clear();
      state.set({ leftPanel: null, rightPanel: null, modals: [] });
      ids.forEach(id => settle(id));
    },
    closeAllModals: () => {
      const ids = read().modals.map(m => m.id);
      for (const id of ids) guards.delete(id);
      state.update(s => ({ ...s, modals: [] }));
      ids.forEach(id => settle(id));
    },
    getInstance,
    updateInstance,
    setDirty: (id, dirty, options) => updateInstance(id, { dirty, dirtyOptions: options }),
    requestClose,
    registerCloseGuard: (id, guard) => {
      guards.set(id, guard);
      return () => {
        if (guards.get(id) === guard) guards.delete(id);
      };
    },
    topmostModal: () => read().modals[read().modals.length - 1] ?? null,
    confirmDiscard: request => confirmRenderer?.(request) ?? Promise.resolve(false),
    setConfirmRenderer: renderer => {
      confirmRenderer = renderer;
    },
    dispose: () => {
      guards.clear();
      [...closedWaiters.keys()].forEach(id => settle(id));
      confirmRenderer = null;
    },
  };
}
