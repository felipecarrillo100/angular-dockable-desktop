/**
 * The toast queue and the `toast` function.
 *
 * rdd routed every `toast.*` call through an event emitter that `<ToastContainer>` subscribed
 * to, because React state cannot live at module scope. A signal can, so here the queue *is*
 * state: `toast()` pushes, `<ndd-toasts>` renders. Two containers mounted at once show the same
 * toasts instead of racing for a subscription, and a test can assert the store directly.
 *
 * `maxVisible` follows from that too: every toast goes in one list and the container renders a
 * slice of it, so promotion is not code at all. Ported from vdd `src/core/toast.ts`; records are
 * replaced, never mutated, so a `computed()` over the queue always sees the change.
 *
 * `NddToaster` is the same API as an injectable, for code that prefers `inject()` or wants to
 * substitute it in a test.
 */
import { Injectable, signal, untracked } from '@angular/core';
import type { Type } from '@angular/core';
import type { NddIcon } from '../core/icon';

export type ToastType = 'info' | 'success' | 'warning' | 'error';
export type ToastPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Per-toast options. Anything omitted falls back to the `<ndd-toasts>` defaults. */
export interface ToastOptions {
  /** @default 'info' — set for you by the `toast.info`/`success`/… shorthands. */
  type?: ToastType;
  /** Auto-dismiss delay in ms. `0` never auto-dismisses. @default from the container */
  duration?: number;
  /** Supply to deduplicate: calling again with the same id updates that toast in place. */
  id?: string;
  /** @default from the container */
  closable?: boolean;
  /** Replaces the built-in type icon. */
  icon?: NddIcon;
  /** Replaces the message string with a component. */
  content?: Type<unknown>;
  /** Inputs for `content`. */
  contentInputs?: Record<string, unknown>;
  /** Called on dismissal by timer, close button or `toast.dismiss()`. */
  onClose?: () => void;
}

/** A toast's options with every default filled in. What an adapter receives. */
export interface ResolvedToastOptions extends Required<Pick<ToastOptions, 'id' | 'type' | 'duration' | 'closable'>> {
  icon?: NddIcon;
  content?: Type<unknown>;
  contentInputs?: Record<string, unknown>;
  onClose?: () => void;
}

/** One toast in the store. */
export interface ToastRecord {
  readonly id: string;
  readonly message: string;
  readonly options: ToastOptions & { id: string };
  /** Set while the exit transition runs; an exiting toast no longer counts as visible. */
  readonly exiting: boolean;
  /** Bumped whenever the toast is updated, so its timer restarts. */
  readonly revision: number;
}

/** Messages for `toast.promise()`. The settled forms may be functions of the value. */
export interface ToastPromiseMessages<T> {
  pending: string;
  success: string | ((result: T) => string);
  error: string | ((error: unknown) => string);
}

/**
 * Hand every `toast.*` call to another notification library instead.
 *
 * `component` is rendered by `<ndd-toasts>` in place of the built-in list; `null` means the
 * adapter owns its own DOM and `<ndd-toasts>` renders nothing at all.
 */
export interface ToastAdapter {
  show(id: string, message: string, options: ResolvedToastOptions): void;
  update(id: string, message: string, patch: Partial<ResolvedToastOptions>): void;
  /** With no id, dismiss everything. */
  dismiss(id?: string): void;
  component: Type<unknown> | null;
}

const items = signal<readonly ToastRecord[]>([]);
let adapter: ToastAdapter | null = null;
let counter = 0;

/** The live queue. Exported for `<ndd-toasts>` and for tests; applications use `toast`. */
export const toastQueue = {
  items: items.asReadonly(),
  get adapter(): ToastAdapter | null {
    return adapter;
  },
  set adapter(next: ToastAdapter | null) {
    adapter = next;
  },
};

/**
 * The queue as an action reads it: untracked, so `toast()` called from an effect never makes that
 * effect depend on the queue it is about to change (ADR 0013).
 */
const current = () => untracked(items);

const patch = (id: string, fn: (t: ToastRecord) => ToastRecord) => items.update(list => list.map(t => (t.id === id ? fn(t) : t)));

