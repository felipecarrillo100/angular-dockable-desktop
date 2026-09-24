/**
 * Side panels and the modal stack.
 *
 * Ported from vue-dockable-desktop `test/components/overlays.test.ts` (6 tests, names preserved,
 * `vdd-` → `ndd-`), itself a port of rdd's `PanelSystem.test.tsx`. As in vdd there is no
 * `<PanelProvider>`: overlay state is the workspace's, so the tests open panels through
 * `ws.overlays` with no component involved — the case that motivated it, a modal raised by a
 * save handler or a guard. Where vdd read `instance.props`, ndd reads `instance.inputs`.
 *
 * Angular additions at the end: Escape reaching only one overlay even when a drawer was opened
 * *after* a modal, the dialog roles, `NddModalRef.afterClosed()` with `injectModalRef()`, and
 * content receiving only the inputs it declares.
 */
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddModals, NddSidePanels, injectModalRef, injectModals } from '../../src/lib/overlays/modals';
import { NddConfirm } from '../../src/lib/overlays/confirm';
import { injectPanel } from '../../src/lib/panel/panel-ref';

@Component({
  selector: 'ndd-test-content',
  template: `<div [attr.id]="'panel-content-' + panelId()"><span class="msg-span">{{ message() }}</span></div>`,
})
class Content {
  readonly panelId = input('');
  readonly message = input('Default');
}

/** Both hosts, as an application would place them. */
@Component({ selector: 'ndd-test-both', imports: [NddSidePanels, NddModals], template: `<ndd-side-panels /><ndd-modals />` })
class Both {}

interface Env {
  ws: Workspace;
  fixture: ComponentFixture<Both>;
  el: HTMLElement;
  overlays: Workspace['overlays'];
  stable: () => Promise<void>;
}

async function setup(): Promise<Env> {
  const ws = createWorkspace({ panels: {} });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(Both);
  await fixture.whenStable();
  return { ws, fixture, el: fixture.nativeElement as HTMLElement, overlays: ws.overlays, stable: () => fixture.whenStable() };
}

const get = (root: ParentNode, selector: string) => {
  const found = root.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};
const text = (el: Element) => el.textContent?.trim() ?? '';
const escape = async (env: Env) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  await env.stable();
};

