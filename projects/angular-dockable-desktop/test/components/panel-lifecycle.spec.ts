/**
 * `injectPanel()` — dirty state, close guards, titles, size, and the lifecycle a panel can
 * observe about itself.
 *
 * Ported from vue-dockable-desktop `test/components/panelLifecycle.test.ts` (25 tests, names
 * preserved), itself a rewrite of rdd's `FormContainer.test.tsx`. rdd's six subscription methods
 * are signals here, as they are refs in vdd:
 *
 *   rdd contract member        ndd equivalent asserted here
 *   ────────────────────────   ──────────────────────────────────────────────────────
 *   onActivate / onDeactivate  `isActive` (a signal)                  (tests 16–19, 24)
 *   onContainerTypeChange      `containerType` (a signal)                (tests 20–22)
 *   onClose                    `DestroyRef.onDestroy` / `subscribe('panel:closed')` (19)
 *   onMinimize / onRestore     `isMinimized` (a signal)                     (test 13)
 *   onResize + getDimensions   `size`, one signal                        (tests 14–15)
 *   requestClose               `close()`                                (tests 4, 5, 9)
 *   onCloseRequested           `onBeforeClose()`, disposed with the component (test 4)
 *   setDirty / setTitle        `setDirty()` / `setTitle()`               (tests 1–3)
 *   registerStateProvider      `onSaveState()`                             (test 10)
 *
 * vdd's `watch(ref, cb)` fires on change only, so the panels here observe through a small
 * `watchSignal` helper that skips an effect's first run — which is what a watcher is.
 *
 * **The ordering guarantee (D14, Angular form).** rdd fired `onDeactivate` synchronously before
 * `onClose`. vdd pinned it with a `flush: 'sync'` watcher. Angular has no synchronous effect; the
 * synchronous channel is the workspace's own `panel:activated` event, which `closePanel`
 * publishes before `panel:closed` and while the closing panel's subscription is still live.
 * Test 19 asserts that, and — the other half of D14 — that an *effect* on the closing panel does
 * not run: the component is destroyed before effects flush. `DestroyRef.onDestroy` is the
 * deterministic "before I go" hook, and it is asserted too.
 */
import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { Workspace, createWorkspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddModals } from '../../src/lib/overlays/modals';
import { injectPanel } from '../../src/lib/panel/panel-ref';
import type { PanelRef } from '../../src/lib/panel/panel-ref';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Where each mounted panel publishes its `injectPanel()` return, keyed by panel id. */
const api = new Map<string, PanelRef>();
/** Ordered lifecycle log, for the ordering assertions. */
let log: string[] = [];

/** vdd's `watch(source, cb)`: an effect that skips its first run and fires on change. */
function watchSignal<T>(read: () => T, cb: (value: T) => void): void {
  let first = true;
  let previous: T;
  effect(() => {
    const value = read();
    if (first) {
      first = false;
      previous = value;
      return;
    }
    if (Object.is(value, previous)) return;
    previous = value;
    untracked(() => cb(value));
  });
}

/** A panel that hands its whole contract to the test. */
@Component({
  selector: 'ndd-test-form',
  template: `<div [attr.id]="'child-' + panelId()" [attr.data-message]="message()">form</div>`,
})
class Form {
  readonly panelId = input('');
  readonly message = input('Default');
  constructor() {
    const panel = injectPanel();
    api.set(panel.id, panel);
  }
}

/** A panel that logs its own lifecycle, both ways round. */
@Component({
  selector: 'ndd-test-lifecycle',
  template: `<div [attr.id]="'lc-' + panelId()" [attr.data-container-type]="panel.containerType()"></div>`,
})
class Lifecycle {
  readonly panelId = input('');
  protected readonly panel = injectPanel();
  constructor() {
    const panel = this.panel;
    const id = panel.id;
    api.set(id, panel);
    watchSignal(panel.isActive, v => log.push(`${v ? 'activate' : 'deactivate'}:${id}`));
    watchSignal(panel.containerType, t => log.push(`containerType:${id}:${t}`));
    watchSignal(panel.isMinimized, v => log.push(`${v ? 'minimize' : 'restore'}:${id}`));
    // The synchronous channel: the workspace's own event, published as it happens.
    const off = (inject(Workspace) as Workspace).subscribe('panel:activated', ({ id: next, previous }) => {
      if (previous === id) log.push(`sync-deactivate:${id}`);
      if (next === id) log.push(`sync-activate:${id}`);
    });
    inject(DestroyRef).onDestroy(() => {
      off();
      log.push(`unmount:${id}`);
    });
  }
}

