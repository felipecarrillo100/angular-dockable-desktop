/**
 * What a rendered side panel or modal shares: the close sequence with its unsaved-changes
 * question, the title with its dirty asterisk, Escape routing, and the panel contract the
 * content gets through `injectPanel()`.
 *
 * rdd's `SidePanelRenderer` and `ModalStackRenderer` each carried a copy of this, thirty-five
 * lines of it identical — which is how two containers come to disagree about what closing a
 * dirty panel does. Here the two hosts differ only in their chrome. Ported from vdd
 * `useOverlayHost.ts`, `VddOverlayFrame.vue`, `VddModalHost.vue` and `VddSidePanelHost.vue`.
 * @internal
 */
import { DOCUMENT } from '@angular/common';
import { NgComponentOutlet } from '@angular/common';
import { Component, DestroyRef, InjectionToken, Injector, computed, inject, input, output, reflectComponentType, signal } from '@angular/core';
import type { Signal, StaticProvider } from '@angular/core';
import type { NddIcon } from '../core/icon';
import type { OverlayInstance } from '../core/overlays';
import type { ContainerType } from '../core/types';
import { NddIconView } from '../common/icon';
import { PANEL_CONTEXT } from '../panel/panel-ref';
import type { PanelContext } from '../panel/panel-ref';
import { Workspace } from '../workspace/workspace';

/** What `injectModalRef()` returns inside a modal: close it, with a result. */
export interface NddModalRef<R = unknown> {
  /** The overlay instance id. */
  readonly id: string;
  /** Close now, handing `result` to `afterClosed()`. Skips guards and the dirty check, like closing from inside. */
  close(result?: R): void;
  /** Close as the × would: through the close guard and the unsaved-changes question. */
  requestClose(): Promise<void>;
  /** Resolves when the modal is gone: with the `close(result)` value, or `undefined` for any other way out. */
  afterClosed(): Promise<R | undefined>;
}

/** @internal */
export const MODAL_REF = new InjectionToken<NddModalRef>('ndd.ModalRef');

/** @internal */
export function modalRef<R>(workspace: Workspace<never>, id: string): NddModalRef<R> {
  const overlays = workspace.overlays;
  return {
    id,
    close: result => overlays.close(id, result),
    requestClose: () => requestOverlayClose(workspace, id),
    afterClosed: () => overlays.whenClosed(id) as Promise<R | undefined>,
  };
}

/**
 * Close through the guard and the dirty check, asking the same unsaved-changes question a
 * docked panel does — `<ndd-modals>` owns the one implementation, so a drawer and a tab cannot
 * answer differently. The question is itself a modal, so it stacks on whatever is closing.
 */
export function requestOverlayClose(workspace: Workspace<never>, id: string, options?: { force?: boolean }): Promise<void> {
  const overlays = workspace.overlays;
  return overlays.requestClose(id, {
    ...options,
    confirm: target => overlays.confirmDiscard({ title: workspace.format(target.options.title ?? ''), dirtyOptions: target.dirtyOptions }),
  });
}

/**
 * The per-instance state both hosts need. Call in an injection context; the Escape listener is
 * removed with the calling component.
 */