describe('Panel System (side panels and nested modals)', () => {
  it('should support opening left and right side panels with dynamic props', async () => {
    const env = await setup();
    const { overlays } = env;

    const leftId = await overlays.openLeftPanel(Content, { message: 'Hello Left' }, { title: 'Left Drawer' });
    await env.stable();

    expect(leftId).not.toBeNull();
    expect(overlays.state().leftPanel).not.toBeNull();
    expect(overlays.state().leftPanel!.id).toBe(leftId);
    expect(overlays.state().leftPanel!.inputs['message']).toBe('Hello Left');

    const left = get(env.el, '.ndd-side-panel-left');
    expect(text(get(left, '.ndd-side-panel-title'))).toBe('Left Drawer');
    expect(text(get(left, '.msg-span'))).toBe('Hello Left');
    expect(left.style.width).toBe('400px');

    const rightId = await overlays.openRightPanel(Content, { message: 'Hello Right' }, { title: 'Right Drawer', width: 550 });
    await env.stable();

    expect(rightId).not.toBeNull();
    expect(overlays.state().rightPanel!.id).toBe(rightId);
    expect(overlays.state().rightPanel!.inputs['message']).toBe('Hello Right');
    expect(get(env.el, '.ndd-side-panel-right').style.width).toBe('550px');
  });

  it('should default the body to zero (no inline) padding, and respect a bodyPadding override', async () => {
    const env = await setup();
    const { overlays } = env;

    // No bodyPadding given: nothing inline, so the stylesheet governs and content is
    // edge-to-edge. An inline default would be unreachable without !important.
    await overlays.openLeftPanel(Content, {}, { title: 'Left Drawer' });
    await env.stable();
    expect(get(env.el, '.ndd-side-panel-left .ndd-side-panel-body').style.padding).toBe('');

    // A number is pixels.
    await overlays.openRightPanel(Content, {}, { title: 'Right Drawer', bodyPadding: 12 });
    await env.stable();
    expect(get(env.el, '.ndd-side-panel-right .ndd-side-panel-body').style.padding).toBe('12px');

    // A string passes through verbatim, shorthand included.
    overlays.close(overlays.state().leftPanel!.id);
    await overlays.openLeftPanel(Content, {}, { title: 'Left Drawer', bodyPadding: '4px 8px' });
    await env.stable();
    expect(get(env.el, '.ndd-side-panel-left .ndd-side-panel-body').style.padding).toBe('4px 8px');
  });

  it('should support nested stacked modals and track their sizes and headers', async () => {
    const env = await setup();
    const { overlays } = env;

    overlays.openModal(Content, { message: 'Modal 1' }, { title: 'First Modal', size: 'small' });
    await env.stable();
    expect(overlays.state().modals).toHaveLength(1);
    expect(overlays.state().modals[0]!.options.title).toBe('First Modal');

    overlays.openModal(Content, { message: 'Modal 2' }, { title: 'Second Modal', size: 'large' });
    await env.stable();
    expect(overlays.state().modals).toHaveLength(2);

    const windows = Array.from(env.el.querySelectorAll<HTMLElement>('.ndd-modal-overlay'));
    expect(windows).toHaveLength(2);
    expect(text(get(windows[0]!, '.ndd-modal-title'))).toBe('First Modal');
    expect(text(get(windows[1]!, '.ndd-modal-title'))).toBe('Second Modal');
    expect(get(windows[0]!, '.ndd-modal-window').classList).toContain('ndd-modal-size-small');
    expect(get(windows[1]!, '.ndd-modal-window').classList).toContain('ndd-modal-size-large');

    // Stacking is by depth, so a modal opened from a modal lands above it.
    const z = windows.map(w => w.style.zIndex);
    expect(z[0]).toBe('calc(var(--ndd-z-base, 1000) + 9000 + 0)');
    expect(z[1]).toBe('calc(var(--ndd-z-base, 1000) + 9000 + 10)');
  });

  it('should default the modal body to zero (no inline) padding, and respect a bodyPadding override', async () => {
    const env = await setup();
    const { overlays } = env;

    overlays.openModal(Content, {}, { title: 'First Modal' });
    await env.stable();
    expect(get(env.el, '.ndd-modal-body').style.padding).toBe('');

    overlays.openModal(Content, {}, { title: 'Second Modal', bodyPadding: 12 });
    await env.stable();
    expect(env.el.querySelectorAll<HTMLElement>('.ndd-modal-body')[1]!.style.padding).toBe('12px');

    overlays.openModal(Content, {}, { title: 'Third Modal', bodyPadding: '4px 8px' });
    await env.stable();
    expect(env.el.querySelectorAll<HTMLElement>('.ndd-modal-body')[2]!.style.padding).toBe('4px 8px');
  });

  it('should route Escape key closes to topmost modal, and to side drawers only if modals stack is empty', async () => {
    const env = await setup();
    const { overlays } = env;

    await overlays.openLeftPanel(Content, {}, { title: 'Left Drawer' });
    overlays.openModal(Content, {}, { title: 'Modal 1' });
    overlays.openModal(Content, {}, { title: 'Modal 2' });
    await env.stable();

    expect(overlays.state().leftPanel).not.toBeNull();
    expect(overlays.state().modals).toHaveLength(2);

    // The topmost modal answers, and nothing below it does — not the modal underneath, and not
    // the drawer, even though all three are listening on the same document.
    await escape(env);
    expect(overlays.state().modals).toHaveLength(1);
    expect(overlays.state().modals[0]!.options.title).toBe('Modal 1');
    expect(overlays.state().leftPanel).not.toBeNull();

    await escape(env);
    expect(overlays.state().modals).toHaveLength(0);
    expect(overlays.state().leftPanel).not.toBeNull();

    // Only now, with the stack empty, does the drawer take it.
    await escape(env);
    expect(overlays.state().leftPanel).toBeNull();
  });

  it('should support NddConfirm rendering, resolving its ok and cancel handlers', async () => {
    const env = await setup();
    const { overlays } = env;
    const onOk = vi.fn();
    const onCancel = vi.fn();

    overlays.openModal(
      NddConfirm,
      { message: 'Critical Action Prompt', alert: 'System Alert Notice', alertType: 'danger', yesNo: true, onOk, onCancel },
      { title: 'Confirmation Dialog' },
    );
    await env.stable();

    expect(overlays.state().modals).toHaveLength(1);
    expect(overlays.state().modals[0]!.options.title).toBe('Confirmation Dialog');

    const body = get(env.el, '.ndd-modal-body');
    expect(body.textContent).toContain('Critical Action Prompt');
    expect(body.textContent).toContain('System Alert Notice');

    const ok = get(body, '[data-ndd-confirm-ok]');
    expect(text(ok)).toBe('Yes');
    expect(text(get(body, '[data-ndd-confirm-cancel]'))).toBe('No');

    ok.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await env.stable();

    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(overlays.state().modals).toHaveLength(0);
  });
});

