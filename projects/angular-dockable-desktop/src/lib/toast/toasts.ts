/**
 * `<ndd-toasts>`, the notification host, and its cards. Mount once, anywhere: the container is
 * portalled to `document.body`, so its place in the tree cannot clip it.
 *
 * `maxVisible` is a `computed()` slice of the one queue, not a second array that has to be
 * shifted from, so a toast leaving the list simply lets the next one into the slice. Ported
 * from vdd `VddToasts.vue`, `VddToastItem.vue` and `VddToastIcon.vue`.
 */
import { NgComponentOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NddIconView } from '../common/icon';
import { NddPortal } from '../common/portal';
import { removeToast, startExit, toastQueue } from './toast';
import type { ToastAdapter, ToastPosition, ToastRecord, ToastType } from './toast';

/** How long the exit may take before the record is dropped anyway. */
const EXIT_FALLBACK_MS = 520;

/** The built-in per-type icon. @internal */
@Component({
  selector: 'ndd-toast-icon',
  host: { style: 'display: contents' },
  template: `
    <svg class="ndd-toast__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      @if (type() === 'warning') {
        <path d="M8 2.5L14 13.5H2L8 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        <path d="M8 7v2.5M8 11.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      } @else {
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
        @switch (type()) {
          @case ('success') {
            <path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          }
          @case ('error') {
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          }
          @default {
            <path d="M8 5v.01M8 7.5v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          }
        }
      }
    </svg>
  `,
})
export class NddToastIcon {
  readonly type = input.required<ToastType>();
}

/**
 * One card: its entry class, its auto-dismiss timer, and its exit.
 *
 * The `max-height` bookkeeping is inherited from rdd, where it was arrived at the hard way. The
 * card is clipped to its own content height so the exit can animate that height to zero. Content
 * that grows *after* mount — `toast.promise()` turning a one-line "Saving…" into a wrapped error
 * — would then be clipped by a stale cap. So a ResizeObserver watches the unconstrained inner
 * body, and reads the card's `scrollHeight`, which reports true content height even through a
 * stale cap. Frozen once exiting starts, where the stylesheet's `max-height: 0` takes over.
 * @internal
 */
@Component({
  selector: 'ndd-toast-item',
  imports: [NddIconView, NddToastIcon, NgComponentOutlet],
  host: { style: 'display: contents' },
  template: `
    <div
      #card
      role="status"
      aria-live="polite"
      class="ndd-toast"
      [class]="'ndd-toast--' + type() + ' ' + entryClass()"
      [class.ndd-toast--exiting]="toast().exiting"
      [class.ndd-toast--paused]="paused()"
      [attr.data-ndd-toast]="toast().id"
      (mouseenter)="onEnter()"
      (mouseleave)="onLeave()"
      (transitionend)="onTransitionEnd($event)"
    >
      @if (toast().options.icon; as icon) {
        <ndd-icon [icon]="icon" />
      } @else {
        <ndd-toast-icon [type]="type()" />
      }
      <div #body class="ndd-toast__body">
        @if (toast().options.content; as content) {
          <ng-container *ngComponentOutlet="content; inputs: toast().options.contentInputs ?? {}" />
        } @else {
          {{ toast().message }}
        }
      </div>
      @if (closable()) {
        <button type="button" class="ndd-toast__close" aria-label="Close notification" data-ndd-toast-close (click)="close()">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      }
      @if (showProgress() && duration() > 0) {
        <div class="ndd-toast__progress" [style.animation-duration.ms]="duration()"></div>
      }
    </div>
  `,
})
export class NddToastItem {
  readonly toast = input.required<ToastRecord>();
  /** A left-hand container slides in from the other side. */
  readonly isLeft = input(false);
  readonly showProgress = input(false);
  readonly pauseOnHover = input(true);
  readonly animation = input<'slide' | 'fade' | 'none'>('slide');
  readonly defaultDuration = input(5000);
  readonly defaultClosable = input(true);
  readonly exited = output<string>();

  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');

  protected readonly type = computed<ToastType>(() => this.toast().options.type ?? 'info');
  protected readonly duration = computed(() => this.toast().options.duration ?? this.defaultDuration());
  protected readonly closable = computed(() => this.toast().options.closable ?? this.defaultClosable());
  protected readonly paused = signal(false);
  protected readonly entryClass = signal('');
  /** Narrowed, so replacing the record for an unrelated change does not restart the timer. */
  private readonly revision = computed(() => this.toast().revision);
  private readonly exiting = computed(() => this.toast().exiting);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = 0;
  private startedAt = 0;
  private exitFallback: ReturnType<typeof setTimeout> | null = null;
  private exitReported = false;
  private observer: ResizeObserver | null = null;

