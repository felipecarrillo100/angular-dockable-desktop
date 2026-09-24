/**
 * Internationalisation: the message formatter, the built-in string table, reading direction, and
 * the consumer classes for the library's chrome.
 *
 * Ported from vue-dockable-desktop `test/core/i18n.test.ts` (25 tests, names preserved), itself a
 * port of rdd's `Internationalization.test.tsx`. The surface collapsed on the way over:
 *
 *   rdd                             ndd
 *   ─────────────────────────────   ──────────────────────────────────────────────────
 *   `useFormatMessage()`            `workspace.format()` — works outside components
 *   `formatLabel(label, fmt)`       still exported; `format()` is it, bound
 *   `usePredefinedMessages()`       `workspace.messages`
 *   `predefinedMessages` prop       `createWorkspace({ messages })`
 *   `useStyleClasses()`             `createWorkspace({ classes })`
 *   `useWindowManagerState().dir`   `workspace.dir()` / `isRtl()`, signals
 *
 * The `classes` tests are **stronger** than rdd's: they assert the classes reach the rendered
 * elements, which is the part that breaks. Message ids are `ndd.`-namespaced.
 */
import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { defaultMessages, formatLabel } from '../../src/lib/core/messages';
import { NddModals, NddSidePanels } from '../../src/lib/overlays/modals';
import { NddDesktop } from '../../src/lib/desktop/desktop';

@Component({ selector: 'ndd-test-inner', template: 'body' })
class Inner {}

let fixture: ComponentFixture<unknown> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach(el => el.remove());
});

async function mount<T>(ws: Workspace, host: new (...args: never[]) => T) {
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const f = TestBed.createComponent(host as never) as ComponentFixture<T>;
  fixture = f as ComponentFixture<unknown>;
  await f.whenStable();
  return { el: f.nativeElement as HTMLElement, stable: () => f.whenStable() };
}
const classesOf = (root: HTMLElement, selector: string) => Array.from(root.querySelector(selector)?.classList ?? []);

// ─── formatLabel ─────────────────────────────────────────────────────────────

describe('formatLabel helper', () => {
  it('returns a plain string unchanged', () => {
    expect(formatLabel('Close')).toBe('Close');
  });

  it('resolves an i18n descriptor through the formatter', () => {
    const fmt = (m: { id: string }) => `translated:${m.id}`;
    expect(formatLabel({ id: 'ndd.closeTab', defaultMessage: 'Close Tab' }, fmt)).toBe('translated:ndd.closeTab');
  });

  it('returns an empty string for an undefined label', () => {
    expect(formatLabel(undefined)).toBe('');
  });
});

// ─── direction ───────────────────────────────────────────────────────────────

describe('default direction', () => {
  it('should default to ltr direction', () => {
    const ws = createWorkspace({ panels: {} });
    expect(ws.state().dir).toBe('ltr');
    expect(ws.state().isRtl).toBe(false);
    expect(ws.dir()).toBe('ltr');
  });

  it('should initialise with rtl when the dir option is rtl', () => {
    const ws = createWorkspace({ panels: {}, dir: 'rtl' });
    expect(ws.state().dir).toBe('rtl');
    expect(ws.state().isRtl).toBe(true);
  });
});

describe('setDirection', () => {
  it('setDirection("rtl") switches state to RTL', () => {
    const ws = createWorkspace({ panels: {} });
    ws.setDirection('rtl');
    expect(ws.state().dir).toBe('rtl');
    expect(ws.state().isRtl).toBe(true);
  });

  it('setDirection("ltr") switches back from RTL', () => {
    const ws = createWorkspace({ panels: {}, dir: 'rtl' });
    ws.setDirection('ltr');
    expect(ws.state().dir).toBe('ltr');
    expect(ws.state().isRtl).toBe(false);
  });

  it('setDirection is idempotent (no state churn when the value is the same)', () => {
    const ws = createWorkspace({ panels: {} });
    // A computed over the state recomputes only when the state actually changes.
    let recomputes = 0;
    const probe = computed(() => {
      recomputes++;
      return ws.state();
    });
    probe();
    const before = recomputes;

    ws.setDirection('ltr'); // already ltr
    ws.setDirection('ltr');
    probe();
    expect(recomputes).toBe(before);

    ws.setDirection('rtl'); // a real change does notify
    probe();
    expect(recomputes).toBeGreaterThan(before);
  });
});

