/**
 * The modal stack and the two side drawers: `<ndd-modals>`, `<ndd-side-panels>`,
 * `injectModals()`, `injectSidePanels()` and `injectModalRef()`.
 *
 * The state is the workspace's (`workspace.overlays`), so a modal can be raised from a service,
 * a guard or an interceptor with nothing rendered; the hosts only draw it. Place each host once,
 * anywhere — both are `position: fixed`, so where they sit in the tree does not matter.
 *
 * `injectModals().open()` returns an {@link NddModalRef}, shaped like Angular Material's
 * `MatDialogRef`: `afterClosed()` resolves with what the modal passed to `close(result)`, and the
 * modal's own content reaches the same ref through `injectModalRef()`. Ported from vdd
 * `VddModals.vue`, `VddSidePanels.vue` and `useOverlays.ts`.
 */
import { Component, DestroyRef, computed, inject, input } from '@angular/core';
import type { Signal, Type } from '@angular/core';
import type { DiscardRequest, ModalOptions, OverlayInstance, SidePanelOptions } from '../core/overlays';
import { injectWorkspace } from '../workspace/provide';
import { Workspace } from '../workspace/workspace';
import { NddConfirm } from './confirm';
import { MODAL_REF, NddModalHost, NddSidePanelHost, modalRef, requestOverlayClose } from './overlay-host';
import type { NddModalRef } from './overlay-host';

export type { NddModalRef } from './overlay-host';

/**
 * Renders the modal stack, bottom to top, and supplies the library's unsaved-changes question.
 *
 * Mount none and a dirty close refuses rather than discarding: asking needs somewhere to render.
 */
@Component({
  selector: 'ndd-modals',
  imports: [NddModalHost],
  host: { style: 'display: contents' },
  template: `
    @for (modal of overlays.state().modals; track modal.id; let i = $index) {
      <ndd-modal-host [instance]="modal" [index]="i" />
    }
  `,
})
export class NddModals {
  private readonly workspace = inject(Workspace) as Workspace<never>;
  protected readonly overlays = this.workspace.overlays;

  constructor() {
    this.overlays.setConfirmRenderer(request => this.confirmDiscard(request));
    inject(DestroyRef).onDestroy(() => this.overlays.setConfirmRenderer(null));
  }

  /**
   * Every close path in the library resolves through this one promise, so the answer cannot
   * differ between a tab, a window, a drawer and a modal. Resolving on *settle* — not only on
   * the buttons — is what makes Escape, the backdrop and the × count as a refusal.
   */
  private confirmDiscard(request: DiscardRequest): Promise<boolean> {
    const ws = this.workspace;
    return new Promise<boolean>(resolve => {
      this.overlays.openModal(
        NddConfirm,
        {
          message: request.dirtyOptions?.message ?? { ...ws.messages.unsavedChangesMessage, values: { title: request.title } },
          alert: request.dirtyOptions?.alert,
          alertType: request.dirtyOptions?.alertType ?? 'danger',
          yesNo: true,
          onSettled: (ok: boolean) => resolve(ok),
        },
        { title: request.dirtyOptions?.title ?? ws.messages.unsavedChangesTitle, size: 'small' },
      );
    });
  }
}

/**
 * Renders whichever side drawers are open. `sides` narrows it to one edge — what rdd offered as
 * two more exported components (`LeftPanelRenderer`, `RightPanelRenderer`).
 */
@Component({
  selector: 'ndd-side-panels',
  imports: [NddSidePanelHost],
  host: { style: 'display: contents' },
  template: `
    @if (left(); as panel) {
      @for (p of [panel]; track p.id) {
        <ndd-side-panel-host [instance]="p" position="left" [defaultWidth]="defaultWidth()" />
      }
    }
    @if (right(); as panel) {
      @for (p of [panel]; track p.id) {
        <ndd-side-panel-host [instance]="p" position="right" [defaultWidth]="defaultWidth()" />
      }
    }
  `,
})
export class NddSidePanels {
  /** Applied when the drawer was opened without a width. */
  readonly defaultWidth = input<number | string>(400);
  /** Which edges this instance is responsible for. */
  readonly sides = input<'both' | 'left' | 'right'>('both');

