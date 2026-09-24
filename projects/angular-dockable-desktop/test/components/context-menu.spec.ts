/**
 * Context menus.
 *
 * Ported from vue-dockable-desktop `test/components/contextMenu.test.ts` (33 tests, names
 * preserved, `vdd-` → `ndd-`), including the D1 regression *through the real menu*: rdd's
 * taskbar offered a "Maximize" whose action did nothing, because `maximizePanel` only mapped over
 * floating windows. vdd's default slot is the `nddContextMenuTemplate` directive here, and
 * `usePanelContextMenu` is `injectPanelContextMenu`. Timer tests switch to fake timers after the
 * first render (Angular's zoneless scheduler uses timers itself).
 *
 * Angular-port additions at the end: the WAI-ARIA menu keyboard pattern (ADR 0005) and the
 * `[nddContextMenu]` directive.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { PanelDefinition, Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddContextMenu, NddContextMenuTemplate } from '../../src/lib/context-menu/context-menu';
import {
  NddContextMenuTrigger,
  injectPanelContextMenu,
} from '../../src/lib/context-menu/inject-context-menu';
import { clampToViewport, menuPosition } from '../../src/lib/core/context-menu';
import type { ContextMenuItem } from '../../src/lib/core/context-menu';

@Component({ selector: 'ndd-test-mock', template: 'panel' })
class P {}
@Component({ selector: 'ndd-test-locked', template: '' })
class Locked {}

let taskbarEvents: string[] = [];

@Component({
  selector: 'ndd-test-shell',
  imports: [NddDesktop, NddContextMenu],
  template: `<ndd-desktop (taskbarContextMenu)="onTaskbar($event.panelId)" /><ndd-context-menu />`,
})
class Shell {
  onTaskbar(id: string) {
    taskbarEvents.push(id);
  }
}

afterEach(() => {
  document
    .querySelectorAll('.ndd-panel-store, .ndd-panel-mount, [data-ndd-menu], [data-ndd-submenu]')
    .forEach((el) => el.remove());
  vi.useRealTimers();
});

interface Env {
  ws: Workspace;
  fixture: ComponentFixture<unknown>;
  el: HTMLElement;
  stable: () => Promise<void>;
}

async function mountWith(
  ws: Workspace,
  root: new (...a: never[]) => unknown = Shell,
): Promise<Env> {
  taskbarEvents = [];
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(root as never) as ComponentFixture<unknown>;
  await fixture.whenStable();
  return {
    ws,
    fixture,
    el: fixture.nativeElement as HTMLElement,
    stable: () => fixture.whenStable(),
  };
}

const setup = (dir?: 'ltr' | 'rtl', panels?: Record<string, PanelDefinition>) =>
  mountWith(
    createWorkspace({
      panels: panels ?? {
        map: { component: P },
        locked: {
          component: Locked,
          defaultOptions: { canClose: false, canMinimize: false, canDrag: false },
        },
      },
      ...(dir ? { dir } : {}),
    }),
  );

const menuLabels = () =>
  Array.from(document.querySelectorAll('[data-ndd-menu-item], [data-ndd-menu-submenu]')).map(
    (el) => el.getAttribute('data-ndd-menu-item') ?? el.getAttribute('data-ndd-menu-submenu'),
  );
const clickItem = (label: string) =>
  document.querySelector<HTMLElement>(`[data-ndd-menu-item="${label}"]`)?.click();
const rightClick = (el: Element) =>
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
const enter = (el: Element) =>
  el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
const leave = (el: Element) =>
  el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

describe('positioning is pure and testable', () => {
  it('reads a position from a mouse event, a touch, or explicit coordinates', () => {
    expect(menuPosition({ items: [], x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(
      menuPosition({ items: [], event: new MouseEvent('contextmenu', { clientX: 5, clientY: 6 }) }),
    ).toEqual({ x: 5, y: 6 });
    expect(menuPosition({ items: [] })).toEqual({ x: 0, y: 0 });
  });

  it('pulls a menu back inside the viewport', () => {
    const viewport = { width: 1000, height: 800 };
    expect(clampToViewport({ x: 950, y: 100 }, { width: 200, height: 100 }, viewport)).toEqual({
      x: 792,
      y: 100,
    });
    expect(clampToViewport({ x: 100, y: 780 }, { width: 200, height: 100 }, viewport)).toEqual({
      x: 100,
      y: 692,
    });
    expect(clampToViewport({ x: -50, y: -50 }, { width: 200, height: 100 }, viewport)).toEqual({
      x: 8,
      y: 8,
    });
  });

  it('leaves a menu that already fits exactly where it was asked for', () => {
    expect(
      clampToViewport(
        { x: 100, y: 100 },
        { width: 200, height: 100 },
        { width: 1000, height: 800 },
      ),
    ).toEqual({ x: 100, y: 100 });
  });
});

describe('the menu host renders what the workspace has pending', () => {
  it('renders nothing until a menu is requested', async () => {
    await setup();
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
  });

  it('renders items, separators and submenus', async () => {
    const { ws, stable } = await setup();
    ws.showContextMenu({
      x: 10,
      y: 10,
      items: [
        { label: 'One', action: () => {} },
        { separator: true },
        { label: 'More', items: [{ label: 'Nested', action: () => {} }] },
      ],
    });
    await stable();
    expect(menuLabels()).toEqual(['One', 'More']);
    expect(document.querySelectorAll('.ndd-context-menu__separator').length).toBe(1);
  });

  it('can be opened from outside any component', async () => {
    const { ws, stable } = await setup();
    // The whole point of the request being state: a service or a plain module can do this.
    ws.showContextMenu({ x: 1, y: 1, items: [{ label: 'From a module', action: () => {} }] });
    await stable();
    expect(menuLabels()).toEqual(['From a module']);
  });

  it("runs an item's action and closes", async () => {
    const { ws, stable } = await setup();
    const action = vi.fn();
    ws.showContextMenu({ x: 10, y: 10, items: [{ label: 'Go', action }] });
    await stable();
    clickItem('Go');
    await stable();
    expect(action).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
  });

  it('does not run a disabled item, and leaves the menu open', async () => {
    const { ws, stable } = await setup();
    const action = vi.fn();
    ws.showContextMenu({ x: 10, y: 10, items: [{ label: 'Nope', action, disabled: true }] });
    await stable();
    clickItem('Nope');
    await stable();
    expect(action).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ndd-menu]')).not.toBeNull();
  });

  it('renders a checkbox column only when asked, and reflects its value', async () => {
    const { ws, stable } = await setup();
    ws.showContextMenu({
      x: 10,
      y: 10,
      items: [
        { label: 'On', checkbox: { value: true } },
        { label: 'Off', checkbox: { value: false } },
        { label: 'Hidden', checkbox: { value: true, active: false } },
        { label: 'Plain' },
      ],
    });
    await stable();
    const box = (label: string) =>
      document.querySelector(`[data-ndd-menu-item="${label}"] .ndd-context-menu__checkbox`);
    expect(box('On')?.classList.contains('ndd-context-menu__checkbox--checked')).toBe(true);
    expect(box('Off')?.classList.contains('ndd-context-menu__checkbox--checked')).toBe(false);
    expect(box('Hidden')).toBeNull();
    expect(box('Plain')).toBeNull();
    expect(document.querySelector('[data-ndd-menu-item="On"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('treats checkbox.enabled: false as disabled', async () => {
    const { ws, stable } = await setup();
    const action = vi.fn();
    ws.showContextMenu({
      x: 10,
      y: 10,
      items: [{ label: 'Locked', action, checkbox: { value: true, enabled: false } }],
    });
    await stable();
    clickItem('Locked');
    expect(action).not.toHaveBeenCalled();
  });

  it('resolves i18n descriptors in labels', async () => {
    const { ws, stable } = await mountWith(
      createWorkspace({ formatMessage: (m) => `[${m.id}]` }),
      NddContextMenu,
    );
    ws.showContextMenu({
      x: 1,
      y: 1,
      items: [{ label: { id: 'menu.save', defaultMessage: 'Save' } }],
    });
    await stable();
    expect(menuLabels()).toEqual(['[menu.save]']);
  });

  it('passes a cyAction through as a test hook', async () => {
    const { ws, stable } = await setup();
    ws.showContextMenu({ x: 1, y: 1, items: [{ label: 'Tagged', cyAction: 'save-button' }] });
    await stable();
    expect(document.querySelector('[data-cy-action="save-button"]')).not.toBeNull();
  });
});

describe('submenus', () => {
  const openWith = async (items: Parameters<Workspace['showContextMenu']>[0]['items']) => {
    const env = await setup();
    env.ws.showContextMenu({ x: 10, y: 10, items });
    await env.stable();
    vi.useFakeTimers();
    return env;
  };

  it('opens after a short rest on the parent, not immediately', async () => {
    const { fixture } = await openWith([{ label: 'More', items: [{ label: 'Nested' }] }]);
    const parent = document.querySelector('[data-ndd-menu-submenu="More"]')!;
    enter(parent);
    fixture.detectChanges();
    expect(document.querySelector('[data-ndd-submenu]')).toBeNull();
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(document.querySelector('[data-ndd-submenu]')).not.toBeNull();
    expect(parent.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes after a grace period once the pointer leaves, so it can be travelled into', async () => {
    const { fixture } = await openWith([{ label: 'More', items: [{ label: 'Nested' }] }]);
    const parent = document.querySelector('[data-ndd-menu-submenu="More"]')!;
    enter(parent);
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    leave(parent);
    vi.advanceTimersByTime(100);
    fixture.detectChanges();
    expect(document.querySelector('[data-ndd-submenu]')).not.toBeNull(); // still within the grace period
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(document.querySelector('[data-ndd-submenu]')).toBeNull();
  });

  it('running a nested item closes the whole menu', async () => {
    const action = vi.fn();
    const { fixture } = await openWith([{ label: 'More', items: [{ label: 'Nested', action }] }]);
    enter(document.querySelector('[data-ndd-menu-submenu="More"]')!);
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    document
      .querySelector<HTMLElement>('[data-ndd-submenu] [data-ndd-menu-item="Nested"]')!
      .click();
    fixture.detectChanges();
    expect(action).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
  });

  it('switching to a different parent closes the previous submenu', async () => {
    const { fixture } = await openWith([
      { label: 'A', items: [{ label: 'A1' }] },
      { label: 'B', items: [{ label: 'B1' }] },
    ]);
    const enterParent = (label: string) =>
      enter(document.querySelector(`[data-ndd-menu-submenu="${label}"]`)!);
    enterParent('A');
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(document.querySelector('[data-ndd-submenu] [data-ndd-menu-item="A1"]')).not.toBeNull();
    enterParent('B');
    fixture.detectChanges();
    expect(document.querySelector('[data-ndd-submenu]')).toBeNull(); // closed at once
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(document.querySelector('[data-ndd-submenu] [data-ndd-menu-item="B1"]')).not.toBeNull();
  });

  it('hovering a plain item closes an open submenu after the grace period', async () => {
    const { fixture } = await openWith([
      { label: 'More', items: [{ label: 'Nested' }] },
      { label: 'Plain' },
    ]);
    enter(document.querySelector('[data-ndd-menu-submenu="More"]')!);
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    enter(document.querySelector('[data-ndd-menu-item="Plain"]')!);
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(document.querySelector('[data-ndd-submenu]')).toBeNull();
  });
});

describe('dismissal', () => {
  it('closes on Escape', async () => {
    const { ws, stable } = await setup();
    ws.showContextMenu({ x: 10, y: 10, items: [{ label: 'One' }] });
    await stable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await stable();
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
  });

  it('closes on a pointerdown outside, in the capture phase', async () => {
    const { ws, stable } = await setup();
    ws.showContextMenu({ x: 10, y: 10, items: [{ label: 'One' }] });
    await stable();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await stable();
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
  });

  it('also closes on a bubbled click, which survives stopPropagation on pointerdown', async () => {
    const { ws, stable } = await setup();
    const canvas = document.createElement('div');
    canvas.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(canvas);
    ws.showContextMenu({ x: 10, y: 10, items: [{ label: 'One' }] });
    await stable();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await stable();
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
    canvas.remove();
  });

  it('does not close on a pointerdown inside the menu', async () => {
    const { ws, stable } = await setup();
    ws.showContextMenu({ x: 10, y: 10, items: [{ label: 'One' }] });
    await stable();
    document
      .querySelector('[data-ndd-menu]')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await stable();
    expect(document.querySelector('[data-ndd-menu]')).not.toBeNull();
  });
});

describe('the standard panel menu', () => {
  it('offers float, minimise and close for a tab', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    await stable();
    rightClick(el.querySelector('[data-ndd-tab="a"]')!);
    await stable();
    expect(menuLabels()).toEqual(['Float Window', 'Minimize Panel', 'Close Tab']);
  });

  it('omits what the panel has opted out of, rather than disabling it', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('l', 'locked');
    await stable();
    rightClick(el.querySelector('[data-ndd-tab="l"]')!);
    await stable();
    // canDrag, canMinimize and canClose are all false: an action a panel has opted out of is not
    // a temporarily unavailable action, so it is absent — and an empty menu does not open.
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
  });

  it('appends items the panel contributed, behind a separator', async () => {
    @Component({ selector: 'ndd-test-contrib', template: '' })
    class Contributing {
      constructor() {
        injectPanelContextMenu(() => [
          { label: 'Save', action: () => {} },
          { label: 'Revert', disabled: true },
        ]);
      }
    }
    const { ws, el, stable } = await setup(undefined, { doc: { component: Contributing } });
    ws.openPanel('d', 'doc');
    await stable();
    rightClick(el.querySelector('[data-ndd-tab="d"]')!);
    await stable();
    expect(menuLabels()).toEqual(['Float Window', 'Minimize Panel', 'Close Tab', 'Save', 'Revert']);
    expect(document.querySelectorAll('.ndd-context-menu__separator').length).toBe(2);
  });

  it('re-reads contributed items each time, so state-driven changes work', async () => {
    let enabled = false;
    @Component({ selector: 'ndd-test-contrib2', template: '' })
    class Contributing {
      constructor() {
        injectPanelContextMenu(() => (enabled ? [{ label: 'Publish' }] : []));
      }
    }
    const { ws, el, stable } = await setup(undefined, { doc: { component: Contributing } });
    ws.openPanel('d', 'doc');
    await stable();
    rightClick(el.querySelector('[data-ndd-tab="d"]')!);
    await stable();
    expect(menuLabels()).not.toContain('Publish');
    ws.closeContextMenu();
    await stable();
    enabled = true;
    rightClick(el.querySelector('[data-ndd-tab="d"]')!);
    await stable();
    expect(menuLabels()).toContain('Publish');
  });

  it("opens from a floating window's title bar too", async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('f', 'map', { initialTarget: 'floating' });
    await stable();
    rightClick(el.querySelector('[data-ndd-titlebar="f"]')!);
    await stable();
    expect(menuLabels()).toContain('Minimize Panel');
  });

  it('shows a more-actions button on a window only when the panel contributed items', async () => {
    @Component({ selector: 'ndd-test-contrib3', template: '' })
    class Contributing {
      constructor() {
        injectPanelContextMenu(() => [{ label: 'Export' }]);
      }
    }
    const { ws, el, stable } = await setup(undefined, {
      plain: { component: P },
      doc: { component: Contributing },
    });
    ws.openPanel('p', 'plain', { initialTarget: 'floating' });
    ws.openPanel('d', 'doc', { initialTarget: 'floating' });
    await stable();
    expect(el.querySelector('[data-ndd-more="p"]')).toBeNull();
    expect(el.querySelector('[data-ndd-more="d"]')).not.toBeNull();
    el.querySelector<HTMLElement>('[data-ndd-more="d"]')!.click();
    await stable();
    expect(menuLabels()).toEqual(['Export']); // only the contributed items
  });
});

describe('the taskbar menu — D1', () => {
  const openTaskbarMenu = async (env: Env, id: string) => {
    rightClick(env.el.querySelector(`[data-ndd-taskbar-item="${id}"]`)!);
    await env.stable();
  };

  it('offers restore, maximise and close for a minimised panel', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.minimizePanel('a');
    await env.stable();
    await openTaskbarMenu(env, 'a');
    expect(menuLabels()).toEqual(['Restore Panel', 'Maximize Panel', 'Close Panel']);
  });

  it("Maximize actually maximises — rdd's did nothing at all", async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.minimizePanel('a');
    await env.stable();
    await openTaskbarMenu(env, 'a');
    clickItem('Maximize Panel');
    await env.stable();
    // rdd's maximizePanel only mapped over `floating`, and a minimised panel is not there, so
    // clicking this item changed nothing whatsoever. It restores first here.
    expect(env.ws.state().panels['a']!.state).toBe('floating');
    expect(env.ws.state().floating.find((w) => w.id === 'a')!.maximized).toBe(true);
    expect(env.ws.state().minimized).toEqual([]);
  });

  it('Restore restores', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.minimizePanel('a');
    await env.stable();
    await openTaskbarMenu(env, 'a');
    clickItem('Restore Panel');
    await env.stable();
    expect(env.ws.state().panels['a']!.state).toBe('docked');
  });

  it('still emits taskbarContextMenu, so an app can observe it', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.minimizePanel('a');
    await env.stable();
    await openTaskbarMenu(env, 'a');
    expect(taskbarEvents[0]).toBe('a');
  });
});

describe('a template replaces the built-in menu (rdd ContextMenuAdapter)', () => {
  it('renders the template instead of the library markup, with the items, position and a close', async () => {
    @Component({
      selector: 'ndd-test-own-menu',
      imports: [NddContextMenu, NddContextMenuTemplate],
      template: `<ndd-context-menu>
        <ng-template nddContextMenuTemplate let-items let-x="x" let-y="y" let-close="close">
          <ul data-mine>
            @for (i of items; track $index) {
              <li [attr.data-x]="x" [attr.data-y]="y">
                {{ labelOf(i) }}<button data-mine-close (click)="close()">x</button>
              </li>
            }
          </ul>
        </ng-template>
      </ndd-context-menu>`,
    })
    class OwnMenu {
      // The template context is typed (ngTemplateContextGuard): items are ContextMenuItem, and
      // a separator has no label, so a real consumer narrows too.
      labelOf(i: ContextMenuItem): string {
        return 'label' in i ? String(i.label) : '';
      }
    }
    const { ws, el, stable } = await mountWith(createWorkspace({ panels: {} }), OwnMenu);
    ws.showContextMenu({ x: 40, y: 60, items: [{ label: 'Mine' }, { label: 'Also mine' }] });
    await stable();
    const own = el.querySelector('[data-mine]');
    expect(own).not.toBeNull();
    expect(own!.textContent).toContain('Mine');
    expect(own!.querySelectorAll('li')).toHaveLength(2);
    expect(own!.querySelector('li')!.getAttribute('data-x')).toBe('40');
    expect(own!.querySelector('li')!.getAttribute('data-y')).toBe('60');
    // The built-in markup is not rendered alongside it.
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
    own!.querySelector<HTMLButtonElement>('[data-mine-close]')!.click();
    await stable();
    expect(el.querySelector('[data-mine]')).toBeNull();
  });

  it('a real press inside a custom menu does not dismiss it before its click; a press outside does', async () => {
    let clicked = 0;
    @Component({
      selector: 'ndd-test-own-menu-press',
      imports: [NddContextMenu, NddContextMenuTemplate],
      template: `<ndd-context-menu>
        <ng-template nddContextMenuTemplate let-close="close">
          <div data-mine style="position: fixed"><button data-mine-act (click)="act(); close()">Act</button></div>
        </ng-template>
      </ndd-context-menu>`,
    })
    class OwnMenu {
      act(): void {
        clicked++;
      }
    }
    const { ws, el, stable } = await mountWith(createWorkspace({ panels: {} }), OwnMenu);
    ws.showContextMenu({ x: 10, y: 10, items: [{ label: 'x' }] });
    await stable();
    const button = el.querySelector<HTMLButtonElement>('[data-mine-act]')!;
    // The sequence a real pointer produces: pointerdown first, then the click.
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await stable();
    expect(el.querySelector('[data-mine]')).not.toBeNull();
    button.click();
    await stable();
    expect(clicked).toBe(1);
    expect(el.querySelector('[data-mine]')).toBeNull();

    ws.showContextMenu({ x: 10, y: 10, items: [{ label: 'x' }] });
    await stable();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await stable();
    expect(el.querySelector('[data-mine]')).toBeNull();
  });

  it('renders the built-in menu when no template is given', async () => {
    const { ws, stable } = await mountWith(createWorkspace({ panels: {} }), NddContextMenu);
    ws.showContextMenu({ x: 5, y: 5, items: [{ label: 'Built in' }] });
    await stable();
    expect(document.querySelector('[data-ndd-menu]')).not.toBeNull();
  });
});

// ── Angular-port additions ──────────────────────────────────────────────────

describe('keyboard: the WAI-ARIA menu pattern', () => {
  const key = (k: string) =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
    );
  const focused = () =>
    document.activeElement?.getAttribute('data-ndd-menu-item') ??
    document.activeElement?.getAttribute('data-ndd-menu-submenu');

  it('moves focus into the menu, and roves across enabled items with arrows, Home and End', async () => {
    const { ws, stable } = await setup();
    ws.showContextMenu({
      x: 10,
      y: 10,
      items: [
        { label: 'One' },
        { label: 'Off', disabled: true },
        { separator: true },
        { label: 'Two' },
        { label: 'Three' },
      ],
    });
    await stable();
    expect(focused()).toBe('One');
    key('ArrowDown');
    expect(focused()).toBe('Two'); // skips the disabled item and the separator
    key('End');
    expect(focused()).toBe('Three');
    key('ArrowDown');
    expect(focused()).toBe('One'); // wraps
    key('ArrowUp');
    expect(focused()).toBe('Three');
    key('Home');
    expect(focused()).toBe('One');
  });

  it('enters a submenu with ArrowRight and leaves it with ArrowLeft (mirrored under RTL)', async () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      const { ws, stable } = await setup(dir);
      ws.showContextMenu({
        x: 10,
        y: 10,
        items: [{ label: 'More', items: [{ label: 'Nested' }] }],
      });
      await stable();
      expect(focused()).toBe('More');
      key(dir === 'ltr' ? 'ArrowRight' : 'ArrowLeft');
      await stable();
      expect(focused()).toBe('Nested');
      key(dir === 'ltr' ? 'ArrowLeft' : 'ArrowRight');
      await stable();
      expect(document.querySelector('[data-ndd-submenu]')).toBeNull();
      expect(focused()).toBe('More');
      TestBed.resetTestingModule();
      document.querySelectorAll('[data-ndd-menu], [data-ndd-submenu]').forEach((el) => el.remove());
    }
  });

  it('Escape closes the menu and returns focus to where it was', async () => {
    const { ws, stable } = await setup();
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    ws.showContextMenu({ x: 10, y: 10, items: [{ label: 'One' }] });
    await stable();
    expect(focused()).toBe('One');
    key('Escape');
    await stable();
    expect(document.querySelector('[data-ndd-menu]')).toBeNull();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('marks checkbox items with the menuitemcheckbox role', async () => {
    const { ws, stable } = await setup();
    ws.showContextMenu({
      x: 10,
      y: 10,
      items: [{ label: 'On', checkbox: { value: true } }, { label: 'Plain' }],
    });
    await stable();
    expect(document.querySelector('[data-ndd-menu-item="On"]')!.getAttribute('role')).toBe(
      'menuitemcheckbox',
    );
    expect(document.querySelector('[data-ndd-menu-item="Plain"]')!.getAttribute('role')).toBe(
      'menuitem',
    );
  });
});

describe('[nddContextMenu]', () => {
  it('opens its items on right-click, reading a getter at the moment of opening', async () => {
    let label = 'First';
    @Component({
      selector: 'ndd-test-trigger',
      imports: [NddContextMenu, NddContextMenuTrigger],
      template: `<div class="target" [nddContextMenu]="items"></div>
        <ndd-context-menu />`,
    })
    class Trigger {
      readonly items = () => [{ label }];
    }
    const { el, stable } = await mountWith(createWorkspace({ panels: {} }), Trigger);
    rightClick(el.querySelector('.target')!);
    await stable();
    expect(menuLabels()).toEqual(['First']);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await stable();
    label = 'Second';
    rightClick(el.querySelector('.target')!);
    await stable();
    expect(menuLabels()).toEqual(['Second']);
  });
});