/** The desktop plus the modal host, since the unsaved-changes question is a modal. */
@Component({ selector: 'ndd-test-app', imports: [NddDesktop, NddModals], template: `<ndd-desktop /><ndd-modals />` })
class App {}

@Component({ selector: 'ndd-test-desktop-only', imports: [NddDesktop], template: `<ndd-desktop />` })
class DesktopOnly {}

interface Env {
  ws: Workspace;
  fixture: ComponentFixture<unknown>;
  el: HTMLElement;
  stable: () => Promise<void>;
}

async function setup(host: typeof App | typeof DesktopOnly = App): Promise<Env> {
  const ws = createWorkspace({ panels: { form: { component: Form }, lifecycle: { component: Lifecycle } } });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(host);
  await fixture.whenStable();
  return { ws, fixture, el: fixture.nativeElement as HTMLElement, stable: () => fixture.whenStable() };
}

const panelOf = (id: string): PanelRef => {
  const found = api.get(id);
  if (!found) throw new Error(`panel ${id} did not mount`);
  return found;
};
/** A close awaits a promise, so give it both a microtask and a render. */
const flush = async (env: Env) => {
  await env.stable();
  await Promise.resolve();
  await env.stable();
};
const q = (env: Env, selector: string) => env.el.querySelector<HTMLElement>(selector);
const text = (el: Element | null) => el?.textContent?.trim() ?? '';

afterEach(() => {
  api.clear();
  log = [];
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach(el => el.remove());
});

// ─── Integration ─────────────────────────────────────────────────────────────

