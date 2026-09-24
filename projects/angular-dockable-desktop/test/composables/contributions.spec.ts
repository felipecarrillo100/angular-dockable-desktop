/**
 * Panel contributions — toolbar items and sidebar sections a panel publishes while active.
 *
 * Ported from vue-dockable-desktop `test/composables/contributions.test.ts` (21 tests,
 * PC1–PC13 plus vdd's additions, names preserved; `usePanelContribution` →
 * `injectPanelContribution`, `useActiveContribution` → `injectActiveContribution`, and so on).
 * As in vdd, there is no `<PanelContributionProvider>` — the store is the workspace's — and the
 * contribution is a *getter*, republished when what it reads changes.
 *
 * PC12 and PC13 are the ones that matter most, and they are about the invariant underneath: a
 * contribution is read from `activePanelId`, so the feature is only trustworthy if
 * `activePanelId` never names a panel the user cannot see (vdd D2).
 */
import { Component, input, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import {
  injectActiveContribution,
  injectMergedSidebarTabs,
  injectMergedToolbarItems,
  injectPanelContribution,
} from '../../src/lib/contributions/inject-contributions';
import { mergeSidebarTabs, mergeToolbarItems, sectionToTab } from '../../src/lib/core/contributions';
import type { PanelContribution, PanelSidebarSection } from '../../src/lib/core/contributions';
import type { ToolbarItem } from '../../src/lib/core/toolbar-types';
import type { SidebarTab } from '../../src/lib/core/sidebar-types';

const Icon = 'icon';
const Fallback = 'fallback-icon';

/** Item ids, with a separator shown as `|`. */
const ids = (items: ToolbarItem[]): string[] => items.map(item => (item.type === 'separator' ? '|' : item.id));
/** The first contributed item's id, or `null`. */
const firstItemId = (c: PanelContribution | null): string | null => {
  const first = c?.toolbarItems?.[0];
  return first && first.type !== 'separator' ? first.id : null;
};

@Component({ selector: 'ndd-test-content', template: 'section' })
class Content {}

/** A panel that contributes one toolbar item and one section, both naming itself. */
@Component({ selector: 'ndd-test-contributor', template: `<div [attr.data-contributor]="panelId()"></div>` })
class Contributor {
  readonly panelId = input('');
  constructor() {
    injectPanelContribution(() => ({
      toolbarItems: [{ type: 'action', id: `act-${this.panelId()}`, label: this.panelId(), icon: Icon, onClick: () => {} }],
      sidebarSections: [{ id: `sec-${this.panelId()}`, label: `sec-${this.panelId()}`, component: Content }],
    }));
  }
}

/** A panel that publishes nothing at all. */
@Component({ selector: 'ndd-test-silent', template: 'silent' })
class Silent {}

let fixture: ComponentFixture<unknown> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach(el => el.remove());
});

async function setup(panels: Record<string, { component: Type<unknown> }> = { contributor: { component: Contributor }, silent: { component: Silent } }, initialState?: string, host: Type<unknown> = NddDesktop) {
  const ws = createWorkspace({ panels, ...(initialState ? { initialState } : {}) });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  fixture = TestBed.createComponent(host);
  await fixture.whenStable();
  return { ws, el: fixture.nativeElement as HTMLElement, stable: () => fixture!.whenStable() };
}

// ─── PC1–PC11 ────────────────────────────────────────────────────────────────