function show(message: string, options: ToastOptions = {}): string {
  const id = options.id ?? `ndd-toast-${++counter}`;
  const resolved = { ...options, id };
  if (current().some(t => t.id === id)) {
    // Dedup: update in place rather than stacking a second copy. Also the path
    // `toast.promise()` takes when the promise settles.
    patch(id, t => ({ ...t, message, options: { ...t.options, ...resolved }, exiting: false, revision: t.revision + 1 }));
    adapter?.update(id, message, resolved as Partial<ResolvedToastOptions>);
    return id;
  }
  items.update(list => [...list, { id, message, options: resolved, exiting: false, revision: 0 }]);
  // An adapter owns rendering, so it is told about a new toast too — with the defaults filled in,
  // since there is no container to supply them (N16; vdd queued a new toast and never told the
  // adapter, so an adapter only ever saw updates and dismissals).
  adapter?.show(id, message, { type: 'info', duration: 5000, closable: true, ...resolved });
  return id;
}

/** Begin the exit transition. `<ndd-toasts>` removes the record when it finishes. */
export function startExit(id: string): void {
  const item = current().find(t => t.id === id);
  if (!item || item.exiting) return;
  patch(id, t => ({ ...t, exiting: true }));
  item.options.onClose?.();
}

/** Drop a record outright — once its exit transition has ended. */
export function removeToast(id: string): void {
  items.update(list => list.filter(t => t.id !== id));
}

/**
 * Dismiss one toast, or all of them. This only *marks*: the exit transition and the record's
 * removal belong to `<ndd-toasts>`, the only thing that knows whether a toast is on screen or
 * still queued behind `maxVisible` — a queued toast has nothing to animate away.
 */
function dismiss(id?: string): void {
  if (adapter) return adapter.dismiss(id);
  if (id === undefined) {
    for (const t of current()) startExit(t.id);
    return;
  }
  startExit(id);
}

export interface ToastFunction {
  (message: string, options?: ToastOptions): string;
  info(message: string, options?: ToastOptions): string;
  success(message: string, options?: ToastOptions): string;
  warning(message: string, options?: ToastOptions): string;
  error(message: string, options?: ToastOptions): string;
  /** Dismiss one toast, or all of them when called with no id. */
  dismiss(id?: string): void;
  /**
   * Track a promise: a sticky "pending" toast immediately, updated in place on settlement.
   * Returns the same promise, so it can be dropped into an existing chain.
   */
  promise<T>(promise: Promise<T>, messages: ToastPromiseMessages<T>, options?: ToastOptions): Promise<T>;
}

/**
 * Show a notification, from anywhere — a component, a service, an interceptor, a guard.
 *
 * Mount `<ndd-toasts>` once to render them. Calling with none mounted is not an error: the toast
 * waits in the queue and appears if a container mounts later.
 *
 * ```ts
 * toast.success('Layout saved');
 * toast.error('Upload failed', { duration: 0 });     // sticky
 * await toast.promise(save(), { pending: 'Saving…', success: 'Saved', error: 'Failed' });
 * ```
 */
export const toast: ToastFunction = Object.assign((message: string, options?: ToastOptions) => show(message, options), {
  info: (message: string, options?: ToastOptions) => show(message, { ...options, type: 'info' }),
  success: (message: string, options?: ToastOptions) => show(message, { ...options, type: 'success' }),
  warning: (message: string, options?: ToastOptions) => show(message, { ...options, type: 'warning' }),
  error: (message: string, options?: ToastOptions) => show(message, { ...options, type: 'error' }),
  dismiss,
  promise<T>(promise: Promise<T>, messages: ToastPromiseMessages<T>, options?: ToastOptions): Promise<T> {
    const id = show(messages.pending, { ...options, type: 'info', duration: 0 });
    promise.then(
      result => {
        const text = typeof messages.success === 'function' ? messages.success(result) : messages.success;
        show(text, { ...options, id, type: 'success', duration: options?.duration ?? 5000 });
      },
      (error: unknown) => {
        const text = typeof messages.error === 'function' ? messages.error(error) : messages.error;
        show(text, { ...options, id, type: 'error', duration: options?.duration ?? 5000 });
      },
    );
    return promise;
  },
});

/** Empty the queue with no animation. For tests and for a full application teardown. */
export function resetToasts(): void {
  items.set([]);
  adapter = null;
}

/** `toast` as an injectable: `inject(NddToaster).success('Saved')`. */
@Injectable({ providedIn: 'root' })
export class NddToaster {
  readonly show = toast;
  readonly info = toast.info;
  readonly success = toast.success;
  readonly warning = toast.warning;
  readonly error = toast.error;
  readonly dismiss = toast.dismiss;
  readonly promise = toast.promise;
  /** The live queue, oldest first. */
  readonly items = items.asReadonly();
}
