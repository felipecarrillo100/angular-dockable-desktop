/**
 * `<ndd-desktop>` — grid rendering, tab groups, and the persistence port.
 *
 * Ported from vue-dockable-desktop `test/components/desktop.test.ts` (24 tests, names
 * preserved; vdd itself ports rdd's CoreLayout (7) and TabOperations (4), and substitutes
 * DomStability (3) with persistence tests). Driving code is TestBed: `mount(VddDesktop)` is
 * `TestBed.createComponent(NddDesktop)`, `await nextTick()` is `await fixture.whenStable()`,
 * `vdd-` selectors are `ndd-`. Shape changes are noted at the test.
 *
 * jsdom does no layout, so nothing here can check geometry or real scrolling; those are in the
 * browser gate, `scripts/gates/browser/m4.mjs`.
 */
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { injectPanel } from '../../src/lib/panel/panel-ref';

/** Panels record how many times one was created, and hold state that must survive. */
let mounts = 0;

@Component({
  selector: 'ndd-test-counter-panel',
  template: `<div class="counter" [attr.data-counter-id]="panel.id">
    <span class="ticks">{{ ticks() }}</span>
    <button class="tick" (click)="ticks.set(ticks() + 1)">tick</button>
  </div>`,
})
class CounterPanel {
  protected readonly panel = injectPanel();
  protected readonly ticks = signal(0);
  constructor() {
    mounts++;
  }
}

const TWO_LEAF = JSON.stringify({
  version: 2,
  gridRoot: {
    type: 'branch',
    orientation: 'horizontal',
    sizes: [0.5, 0.5],
    children: [
      { type: 'leaf', id: 'L', panels: [], activePanelId: null },
      { type: 'leaf', id: 'R', panels: [], activePanelId: null },
    ],
  },
  floating: [],
  minimized: [],
  panels: {},
});

afterEach(() => {
  // The panel DOM lives outside the component tree by design, so leftovers must be removed or a
  // later document query finds an earlier test's nodes (vdd hit exactly this).
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach((el) => el.remove());
  document.documentElement.removeAttribute('data-color-scheme');
});

async function setup(
  initialState?: string,
): Promise<{ ws: Workspace; fixture: ComponentFixture<NddDesktop>; el: HTMLElement }> {
  mounts = 0;
  const ws = createWorkspace({
    panels: { counter: { component: CounterPanel } },
    ...(initialState ? { initialState } : {}),
  });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(NddDesktop);
  await fixture.whenStable();
  return { ws, fixture, el: fixture.nativeElement as HTMLElement };
}

const tabIds = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-ndd-tab]')].map((t) => t.getAttribute('data-ndd-tab'));

describe('WindowManager Core Layout Operations', () => {
  it('renders an empty workspace without error', async () => {
    const { el } = await setup();
    expect(el.classList.contains('ndd-workspace')).toBe(true);
    expect(el.querySelector('.ndd-empty-leaf-placeholder')).not.toBeNull();
  });

  it('renders a leaf group with a tab per panel', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    await fixture.whenStable();
    expect(tabIds(el)).toEqual(['a', 'b']);
  });

  it('renders a branch with a divider between each pair of children', async () => {
    const { ws, fixture, el } = await setup(TWO_LEAF);
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    ws.dockPanelToGroup('b', 'R', 'center');
    await fixture.whenStable();
    expect(el.querySelectorAll('.ndd-workspace-branch').length).toBe(1);
    expect(el.querySelectorAll('[data-ndd-divider]').length).toBe(1);
  });

  it('renders nested branches recursively', async () => {
    const { ws, fixture, el } = await setup(TWO_LEAF);
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    ws.dockPanelToGroup('b', 'R', 'center');
    ws.openPanel('c', 'counter');
    ws.dockPanelToGroup('c', 'R', 'bottom'); // splits R, nesting a branch
    await fixture.whenStable();
    expect(el.querySelectorAll('.ndd-workspace-branch').length).toBe(2);
    expect(el.querySelectorAll('[data-ndd-leaf]').length).toBe(3);
  });

  it('marks the selected tab active, and distinguishes focused from unfocused groups', async () => {
    const { ws, fixture, el } = await setup(TWO_LEAF);
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    ws.dockPanelToGroup('b', 'R', 'center'); // b is docked, and becomes active
    await fixture.whenStable();
    expect(el.querySelector('[data-ndd-tab="b"]')!.classList).toContain(
      'ndd-workspace-tab-active-focused',
    );
    expect(el.querySelector('[data-ndd-tab="a"]')!.classList).toContain(
      'ndd-workspace-tab-active-unfocused',
    );
  });

  it('never lets the focused tab and activePanelId disagree (D2)', async () => {
    const { ws, fixture, el } = await setup(TWO_LEAF);
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    ws.dockPanelToGroup('b', 'R', 'center');
    await fixture.whenStable();
    const focused = el.querySelectorAll('.ndd-workspace-tab-active-focused');
    expect(focused.length).toBe(1);
    expect(focused[0]!.getAttribute('data-ndd-tab')).toBe(ws.state().activePanelId);
  });

  it('renders an unregistered panel as a diagnostic rather than crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ws, fixture } = await setup();
    ws.openPanel('ghost', 'not-registered');
    await fixture.whenStable();
    warn.mockRestore();
    // Shape change: the diagnostic lives in the panel's own element, which the slot holds.
    expect(document.querySelector('.ndd-unregistered-panel')).not.toBeNull();
  });
});

