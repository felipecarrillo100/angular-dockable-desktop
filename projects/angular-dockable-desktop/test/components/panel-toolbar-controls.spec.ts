/**
 * The panel-toolbar controls: button, toggle, separator, spacer, item, centre, search.
 *
 * Ported from vue-dockable-desktop `test/components/panelToolbarControls.test.ts` (16 tests,
 * names preserved, `Vdd` → `Ndd`). Two surface changes, both Angular idiom:
 *
 *   - `<ndd-toolbar-button>` has no `click` output: its inner button's native `click` bubbles to
 *     the element, so `(click)` works as on any button and — like a native button — fires nothing
 *     while disabled. vdd's `emitted('click')` is a listener on the element here.
 *   - `<ndd-toolbar-search>`'s `select` event is `(resultSelect)`: an output named like a native
 *     DOM event would also fire for the input's own `select` event.
 */
import { Component, signal } from '@angular/core';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import {
  NddToolbarButton,
  NddToolbarCenter,
  NddToolbarItem,
  NddToolbarSeparator,
  NddToolbarSpacer,
  NddToolbarToggle,
} from '../../src/lib/panel-overlay/toolbar-controls';
import { NddToolbarSearch } from '../../src/lib/panel-overlay/toolbar-search';
import type { SearchResult } from '../../src/lib/panel-overlay/toolbar-search';

let fixture: ComponentFixture<unknown> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.querySelectorAll('[data-ndd-search-results]').forEach(el => el.remove());
  vi.useRealTimers();
});

async function mount<T>(type: Type<T>, inputs: Record<string, unknown> = {}): Promise<ComponentFixture<T>> {
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(createWorkspace({ panels: {} }))] });
  const f = TestBed.createComponent(type);
  fixture = f as ComponentFixture<unknown>;
  for (const [key, value] of Object.entries(inputs)) f.componentRef.setInput(key, value);
  await f.whenStable();
  return f;
}
const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
const button = (f: ComponentFixture<unknown>) => el(f).querySelector('button')!;

// ─── button ──────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-button-host',
  imports: [NddToolbarButton],
  template: `<ndd-toolbar-button [title]="title()" [disabled]="disabled()" (click)="clicks = clicks + 1"><span>icon</span></ndd-toolbar-button>`,
})
class ButtonHost {
  readonly title = signal('Zoom to fit');
  readonly disabled = signal(false);
  clicks = 0;
}

describe('NddToolbarButton', () => {
  it('renders its content, its accessible name, and fires click', async () => {
    const f = await mount(ButtonHost);
    const b = button(f);
    expect(b.classList).toContain('ndd-panel-toolbar-btn');
    expect(b.getAttribute('title')).toBe('Zoom to fit');
    expect(b.getAttribute('aria-label')).toBe('Zoom to fit');
    expect(b.textContent?.trim()).toBe('icon');

    b.click();
    expect(f.componentInstance.clicks).toBe(1);
  });

  it('does not fire when disabled', async () => {
    const f = await mount(ButtonHost);
    f.componentInstance.disabled.set(true);
    await f.whenStable();
    expect(button(f).hasAttribute('disabled')).toBe(true);
    button(f).click();
    expect(f.componentInstance.clicks).toBe(0);
  });

  it('carries its own variant when given one, and none when not', async () => {
    expect(button(await mount(NddToolbarButton, { variant: 'filled' })).getAttribute('data-variant')).toBe('filled');
    fixture!.destroy();
    TestBed.resetTestingModule();
    // Absent rather than empty: the toolbar's own `data-btn-variant` is what should win.
    expect(button(await mount(NddToolbarButton)).hasAttribute('data-variant')).toBe(false);
  });
});

// ─── toggle ──────────────────────────────────────────────────────────────────

describe('NddToolbarToggle', () => {
  it('reflects and reports its model, and sets aria-pressed', async () => {
    // rdd took `active` plus `onToggle` and left flipping it to the caller; the model is both.
    const f = await mount(NddToolbarToggle, { title: 'Grid', active: false });
    const seen: boolean[] = [];
    f.componentInstance.active.subscribe(v => seen.push(v));
    const b = button(f);
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.classList).not.toContain('ndd-panel-toolbar-btn--active');

    b.click();
    expect(seen).toEqual([true]);

    f.componentRef.setInput('active', true);
    await f.whenStable();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.classList).toContain('ndd-panel-toolbar-btn--active');

    b.click();
    expect(seen.at(-1)).toBe(false);
  });

  it('does not report when disabled', async () => {
    const f = await mount(NddToolbarToggle, { disabled: true, active: false });
    const seen: boolean[] = [];
    f.componentInstance.active.subscribe(v => seen.push(v));
    button(f).click();
    expect(seen).toEqual([]);
  });
});

// ─── the layout pieces ───────────────────────────────────────────────────────

describe('the toolbar layout pieces', () => {
  it.each([
    [NddToolbarSeparator, 'ndd-panel-toolbar__sep'],
    [NddToolbarSpacer, 'ndd-panel-toolbar__spacer'],
  ] as const)('renders its own class and is hidden from assistive tech', async (component, expected) => {
    const f = await mount(component as Type<unknown>);
    expect(el(f).classList).toContain(expected);
    // Decorative: a separator or a spacer announced to a screen reader is noise.
    expect(el(f).getAttribute('aria-hidden')).toBe('true');
  });

  @Component({ selector: 'ndd-test-item-host', imports: [NddToolbarItem], template: '<ndd-toolbar-item><span>content</span></ndd-toolbar-item>' })
  class ItemHost {}
  @Component({ selector: 'ndd-test-center-host', imports: [NddToolbarCenter], template: '<ndd-toolbar-center><span>content</span></ndd-toolbar-center>' })
  class CenterHost {}

  it.each([
    [ItemHost, 'ndd-panel-toolbar__item'],
    [CenterHost, 'ndd-panel-toolbar__center'],
  ] as const)('wraps its content without announcing itself', async (host, expected) => {
    const f = await mount(host as Type<unknown>);
    const wrapper = el(f).firstElementChild as HTMLElement;
    expect(wrapper.classList).toContain(expected);
    expect(wrapper.textContent).toBe('content');
    expect(wrapper.hasAttribute('aria-hidden')).toBe(false);
  });
});

