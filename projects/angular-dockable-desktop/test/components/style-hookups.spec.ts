/**
 * The class-name and stacking hookups the stylesheet depends on.
 *
 * Ported from vue-dockable-desktop `test/components/styleHookups.test.ts` (14 tests, names
 * preserved, `vdd-` → `ndd-`), itself a port of rdd's `StyleHookups.test.tsx`. Every case covers a
 * rule that **silently matched nothing**, because the class rendered was not the class the
 * selector named, or because an inline `z-index` overrode the rule that reads the stacking
 * variable. They assert the *rendered contract* rather than computed styles — jsdom loads no
 * stylesheet, so a computed-style assertion would pass whatever class was emitted. The other
 * half, that the rules apply on screen, is the M13 browser sweep.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddContextMenu } from '../../src/lib/context-menu/context-menu';
import { NddModals } from '../../src/lib/overlays/modals';
import { NddConfirm } from '../../src/lib/overlays/confirm';
import type { TaskbarVisibility } from '../../src/lib/desktop/taskbar';

@Component({ selector: 'ndd-test-mock-panel', template: '' })
class Panel {}

let fixture: ComponentFixture<unknown> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount, [data-ndd-menu]').forEach(el => el.remove());
  document.documentElement.style.removeProperty('--ndd-z-base');
  vi.useRealTimers();
});

async function mount<T>(ws: Workspace, type: new (...a: never[]) => T, inputs: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const f = TestBed.createComponent(type as never) as ComponentFixture<T>;
  fixture = f as ComponentFixture<unknown>;
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  await f.whenStable();
  return f;
}
const el = () => fixture!.nativeElement as HTMLElement;

// ─── the taskbar mode class ──────────────────────────────────────────────────
// The autohide overlay and peek-strip rules key off
// `.ndd-taskbar-footer-container.ndd-taskbar-mode-autohide`; an unprefixed mode class left the
// whole mode rendering as a plain always-on bar in rdd.

describe('the taskbar mode class', () => {
  /** `compact` and `autohide` show the bar only once something is minimised. */
  const withMinimised = async (taskbar: TaskbarVisibility) => {
    const ws = createWorkspace({ panels: { map: { component: Panel } } });
    await mount(ws, NddDesktop, { taskbar });
    ws.openPanel('map-1', 'map');
    ws.minimizePanel('map-1');
    await fixture!.whenStable();
    return el().querySelector('.ndd-taskbar-footer-container');
  };

  it.each(['always', 'compact', 'autohide'] as const)('renders the ndd- prefixed mode class for %s', async mode => {
    const bar = await withMinimised(mode);
    expect(bar).not.toBeNull();
    expect(bar!.classList).toContain(`ndd-taskbar-mode-${mode}`);
    // The unprefixed name is what the stylesheet does *not* match.
    expect(bar!.classList).not.toContain(`taskbar-mode-${mode}`);
  });

  it('pairs the mode class with the container class the autohide rules require', async () => {
    // The selector is `.ndd-taskbar-footer-container.ndd-taskbar-mode-autohide`; either half alone
    // matches nothing, so both have to be on the same element.
    const bar = await withMinimised('autohide');
    expect(bar).not.toBeNull();
    expect(bar!.classList).toContain('ndd-taskbar-footer-container');
    expect(bar!.classList).toContain('ndd-taskbar-mode-autohide');
  });
});

// ─── the confirmation alert class ────────────────────────────────────────────

describe('the confirmation alert class', () => {
  const withAlert = async (inputs: Record<string, unknown>) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); // standalone injectPanel
    await mount(createWorkspace({ panels: {} }), NddConfirm, { message: 'Discard?', ...inputs });
    warn.mockRestore();
    return el();
  };

  it.each(['info', 'warning', 'success', 'danger'] as const)('renders the ndd- prefixed alert class for %s', async alertType => {
    const root = await withAlert({ alert: 'Two fields are empty.', alertType });
    const banner = root.querySelector('.ndd-confirmation-alert');
    expect(banner).not.toBeNull();
    expect(banner!.classList).toContain(`ndd-confirmation-alert-${alertType}`);
    expect(banner!.classList).not.toContain(`confirmation-alert-${alertType}`);
  });

  it('renders no banner when `alert` is omitted', async () => {
    const root = await withAlert({ alertType: 'danger' });
    expect(root.querySelector('.ndd-confirmation-alert')).toBeNull();
  });
});

// ─── context-menu stacking ───────────────────────────────────────────────────
// .ndd-context-menu and .ndd-context-menu--submenu carry `calc(var(--ndd-z-base, 1000) + 8500/8501)`,
// which an inline z-index silently overrode in rdd — so `zIndexBase` never moved the menu.