// ─── the default formatter ───────────────────────────────────────────────────

describe('default formatter (fallback)', () => {
  it('format is a callable function on the workspace', () => {
    // rdd needed `useFormatMessage()`, so formatting was only possible inside a component. This
    // works from a service, which is where a message often needs resolving.
    const ws = createWorkspace({ panels: {} });
    expect(typeof ws.format).toBe('function');
  });

  it('returns defaultMessage when one is provided', () => {
    const ws = createWorkspace({ panels: {} });
    expect(ws.format({ id: 'x.y', defaultMessage: 'Hello' })).toBe('Hello');
  });

  it('returns the id when there is no defaultMessage', () => {
    const ws = createWorkspace({ panels: {} });
    expect(ws.format({ id: 'x.y' })).toBe('x.y');
  });

  it('interpolates {placeholder} values', () => {
    const ws = createWorkspace({ panels: {} });
    expect(ws.format({ id: 'x', defaultMessage: 'Close {title} now', values: { title: 'Map' } })).toBe('Close Map now');
  });
});

describe('a custom formatMessage', () => {
  it('is used instead of the default', () => {
    const ws = createWorkspace({ panels: {}, formatMessage: m => `[${m.id}]` });
    expect(ws.format({ id: 'ndd.closeTab', defaultMessage: 'Close Tab' })).toBe('[ndd.closeTab]');
    // A plain string is not a descriptor, so it never reaches the formatter.
    expect(ws.format('literal')).toBe('literal');
  });
});

// ─── the built-in message table ──────────────────────────────────────────────

describe('the built-in messages', () => {
  it('is a non-empty object', () => {
    const ws = createWorkspace({ panels: {} });
    expect(typeof ws.messages).toBe('object');
    expect(Object.keys(ws.messages).length).toBeGreaterThan(0);
  });

  it('contains the expected built-in keys', () => {
    const ws = createWorkspace({ panels: {} });
    for (const key of ['closeTab', 'minimizePanel', 'floatWindow', 'unsavedChangesMessage']) expect(ws.messages).toHaveProperty(key);
  });

  it('allows overriding one message through the messages option', () => {
    const ws = createWorkspace({ panels: {}, messages: { closeTab: { id: 'custom.closeTab', defaultMessage: 'Dismiss' } } });
    expect(ws.messages.closeTab).toEqual({ id: 'custom.closeTab', defaultMessage: 'Dismiss' });
  });

  it('a partial override preserves every key it did not name', () => {
    const ws = createWorkspace({ panels: {}, messages: { closeTab: { id: 'custom.closeTab', defaultMessage: 'Dismiss' } } });
    expect(ws.messages.minimizePanel).toBeDefined();
    expect(typeof ws.messages.minimizePanel.id).toBe('string');
    // Every default key survives, not just the one asserted above.
    for (const key of Object.keys(defaultMessages)) expect(ws.messages).toHaveProperty(key);
  });

  it('unsavedChangesMessage carries a {title} placeholder by default', () => {
    const ws = createWorkspace({ panels: {} });
    const message = ws.messages.unsavedChangesMessage;
    expect(message.defaultMessage ?? message.id).toContain('{title}');
  });

  it('every default message id is namespaced, so an app message table cannot collide', () => {
    for (const [key, message] of Object.entries(defaultMessages)) expect(message.id, key).toMatch(/^ndd\./);
  });
});

// ─── consumer classes for the library's chrome ───────────────────────────────

@Component({ selector: 'ndd-test-modals-only', imports: [NddModals], template: '<ndd-modals />' })
class ModalsOnly {}

@Component({
  selector: 'ndd-test-all-hosts',
  imports: [NddDesktop, NddModals, NddSidePanels],
  template: '<ndd-desktop /><ndd-side-panels /><ndd-modals />',
})
class AllHosts {}