// ─── Angular additions ───────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-answer',
  template: `<button data-answer (click)="ref.close(42)">answer</button><span data-kind>{{ panel.containerType() }}</span>`,
})
class Answer {
  protected readonly ref = injectModalRef<number>();
  protected readonly panel = injectPanel();
}

describe('Overlays: Angular additions', () => {
  it('Escape closes only the modal when a drawer was opened after it, whose listener runs last', async () => {
    // Listeners run in registration order. A drawer opened after a modal listens after it, so
    // when the modal's close is synchronous the stack is already empty by the time the drawer
    // looks — without the "handled" mark, one Escape would close both.
    const env = await setup();
    const { overlays } = env;
    overlays.openModal(Content, {}, { title: 'Modal' });
    await env.stable();
    await overlays.openLeftPanel(Content, {}, { title: 'Drawer' });
    await env.stable();

    await escape(env);
    expect(overlays.state().modals).toHaveLength(0);
    expect(overlays.state().leftPanel).not.toBeNull();
  });

  it('a modal is a labelled dialog, and a closable: false modal has no × and ignores the backdrop and Escape', async () => {
    const env = await setup();
    const { overlays } = env;
    overlays.openModal(Content, {}, { title: 'Pinned', closable: false });
    await env.stable();
    const overlay = get(env.el, '.ndd-modal-overlay');
    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    expect(overlay.getAttribute('aria-label')).toBe('Pinned');
    expect(overlay.querySelector('[data-ndd-overlay-close]')).toBeNull();
    get(overlay, '[data-ndd-modal-curtain]').click();
    await escape(env);
    expect(overlays.state().modals).toHaveLength(1);
  });

  it('injectModals().open() returns a ref whose afterClosed() resolves with what the content passed to injectModalRef().close()', async () => {
    const env = await setup();
    const modals = TestBed.runInInjectionContext(() => injectModals());
    const ref = modals.open<number>(Answer, {}, { title: 'Question' });
    await env.stable();
    expect(modals.topmost()?.id).toBe(ref.id);
    // The content gets the same injectPanel() contract as a docked panel, typed for a modal.
    expect(text(get(env.el, '[data-kind]'))).toBe('modal');

    const answer = ref.afterClosed();
    get(env.el, '[data-answer]').click();
    await expect(answer).resolves.toBe(42);
    await env.stable();
    expect(modals.stack()).toHaveLength(0);
  });

  it('afterClosed() resolves undefined for every other way out — Escape, the ×, the backdrop, closeAll', async () => {
    const env = await setup();
    const modals = TestBed.runInInjectionContext(() => injectModals());
    const ways: (() => Promise<void> | void)[] = [
      () => escape(env),
      () => get(env.el, '[data-ndd-overlay-close]').click(),
      () => get(env.el, '[data-ndd-modal-curtain]').click(),
      () => modals.closeAll(),
    ];
    for (const way of ways) {
      const ref = modals.open(Content, {}, { title: 'X' });
      await env.stable();
      const closed = ref.afterClosed();
      await way();
      await env.stable();
      await expect(closed).resolves.toBeUndefined();
    }
  });

  it('content receives only the inputs it declares, and panelId cannot be spoofed', async () => {
    const env = await setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = env.overlays.openModal(Content, { message: 'hi', panelId: 'spoofed', notAnInput: 1 }, { title: 'T' });
    await env.stable();
    expect(env.el.querySelector(`#panel-content-${id}`)).not.toBeNull();
    expect(env.el.querySelector('#panel-content-spoofed')).toBeNull();
    // An undeclared key is ignored rather than reported as NG0303.
    expect(error.mock.calls.filter(c => String(c[0]).includes('NG0303'))).toHaveLength(0);
    error.mockRestore();
  });
});