describe('PanelContribution', () => {
  it('PC1: is null when no panel is active', async () => {
    const { ws } = await setup();
    expect(ws.state().activePanelId).toBeNull();
    expect(ws.activeContribution()).toBeNull();
  });

  it('PC2: a published contribution is reflected once its panel becomes active', async () => {
    const { ws, stable } = await setup();
    ws.openPanel('p1', 'contributor');
    await stable();
    expect(ws.state().activePanelId).toBe('p1');
    expect(firstItemId(ws.activeContribution())).toBe('act-p1');
    expect(ws.activeContribution()?.sidebarSections?.[0]?.label).toBe('sec-p1');
  });

  it('PC3: switching active panel switches which contribution is read', async () => {
    const { ws, stable } = await setup();
    ws.openPanel('p1', 'contributor');
    ws.openPanel('p2', 'contributor');
    await stable();
    expect(firstItemId(ws.activeContribution())).toBe('act-p2');

    ws.focusPanel('p1');
    await stable();
    expect(firstItemId(ws.activeContribution())).toBe('act-p1');
  });

  it('PC4: two independent instances keep independent, preserved state', async () => {
    // Each instance publishes through its own getter, so the same component opened twice
    // contributes twice — and neither is clobbered by the other's republish.
    const seen: string[] = [];
    @Component({ selector: 'ndd-test-stateful', template: `<div [attr.data-tool]="tool()"></div>` })
    class Stateful implements OnInit {
      readonly panelId = input('');
      protected readonly tool = signal('');
      constructor() {
        injectPanelContribution(() => ({
          toolbarItems: [{ type: 'action', id: this.tool() || `pan-${this.panelId()}`, label: 'x', icon: Icon, onClick: () => {} }],
        }));
      }
      ngOnInit(): void {
        seen.push(this.panelId());
      }
    }
    const { ws, stable } = await setup({ stateful: { component: Stateful } });
    ws.openPanel('a', 'stateful');
    ws.openPanel('b', 'stateful');
    await stable();
    expect(seen).toEqual(['a', 'b']);
    expect(firstItemId(ws.contributions.get('a'))).toBe('pan-a');
    expect(firstItemId(ws.contributions.get('b'))).toBe('pan-b');
  });

  it('PC5: closing the active panel clears its contribution', async () => {
    const { ws, stable } = await setup();
    ws.openPanel('p1', 'contributor');
    await stable();
    expect(ws.contributions.get('p1')).not.toBeNull();

    ws.closePanel('p1');
    await stable();
    expect(ws.contributions.get('p1')).toBeNull();
    expect(ws.activeContribution()).toBeNull();
  });

  it('PC6: a panel can contribute multiple sidebar sections at once', async () => {
    @Component({ selector: 'ndd-test-many', template: '' })
    class Many {
      constructor() {
        injectPanelContribution(() => ({
          sidebarSections: [
            { id: 'one', label: 'One', component: Content },
            { id: 'two', label: 'Two', component: Content },
            { id: 'three', label: 'Three', component: Content },
          ],
        }));
      }
    }
    const { ws, stable } = await setup({ many: { component: Many } });
    ws.openPanel('p1', 'many');
    await stable();
    expect(ws.activeContribution()?.sidebarSections?.map(s => s.id)).toEqual(['one', 'two', 'three']);
  });

  it('a panel contributing nothing yields null while active', async () => {
    const { ws, stable } = await setup();
    ws.openPanel('p1', 'silent');
    await stable();
    expect(ws.state().activePanelId).toBe('p1');
    expect(ws.activeContribution()).toBeNull();
  });

  @Component({ selector: 'ndd-test-bare-contribution', template: '' })
  class BareContribution {
    constructor() {
      injectPanelContribution(() => ({}));
    }
  }
  @Component({ selector: 'ndd-test-bare-active', template: '' })
  class BareActive {
    readonly active = injectActiveContribution();
  }

  it('PC7: injectPanelContribution() outside a workspace throws', () => {
    // rdd threw for a missing `<PanelContributionProvider>`. There is no such provider: the store
    // is on the workspace, so the only prerequisite is the workspace itself.
    TestBed.configureTestingModule({});
    expect(() => TestBed.createComponent(BareContribution)).toThrow(/provideDockableDesktop\(/);
  });

  it('PC8: injectActiveContribution() outside a workspace throws', () => {
    TestBed.configureTestingModule({});
    expect(() => TestBed.createComponent(BareActive)).toThrow(/provideDockableDesktop\(/);
  });

  it('PC9: sectionToTab() converts, using the fallback icon when the section omits one', () => {
    const withIcon: PanelSidebarSection = { id: 'a', label: 'A', icon: Icon, component: Content };
    const without: PanelSidebarSection = { id: 'b', label: 'B', component: Content };

    expect(sectionToTab(withIcon, Fallback)).toEqual({ id: 'a', label: 'A', icon: Icon, component: Content, inputs: undefined });
    expect(sectionToTab(without, Fallback).icon).toBe(Fallback);
    // No fallback given: the tab simply has no icon, which is valid for a hidden tab.
    expect(sectionToTab(without).icon).toBeUndefined();
    // `eagerMount` and `preserveState` are deliberately absent — a contribution only exists while
    // its panel is mounted and active, so neither has anything to mean.
    expect('eagerMount' in sectionToTab(without)).toBe(false);
    expect('preserveState' in sectionToTab(without)).toBe(false);
  });

  it('PC10: merged toolbar items append behind a separator, and are unchanged when empty', () => {
    const base: ToolbarItem[] = [{ type: 'action', id: 'save', label: 'Save', icon: Icon, onClick: () => {} }];
    const contributed: ToolbarItem[] = [{ type: 'action', id: 'draw', label: 'Draw', icon: Icon, onClick: () => {} }];

    expect(mergeToolbarItems(base, null)).toBe(base); // same array, untouched
    expect(mergeToolbarItems(base, { toolbarItems: [] })).toBe(base);
    expect(ids(mergeToolbarItems(base, { toolbarItems: contributed }))).toEqual(['save', '|', 'draw']);
  });

  it('PC11: merged sidebar tabs append contributed sections, and are unchanged when empty', () => {
    const base: SidebarTab[] = [{ id: 'files', label: 'Files', icon: Icon }];
    const sections: PanelSidebarSection[] = [{ id: 'layers', label: 'Layers', component: Content }];

    expect(mergeSidebarTabs(base, null)).toBe(base);
    expect(mergeSidebarTabs(base, { sidebarSections: [] })).toBe(base);
    const merged = mergeSidebarTabs(base, { sidebarSections: sections }, Fallback);
    expect(merged.map(t => t.id)).toEqual(['files', 'layers']);
    expect(merged[1]!.icon).toBe(Fallback);
  });
});

// ─── PC12–PC13: the invariant underneath ─────────────────────────────────────

describe('PanelContribution after a layout restore', () => {
  /**
   * Two panels in one group with the **second** selected, and `panels` key order putting the
   * first one first. rdd seeded `activePanelId` from `Object.keys(panels)[0]`, so it resolved to
   * the hidden panel and the shell surfaced the wrong contribution.
   */
  const RESTORED = JSON.stringify({
    version: 2,
    gridRoot: { type: 'leaf', id: 'g1', panels: ['p1', 'p2'], activePanelId: 'p2' },
    floating: [],
    minimized: [],
    panels: {
      p1: { id: 'p1', title: 'P1', component: 'contributor', state: 'docked', serializable: true },
      p2: { id: 'p2', title: 'P2', component: 'contributor', state: 'docked', serializable: true },
    },
  });

  it('PC12: surfaces the contribution of the panel that is actually visible', async () => {
    const { ws } = await setup(undefined, RESTORED);
    expect(ws.state().activePanelId).toBe('p2');
    expect(ws.activeContribution()).not.toBeNull();
    expect(ws.activeContribution()?.sidebarSections?.[0]?.label).toBe('sec-p2');
  });

  it('PC13: renders the visible tab as focused, not unfocused', async () => {
    const { el } = await setup(undefined, RESTORED);
    expect(el.querySelector('[data-ndd-tab="p2"]')!.classList).toContain('ndd-workspace-tab-active-focused');
    expect(el.querySelector('[data-ndd-tab="p1"]')!.classList).not.toContain('ndd-workspace-tab-active-focused');
  });
});

// ─── The inject functions over the same merge functions ──────────────────────

let merged: { items: () => ToolbarItem[]; tabs: () => SidebarTab[] };
@Component({ selector: 'ndd-test-shell', template: '' })
class Shell {
  constructor() {
    const items = injectMergedToolbarItems(() => [{ type: 'action', id: 'save', label: 'Save', icon: Icon, onClick: () => {} }]);
    const tabs = injectMergedSidebarTabs(() => [{ id: 'files', label: 'Files', icon: Icon }], Fallback);
    merged = { items, tabs };
  }
}
@Component({ selector: 'ndd-test-shell-host', imports: [Shell, NddDesktop], template: '<ndd-test-shell /><ndd-desktop />' })
class ShellHost {}

describe('the merge inject functions track the active panel', () => {
  it('injectMergedToolbarItems and injectMergedSidebarTabs follow a focus change', async () => {
    // Thin `computed`s over the plain functions above, so what is worth asserting is that they
    // are reactive — which is the whole reason rdd needed `useSyncExternalStore` for this.
    const { ws, stable } = await setup({ contributor: { component: Contributor } }, undefined, ShellHost);
    expect(ids(merged.items())).toEqual(['save']);
    expect(merged.tabs().map(t => t.id)).toEqual(['files']);

    ws.openPanel('p1', 'contributor');
    await stable();
    expect(ids(merged.items())).toEqual(['save', '|', 'act-p1']);
    expect(merged.tabs().map(t => t.id)).toEqual(['files', 'sec-p1']);

    ws.openPanel('p2', 'contributor');
    await stable();
    expect(ids(merged.items())).toEqual(['save', '|', 'act-p2']);
    expect(merged.tabs().map(t => t.id)).toEqual(['files', 'sec-p2']);
  });

  it('a stale withdrawal cannot clear a newer contribution for the same panel', () => {
    // The guard that makes publish-then-withdraw safe: calling the *previous* withdrawal after a
    // republish must do nothing.
    const ws = createWorkspace({ panels: {} });
    const first: PanelContribution = { toolbarItems: [{ type: 'action', id: 'first', label: 'F', icon: Icon, onClick: () => {} }] };
    const second: PanelContribution = { toolbarItems: [{ type: 'action', id: 'second', label: 'S', icon: Icon, onClick: () => {} }] };

    const withdrawFirst = ws.contributions.publish('p', first);
    const withdrawSecond = ws.contributions.publish('p', second);
    expect(firstItemId(ws.contributions.get('p'))).toBe('second');

    withdrawFirst();
    expect(firstItemId(ws.contributions.get('p'))).toBe('second');

    withdrawSecond();
    expect(ws.contributions.get('p')).toBeNull();
  });

  it('a panel never momentarily publishes nothing while updating', async () => {
    // Withdrawing before publishing would leave a gap. Signals have no synchronous observer, so
    // the store itself is instrumented: every write it makes is followed by a read of what the
    // active contribution is at that instant.
    const tool = signal('pan');
    @Component({ selector: 'ndd-test-live', template: '' })
    class Live {
      constructor() {
        injectPanelContribution(() => ({ toolbarItems: [{ type: 'action', id: tool(), label: tool(), icon: Icon, onClick: () => {} }] }));
      }
    }
    const { ws, stable } = await setup({ live: { component: Live } });
    // Instrumented before the panel opens, so every registration — and every withdrawal it hands
    // back — records what the active contribution is immediately after it runs.
    const observed: (string | null)[] = [];
    const store = ws.contributions as Workspace['contributions'];
    const publish = store.publish.bind(store);
    store.publish = (id, c) => {
      const withdraw = publish(id, c);
      observed.push(firstItemId(ws.activeContribution()));
      return () => {
        withdraw();
        observed.push(firstItemId(ws.activeContribution()));
      };
    };
    ws.openPanel('p1', 'live');
    await stable();
    observed.length = 0;

    tool.set('draw');
    await stable();

    expect(observed).not.toContain(null);
    expect(observed.at(-1)).toBe('draw');
  });

  it('a republished contribution is picked up without re-registering', async () => {
    // A getter means the component republishes when its own state changes and never otherwise.
    const tool = signal('pan');
    @Component({ selector: 'ndd-test-live2', template: '' })
    class Live2 {
      constructor() {
        injectPanelContribution(() => ({ toolbarItems: [{ type: 'action', id: tool(), label: tool(), icon: Icon, onClick: () => {} }] }));
      }
    }
    const { ws, stable } = await setup({ live: { component: Live2 } });
    ws.openPanel('p1', 'live');
    await stable();
    expect(firstItemId(ws.activeContribution())).toBe('pan');

    tool.set('draw');
    await stable();
    expect(firstItemId(ws.activeContribution())).toBe('draw');
    expect(ws.contributions.ids()).toEqual(['p1']); // republished, not duplicated
  });
});

// ─── A hidden panel contributes nothing visible ──────────────────────────────

describe('a contribution is never surfaced for a panel the user cannot see', () => {
  it('a minimised panel keeps publishing but is not the active one', async () => {
    const { ws, stable } = await setup();
    ws.openPanel('p1', 'contributor');
    await stable();
    expect(firstItemId(ws.activeContribution())).toBe('act-p1');

    ws.minimizePanel('p1');
    await stable();
    expect(ws.state().activePanelId).not.toBe('p1');
    expect(ws.activeContribution()).toBeNull();
    // Still mounted and still published — restoring it surfaces the same contribution again.
    expect(firstItemId(ws.contributions.get('p1'))).toBe('act-p1');

    ws.restorePanel('p1');
    await stable();
    expect(firstItemId(ws.activeContribution())).toBe('act-p1');
  });

  it('a background tab keeps publishing but is not the active one', async () => {
    const { ws, stable } = await setup();
    ws.openPanel('p1', 'contributor');
    ws.openPanel('p2', 'contributor');
    await stable();
    // p2 is the visible tab; p1 is behind it and must not be surfaced.
    expect(firstItemId(ws.activeContribution())).toBe('act-p2');
    expect(ws.contributions.get('p1')).not.toBeNull();
    expect(ws.contributions.ids().sort()).toEqual(['p1', 'p2']);
  });
});

// ─── Standalone ──────────────────────────────────────────────────────────────

describe('injectPanelContribution outside a panel', () => {
  it('warns and does nothing rather than throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ws = createWorkspace({ panels: {} });
      TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
      TestBed.runInInjectionContext(() => injectPanelContribution(() => ({ toolbarItems: [] })));
      expect(ws.contributions.ids()).toEqual([]);
      expect(warn.mock.calls.some(c => String(c[0]).includes('injectPanelContribution'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
