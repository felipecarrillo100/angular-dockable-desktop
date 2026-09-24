/**
 * The panel host — Angular-only behaviour with no vdd counterpart: lazy panels, panel data as
 * the component's own `input()`s, and dependency injection reaching panels.
 */
import { Component, InjectionToken, inject, input } from '@angular/core';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { PanelDefinition, Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { injectPanel } from '../../src/lib/panel/panel-ref';

let created = 0;

@Component({
  selector: 'ndd-test-doc-panel',
  template: `<div class="doc" [attr.data-doc]="panelId()">{{ path() }}|{{ zoom() }}</div>`,
})
class DocPanel {
  readonly panelId = input('');
  readonly path = input('none');
  // eslint-disable-next-line @angular-eslint/no-input-rename -- the alias is what this suite tests
  readonly zoom = input(1, { alias: 'zoomLevel' });
  constructor() {
    created++;
  }
}

const THEME = new InjectionToken<string>('theme');

@Component({
  selector: 'ndd-test-themed-panel',
  template: `<span class="themed">{{ theme }}</span>`,
})
class ThemedPanel {
  protected readonly theme = inject(THEME, { optional: true }) ?? 'none';
}

@Component({
  selector: 'ndd-test-kind-panel',
  template: `<span class="kind">{{ panel.containerType() }}</span>`,
})
class KindPanel {
  protected readonly panel = injectPanel();
}

afterEach(() =>
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach((el) => el.remove()),
);

async function render(
  panels: Record<string, PanelDefinition>,
  host?: Type<unknown>,
): Promise<{ w: Workspace; stable: () => Promise<void> }> {
  created = 0;
  const w = createWorkspace({ panels });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(w)] });
  const fixture = TestBed.createComponent(host ?? NddDesktop);
  await fixture.whenStable();
  return { w, stable: () => fixture.whenStable() };
}

describe('lazy panels (loadComponent)', () => {
  it('shows a placeholder, then the real component, in the same panel element, created once', async () => {
    let release!: (t: Type<unknown>) => void;
    const loaded = new Promise<Type<unknown>>((r) => (release = r));
    const { w, stable } = await render({ doc: { loadComponent: () => loaded } });
    w.openPanel('d1', 'doc');
    await stable();
    const mount = document.querySelector('[data-ndd-panel="d1"]')!;
    expect(mount.querySelector('.ndd-panel-loading')).not.toBeNull();
    expect(mount.parentElement!.getAttribute('data-ndd-slot')).toBe('d1');

    release(DocPanel);
    await loaded;
    await stable();
    expect(document.querySelector('[data-ndd-panel="d1"]')).toBe(mount); // same element, same place
    expect(mount.querySelector('.ndd-panel-loading')).toBeNull();
    expect(mount.querySelector('[data-doc="d1"]')).not.toBeNull();
    expect(created).toBe(1);
  });

  it('a lazy panel closed before its chunk arrives is never created', async () => {
    let release!: (t: Type<unknown>) => void;
    const loaded = new Promise<Type<unknown>>((r) => (release = r));
    const { w, stable } = await render({ doc: { loadComponent: () => loaded } });
    w.openPanel('d1', 'doc');
    await stable();
    w.closePanel('d1');
    await stable();
    release(DocPanel);
    await loaded;
    await stable();
    expect(created).toBe(0);
    expect(document.querySelector('[data-ndd-panel="d1"]')).toBeNull();
  });

  it('two panels of one lazy kind share a single load', async () => {
    let loads = 0;
    const { w, stable } = await render({
      doc: { loadComponent: () => (loads++, Promise.resolve(DocPanel)) },
    });
    w.openPanel('d1', 'doc');
    w.openPanel('d2', 'doc');
    await stable();
    await Promise.resolve();
    await stable();
    expect(loads).toBe(1);
    expect(created).toBe(2);
  });
});

describe("panel data arrives as the component's own inputs", () => {
  it('applies props to declared inputs by public name and by alias, and sets panelId', async () => {
    const { w, stable } = await render({ doc: { component: DocPanel } });
    w.openPanel('d1', 'doc', { inputs: { path: '/a.md', zoomLevel: 2 } });
    await stable();
    expect(document.querySelector('[data-doc="d1"]')!.textContent).toBe('/a.md|2');
  });

  it('skips keys the component does not declare, without an error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { w, stable } = await render({ doc: { component: DocPanel } });
    w.openPanel('d1', 'doc', { inputs: { path: '/a.md', notAnInput: true } });
    await stable();
    expect(document.querySelector('[data-doc="d1"]')!.textContent).toBe('/a.md|1');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('applies new props when a layout is loaded, without re-creating the panel', async () => {
    const { w, stable } = await render({ doc: { component: DocPanel } });
    w.openPanel('d1', 'doc', { inputs: { path: '/a.md' } });
    await stable();
    const saved = JSON.parse(w.saveLayout());
    saved.panels.d1.props = { path: '/b.md' };
    w.loadLayout(JSON.stringify(saved));
    await stable();
    expect(document.querySelector('[data-doc="d1"]')!.textContent).toBe('/b.md|1');
    expect(created).toBe(1);
  });
});

describe('dependency injection reaches panels', () => {
  it('a panel can inject what is provided above <ndd-desktop>', async () => {
    @Component({
      selector: 'ndd-test-shell',
      imports: [NddDesktop],
      providers: [{ provide: THEME, useValue: 'nord' }],
      template: `<ndd-desktop />`,
    })
    class Shell {}
    const { w, stable } = await render({ themed: { component: ThemedPanel } }, Shell);
    w.openPanel('t', 'themed');
    await stable();
    expect(document.querySelector('.themed')!.textContent).toBe('nord');
  });

  it('containerType follows placement, and a minimised panel reports where it will return', async () => {
    const { w, stable } = await render({ kind: { component: KindPanel } });
    w.openPanel('k', 'kind');
    await stable();
    const kind = () => document.querySelector('[data-ndd-panel="k"] .kind')!.textContent;
    expect(kind()).toBe('dockable-panel');
    w.floatPanel('k');
    await stable();
    expect(kind()).toBe('floating-window');
    w.minimizePanel('k');
    await stable();
    expect(kind()).toBe('floating-window');
  });
});