function createOverlayHost(instance: Signal<OverlayInstance>) {
  const workspace = inject(Workspace) as Workspace<never>;
  const overlays = workspace.overlays;
  const doc = inject(DOCUMENT);
  const parent = inject(Injector);
  /** Set from inside via `injectPanel().setIcon()`; falls back to the open-time icon. */
  const liveIcon = signal<NddIcon | null>(null);

  const dismissible = computed(() => (instance().kind === 'modal' ? instance().options.closable !== false : true));
  const close = (options?: { force?: boolean }) => requestOverlayClose(workspace, instance().id, options);

  /**
   * Escape belongs to the topmost modal, and reaches a drawer only when no modal is open. The
   * modal that answers marks the event handled, so a drawer listening on the same document
   * cannot also close — even when the modal's close is synchronous and the stack is already
   * empty by the time the drawer's listener runs.
   */
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !dismissible()) return;
    const self = instance();
    if (self.kind === 'modal') {
      if (overlays.topmostModal()?.id !== self.id) return;
    } else if (overlays.state().modals.length > 0) {
      return;
    }
    event.preventDefault();
    void close();
  };
  doc.addEventListener('keydown', onKeydown);
  inject(DestroyRef).onDestroy(() => doc.removeEventListener('keydown', onKeydown));

  // The content gets the same `injectPanel()` contract a docked panel gets, so one component can
  // be opened as a tab, a floating window, a drawer or a modal without knowing which. Everything
  // here reads `instance()` lazily: inputs are not set yet while the host is being constructed,
  // and the content — the only reader — is created after they are.
  const context: PanelContext = {
    get id() {
      return instance().id;
    },
    containerType: computed(() => instance().kind as ContainerType),
    close,
    setTitle: title => overlays.updateInstance(instance().id, { options: { ...instance().options, title } }),
    setIcon: icon => liveIcon.set(icon ?? null),
    setDirty: (dirty, dirtyOptions) => overlays.setDirty(instance().id, dirty, dirtyOptions),
  };
  const providers: StaticProvider[] = [
    { provide: PANEL_CONTEXT, useValue: context },
    { provide: MODAL_REF, useFactory: () => (instance().kind === 'modal' ? modalRef(workspace, instance().id) : null), deps: [] },
  ];
  const contentInjector = Injector.create({ providers, parent });

  /** Only inputs the component declares, so an extra key is ignored rather than an NG0303 error; `panelId` last, so a caller cannot spoof it. */
  const declared = computed(() => new Set((reflectComponentType(instance().component)?.inputs ?? []).map(i => i.templateName)));
  const contentInputs = computed(() => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(instance().inputs)) if (declared().has(key)) out[key] = value;
    if (declared().has('panelId')) out['panelId'] = instance().id;
    return out;
  });

  return {
    workspace,
    dismissible,
    close,
    contentInjector,
    contentInputs,
    displayTitle: computed(() => {
      const base = workspace.format(instance().options.title ?? '');
      return instance().dirty ? `${base} *` : base;
    }),
    icon: computed(() => liveIcon() ?? instance().options.icon ?? null),
    bodyPadding: computed(() => {
      const value = instance().options.bodyPadding;
      if (value == null) return null;
      return typeof value === 'number' ? `${value}px` : value;
    }),
  };
}

/** Class names picked from a literal map, so a devtools search finds them in the source. */
const MODAL = {
  header: 'ndd-modal-header',
  icon: 'ndd-modal-icon',
  title: 'ndd-modal-title',
  closeButton: 'ndd-modal-close-button',
  body: 'ndd-modal-body',
} as const;
const SIDE_PANEL = {
  header: 'ndd-side-panel-header',
  icon: 'ndd-side-panel-icon',
  title: 'ndd-side-panel-title',
  closeButton: 'ndd-side-panel-close-button',
  body: 'ndd-side-panel-body',
} as const;

/** The header-and-body chrome shared by a side panel and a modal. @internal */
@Component({
  selector: 'ndd-overlay-frame',
  imports: [NddIconView],
  host: { style: 'display: contents' },
  template: `
    <div [class]="c().header">
      @if (icon(); as i) {
        <div [class]="c().icon"><ndd-icon [icon]="i" /></div>
      }
      <h4 [class]="c().title">{{ title() }}</h4>
      @if (closable()) {
        <button
          type="button"
          [class]="c().closeButton"
          [attr.title]="closeLabel()"
          [attr.aria-label]="closeLabel()"
          data-ndd-overlay-close
          (click)="closeRequest.emit()"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      }
    </div>
    <div [class]="bodyClass()" [style.padding]="bodyPadding()"><ng-content /></div>
  `,
})
export class NddOverlayFrame {
  readonly block = input.required<'side-panel' | 'modal'>();
  readonly title = input.required<string>();
  readonly icon = input<NddIcon | null>(null);
  /** `false` hides the close button entirely — a modal opened with `closable: false`. */
  readonly closable = input(true);
  readonly closeLabel = input.required<string>();
  /** Body padding, or `null` to leave it to the stylesheet. */
  readonly bodyPadding = input<string | null>(null);
  readonly closeRequest = output();

  private readonly workspace = inject(Workspace) as Workspace<never>;
  protected readonly c = computed(() => (this.block() === 'modal' ? MODAL : SIDE_PANEL));
  /** Plus the consumer's own class for this body, from `createWorkspace({ classes })`. */
  protected readonly bodyClass = computed(() => {
    const own = this.block() === 'modal' ? this.workspace.classes.modalBody : this.workspace.classes.sidePanelBody;
    return own ? `${this.c().body} ${own}` : this.c().body;
  });
}