describe('injectPanel integration', () => {
  it('should render form container and show asterisk on dirty state', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Editor' });
    await env.stable();

    expect(q(env, '#child-p1')).not.toBeNull();
    expect(text(q(env, '[data-ndd-tab="p1"]'))).toBe('Editor');

    panelOf('p1').setDirty(true);
    await env.stable();
    expect(env.ws.state().panels['p1']!.dirty).toBe(true);
    expect(text(q(env, '[data-ndd-tab="p1"]'))).toContain('*');
  });

  it('should clear dirty flag and asterisk when setDirty(false) is called', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Editor' });
    await env.stable();

    panelOf('p1').setDirty(true);
    await env.stable();
    expect(text(q(env, '[data-ndd-tab="p1"]'))).toContain('*');

    panelOf('p1').setDirty(false);
    await env.stable();
    expect(env.ws.state().panels['p1']!.dirty).toBe(false);
    expect(text(q(env, '[data-ndd-tab="p1"]'))).not.toContain('*');
  });

  it('should support dynamic title updates via the panel contract', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Initial Title' });
    await env.stable();
    expect(text(q(env, '[data-ndd-tab="p1"]'))).toBe('Initial Title');

    panelOf('p1').setTitle('Dynamic Title');
    await env.stable();
    expect(text(q(env, '[data-ndd-tab="p1"]'))).toBe('Dynamic Title');
    // And the live title is readable back through the same contract.
    expect(panelOf('p1').title()).toBe('Dynamic Title');
  });

  it('should block panel closure when an onBeforeClose guard returns false', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Guard Test' });
    await env.stable();

    panelOf('p1').onBeforeClose(() => false);
    await env.ws.requestClosePanel('p1');
    await flush(env);
    expect(env.ws.isOpen('p1')).toBe(true);
  });

  it('should bypass the guard and the dirty check on a force close', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Force Close Test' });
    await env.stable();

    panelOf('p1').onBeforeClose(() => false);
    panelOf('p1').setDirty(true);
    await env.stable();

    await panelOf('p1').close({ force: true });
    await flush(env);
    expect(env.ws.isOpen('p1')).toBe(false);
  });

  it('should show the dirty confirmation modal when a dirty panel is closed', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Modal Test' });
    await env.stable();
    panelOf('p1').setDirty(true);
    await env.stable();

    // The tab's own × is the path a user takes, and it is wired to the same request.
    expect(q(env, '[data-ndd-close="p1"]')).not.toBeNull();
    void env.ws.requestClosePanel('p1');
    await flush(env);

    expect(env.ws.overlays.state().modals).toHaveLength(1);
    const modal = q(env, '.ndd-modal-overlay')!;
    expect(text(modal.querySelector('.ndd-modal-title'))).toBe('Unsaved Changes');
    expect(modal.textContent).toContain('Modal Test');
    expect(env.ws.isOpen('p1')).toBe(true);
  });

  it('should keep the panel open when No is clicked in the dirty confirmation modal', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Modal Test' });
    await env.stable();
    panelOf('p1').setDirty(true);
    await env.stable();

    void env.ws.requestClosePanel('p1');
    await flush(env);
    q(env, '[data-ndd-confirm-cancel]')!.click();
    await flush(env);

    expect(env.ws.isOpen('p1')).toBe(true);
    expect(env.ws.overlays.state().modals).toHaveLength(0);
  });

  it('should close the panel when Yes is clicked in the dirty confirmation modal', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Modal Test' });
    await env.stable();
    panelOf('p1').setDirty(true);
    await env.stable();

    void env.ws.requestClosePanel('p1');
    await flush(env);
    q(env, '[data-ndd-confirm-ok]')!.click();
    await flush(env);

    expect(env.ws.isOpen('p1')).toBe(false);
    expect(env.ws.overlays.state().modals).toHaveLength(0);
  });

  it('closing a dirty panel with nothing able to ask should silently abort (no modal, no close)', async () => {
    // rdd's equivalent: `requestClose` on a dirty panel with no `onConfirm`. ndd supplies the
    // question by default, so the way to reach this state is to mount no `<ndd-modals>` — and
    // the refusal is the same: the edits are not discarded.
    const env = await setup(DesktopOnly);
    env.ws.openPanel('p1', 'form', { title: 'No Host' });
    await env.stable();
    panelOf('p1').setDirty(true);
    await env.stable();

    await env.ws.requestClosePanel('p1');
    await flush(env);
    expect(env.ws.isOpen('p1')).toBe(true);
    expect(env.ws.overlays.state().modals).toHaveLength(0);
  });

  it('onSaveState (from inside the panel) is reflected in saveLayout, pulled fresh each time', async () => {
    const env = await setup();
    const value = signal<unknown>({ count: 0 });
    @Component({ selector: 'ndd-test-stateful', template: 'stateful' })
    class Stateful {
      constructor() {
        injectPanel().onSaveState(() => value());
      }
    }
    env.ws.registry.register('stateful', Stateful);
    env.ws.openPanel('p1', 'stateful', { title: 'Stateful' });
    await env.stable();

    expect(JSON.parse(env.ws.saveLayout()).panels.p1.props).toEqual({ count: 0 });

    // Pulled on every save, not captured once — the whole reason the hook exists.
    value.set({ count: 7, note: 'later' });
    expect(JSON.parse(env.ws.saveLayout()).panels.p1.props).toEqual({ count: 7, note: 'later' });
  });

  it('openPanel props are spread onto the rendered component alongside panelId', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Props', inputs: { message: 'from open' } });
    await env.stable();
    expect(q(env, '#child-p1')!.getAttribute('data-message')).toBe('from open');
    expect(panelOf('p1').id).toBe('p1');
  });

  it('a caller-supplied prop named panelId can never override the injected id', async () => {
    const env = await setup();
    env.ws.openPanel('p1', 'form', { title: 'Props', inputs: { panelId: 'spoofed', message: 'x' } });
    await env.stable();
    // The injected id is applied after the caller's inputs, so it wins — a panel can trust it.
    expect(q(env, '#child-spoofed')).toBeNull();
    expect(q(env, '#child-p1')).not.toBeNull();
    expect(panelOf('p1').id).toBe('p1');
  });
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