  private readonly overlays = (inject(Workspace) as Workspace<never>).overlays;
  protected readonly left = computed(() => (this.sides() === 'right' ? null : this.overlays.state().leftPanel));
  protected readonly right = computed(() => (this.sides() === 'left' ? null : this.overlays.state().rightPanel));
}

/** What {@link injectModals} returns. */
export interface NddModalsApi {
  /** Bottom to top — the last entry is the topmost. */
  readonly stack: Signal<readonly OverlayInstance[]>;
  /** The topmost modal, or `null`. */
  readonly topmost: Signal<OverlayInstance | null>;
  /** Push a modal. Modals stack, so opening one never closes another. */
  open<R = unknown>(component: Type<unknown>, inputs?: Record<string, unknown>, options?: ModalOptions): NddModalRef<R>;
  /** Close, honouring the modal's close guard and dirty state. `force` skips both. */
  close(id: string, options?: { force?: boolean }): Promise<void>;
  closeAll(): void;
}

/**
 * The modal stack. Every member is also reachable as `workspace.overlays.*` without a
 * component — the usual case for a confirmation raised by a service.
 *
 * ```ts
 * const modals = injectModals();
 * const ref = modals.open<boolean>(EditFeature, { featureId }, { size: 'medium', title: 'Edit' });
 * const saved = await ref.afterClosed();
 * ```
 */
export function injectModals(): NddModalsApi {
  const workspace = injectWorkspace() as unknown as Workspace<never>;
  const { overlays } = workspace;
  return {
    stack: computed(() => overlays.state().modals),
    topmost: computed(() => overlays.state().modals.at(-1) ?? null),
    open: <R>(component: Type<unknown>, inputs?: Record<string, unknown>, options?: ModalOptions) =>
      modalRef<R>(workspace, overlays.openModal(component, inputs, options)),
    close: (id, options) => requestOverlayClose(workspace, id, options),
    closeAll: () => overlays.closeAllModals(),
  };
}

/**
 * Inside a modal's content: the ref for the modal you are in, to close it with a result.
 *
 * ```ts
 * export class EditFeature {
 *   private readonly ref = injectModalRef<boolean>();
 *   save() { … this.ref.close(true); }
 * }
 * ```
 * @throws outside a modal's content.
 */
export function injectModalRef<R = unknown>(): NddModalRef<R> {
  const ref = inject(MODAL_REF, { optional: true });
  if (!ref) throw new Error("[angular-dockable-desktop] injectModalRef() must be called inside a modal's content.");
  return ref as NddModalRef<R>;
}

/** What {@link injectSidePanels} returns. */
export interface NddSidePanelsApi {
  readonly left: Signal<OverlayInstance | null>;
  readonly right: Signal<OverlayInstance | null>;
  /**
   * Open a drawer. Each side holds one panel, so opening is also closing whatever was there —
   * which is why this is async, resolving `null` when the occupant's close guard refuses.
   */
  openLeft(component: Type<unknown>, inputs?: Record<string, unknown>, options?: SidePanelOptions): Promise<string | null>;
  openRight(component: Type<unknown>, inputs?: Record<string, unknown>, options?: SidePanelOptions): Promise<string | null>;
  /** Close, honouring the close guard and dirty state. `force` skips both. */
  close(id: string, options?: { force?: boolean }): Promise<void>;
  /** Close both drawers, leaving the modal stack alone. */
  closeAll(): void;
}

/** The two side drawers. */
export function injectSidePanels(): NddSidePanelsApi {
  const workspace = injectWorkspace() as unknown as Workspace<never>;
  const { overlays } = workspace;
  return {
    left: computed(() => overlays.state().leftPanel),
    right: computed(() => overlays.state().rightPanel),
    openLeft: (c, i, o) => overlays.openLeftPanel(c, i, o),
    openRight: (c, i, o) => overlays.openRightPanel(c, i, o),
    close: (id, options) => requestOverlayClose(workspace, id, options),
    closeAll: () => {
      const { leftPanel, rightPanel } = overlays.state();
      for (const instance of [leftPanel, rightPanel]) if (instance) overlays.close(instance.id);
    },
  };
}