describe('the classes option', () => {
  it('returns every field, empty, when nothing is configured', () => {
    const ws = createWorkspace({ panels: {} });
    expect(ws.classes).toEqual({ modal: '', modalBody: '', sidePanel: '', sidePanelBody: '', window: '', windowBody: '' });
  });

  it('a configured modal class reaches the rendered modal', async () => {
    // rdd's equivalent asserted only that its hook returned the config — true of any object and
    // unable to fail. What breaks is the hookup, so that is what is asserted.
    const ws = createWorkspace({ panels: {}, classes: { modal: 'mui-Paper', modalBody: 'p-4' } });
    const { el, stable } = await mount(ws, ModalsOnly);
    ws.overlays.openModal(Inner, {}, { title: 'Titled' });
    await stable();
    expect(classesOf(el, '.ndd-modal-window')).toContain('mui-Paper');
    expect(classesOf(el, '.ndd-modal-body')).toContain('p-4');
  });

  it('every configured class reaches its own element', async () => {
    const ws = createWorkspace({
      panels: { p: { component: Inner } },
      classes: {
        modal: 'c-modal',
        modalBody: 'c-modal-body',
        sidePanel: 'c-side',
        sidePanelBody: 'c-side-body',
        window: 'c-window',
        windowBody: 'c-window-body',
      },
    });
    const { el, stable } = await mount(ws, AllHosts);
    ws.overlays.openModal(Inner, {}, { title: 'M' });
    await ws.overlays.openLeftPanel(Inner, {}, { title: 'S' });
    ws.openPanel('p', 'p');
    ws.floatPanel('p');
    await stable();

    expect(classesOf(el, '.ndd-modal-window')).toContain('c-modal');
    expect(classesOf(el, '.ndd-modal-body')).toContain('c-modal-body');
    expect(classesOf(el, '.ndd-side-panel-window')).toContain('c-side');
    expect(classesOf(el, '.ndd-side-panel-body')).toContain('c-side-body');
    expect(classesOf(el, '.ndd-floating-window')).toContain('c-window');
    expect(classesOf(el, '.ndd-floating-window-body')).toContain('c-window-body');
  });

  it("adds to the library's own classes rather than replacing them", async () => {
    const ws = createWorkspace({ panels: {}, classes: { modal: 'mine' } });
    const { el, stable } = await mount(ws, ModalsOnly);
    ws.overlays.openModal(Inner, {}, { title: 'M', size: 'small' });
    await stable();
    const classes = classesOf(el, '.ndd-modal-window');
    expect(classes).toContain('mine');
    expect(classes).toContain('ndd-modal-window');
    expect(classes).toContain('ndd-modal-size-small');
  });
});

// ─── Every title the library stores ──────────────────────────────────────────

describe('a title the library stores', () => {
  it('accepts a descriptor everywhere it is stored, and resolves it through the workspace', () => {
    const locale = signal<'es' | 'ru'>('es');
    const table: Record<'es' | 'ru', Record<string, string>> = { es: { 'x.title': 'Título' }, ru: { 'x.title': 'Заголовок' } };
    const ws = createWorkspace({ panels: {}, formatMessage: m => table[locale()][m.id] ?? m.defaultMessage ?? m.id });
    const descriptor = { id: 'x.title', defaultMessage: 'Title' };

    // One descriptor, resolved twice: the resolution point every stored title goes through.
    expect(ws.format(descriptor)).toBe('Título');
    locale.set('ru');
    expect(ws.format(descriptor)).toBe('Заголовок');
  });

  it('resolves a plain string without consulting the formatter', () => {
    let calls = 0;
    const ws = createWorkspace({
      panels: {},
      formatMessage: m => {
        calls += 1;
        return m.defaultMessage ?? m.id;
      },
    });
    expect(ws.format('Already text')).toBe('Already text');
    expect(calls).toBe(0);
  });
});

// ─── Angular additions ───────────────────────────────────────────────────────

describe('a locale switch reaches rendered chrome with no reopen', () => {
  it("a formatter reading a signal re-renders the library's own labels", async () => {
    const locale = signal<'en' | 'es'>('en');
    const table: Record<string, string> = { 'ndd.closeTab': 'Cerrar pestaña' };
    const ws = createWorkspace({
      panels: { p: { component: Inner } },
      formatMessage: m => (locale() === 'es' ? (table[m.id] ?? m.defaultMessage ?? m.id) : (m.defaultMessage ?? m.id)),
    });
    const { el, stable } = await mount(ws, AllHosts);
    ws.openPanel('p', 'p');
    await stable();
    const close = () => el.querySelector('[data-ndd-close="p"]')!.getAttribute('title');
    expect(close()).toBe('Close Tab');
    locale.set('es');
    await stable();
    expect(close()).toBe('Cerrar pestaña');
  });
});