describe('injectPanel lifecycle', () => {
  it('minimize moves the panel to the taskbar, and isMinimized reports it', async () => {
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    await env.stable();

    panelOf('lc').minimize();
    await env.stable();

    expect(env.ws.state().panels['lc']!.state).toBe('minimized');
    expect(panelOf('lc').isMinimized()).toBe(true);
    expect(q(env, '[data-ndd-taskbar-item="lc"]')).not.toBeNull();
    expect(log).toContain('minimize:lc');
  });

  it('size is null before anything has measured the panel', async () => {
    // rdd had getDimensions() *and* usePanelSize() for this; one signal answers both.
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    await env.stable();
    // jsdom runs no layout and fires no ResizeObserver, so nothing has reported a size.
    expect(panelOf('lc').size()).toBeNull();
  });

  it("size is one reactive signal, so an effect replaces rdd's onResize + usePanelSize", async () => {
    // rdd needed `getDimensions()`, `onResize()` and `usePanelSize()` for this. They are one
    // signal here, and writing it is the host's job, so what this asserts is the contract a
    // panel depends on: it is reactive, and it is never a guess. jsdom runs no layout, so
    // nothing measures the panel and the value stays null — the browser gates assert a real size.
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    await env.stable();

    const size = panelOf('lc').size;
    const seen: (number | null)[] = [];
    TestBed.runInInjectionContext(() => watchSignal(size, s => seen.push(s?.width ?? null)));

    expect(size()).toBeNull();
    // Neither floating nor docking invents a size: `null` means "not laid out yet", and a panel
    // can trust that rather than defending against a zero.
    env.ws.floatPanel('lc', { x: 10, y: 10, width: 420, height: 300 });
    await env.stable();
    expect(env.ws.state().floating.find(f => f.id === 'lc')?.width).toBe(420);
    expect(size()).toBeNull();
    expect(seen).toEqual([]);
  });

  it('isActive becomes true when the panel gains focus', async () => {
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    env.ws.openPanel('lc2', 'lifecycle', { title: 'LC2' });
    await env.stable();

    env.ws.focusPanel('lc');
    await env.stable();
    expect(panelOf('lc').isActive()).toBe(true);
    expect(log).toContain('activate:lc');
  });

  it('isActive becomes false when the panel loses focus', async () => {
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    env.ws.openPanel('lc2', 'lifecycle', { title: 'LC2' });
    await env.stable();
    env.ws.focusPanel('lc');
    await env.stable();
    log = [];

    env.ws.focusPanel('lc2');
    await env.stable();
    expect(panelOf('lc').isActive()).toBe(false);
    expect(log).toContain('deactivate:lc');
    expect(log).toContain('activate:lc2');
  });

  it('the active panel is deactivated when it is closed', async () => {
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    env.ws.openPanel('lc2', 'lifecycle', { title: 'LC2' });
    await env.stable();
    env.ws.focusPanel('lc');
    await env.stable();
    log = [];

    env.ws.closePanel('lc');
    await flush(env);
    expect(env.ws.state().activePanelId).not.toBe('lc');
    expect(log.some(e => e === 'sync-deactivate:lc')).toBe(true);
  });

  it('deactivation is observable before the close is published, through the synchronous panel:activated event', async () => {
    // rdd fired onDeactivate before onClose, synchronously; vdd pinned it with a sync watcher.
    // Angular's effects are scheduled, so an effect on a closing panel never runs — its
    // component is destroyed first. Both halves are asserted, because both are the contract.
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    await env.stable();
    env.ws.focusPanel('lc');
    await env.stable();
    log = [];
    env.ws.subscribe('panel:closed', ({ id }) => log.push(`closed:${id}`));

    env.ws.closePanel('lc');
    await flush(env);

    const deactivate = log.indexOf('sync-deactivate:lc');
    const closed = log.indexOf('closed:lc');
    expect(deactivate).toBeGreaterThanOrEqual(0);
    expect(closed).toBeGreaterThanOrEqual(0);
    expect(deactivate).toBeLessThan(closed);

    // The deterministic hook for "before I go" work is DestroyRef, and it does run.
    expect(log).toContain('unmount:lc');
    // The effect did not fire for the closing panel. This is the divergence (D14).
    expect(log).not.toContain('deactivate:lc');
  });

  it('containerType reports floating-window when the panel is floated', async () => {
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    await env.stable();
    log = [];

    env.ws.floatPanel('lc');
    await env.stable();
    expect(panelOf('lc').containerType()).toBe('floating-window');
    expect(log).toContain('containerType:lc:floating-window');
  });

  it('containerType reports dockable-panel when a floating panel is docked back', async () => {
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    await env.stable();
    env.ws.floatPanel('lc');
    await env.stable();
    log = [];

    env.ws.dockPanel('lc');
    await env.stable();
    expect(panelOf('lc').containerType()).toBe('dockable-panel');
    expect(log).toContain('containerType:lc:dockable-panel');
  });

  it('containerType does NOT change during minimize and restore', async () => {
    // Minimising does not move a panel between containers — it takes it off screen, still
    // mounted and running — so the type is what the panel was, which is where restoring puts it.
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    await env.stable();
    env.ws.floatPanel('lc');
    await env.stable();
    log = [];

    env.ws.minimizePanel('lc');
    await env.stable();
    expect(panelOf('lc').containerType()).toBe('floating-window');
    env.ws.restorePanel('lc');
    await env.stable();
    expect(panelOf('lc').containerType()).toBe('floating-window');

    expect(log.filter(e => e.startsWith('containerType:'))).toEqual([]);
    // The minimise itself is observable, through the signal that actually describes it.
    expect(log).toContain('minimize:lc');
    expect(log).toContain('restore:lc');
  });

  it('containerType is dockable-panel at mount for a docked panel', async () => {
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    await env.stable();
    expect(panelOf('lc').containerType()).toBe('dockable-panel');
    expect(q(env, '#lc-lc')!.getAttribute('data-container-type')).toBe('dockable-panel');
  });

  it('isActive does not change when an unrelated panel gains focus', async () => {
    const env = await setup();
    env.ws.openPanel('lc', 'lifecycle', { title: 'LC' });
    env.ws.openPanel('lc2', 'lifecycle', { title: 'LC2' });
    env.ws.openPanel('lc3', 'lifecycle', { title: 'LC3' });
    await env.stable();
    env.ws.focusPanel('lc');
    await env.stable();
    log = [];

    env.ws.focusPanel('lc2');
    await env.stable();
    log = [];
    // lc is already inactive; a third panel taking focus must not touch it.
    env.ws.focusPanel('lc3');
    await env.stable();

    expect(log.filter(e => e.endsWith(':lc'))).toEqual([]);
    expect(panelOf('lc').isActive()).toBe(false);
  });
});

