/**
 * The taskbar, its three visibility modes, and the hover preview.
 *
 * Ported from vue-dockable-desktop `test/components/taskbar.test.ts` (20 tests, names preserved,
 * `vdd-` → `ndd-`). The preview's defining property — that it contains *the live panel*, not a
 * copy — is asserted by DOM node identity, and again in the browser gate. The mode-class test is
 * the taskbar half of rdd's StyleHookups: its `taskbarVisibility` did nothing in rdd 6.0.0
 * because the component emitted a class no rule was keyed on.
 *
 * Driving code is TestBed. vdd's `wrapper.emitted('taskbarContextMenu')[0][0]` is the panel id
 * of the `(taskbarContextMenu)` output's `{ panelId, event }` payload. Tests needing fake timers
 * switch to them after the first render (Angular's zoneless scheduler uses timers itself).
 */
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import type { TaskbarVisibility } from '../../src/lib/desktop/taskbar';
import { LONG_PRESS_MS } from '../../src/lib/desktop/drag-dock';

@Component({
  selector: 'ndd-test-mock-panel',
  template: `<div class="body" [attr.data-body]="panelId()">
    <div class="scroller" [attr.data-scroller]="panelId()">
      @for (i of rows; track i) {
        <div>row {{ i }}</div>
      }
    </div>
  </div>`,
})
class P {
  readonly panelId = input('');
  protected readonly rows = Array.from({ length: 30 }, (_, i) => i);
}

@Component({ selector: 'ndd-test-no-preview', template: 'x' })
class NoPreview {}

afterEach(() => {
  document
    .querySelectorAll('.ndd-panel-store, .ndd-panel-mount, [data-ndd-preview]')
    .forEach((el) => el.remove());
  vi.useRealTimers();
});

interface Env {
  ws: Workspace;
  fixture: ComponentFixture<NddDesktop>;
  el: HTMLElement;
  stable: () => Promise<void>;
  menus: string[];
}

async function setup(taskbar?: TaskbarVisibility): Promise<Env> {
  const ws = createWorkspace({
    panels: {
      map: { component: P },
      quiet: {
        component: NoPreview,
        defaultOptions: { disableLivePreview: true, title: 'Quiet Panel' },
      },
    },
  });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(NddDesktop);
  if (taskbar) fixture.componentRef.setInput('taskbar', taskbar);
  const menus: string[] = [];
  fixture.componentInstance.taskbarContextMenu.subscribe((e) => menus.push(e.panelId));
  await fixture.whenStable();
  return {
    ws,
    fixture,
    el: fixture.nativeElement as HTMLElement,
    stable: () => fixture.whenStable(),
    menus,
  };
}

const q = (el: ParentNode, sel: string) => el.querySelector<HTMLElement>(sel);
const qa = (el: ParentNode, sel: string) => [...el.querySelectorAll<HTMLElement>(sel)];

describe('taskbar visibility modes', () => {
  it('always: the strip is present even with nothing minimised', async () => {
    const { el } = await setup('always');
    expect(q(el, '[data-ndd-taskbar]')).not.toBeNull();
  });

  it('compact: the strip appears only while something is minimised', async () => {
    const { ws, el, stable } = await setup('compact');
    expect(q(el, '[data-ndd-taskbar]')).toBeNull();
    ws.openPanel('a', 'map');
    ws.minimizePanel('a');
    await stable();
    expect(q(el, '[data-ndd-taskbar]')).not.toBeNull();
    ws.restorePanel('a');
    await stable();
    expect(q(el, '[data-ndd-taskbar]')).toBeNull();
  });

  it('emits the mode class the stylesheet is keyed on (rdd shipped this broken)', async () => {
    for (const mode of ['always', 'compact', 'autohide'] as const) {
      const { ws, el, stable } = await setup(mode);
      ws.openPanel('a', 'map');
      ws.minimizePanel('a');
      await stable();
      expect(q(el, '[data-ndd-taskbar]')!.classList).toContain(`ndd-taskbar-mode-${mode}`);
      TestBed.resetTestingModule();
    }
  });

  it('autohide: renders a peek handle and expands on hover', async () => {
    const { ws, el, stable } = await setup('autohide');
    ws.openPanel('a', 'map');
    ws.minimizePanel('a');
    await stable();
    expect(q(el, '[data-ndd-peek]')).not.toBeNull();
    const bar = () => q(el, '[data-ndd-taskbar]')!;
    bar().dispatchEvent(new PointerEvent('pointerleave'));
    await new Promise((r) => setTimeout(r, 450));
    await stable();
    expect(bar().classList).not.toContain('ndd-taskbar-expanded');
    bar().dispatchEvent(new PointerEvent('pointerenter'));
    await stable();
    expect(bar().classList).toContain('ndd-taskbar-expanded');
  });

  it('autohide: flashes open when a panel is minimised, then collapses', async () => {
    const { ws, el, fixture } = await setup('autohide');
    vi.useFakeTimers();
    ws.openPanel('a', 'map');
    ws.minimizePanel('a');
    fixture.detectChanges();
    expect(q(el, '[data-ndd-taskbar]')!.classList).toContain('ndd-taskbar-expanded');
    vi.advanceTimersByTime(2100);
    fixture.detectChanges();
    expect(q(el, '[data-ndd-taskbar]')!.classList).not.toContain('ndd-taskbar-expanded');
  });

  it('always: no peek handle, since there is nothing to peek from', async () => {
    const { el } = await setup('always');
    expect(q(el, '[data-ndd-peek]')).toBeNull();
  });
});