describe('WindowManager Tab Operations', () => {
  it('clicking a tab selects it', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    await fixture.whenStable();
    (el.querySelector('[data-ndd-tab="a"]') as HTMLElement).click();
    expect(ws.state().activePanelId).toBe('a');
  });

  it("clicking a tab's close button closes that panel", async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    await fixture.whenStable();
    (el.querySelector('[data-ndd-close="a"]') as HTMLElement).click();
    await fixture.whenStable();
    expect(ws.isOpen('a')).toBe(false);
    expect(el.querySelectorAll('[data-ndd-tab]').length).toBe(1);
  });

  it('shows a dirty marker on the tab', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'counter');
    ws.setPanelDirty('a', true);
    await fixture.whenStable();
    expect(el.querySelector('[data-ndd-tab="a"]')!.textContent).toContain('*');
  });

  it('reorders tabs by index', async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    ws.openPanel('c', 'counter');
    await fixture.whenStable();
    const leafId = el.querySelector('[data-ndd-leaf]')!.getAttribute('data-ndd-leaf')!;
    ws.movePanelOrder('c', leafId, 0);
    await fixture.whenStable();
    expect(tabIds(el)).toEqual(['c', 'a', 'b']);
  });
});

describe('the persistence port keeps panels alive (substitutes DomStability)', () => {
  it('mounts each panel exactly once, however many tabs exist', async () => {
    const { ws, fixture } = await setup();
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    await fixture.whenStable();
    expect(mounts).toBe(2);
  });

  it('does not re-create a panel when the user switches tabs away and back', async () => {
    const { ws, fixture } = await setup();
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    await fixture.whenStable();
    const before = mounts;
    ws.focusPanel('a');
    await fixture.whenStable();
    ws.focusPanel('b');
    await fixture.whenStable();
    ws.focusPanel('a');
    await fixture.whenStable();
    expect(mounts).toBe(before);
  });

  it("keeps a panel's own DOM node identical across every placement change", async () => {
    const { ws, fixture } = await setup(TWO_LEAF);
    ws.openPanel('a', 'counter');
    ws.openPanel('keeper', 'counter');
    await fixture.whenStable();
    const node = document.querySelector('[data-counter-id="a"]');
    expect(node).not.toBeNull();

    ws.dockPanelToGroup('a', 'R', 'center');
    await fixture.whenStable();
    expect(document.querySelector('[data-counter-id="a"]')).toBe(node);
    ws.minimizePanel('a');
    await fixture.whenStable();
    expect(document.querySelector('[data-counter-id="a"]')).toBe(node); // off-screen, still alive
    ws.restorePanel('a');
    await fixture.whenStable();
    expect(document.querySelector('[data-counter-id="a"]')).toBe(node);
    ws.floatPanel('a');
    await fixture.whenStable();
    expect(document.querySelector('[data-counter-id="a"]')).toBe(node);
  });

  it("keeps a panel's component state through a tab switch", async () => {
    const { ws, fixture, el } = await setup();
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter');
    await fixture.whenStable();
    const tick = document.querySelector('[data-counter-id="a"] .tick') as HTMLElement;
    tick.click();
    tick.click();
    tick.click();
    await fixture.whenStable();
    expect(document.querySelector('[data-counter-id="a"] .ticks')!.textContent).toBe('3');

    ws.focusPanel('b');
    await fixture.whenStable();
    ws.focusPanel('a');
    await fixture.whenStable();
    expect(document.querySelector('[data-counter-id="a"] .ticks')!.textContent).toBe('3');
    expect(el.querySelector('[data-ndd-tab="a"]')!.classList).toContain('ndd-active');
  });

  it('moves the panel element into the slot that currently shows it', async () => {
    const { ws, fixture } = await setup();
    ws.openPanel('a', 'counter');
    await fixture.whenStable();
    const mountEl = document.querySelector('[data-ndd-panel="a"]')!;
    expect(mountEl.parentElement!.getAttribute('data-ndd-slot')).toBe('a');

    ws.minimizePanel('a');
    await fixture.whenStable();
    expect(mountEl.parentElement!.className).toContain('ndd-panel-store'); // parked off-screen

    ws.restorePanel('a');
    await fixture.whenStable();
    expect(mountEl.parentElement!.getAttribute('data-ndd-slot')).toBe('a');
  });

  it("parks a background tab's panel off-screen, alive, with no slot of its own", async () => {
    const { ws, fixture } = await setup();
    ws.openPanel('a', 'counter');
    ws.openPanel('b', 'counter'); // b is selected; a moves to the background
    await fixture.whenStable();
    const a = document.querySelector('[data-ndd-panel="a"]')!;
    const b = document.querySelector('[data-ndd-panel="b"]')!;
    expect(a.parentElement!.className).toContain('ndd-panel-store');
    expect(b.parentElement!.getAttribute('data-ndd-slot')).toBe('b');
    expect(document.querySelectorAll('[data-ndd-slot]').length).toBe(1);
    expect(mounts).toBe(2); // both alive

    ws.focusPanel('a');
    await fixture.whenStable();
    expect(a.parentElement!.getAttribute('data-ndd-slot')).toBe('a');
    expect(b.parentElement!.className).toContain('ndd-panel-store');
    expect(mounts).toBe(2); // neither was re-created
  });

  it('places a panel in its slot within a single tick, not a frame later', async () => {
    // Shape change: vdd moved from a function ref during the patch; ndd moves in the slot
    // directive's ngOnInit, which runs in the same change-detection pass that creates the slot.
    const { ws, fixture } = await setup();
    ws.openPanel('a', 'counter');
    await fixture.whenStable();
    expect(
      document.querySelector('[data-ndd-panel="a"]')!.parentElement!.getAttribute('data-ndd-slot'),
    ).toBe('a');
  });

  it("releases a closed panel's element so the cache cannot grow forever", async () => {
    const { ws, fixture } = await setup();
    ws.openPanel('a', 'counter');
    await fixture.whenStable();
    expect(document.querySelector('[data-ndd-panel="a"]')).not.toBeNull();
    ws.closePanel('a');
    await fixture.whenStable();
    expect(document.querySelector('[data-ndd-panel="a"]')).toBeNull();
  });

  it('cleans up the hidden store when the desktop unmounts', async () => {
    const { ws, fixture } = await setup();
    ws.openPanel('a', 'counter');
    await fixture.whenStable();
    expect(document.querySelectorAll('.ndd-panel-store').length).toBe(1);
    fixture.destroy();
    expect(document.querySelectorAll('.ndd-panel-store').length).toBe(0);
  });
});