// ─── Standalone ──────────────────────────────────────────────────────────────

describe('injectPanel outside a container', () => {
  it('reports a standalone panel and warns rather than throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const panel = TestBed.runInInjectionContext(() => injectPanel());

      expect(panel.id).toBe('standalone');
      expect(panel.containerType()).toBe('standalone');
      expect(panel.isActive()).toBe(false);
      expect(panel.size()).toBeNull();

      // The actions are no-ops with a diagnostic, so a panel component renders on its own — in
      // a test, or a story — without special-casing.
      panel.setTitle('x');
      panel.setDirty(true);
      panel.minimize();
      void panel.close();
      expect(warn.mock.calls.length).toBeGreaterThanOrEqual(4);
    } finally {
      warn.mockRestore();
    }
  });
});

// ─── Angular additions: trackDirty and Signal Forms ──────────────────────────

/** A real Signal Forms form, its dirty state tracked by the panel. */
@Component({ selector: 'ndd-test-signal-form', template: `<div data-signal-form>{{ model().name }}</div>` })
class SignalFormPanel {
  readonly model = signal({ name: '' });
  readonly form = form(this.model);
  constructor() {
    const panel = injectPanel();
    forms.set(panel.id, this);
    panel.trackDirty(
      () => this.form().dirty(),
      () => ({ alert: this.model().name ? undefined : 'Name is still empty' }),
    );
  }
}
const forms = new Map<string, SignalFormPanel>();

describe('trackDirty', () => {
  async function withForm() {
    const env = await setup();
    env.ws.registry.register('signal-form', SignalFormPanel);
    env.ws.openPanel('f1', 'signal-form', { title: 'Signal Form' });
    await env.stable();
    return { env, panel: forms.get('f1')! };
  }

  it("follows a Signal Forms form's dirty() both ways, with no setDirty call", async () => {
    const { env, panel } = await withForm();
    expect(env.ws.state().panels['f1']!.dirty).toBe(false);

    panel.form.name().markAsDirty();
    await env.stable();
    expect(env.ws.state().panels['f1']!.dirty).toBe(true);
    expect(text(q(env, '[data-ndd-tab="f1"]'))).toContain('*');

    panel.form().reset();
    await env.stable();
    expect(env.ws.state().panels['f1']!.dirty).toBe(false);
    expect(text(q(env, '[data-ndd-tab="f1"]'))).not.toContain('*');
  });

  it('a tracked-dirty panel asks before closing, and the options getter says what is wrong right now', async () => {
    const { env, panel } = await withForm();
    panel.form.name().markAsDirty();
    await env.stable();

    void env.ws.requestClosePanel('f1');
    await flush(env);
    expect(q(env, '.ndd-modal-overlay')!.textContent).toContain('Name is still empty');
    q(env, '[data-ndd-confirm-cancel]')!.click();
    await flush(env);
    expect(env.ws.isOpen('f1')).toBe(true);

    // The getter is re-read, so fixing the field changes what the next question says.
    panel.model.set({ name: 'Ada' });
    await env.stable();
    void env.ws.requestClosePanel('f1');
    await flush(env);
    expect(q(env, '.ndd-modal-overlay')!.textContent).not.toContain('Name is still empty');
    q(env, '[data-ndd-confirm-ok]')!.click();
    await flush(env);
    expect(env.ws.isOpen('f1')).toBe(false);
  });

  it('stops tracking when the panel is destroyed', async () => {
    const { env, panel } = await withForm();
    env.ws.closePanel('f1');
    await env.stable();
    // A write after destroy must not resurrect state for a panel that no longer exists.
    panel.form.name().markAsDirty();
    await env.stable();
    expect(env.ws.state().panels['f1']).toBeUndefined();
  });

  it('works inside a modal too: the same contract, through the overlay host', async () => {
    const env = await setup();
    const id = env.ws.overlays.openModal(SignalFormPanel, {}, { title: 'Modal form' });
    await env.stable();
    forms.get(id)!.form.name().markAsDirty();
    await env.stable();
    expect(env.ws.overlays.getInstance(id)!.dirty).toBe(true);
    expect(text(q(env, '.ndd-modal-title'))).toBe('Modal form *');
  });
});