describe('taskbar items', () => {
  it('shows one icon per minimised panel, in order', async () => {
    const { ws, el, stable } = await setup();
    for (const id of ['a', 'b', 'c']) {
      ws.openPanel(id, 'map');
      ws.minimizePanel(id);
    }
    await stable();
    expect(
      qa(el, '[data-ndd-taskbar-item]').map((i) => i.getAttribute('data-ndd-taskbar-item')),
    ).toEqual(['a', 'b', 'c']);
  });

  it('clicking an icon restores the panel', async () => {
    const { ws, el, stable } = await setup();
    ws.openPanel('a', 'map');
    ws.minimizePanel('a');
    await stable();
    q(el, '[data-ndd-taskbar-item="a"]')!.click();
    expect(ws.state().panels['a']!.state).toBe('docked');
    expect(ws.state().activePanelId).toBe('a');
  });

  it('shows scroll arrows only once there are more icons than fit', async () => {
    const { ws, el, stable } = await setup();
    for (const id of ['a', 'b', 'c', 'd']) {
      ws.openPanel(id, 'map');
      ws.minimizePanel(id);
    }
    await stable();
    expect(qa(el, '[data-ndd-taskbar-scroll]').length).toBe(0);
    ws.openPanel('e', 'map');
    ws.minimizePanel('e');
    await stable();
    expect(qa(el, '[data-ndd-taskbar-scroll]').length).toBe(2);
  });

  it('asks the host for a context menu on right-click', async () => {
    const { ws, el, stable, menus } = await setup();
    ws.openPanel('a', 'map');
    ws.minimizePanel('a');
    await stable();
    q(el, '[data-ndd-taskbar-item="a"]')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(menus[0]).toBe('a');
  });
});