  constructor() {
    // Entry: start in the entering state, then flip to visible on the next frame so it animates.
    effect(() => {
      const animation = this.animation();
      const isLeft = this.isLeft();
      untracked(() => {
        if (this.entryClass()) return;
        this.entryClass.set(
          animation === 'none' ? 'ndd-toast--visible' : animation === 'fade' ? 'ndd-toast--fade-entering' : isLeft ? 'ndd-toast--entering-left' : 'ndd-toast--entering',
        );
      });
    });

    // The timer restarts whenever the duration or the record's revision changes, as rdd's did.
    effect(() => {
      const duration = this.duration();
      this.revision();
      untracked(() => {
        if (this.exiting()) return;
        this.clear();
        this.remaining = duration;
        this.schedule(duration);
      });
    });

    // Exit: stop the timer, freeze the height, and report once the transition has run — or
    // after a floor, since a transition that never runs (a hidden tab, reduced motion, a test)
    // would otherwise strand the record.
    effect(() => {
      if (!this.exiting()) return;
      untracked(() => {
        this.clear();
        this.observer?.disconnect();
        this.observer = null;
        if (this.animation() === 'none') return this.reportExit();
        this.exitFallback ??= setTimeout(() => this.reportExit(), EXIT_FALLBACK_MS);
      });
    });

    afterNextRender(() => {
      this.applyHeight();
      // jsdom has no ResizeObserver; the height sync is a browser refinement, not behaviour.
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => this.applyHeight());
        this.observer.observe(this.body().nativeElement);
      }
      if (this.animation() !== 'none') requestAnimationFrame(() => this.entryClass.set('ndd-toast--visible'));
    });

    inject(DestroyRef).onDestroy(() => {
      this.clear();
      if (this.exitFallback) clearTimeout(this.exitFallback);
      this.observer?.disconnect();
    });
  }

  private schedule(ms: number): void {
    if (ms <= 0) return;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => startExit(this.toast().id), ms);
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private applyHeight(): void {
    const el = this.card().nativeElement;
    if (!this.toast().exiting) el.style.maxHeight = `${el.scrollHeight}px`;
  }

  private reportExit(): void {
    if (this.exitReported) return;
    this.exitReported = true;
    this.exited.emit(this.toast().id);
  }

  protected close(): void {
    startExit(this.toast().id);
  }

  protected onEnter(): void {
    if (!this.pauseOnHover() || this.duration() === 0 || !this.timer) return;
    this.clear();
    this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
    this.paused.set(true);
  }

  protected onLeave(): void {
    if (!this.pauseOnHover() || this.duration() === 0) return;
    this.paused.set(false);
    this.schedule(this.remaining);
  }

  protected onTransitionEnd(event: TransitionEvent): void {
    if (this.toast().exiting && event.propertyName === 'max-height') this.reportExit();
  }
}

/** The notification host. */
@Component({
  selector: 'ndd-toasts',
  imports: [NddPortal, NddToastItem, NgComponentOutlet],
  host: { style: 'display: contents' },
  template: `
    @if (adapter(); as a) {
      @if (a.component) {
        <div nddPortal style="display: contents"><ng-container *ngComponentOutlet="a.component; inputs: { position: position() }" /></div>
      }
    } @else {
      <div
        nddPortal
        class="ndd-toast-container"
        [class]="'ndd-toast-container--' + position() + (newestOnTop() ? ' ndd-toast-container--newest-top' : ' ndd-toast-container--newest-bottom')"
        [style.width.px]="width()"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        data-ndd-toasts
      >
        @for (item of visible(); track item.id) {
          <ndd-toast-item
            [toast]="item"
            [isLeft]="isLeft()"
            [showProgress]="progressBar()"
            [pauseOnHover]="pauseOnHover()"
            [animation]="animation()"
            [defaultDuration]="defaultDuration()"
            [defaultClosable]="defaultClosable()"
            (exited)="remove($event)"
          />
        }
      </div>
    }
  `,
})
export class NddToasts {
  readonly position = input<ToastPosition>('top-right');
  /** How many show at once. The rest wait. */
  readonly maxVisible = input(3);
  /** Auto-dismiss delay in ms; `0` makes every toast sticky. */
  readonly defaultDuration = input(5000);
  readonly defaultClosable = input(true);
  /** Hold the timer while the pointer is over a toast. */
  readonly pauseOnHover = input(true);
  readonly animation = input<'slide' | 'fade' | 'none'>('slide');
  /** Put the newest toast at the top of the stack. */
  readonly newestOnTop = input(false);
  /** A countdown bar along the bottom of each toast. */
  readonly progressBar = input(false);
  /** Card width in pixels. */
  readonly width = input(320);
  /** Hand every `toast.*` call to another library instead. */
  readonly adapter = input<ToastAdapter | undefined>(undefined);

  protected readonly isLeft = computed(() => this.position().endsWith('left'));

  /**
   * What is on screen: the oldest `maxVisible` toasts, with the ones still animating out kept
   * in place so they can finish rather than being yanked as the next one arrives.
   */
  protected readonly visible = computed(() => {
    const result: ToastRecord[] = [];
    let shown = 0;
    for (const item of toastQueue.items()) {
      if (item.exiting) {
        result.push(item);
        continue;
      }
      if (shown >= this.maxVisible()) break;
      result.push(item);
      shown++;
    }
    return this.newestOnTop() ? result.reverse() : result;
  });

  constructor() {
    // An adapter is registered on the store, so `toast.*` reaches it even from outside any component.
    effect(() => {
      const adapter = this.adapter();
      untracked(() => (toastQueue.adapter = adapter ?? null));
    });
    inject(DestroyRef).onDestroy(() => {
      if (toastQueue.adapter === this.adapter()) toastQueue.adapter = null;
    });

    // A toast dismissed while still queued was never rendered, so nothing will report its exit.
    // Drop it here — this is the only thing that knows whether a toast was on screen at all.
    effect(() => {
      const onScreen = new Set(this.visible().map(t => t.id));
      for (const item of toastQueue.items()) if (item.exiting && !onScreen.has(item.id)) untracked(() => removeToast(item.id));
    });
  }

  protected remove(id: string): void {
    removeToast(id);
  }
}