// ─── Actions called from an effect ───────────────────────────────────────────

/**
 * `effect(() => panel.setTitle(...))` is the documented way to drive a title or a dirty flag
 * from a signal. Each action read state on its way — the workspace's panel record, an overlay's
 * instance signal — and tracked, so the calling effect came to depend on the state its own call
 * changed, and re-ran forever: the M14 demo's Terminal panel froze the page. Every action is
 * untracked now, and an unchanged title or dirty flag publishes nothing.
 */
const effectRuns = new Map<string, number>();

@Component({ selector: 'ndd-test-effect-driven', template: `<span>{{ count() }}</span>` })
class EffectDriven {
  readonly count = signal(0);
  constructor() {
    const panel = injectPanel();
    api.set(panel.id, panel);
    (window as unknown as Record<string, EffectDriven>)[`effect-${panel.id}`] = this;
    effect(() => {
      effectRuns.set(panel.id, (effectRuns.get(panel.id) ?? 0) + 1);
      panel.setTitle(`Log (${this.count()})`);
      panel.setDirty(this.count() > 0);
    });
  }
}
const driven = (id: string) => (window as unknown as Record<string, EffectDriven>)[`effect-${id}`]!;

describe('PanelRef actions called from an effect', () => {
  afterEach(() => effectRuns.clear());

  it('setTitle and setDirty in an effect of a docked panel run once per change, not forever', async () => {
    const env = await setup();
    env.ws.registry.register('driven', EffectDriven);
    env.ws.openPanel('d1', 'driven');
    await env.stable();
    expect(effectRuns.get('d1')).toBe(1);
    expect(env.ws.state().panels['d1']!.title).toBe('Log (0)');

    driven('d1').count.set(3);
    await env.stable();
    expect(effectRuns.get('d1')).toBe(2);
    expect(env.ws.state().panels['d1']!.title).toBe('Log (3)');
    expect(env.ws.state().panels['d1']!.dirty).toBe(true);

    // Unrelated workspace changes do not re-run it: the effect depends on `count` alone.
    env.ws.openPanel('other', 'form');
    env.ws.focusPanel('d1');
    await env.stable();
    expect(effectRuns.get('d1')).toBe(2);
  });

  it('the same holds inside a modal, through the overlay host', async () => {
    const env = await setup();
    const id = env.ws.overlays.openModal(EffectDriven, {}, { title: 'Modal' });
    await env.stable();
    expect(effectRuns.get(id)).toBe(1);
    driven(id).count.set(2);
    await env.stable();
    expect(effectRuns.get(id)).toBe(2);
    expect(env.ws.overlays.getInstance(id)!.dirty).toBe(true);
    expect(text(q(env, '.ndd-modal-title'))).toBe('Log (2) *');
  });

  it('an unchanged title or dirty flag publishes nothing', async () => {
    const env = await setup();
    env.ws.openPanel('p', 'form', { title: 'Same' });
    await env.stable();
    const before = env.ws.state();
    env.ws.updatePanelTitle('p', 'Same');
    env.ws.setPanelDirty('p', false);
    expect(env.ws.state()).toBe(before);
    env.ws.setPanelDirty('p', true);
    expect(env.ws.state()).not.toBe(before);
  });
});
