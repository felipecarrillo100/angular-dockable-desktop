/**
 * The `toast` function and `<ndd-toasts>`.
 *
 * Ported from vue-dockable-desktop `test/components/toast.test.ts` (16 tests, T1–T13, names
 * preserved, `vdd-` → `ndd-`), itself a port of rdd's `Toast.test.tsx`. As in vdd, the queue *is*
 * state — a signal at module scope — so there is nothing to emit: T1 asserts a toast raised with
 * no container is *kept*, and T10's promotion is a `computed()` slice moving. `toastQueue.items`
 * is a signal here, so it is read as `toastQueue.items()`.
 *
 * Fake-timer tests switch to fake timers after the container's first render (Angular's zoneless
 * scheduler uses timers itself) and then drive change detection with `detectChanges()`.
 */
import { Component, effect, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { NddToasts } from '../../src/lib/toast/toasts';
import { NddToaster, resetToasts, toast, toastQueue } from '../../src/lib/toast/toast';
import type { ToastAdapter } from '../../src/lib/toast/toast';

let fixture: ComponentFixture<NddToasts> | null = null;

async function mountContainer(props: Record<string, unknown> = {}): Promise<ComponentFixture<NddToasts>> {
  fixture = TestBed.createComponent(NddToasts);
  for (const [key, value] of Object.entries(props)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  return fixture;
}

afterEach(() => {
  fixture?.destroy();
  fixture = null;
  resetToasts();
  document.querySelectorAll('[data-ndd-toasts]').forEach(el => el.remove());
  vi.clearAllTimers();
  vi.useRealTimers();
});

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.ndd-toast'));
const host = () => document.querySelector('[data-ndd-toasts]');
const settle = async () => {
  await fixture?.whenStable();
  await fixture?.whenStable();
};
/** Under fake timers: change detection by hand. */
const render = () => fixture!.detectChanges();

// ─── T1 ──────────────────────────────────────────────────────────────────────

describe('T1: toast.* without a mounted container', () => {
  it('does not throw when no container is mounted, and keeps the notification queued', () => {
    expect(() => {
      toast.info('no container');
      toast.success('ok');
      toast.warning('warn');
      toast.error('err');
    }).not.toThrow();
    // rdd's emitter had no subscriber, so these four calls went nowhere. The queue is state
    // here, so they are still pending — a container mounted later shows them.
    expect(toastQueue.items()).toHaveLength(4);
    expect(() => toast.dismiss()).not.toThrow();
  });
});

// ─── T2 ──────────────────────────────────────────────────────────────────────

describe('T2: the container renders a toast', () => {
  it('adds .ndd-toast--info to the document', async () => {
    await mountContainer();
    toast.info('hello');
    await settle();
    expect(document.querySelector('.ndd-toast--info')).not.toBeNull();
    // Portalled to the body, so the container's own place in the tree cannot clip it.
    expect(host()!.parentElement).toBe(document.body);
  });
});

// ─── T3 ──────────────────────────────────────────────────────────────────────

describe('T3: toast type modifier classes', () => {
  it('toast.success adds .ndd-toast--success', async () => {
    await mountContainer();
    toast.success('yes');
    await settle();
    expect(document.querySelector('.ndd-toast--success')).not.toBeNull();
  });

  it('toast.warning adds .ndd-toast--warning', async () => {
    await mountContainer();
    toast.warning('careful');
    await settle();
    expect(document.querySelector('.ndd-toast--warning')).not.toBeNull();
  });

  it('toast.error adds .ndd-toast--error', async () => {
    await mountContainer();
    toast.error('broken');
    await settle();
    expect(document.querySelector('.ndd-toast--error')).not.toBeNull();
  });
});

// ─── T4 ──────────────────────────────────────────────────────────────────────

describe('T4: toast message text', () => {
  it('renders the supplied message string inside .ndd-toast__body', async () => {
    await mountContainer();
    toast.info('Layout saved');
    await settle();
    expect(document.querySelector('.ndd-toast__body')!.textContent).toContain('Layout saved');
  });
});

// ─── T5 ──────────────────────────────────────────────────────────────────────

describe('T5: the close button dismisses', () => {
  it('clicking .ndd-toast__close removes the toast (starts exit)', async () => {
    await mountContainer({ defaultDuration: 0, animation: 'none' });
    toast.info('closable');
    await settle();
    expect(cards()).toHaveLength(1);

    document.querySelector<HTMLButtonElement>('.ndd-toast__close')!.click();
    await settle();
    expect(cards()).toHaveLength(0);
    expect(toastQueue.items()).toHaveLength(0);
  });
});

// ─── T6 ──────────────────────────────────────────────────────────────────────

describe('T6: toast.dismiss(id) — targeted', () => {
  it('removes only the toast with the specified id', async () => {
    await mountContainer({ defaultDuration: 0, animation: 'none' });
    toast.info('one', { id: 'a' });
    toast.info('two', { id: 'b' });
    await settle();
    expect(cards()).toHaveLength(2);

    toast.dismiss('a');
    await settle();
    expect(cards()).toHaveLength(1);
    expect(host()!.textContent).toContain('two');
    expect(host()!.textContent).not.toContain('one');
  });
});

// ─── T7 ──────────────────────────────────────────────────────────────────────

describe('T7: toast.dismiss() — dismiss all', () => {
  it('removes all active toasts', async () => {
    await mountContainer({ defaultDuration: 0, animation: 'none' });
    toast.info('one');
    toast.success('two');
    toast.error('three');
    await settle();
    expect(cards()).toHaveLength(3);

    toast.dismiss();
    await settle();
    expect(cards()).toHaveLength(0);
  });
});

// ─── T8 ──────────────────────────────────────────────────────────────────────

describe('T8: sticky toast (duration=0)', () => {
  it('does not auto-dismiss after time passes', async () => {
    await mountContainer();
    vi.useFakeTimers();
    toast.error('Sticky error', { duration: 0 });
    render();
    vi.advanceTimersByTime(10_000);
    render();
    expect(document.querySelector('.ndd-toast')).not.toBeNull();
  });
});

// ─── T9 ──────────────────────────────────────────────────────────────────────

describe('T9: auto-dismiss after the default duration', () => {
  it('removes the toast from the DOM after the configured duration plus the exit animation', async () => {
    await mountContainer({ defaultDuration: 50 });
    vi.useFakeTimers();
    toast.info('auto');
    render();
    expect(document.querySelector('.ndd-toast')).not.toBeNull();

    vi.advanceTimersByTime(51); // the auto-dismiss timer
    render();
    vi.advanceTimersByTime(521); // the exit fallback, since jsdom runs no transitions
    render();

    expect(document.querySelector('.ndd-toast')).toBeNull();
  });
});

// ─── T10 ─────────────────────────────────────────────────────────────────────

describe('T10: the maxVisible queue', () => {
  it('queues the 3rd toast and promotes it when the 1st exits', async () => {
    // rdd kept the overflow in a second array and shifted from it when a toast finished
    // exiting. Here all three are in one queue and the container renders a slice, so
    // "promotion" is just the slice moving — which is why nothing needs to be triggered.
    await mountContainer({ maxVisible: 2, defaultDuration: 0, animation: 'none' });
    toast.info('first');
    toast.info('second');
    toast.info('third');
    await settle();

    expect(toastQueue.items()).toHaveLength(3);
    expect(cards()).toHaveLength(2);
    expect(host()!.textContent).not.toContain('third');

    document.querySelector<HTMLButtonElement>('.ndd-toast__close')!.click();
    await settle();

    expect(cards()).toHaveLength(2);
    expect(host()!.textContent).toContain('third');
    expect(host()!.textContent).not.toContain('first');
  });
});

// ─── T11 ─────────────────────────────────────────────────────────────────────

describe('T11: toast.promise()', () => {
  it('shows pending text immediately, then updates to success on resolve', async () => {
    await mountContainer();
    let resolve!: (value: string) => void;
    const promise = new Promise<string>(res => {
      resolve = res;
    });

    void toast.promise(promise, { pending: 'Saving…', success: r => `Saved: ${r}`, error: 'Failed' });
    await settle();
    expect(document.querySelector('.ndd-toast')!.textContent).toContain('Saving…');
    expect(document.querySelector('.ndd-toast--info')).not.toBeNull();

    resolve('file.txt');
    await promise;
    await settle();

    expect(document.querySelector('.ndd-toast--success')).not.toBeNull();
    expect(document.querySelector('.ndd-toast')!.textContent).toContain('Saved: file.txt');
    // Updated in place, not stacked.
    expect(cards()).toHaveLength(1);
  });

  it('shows the error message when the promise rejects', async () => {
    await mountContainer();
    const promise = Promise.reject(new Error('network error'));
    promise.catch(() => {
      /* asserted through the toast */
    });

    void toast.promise(promise, { pending: 'Loading…', success: 'Done', error: e => `Error: ${(e as Error).message}` }).catch(() => {});
    await settle();
    try {
      await promise;
    } catch {
      /* expected */
    }
    await settle();

    expect(document.querySelector('.ndd-toast--error')).not.toBeNull();
    expect(document.querySelector('.ndd-toast')!.textContent).toContain('Error: network error');
  });
});

// ─── T12 ─────────────────────────────────────────────────────────────────────

describe('T12: dedup by id', () => {
  it('re-calling toast.info with the same id updates in place, not duplicating', async () => {
    await mountContainer();
    toast.info('Original message', { id: 'dedup-1', duration: 0 });
    await settle();
    expect(cards()).toHaveLength(1);
    expect(document.querySelector('.ndd-toast__body')!.textContent).toContain('Original message');

    toast.success('Updated message', { id: 'dedup-1', duration: 0 });
    await settle();
    expect(cards()).toHaveLength(1);
    expect(document.querySelector('.ndd-toast__body')!.textContent).toContain('Updated message');
    expect(document.querySelector('.ndd-toast--success')).not.toBeNull();
  });
});

// ─── T13 ─────────────────────────────────────────────────────────────────────

describe('T13: max-height re-syncs when content grows after mount', () => {
  it('updates max-height to the new, taller content height instead of staying locked at the first-render value', async () => {
    // The real bug: toast.promise() swapping a one-line "pending" for a wrapped error, with
    // the card still clipped to the height it had at mount. The observer watches the
    // unconstrained inner body as a trigger and reads the card's scrollHeight, the only
    // measurement that reports true content height through a stale cap.
    let trigger: (() => void) | null = null;
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        trigger = cb;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;

    try {
      await mountContainer();
      toast.info('Working…', { id: 'grow-1', duration: 0 });
      await settle();

      const card = document.querySelector('.ndd-toast') as HTMLElement;
      Object.defineProperty(card, 'scrollHeight', { configurable: true, value: 60 });
      trigger!();
      expect(card.style.maxHeight).toBe('60px');

      toast.error('This is a considerably longer error message that wraps onto more than one line.', { id: 'grow-1' });
      await settle();
      Object.defineProperty(card, 'scrollHeight', { configurable: true, value: 140 });

      // Without the re-measure, this stays at 60px and the wrapped text is clipped by
      // .ndd-toast's overflow: hidden.
      trigger!();
      expect(card.style.maxHeight).toBe('140px');
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});

// ─── Angular additions ───────────────────────────────────────────────────────

@Component({ selector: 'ndd-test-adapter-view', template: '<div data-adapter-view>adapter</div>' })
class AdapterView {}

describe('Toasts: Angular additions', () => {
  it('NddToaster is the same queue through inject()', async () => {
    await mountContainer({ animation: 'none', defaultDuration: 0 });
    const toaster = TestBed.inject(NddToaster);
    const id = toaster.warning('from a service');
    await settle();
    expect(toaster.items().map(t => t.id)).toEqual([id]);
    expect(document.querySelector('.ndd-toast--warning')!.textContent).toContain('from a service');
    toaster.dismiss(id);
    await settle();
    expect(cards()).toHaveLength(0);
  });

  it('an adapter receives every call, and its component replaces the built-in list', async () => {
    const seen: string[] = [];
    const adapter: ToastAdapter = {
      show: (id, message, options) => seen.push(`show:${id}:${message}:${options.type}:${options.duration}:${options.closable}`),
      update: (id, message) => seen.push(`update:${id}:${message}`),
      dismiss: id => seen.push(`dismiss:${id ?? '*'}`),
      component: AdapterView,
    };
    await mountContainer({ adapter });
    expect(document.querySelector('[data-adapter-view]')).not.toBeNull();
    expect(host()).toBeNull();
    toast.info('a', { id: 'x' });
    toast.info('b', { id: 'x' });
    toast.dismiss();
    // Every call: the first `toast()` is a show (defaults filled in), the second an update.
    expect(seen).toEqual(['show:x:a:info:5000:true', 'update:x:b', 'dismiss:*']);
    fixture!.destroy();
    fixture = null;
    expect(toastQueue.adapter).toBeNull();
  });

  it('pausing on hover holds the timer, and leaving resumes it with the time that was left', async () => {
    await mountContainer({ defaultDuration: 100 });
    vi.useFakeTimers();
    toast.info('hover me');
    render();
    vi.advanceTimersByTime(60);
    const card = document.querySelector('.ndd-toast')!;
    card.dispatchEvent(new MouseEvent('mouseenter'));
    render();
    expect(card.classList).toContain('ndd-toast--paused');
    vi.advanceTimersByTime(1000);
    render();
    expect(toastQueue.items()[0]!.exiting).toBe(false);
    card.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(39);
    expect(toastQueue.items()[0]!.exiting).toBe(false);
    vi.advanceTimersByTime(2);
    expect(toastQueue.items()[0]!.exiting).toBe(true);
  });

  it('two containers mounted at once show the same toasts', async () => {
    @Component({ selector: 'ndd-test-two', imports: [NddToasts], template: '<ndd-toasts position="top-left" /><ndd-toasts position="bottom-right" />' })
    class Two {}
    const two = TestBed.createComponent(Two);
    await two.whenStable();
    toast.success('everywhere');
    await two.whenStable();
    expect(document.querySelectorAll('[data-ndd-toasts]')).toHaveLength(2);
    expect(Array.from(document.querySelectorAll('[data-ndd-toasts]')).every(h => h.textContent?.includes('everywhere'))).toBe(true);
    two.destroy();
  });
});

describe('toast called from an effect (ADR 0013)', () => {
  it('a deduplicated toast driven by a signal updates once per change, not forever', async () => {
    const count = signal(0);
    let runs = 0;
    @Component({ selector: 'ndd-test-toast-effect', template: '' })
    class Driver {
      constructor() {
        effect(() => {
          // Bounded, so a regression fails this test instead of hanging the suite.
          if (++runs > 20) return;
          toast.info(`Saved ${count()} item(s)`, { id: 'saved' });
        });
      }
    }
    const driver = TestBed.createComponent(Driver);
    await driver.whenStable();
    expect(runs).toBe(1);
    count.set(2);
    await driver.whenStable();
    expect(runs).toBe(2);
    const queued = toastQueue.items();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.message).toBe('Saved 2 item(s)');
    driver.destroy();
  });
});
