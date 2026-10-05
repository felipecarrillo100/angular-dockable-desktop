/**
 * Ready-made dialogs (1.6.0, from rdd 7.7.0 / vdd 1.8.0): the confirmation's icon, `<ndd-alert>`,
 * and `injectModals().confirm()` / `.alert()`.
 *
 * Ported from vdd `test/components/dialogs.test.ts` (names preserved, `vdd-` → `ndd-`, a custom
 * icon is an {@link NddIcon} class string rather than a component). The dismissal bug rdd 7.7.0
 * fixed never applied here — `NddConfirm` already settled on destroy — but the same settle-once
 * matrix runs against both dialogs so it stays that way.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddModals, injectModals } from '../../src/lib/overlays/modals';
import type { NddModalsApi } from '../../src/lib/overlays/modals';
import { NddConfirm } from '../../src/lib/overlays/confirm';
import { NddAlert } from '../../src/lib/overlays/alert';

let modals!: NddModalsApi;

@Component({ selector: 'ndd-test-dialog-host', imports: [NddModals], template: `<ndd-modals />` })
class Host {
  constructor() {
    modals = injectModals();
  }
}

interface Env {
  fixture: ComponentFixture<Host>;
  overlays: Workspace['overlays'];
  stable: () => Promise<void>;
}

async function setup(): Promise<Env> {
  const ws = createWorkspace({ panels: {} });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  const stable = async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await fixture.whenStable();
  };
  return { fixture, overlays: ws.overlays, stable };
}

afterEach(() => {
  document.body.innerHTML = '';
});

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const text = (sel: string) => q(sel)?.textContent?.trim() ?? '';
const escape = async (env: Env) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await env.stable();
};

const dismissals: [string, (env: Env) => Promise<void> | void][] = [
  ['Escape', env => escape(env)],
  ['the backdrop', () => q('[data-ndd-modal-curtain]')!.click()],
  ['the ×', () => q('[data-ndd-overlay-close]')!.click()],
  ['closeAllModals', env => env.overlays.closeAllModals()],
  ['close(id)', env => env.overlays.close(env.overlays.state().modals[0]!.id)],
];

describe('<ndd-confirm> settles exactly once', () => {
  for (const [name, dismiss] of dismissals) {
    it(`settles false when dismissed with ${name}, without calling onOk or onCancel`, async () => {
      const env = await setup();
      const onSettled = vi.fn(), onOk = vi.fn(), onCancel = vi.fn();
      env.overlays.openModal(NddConfirm, { message: 'Proceed?', onSettled, onOk, onCancel });
      await env.stable();
      await dismiss(env);
      await env.stable();
      expect(q('[data-ndd-modal]')).toBeNull();
      expect(onSettled.mock.calls).toEqual([[false]]);
      expect(onOk).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });
  }

  it('settles true once on the confirm button', async () => {
    const env = await setup();
    const onSettled = vi.fn();
    env.overlays.openModal(NddConfirm, { message: 'Proceed?', onSettled });
    await env.stable();
    q('[data-ndd-confirm-ok]')!.click();
    await env.stable();
    expect(onSettled.mock.calls).toEqual([[true]]);
  });
});

describe('dialog icon', () => {
  it('<ndd-confirm> draws the built-in question icon, coloured by alertType', async () => {
    const env = await setup();
    env.overlays.openModal(NddConfirm, { message: 'Proceed?', alertType: 'warning' });
    await env.stable();
    const icon = q('.ndd-dialog-icon')!;
    expect(icon.classList.contains('ndd-dialog-icon-warning')).toBe(true);
    expect(icon.getAttribute('data-ndd-dialog-icon')).toBe('default');
    expect(icon.querySelector('svg')).not.toBeNull();
  });

  it('icon: null draws no icon', async () => {
    const env = await setup();
    env.overlays.openModal(NddConfirm, { message: 'Proceed?', icon: null });
    await env.stable();
    expect(q('.ndd-dialog-icon')).toBeNull();
    expect(text('.ndd-confirmation-message')).toBe('Proceed?');
  });

  it('a custom icon replaces the built-in one, in the same slot', async () => {
    const env = await setup();
    env.overlays.openModal(NddConfirm, { message: 'Proceed?', icon: 'my-icon', alertType: 'danger' });
    await env.stable();
    const icon = q('.ndd-dialog-icon')!;
    expect(icon.querySelector('.my-icon')).not.toBeNull();
    expect(icon.querySelector('svg')).toBeNull();
    expect(icon.classList.contains('ndd-dialog-icon-danger')).toBe(true);
  });

  it('leaves ModalOptions.icon in the header alone', async () => {
    const env = await setup();
    env.overlays.openModal(NddAlert, { message: 'Done' }, { icon: 'header-icon' });
    await env.stable();
    expect(q('.ndd-modal-icon .header-icon')).not.toBeNull();
  });

  it('<ndd-alert> draws the icon of its type, not the question mark', async () => {
    const env = await setup();
    env.overlays.openModal(NddConfirm, { message: 'Proceed?', alertType: 'success' });
    await env.stable();
    const question = q('.ndd-dialog-icon svg')!.innerHTML;
    env.overlays.closeAllModals();
    await env.stable();
    env.overlays.openModal(NddAlert, { message: 'Saved', alertType: 'success' });
    await env.stable();
    const icon = q('.ndd-dialog-icon')!;
    expect(icon.classList.contains('ndd-dialog-icon-success')).toBe(true);
    expect(icon.querySelector('svg')!.innerHTML).not.toBe(question);
  });
});

describe('<ndd-alert>', () => {
  it('shows one OK button, focused, with the data hook', async () => {
    const env = await setup();
    env.overlays.openModal(NddAlert, { message: 'Done' });
    await env.stable();
    expect(document.querySelectorAll('.ndd-modal-body button')).toHaveLength(1);
    expect(document.activeElement).toBe(q('[data-ndd-alert-ok]'));
    expect(text('[data-ndd-alert-ok]')).toBe('OK');
  });

  it('okLabel replaces the button label', async () => {
    const env = await setup();
    env.overlays.openModal(NddAlert, { message: 'Done', okLabel: 'Got it' });
    await env.stable();
    expect(text('[data-ndd-alert-ok]')).toBe('Got it');
  });

  it('settles once on OK', async () => {
    const env = await setup();
    const onSettled = vi.fn();
    env.overlays.openModal(NddAlert, { message: 'Done', onSettled });
    await env.stable();
    q('[data-ndd-alert-ok]')!.click();
    await env.stable();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(q('[data-ndd-modal]')).toBeNull();
  });

  for (const [name, dismiss] of dismissals) {
    it(`settles once when dismissed with ${name}`, async () => {
      const env = await setup();
      const onSettled = vi.fn();
      env.overlays.openModal(NddAlert, { message: 'Done', onSettled });
      await env.stable();
      await dismiss(env);
      await env.stable();
      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(q('[data-ndd-modal]')).toBeNull();
    });
  }

  it('with closable: false, Escape and the backdrop do not close it; OK does', async () => {
    const env = await setup();
    const onSettled = vi.fn();
    env.overlays.openModal(NddAlert, { message: 'Done', onSettled }, { closable: false });
    await env.stable();
    await escape(env);
    q('[data-ndd-modal-curtain]')!.click();
    await env.stable();
    expect(q('[data-ndd-modal]')).not.toBeNull();
    expect(onSettled).not.toHaveBeenCalled();
    q('[data-ndd-alert-ok]')!.click();
    await env.stable();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

describe('injectModals().confirm / alert', () => {
  it('confirm resolves true on the confirm button, titled and sized by default', async () => {
    const env = await setup();
    const p = modals.confirm({ message: 'Delete?', yesNo: true });
    await env.stable();
    expect(text('[data-ndd-confirm-ok]')).toBe('Yes');
    expect(text('.ndd-modal-title')).toBe('Confirmation');
    expect(q('.ndd-modal-size-small')).not.toBeNull();
    expect(q('.ndd-dialog-icon-info')).not.toBeNull();
    q('[data-ndd-confirm-ok]')!.click();
    await expect(p).resolves.toBe(true);
  });

  it('confirm resolves false on cancel and on dismissal', async () => {
    const env = await setup();
    const p1 = modals.confirm({ message: 'Delete?' });
    await env.stable();
    q('[data-ndd-confirm-cancel]')!.click();
    await expect(p1).resolves.toBe(false);
    await env.stable();
    const p2 = modals.confirm({ message: 'Delete?', title: 'Sure?' });
    await env.stable();
    expect(text('.ndd-modal-title')).toBe('Sure?');
    await escape(env);
    await expect(p2).resolves.toBe(false);
  });

  it('alert resolves on OK and on dismissal, titled "Information" by default', async () => {
    const env = await setup();
    const p1 = modals.alert({ message: 'Saved', alertType: 'success' });
    await env.stable();
    expect(text('.ndd-modal-title')).toBe('Information');
    expect(q('.ndd-modal-size-small')).not.toBeNull();
    expect(q('.ndd-dialog-icon-success')).not.toBeNull();
    q('[data-ndd-alert-ok]')!.click();
    await expect(p1).resolves.toBeUndefined();
    await env.stable();
    const p2 = modals.alert({ message: 'Saved', icon: null });
    await env.stable();
    expect(q('.ndd-dialog-icon')).toBeNull();
    q('[data-ndd-overlay-close]')!.click();
    await expect(p2).resolves.toBeUndefined();
  });
});