describe('context-menu stacking', () => {
  const showMenu = async (items: unknown[]) => {
    const ws = createWorkspace({ panels: {} });
    await mount(ws, NddContextMenu);
    ws.showContextMenu({ x: 40, y: 60, items: items as never });
    await fixture!.whenStable();
    return ws;
  };

  it('leaves the main menu z-index to the stylesheet', async () => {
    await showMenu([{ label: 'Float Window', action: () => {} }]);
    const menu = document.querySelector('[data-ndd-menu]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.style.zIndex).toBe('');
    // Positioning stays inline — only stacking moved to CSS.
    expect(menu.style.position).toBe('fixed');
  });

  it('leaves the submenu z-index to the stylesheet', async () => {
    await showMenu([{ label: 'More', items: [{ label: 'Nested', action: () => {} }] }]);
    vi.useFakeTimers();
    const parent = document.querySelector('.ndd-context-menu__item--has-submenu') as HTMLElement;
    expect(parent).not.toBeNull();
    parent.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    vi.advanceTimersByTime(200); // past the 150ms submenu open delay
    fixture!.detectChanges();

    const submenu = document.querySelector('.ndd-context-menu--submenu') as HTMLElement;
    expect(submenu).not.toBeNull();
    expect(submenu.style.zIndex).toBe('');
  });

  it('zIndexBase moves the chrome, which is what the inline z-index used to defeat', async () => {
    // rdd's third case asserted that a caller's inline z-index still won — precisely what made
    // `zIndexBase` do nothing. So this asserts the replacement: the base reaches the document
    // element as a custom property, and the stylesheet's calc() picks it up.
    const ws = createWorkspace({ panels: { map: { component: Panel } }, zIndexBase: 4200 });
    await mount(ws, NddDesktop);
    expect(document.documentElement.style.getPropertyValue('--ndd-z-base')).toBe('4200');
    expect(ws.config.zIndexBase).toBe(4200);
  });

  it('a modal stacks against the variable rather than a literal', async () => {
    const ws = createWorkspace({ panels: {}, zIndexBase: 4200 });
    await mount(ws, NddModals);
    ws.overlays.openModal(Panel, {}, { title: 'M' });
    await fixture!.whenStable();
    const overlay = el().querySelector('.ndd-modal-overlay') as HTMLElement;
    // A literal would be frozen at build time; the calc() follows the base.
    expect(overlay.style.zIndex).toContain('var(--ndd-z-base');
  });

  it('the base is removed from the document element when the workspace is destroyed', async () => {
    const ws = createWorkspace({ panels: {}, zIndexBase: 7777 });
    const f = await mount(ws, NddDesktop);
    expect(document.documentElement.style.getPropertyValue('--ndd-z-base')).toBe('7777');
    f.destroy();
    fixture = null;
    // Left behind, it would shift a second workspace — or the host page's own chrome.
    expect(document.documentElement.style.getPropertyValue('--ndd-z-base')).toBe('');
  });
});

// ─── Accessibility hookups (M13) ─────────────────────────────────────────────

describe('accessibility hookups', () => {
  it('a tab is closed from the keyboard with Delete, and its × is hidden from assistive technology', async () => {
    const ws = createWorkspace({ panels: { map: { component: Panel } } });
    await mount(ws, NddDesktop);
    ws.openPanel('p', 'map');
    await fixture!.whenStable();
    const tab = el().querySelector<HTMLElement>('[data-ndd-tab="p"]')!;
    const x = el().querySelector<HTMLElement>('[data-ndd-close="p"]')!;
    // A focusable control inside role="tab" is a nested interactive; the × is pointer-only.
    expect(x.getAttribute('aria-hidden')).toBe('true');
    expect(x.hasAttribute('tabindex')).toBe(false);
    expect(tab.getAttribute('aria-keyshortcuts')).toBe('Delete');
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await fixture!.whenStable();
    expect(ws.isOpen('p')).toBe(false);
  });

  it('Delete goes through the close sequence, so a dirty tab still asks', async () => {
    const ws = createWorkspace({ panels: { map: { component: Panel } } });
    await mount(ws, NddDesktop);
    ws.openPanel('p', 'map');
    ws.setPanelDirty('p', true);
    await fixture!.whenStable();
    el().querySelector<HTMLElement>('[data-ndd-tab="p"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await fixture!.whenStable();
    // No <ndd-modals> here, so nothing can ask — and a dirty close refuses rather than discarding.
    expect(ws.isOpen('p')).toBe(true);
  });

  it('the toast container is a labelled region', async () => {
    const { NddToasts } = await import('../../src/lib/toast/toasts');
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(NddToasts);
    await fixture.whenStable();
    const host = document.querySelector('[data-ndd-toasts]')!;
    expect(host.getAttribute('role')).toBe('region');
    expect(host.getAttribute('aria-label')).toBe('Notifications');
  });
});