describe('the hover preview is the live panel, not a copy', () => {
  const hover = async (env: Env, id: string) => {
    const icon = q(env.el, `[data-ndd-taskbar-item="${id}"]`)!;
    icon.getBoundingClientRect = () => ({
      left: 100,
      top: 500,
      right: 138,
      bottom: 538,
      width: 38,
      height: 38,
      x: 100,
      y: 500,
      toJSON: () => ({}),
    });
    icon.dispatchEvent(
      new PointerEvent('pointerenter', {
        bubbles: true,
        pointerType: 'mouse',
        clientX: 110,
        clientY: 510,
      }),
    );
    await env.stable();
  };

  it("moves the panel's own element into the preview — the same DOM node", async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    await env.stable();
    const node = document.querySelector('[data-body="a"]');
    expect(node).not.toBeNull();
    env.ws.minimizePanel('a');
    await env.stable();
    await hover(env, 'a');
    const preview = document.querySelector('[data-ndd-preview]');
    expect(preview).not.toBeNull();
    // The very same node, now inside the preview: a thumbnail of a running panel rather than a
    // screenshot or a second instance.
    expect(preview!.contains(node!)).toBe(true);
    expect(document.querySelectorAll('[data-body="a"]').length).toBe(1);
  });

  it('returns the panel to the off-screen store when the preview closes', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.minimizePanel('a');
    await env.stable();
    await hover(env, 'a');
    const mount = document.querySelector('[data-ndd-panel="a"]')!;
    expect(mount.closest('[data-ndd-preview]')).not.toBeNull();
    q(env.el, '[data-ndd-taskbar-item="a"]')!.dispatchEvent(new PointerEvent('pointerleave'));
    await new Promise((r) => setTimeout(r, 200));
    await env.stable();
    expect(document.querySelector('[data-ndd-preview]')).toBeNull();
    expect(mount.parentElement!.className).toContain('ndd-panel-store');
  });

  it('scales the thumbnail from the size the panel had while it was on screen', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.minimizePanel('a');
    await env.stable();
    await hover(env, 'a');
    const host = document.querySelector<HTMLElement>('.ndd-taskbar-item-preview-host');
    expect(host).not.toBeNull();
    // jsdom reports no size, so the cache's 800×500 default is used: 220/800 vs 140/500 →
    // 0.275 is the smaller, so the aspect ratio is preserved rather than stretched.
    expect(host!.style.transform).toBe('scale(0.275)');
  });

  it('shows the title, a dirty marker, and a close button', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map', { title: 'Notes' });
    env.ws.setPanelDirty('a', true);
    env.ws.minimizePanel('a');
    await env.stable();
    await hover(env, 'a');
    const preview = document.querySelector('[data-ndd-preview]')!;
    expect(preview.textContent).toContain('Notes');
    expect(preview.textContent).toContain('*');
    expect(preview.querySelector('[data-ndd-preview-close="a"]')).not.toBeNull();
  });

  it('clicking the preview restores the panel', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.minimizePanel('a');
    await env.stable();
    await hover(env, 'a');
    document.querySelector<HTMLElement>('[data-ndd-preview]')!.click();
    await env.stable();
    expect(env.ws.state().panels['a']!.state).toBe('docked');
    expect(document.querySelector('[data-ndd-preview]')).toBeNull();
  });

  it('shows a letter tile instead for a panel with disableLivePreview', async () => {
    const env = await setup();
    env.ws.openPanel('q', 'quiet');
    env.ws.minimizePanel('q');
    await env.stable();
    await hover(env, 'q');
    const preview = document.querySelector('[data-ndd-preview]')!;
    expect(preview.querySelector('.ndd-taskbar-item-preview-letter')?.textContent).toBe('Q');
    expect(preview.querySelector('.ndd-taskbar-item-preview-host')).toBeNull();
    // and the panel stays parked off-screen rather than being moved into the preview
    expect(document.querySelector('[data-ndd-panel="q"]')!.parentElement!.className).toContain(
      'ndd-panel-store',
    );
  });

  it('closes itself if its panel stops being minimised elsewhere', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.minimizePanel('a');
    await env.stable();
    await hover(env, 'a');
    expect(document.querySelector('[data-ndd-preview]')).not.toBeNull();
    env.ws.restorePanel('a'); // restored from somewhere else entirely
    await env.stable();
    expect(document.querySelector('[data-ndd-preview]')).toBeNull();
  });

  it('does not preview on a touch pointerenter, where there is no hover', async () => {
    const env = await setup();
    env.ws.openPanel('a', 'map');
    env.ws.minimizePanel('a');
    await env.stable();
    q(env.el, '[data-ndd-taskbar-item="a"]')!.dispatchEvent(
      new PointerEvent('pointerenter', { bubbles: true, pointerType: 'touch' }),
    );
    await env.stable();
    expect(document.querySelector('[data-ndd-preview]')).toBeNull();
  });
});

describe('touch: tap to preview, tap again to restore', () => {
  it('first tap opens the preview, second restores', async () => {
    const { ws, el, fixture } = await setup();
    ws.openPanel('a', 'map');
    ws.minimizePanel('a');
    await fixture.whenStable();
    vi.useFakeTimers();
    const icon = q(el, '[data-ndd-taskbar-item="a"]')!;
    const tap = () => {
      icon.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 5,
          clientY: 5,
        }),
      );
      icon.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 5,
          clientY: 5,
        }),
      );
    };
    tap();
    fixture.detectChanges();
    expect(document.querySelector('[data-ndd-preview]')).not.toBeNull();
    expect(ws.state().panels['a']!.state).toBe('minimized');
    tap();
    fixture.detectChanges();
    expect(ws.state().panels['a']!.state).toBe('docked');
  });

  it('a long press asks for a context menu instead', async () => {
    const { ws, el, fixture, menus } = await setup();
    ws.openPanel('a', 'map');
    ws.minimizePanel('a');
    await fixture.whenStable();
    vi.useFakeTimers();
    q(el, '[data-ndd-taskbar-item="a"]')!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'touch',
        clientX: 5,
        clientY: 5,
      }),
    );
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fixture.detectChanges();
    expect(menus[0]).toBe('a');
    expect(ws.state().panels['a']!.state).toBe('minimized');
  });
});