// ─── search ──────────────────────────────────────────────────────────────────

describe('NddToolbarSearch', () => {
  const setup = async (search: (q: string, signal: AbortSignal) => SearchResult[] | Promise<SearchResult[]>) => {
    const f = await mount(NddToolbarSearch, { search });
    const selected: SearchResult[] = [];
    f.componentInstance.resultSelect.subscribe(r => selected.push(r));
    return { f, selected };
  };
  const results = () => Array.from(document.querySelectorAll('[data-ndd-search-result]'));
  const q = (f: ComponentFixture<unknown>, s: string) => el(f).querySelector<HTMLElement>(s);
  const toggle = async (f: ComponentFixture<unknown>) => {
    q(f, '[data-ndd-search-toggle]')!.click();
    await f.whenStable();
  };
  /** vdd's `setValue`: set the value and fire `input`. Under fake timers, render by hand. */
  const type = (f: ComponentFixture<unknown>, value: string) => {
    const input = q(f, '[data-ndd-search-input]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    f.detectChanges();
  };

  it('starts collapsed and expands into an input', async () => {
    const { f } = await setup(() => []);
    expect(q(f, '[data-ndd-search-input]')).toBeNull();
    await toggle(f);
    expect(q(f, '[data-ndd-search-input]')).not.toBeNull();
  });

  it('debounces, then shows grouped results teleported out of the toolbar', async () => {
    const search = vi.fn(() => [
      { id: 'a', label: 'Alpha', description: 'first', group: 'Layers' },
      { id: 'b', label: 'Beta', group: 'Layers' },
    ]);
    const { f } = await setup(search);
    await toggle(f);
    vi.useFakeTimers();
    type(f, 'al');

    // Not yet: the field waits before asking, so typing does not fire a request per keystroke.
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    f.detectChanges();
    expect(search).toHaveBeenCalledTimes(1);
    expect(results()).toHaveLength(2);
    // Portalled, so the toolbar's own bounds cannot clip it.
    expect(document.querySelector('[data-ndd-search-results]')!.parentElement).toBe(document.body);
    expect(document.querySelector('.ndd-panel-toolbar-search__group')!.textContent).toBe('Layers');
  });

  it('emits resultSelect and collapses when a result is chosen', async () => {
    const { f, selected } = await setup(() => [{ id: 'a', label: 'Alpha' }]);
    await toggle(f);
    vi.useFakeTimers();
    type(f, 'al');
    await vi.advanceTimersByTimeAsync(400);
    f.detectChanges();

    (results()[0] as HTMLElement).click();
    f.detectChanges();
    expect(selected).toEqual([{ id: 'a', label: 'Alpha' }]);
    expect(q(f, '[data-ndd-search-input]')).toBeNull();
    expect(results()).toHaveLength(0);
  });

  it('an emptied query clears the results without asking again', async () => {
    const search = vi.fn(() => [{ id: 'a', label: 'Alpha' }]);
    const { f } = await setup(search);
    await toggle(f);
    vi.useFakeTimers();
    type(f, 'al');
    await vi.advanceTimersByTimeAsync(400);
    f.detectChanges();
    expect(results()).toHaveLength(1);

    type(f, '   ');
    await vi.advanceTimersByTimeAsync(400);
    f.detectChanges();
    expect(results()).toHaveLength(0);
    expect(search).toHaveBeenCalledTimes(1); // whitespace is not a query
  });

  it('aborts a superseded request and discards its result', async () => {
    // The stale-result race: a slow request for an earlier query must not overwrite a fast one
    // for a later query. The component discards a resolved-but-aborted result as well — an abort
    // cannot retract a promise that has already settled.
    const signals: AbortSignal[] = [];
    const search = (query: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<SearchResult[]>(resolve => {
        setTimeout(() => resolve([{ id: query, label: query }]), query === 'slow' ? 500 : 10);
      });
    };
    const { f } = await setup(search);
    await toggle(f);
    vi.useFakeTimers();

    type(f, 'slow');
    await vi.advanceTimersByTimeAsync(350); // the request is now in flight
    type(f, 'fast');
    await vi.advanceTimersByTimeAsync(350);
    f.detectChanges();

    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);

    // Let the slow one land. It must not replace the fast one's result.
    await vi.advanceTimersByTimeAsync(500);
    f.detectChanges();
    expect(results().map(r => r.getAttribute('data-ndd-search-result'))).toEqual(['fast']);
  });

  it('Escape collapses the field', async () => {
    const { f } = await setup(() => []);
    await toggle(f);
    q(f, '[data-ndd-search-input]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await f.whenStable();
    expect(q(f, '[data-ndd-search-input]')).toBeNull();
  });

  it('a rejected search shows nothing rather than surfacing the error', async () => {
    const { f } = await setup(() => Promise.reject(new Error('network')));
    await toggle(f);
    vi.useFakeTimers();
    type(f, 'x');
    await vi.advanceTimersByTimeAsync(400);
    f.detectChanges();
    expect(results()).toHaveLength(0);
  });
});