describe('skin and animations', () => {
  it('mirrors the skin onto the document so teleported chrome inherits its tokens', async () => {
    const { fixture } = await setup();
    fixture.componentRef.setInput('skin', 'macos');
    await fixture.whenStable();
    expect(document.documentElement.getAttribute('data-ndd-skin')).toBe('macos');
    fixture.destroy();
    expect(document.documentElement.getAttribute('data-ndd-skin')).toBeNull();
  });

  it('mirrors the skin and the colour scheme onto the workspace element together', async () => {
    const { fixture, el } = await setup();
    fixture.componentRef.setInput('skin', 'macos');
    await fixture.whenStable();
    expect(el.getAttribute('data-ndd-skin')).toBe('macos');
    expect(el.getAttribute('data-color-scheme')).toBe('dark');
  });

  it('the mirrored scheme follows the attribute the application sets', async () => {
    const { fixture, el } = await setup();
    expect(el.getAttribute('data-color-scheme')).toBe('dark');
    document.documentElement.setAttribute('data-color-scheme', 'light');
    // The attribute is observed with a MutationObserver, which delivers on a microtask.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    expect(el.getAttribute('data-color-scheme')).toBe('light');
  });

  it("opts out of the library's own animations without touching the host app", async () => {
    const { fixture, el } = await setup();
    fixture.componentRef.setInput('animations', false);
    await fixture.whenStable();
    expect(el.classList).toContain('ndd-no-animations');
    expect(document.documentElement.classList.contains('ndd-no-animations')).toBe(true);
    fixture.destroy();
    expect(document.documentElement.classList.contains('ndd-no-animations')).toBe(false);
  });
});