/** One rendered modal. @internal */
@Component({
  selector: 'ndd-modal-host',
  imports: [NddOverlayFrame, NgComponentOutlet],
  host: { style: 'display: contents' },
  template: `
    <div
      class="ndd-modal-overlay"
      [style.z-index]="zIndex()"
      [attr.dir]="host.workspace.dir()"
      [attr.data-ndd-modal]="instance().id"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="host.displayTitle()"
    >
      <!-- Clicking the backdrop dismisses, unless the modal was opened with closable: false. It is
           a pointer affordance only: its keyboard equivalents are Escape and the × button, so it
           is hidden from assistive technology rather than made a focus stop of its own. -->
      <div class="ndd-modal-curtain" data-ndd-modal-curtain aria-hidden="true" (click)="host.dismissible() && host.close()"></div>
      <div class="ndd-modal-window" [class]="windowClass()">
        <ndd-overlay-frame
          block="modal"
          [title]="host.displayTitle()"
          [icon]="host.icon()"
          [closable]="host.dismissible()"
          [closeLabel]="host.workspace.format(host.workspace.messages.closeTooltip)"
          [bodyPadding]="host.bodyPadding()"
          (closeRequest)="host.close()"
        >
          <ng-container *ngComponentOutlet="instance().component; inputs: host.contentInputs(); injector: host.contentInjector" />
        </ndd-overlay-frame>
      </div>
    </div>
  `,
})
export class NddModalHost {
  readonly instance = input.required<OverlayInstance>();
  /** Depth in the stack, which is what separates the modals' z-indexes. */
  readonly index = input.required<number>();
  protected readonly host = createOverlayHost(this.instance);
  /** Stacks against `--ndd-z-base`, so `createWorkspace({ zIndexBase })` moves the modals with everything else. */
  protected readonly zIndex = computed(() => `calc(var(--ndd-z-base, 1000) + 9000 + ${this.index() * 10})`);
  protected readonly windowClass = computed(() => {
    const own = this.host.workspace.classes.modal;
    const size = `ndd-modal-size-${this.instance().options.size ?? 'auto'}`;
    return own ? `ndd-modal-window ${size} ${own}` : `ndd-modal-window ${size}`;
  });
}

/** One rendered side panel. @internal */
@Component({
  selector: 'ndd-side-panel-host',
  imports: [NddOverlayFrame, NgComponentOutlet],
  host: { style: 'display: contents' },
  template: `
    <div
      class="ndd-side-panel ndd-side-panel-visible"
      [class.ndd-side-panel-left]="position() === 'left'"
      [class.ndd-side-panel-right]="position() === 'right'"
      [style.width]="width()"
      [attr.dir]="host.workspace.dir()"
      [attr.data-ndd-side-panel]="position()"
      role="complementary"
      [attr.aria-label]="host.displayTitle()"
    >
      <div [class]="windowClass()">
        <ndd-overlay-frame
          block="side-panel"
          [title]="host.displayTitle()"
          [icon]="host.icon()"
          [closeLabel]="host.workspace.format(host.workspace.messages.closeTooltip)"
          [bodyPadding]="host.bodyPadding()"
          (closeRequest)="host.close()"
        >
          <ng-container *ngComponentOutlet="instance().component; inputs: host.contentInputs(); injector: host.contentInjector" />
        </ndd-overlay-frame>
      </div>
    </div>
  `,
})
export class NddSidePanelHost {
  readonly instance = input.required<OverlayInstance>();
  readonly position = input.required<'left' | 'right'>();
  /** Used when the instance did not ask for a width. */
  readonly defaultWidth = input.required<number | string>();
  protected readonly host = createOverlayHost(this.instance);
  protected readonly width = computed(() => {
    const value = this.instance().options.width ?? this.defaultWidth();
    return typeof value === 'number' ? `${value}px` : value;
  });
  protected readonly windowClass = computed(() => {
    const own = this.host.workspace.classes.sidePanel;
    return own ? `ndd-side-panel-window ${own}` : 'ndd-side-panel-window';
  });
}
