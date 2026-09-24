/**
 * `<ndd-sidebar>`, `<ndd-secondary-sidebar>`, `injectSidebar()` and `injectSidebarTab()`.
 *
 * Ported from vue-dockable-desktop `test/components/sidebar.test.ts` (91 tests, same SB numbers,
 * same order, names preserved with `vdd-` → `ndd-`). vdd's mapping from rdd's imperative handle
 * carries over, with Angular's names:
 *
 *   rdd handle method            ndd equivalent asserted here
 *   ──────────────────────────   ────────────────────────────────────────────────────
 *   openTab(id)                  injectSidebar().openTab(id)                   (SB11)
 *   closeDrawer()                injectSidebar().closeDrawer()                 (SB12)
 *   getActiveTab()               injectSidebar().activeTabId — a signal         (SB14)
 *   show() / hide() / toggle()   writing the `visible` model                   (SB13)
 *   showStrip() / hideStrip()    writing the `stripVisible` model              (SB24)
 *   setWidth(px) / getWidth()    writing / reading the `width` model           (SB21)
 *   onActiveTabChange            `(activeTabIdChange)`                   (SB10, SB18)
 *   onWidthChange                `(widthChange)`                               (SB21)
 *   renderContent(id)            `<ng-template nddSidebarTab="id">`, or the tab's `component`
 *   renderHeader(tab, close)     `<ng-template nddSidebarHeader>`, with the same context
 *
 * vdd's `update:x` listener is the model's own output (`model.subscribe`, i.e. `(xChange)`);
 * vdd's `setProps` is `setInput`, a one-way `[x]` binding. vdd's two deliberate assertion
 * changes stand: SB22 asserts clamping at the drag plus min/max bounds on the render, and SB26
 * reads the stylesheet (divergence D12).
 *
 * Every model test also has a twin at the end driven by `twoWayBinding` — what `[(x)]` compiles
 * to — or by a real `[(x)]` in a template, checking both directions.
 */
import { Component, input, inputBinding, runInInjectionContext, signal, twoWayBinding } from '@angular/core';
import type { OnInit, Type, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NddSecondarySidebar,
  NddSidebar,
  NddSidebarHeaderTemplate,
  NddSidebarTabTemplate,
  injectSidebar,
  injectSidebarTab,
} from '../../src/lib/sidebar/sidebar';
import type { SidebarPosition } from '../../src/lib/sidebar/sidebar';
import type { SidebarContext, SidebarRailEntry, SidebarTab } from '../../src/lib/core/sidebar-types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const Icon = 'icon';

/** One content component for every tab; its `id` input says which tab it is. */
@Component({ selector: 'ndd-test-content', template: `<div [attr.data-content]="id()">{{ id() }} content</div>` })
class Content {
  readonly id = input('');
}

const makeTab = (id: string, overrides: Partial<SidebarTab> = {}): SidebarTab => ({
  id,
  label: `Tab ${id}`,
  icon: Icon,
  component: Content,
  inputs: { id },
  ...overrides,
});

interface SidebarInputs {
  tabs: SidebarTab[];
  position?: SidebarPosition;
  headerAction?: SidebarRailEntry | SidebarRailEntry[];
  footerAction?: SidebarRailEntry | SidebarRailEntry[];
  minWidth?: number;
  maxWidth?: number;
  showCloseButton?: boolean;
  hideDefaultHeader?: boolean;
  activeTabId?: string | null;
  visible?: boolean;
  stripVisible?: boolean;
  width?: number;
}

/** vdd's `onUpdate:*` listeners: the models' own outputs. */
interface Listeners {
  activeTabId?: (id: string | null) => void;
  width?: (px: number) => void;
}

interface Mounted {
  fixture: ComponentFixture<unknown>;
  el: HTMLElement;
  setProps: (props: Partial<SidebarInputs>) => Promise<void>;
  /** `injectSidebar()` as a descendant of this sidebar would see it. */
  api: () => SidebarContext;
  stable: () => Promise<void>;
}

async function mountSidebar(props: SidebarInputs, listeners: Listeners = {}): Promise<Mounted> {
  const fixture = TestBed.createComponent(NddSidebar);
  const setProps = async (next: Partial<SidebarInputs>) => {
    for (const [key, value] of Object.entries(next)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
  };
  if (listeners.activeTabId) fixture.componentInstance.activeTabId.subscribe(listeners.activeTabId);
  if (listeners.width) fixture.componentInstance.width.subscribe(listeners.width);
  await setProps(props);
  return {
    fixture,
    el: fixture.nativeElement as HTMLElement,
    setProps,
    api: () => runInInjectionContext(fixture.componentRef.injector, injectSidebar),
    stable: () => fixture.whenStable(),
  };
}

const all = (m: Mounted, selector: string) => Array.from(m.el.querySelectorAll<HTMLElement>(selector));
const get = (m: Mounted, selector: string) => {
  const found = m.el.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};
const exists = (m: Mounted, selector: string) => m.el.querySelector(selector) !== null;
const railButtons = (m: Mounted) => all(m, '.ndd-sidebar-tab-btn');
const tabButton = (m: Mounted, id: string) => get(m, `[data-ndd-sidebar-tab="${id}"]`);
const drawer = (m: Mounted) => get(m, '.ndd-sidebar-content-drawer');
const stripOuter = (m: Mounted) => get(m, '.ndd-sidebar-strip-outer');
const content = (m: Mounted, id: string) => exists(m, `[data-content="${id}"]`);
/** `HTMLElement.click()`, which — like a real click, and like vdd's `trigger` — does nothing on a disabled button. */
const click = async (m: Mounted, el: Element) => {
  (el as HTMLElement).click();
  await m.stable();
};

/** Content probes record the context they resolve, in creation order. */
const probes: SidebarContext[] = [];
const seen: { position: string; isSecondary: boolean }[] = [];
beforeEach(() => {
  probes.length = 0;
  seen.length = 0;
});

@Component({ selector: 'ndd-test-probe', template: '<div data-probe></div>' })
class Probe implements OnInit {
  private readonly api = injectSidebar();
  constructor() {
    probes.push(this.api);
  }
  /** Read once inputs have landed, so `position` is the one the host bound. */
  ngOnInit(): void {
    seen.push({ position: this.api.position, isSecondary: this.api.isSecondary });
  }
}

/** Renders a close control wired to `injectSidebarTab()`, for the tab it is inside. */
@Component({
  selector: 'ndd-test-closer',
  template: `<button [attr.data-nested-close]="tab.tabId" [attr.data-sec-close]="tab.tabId" (click)="tab.close()">close</button>`,
})
class Closer {
  protected readonly tab = injectSidebarTab();
}

// ─── SB1 ─────────────────────────────────────────────────────────────────────

describe('SB1: Renders one button per tab in the strip', () => {
  it('renders correct number of tab buttons', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('b'), makeTab('c')] });
    expect(railButtons(m)).toHaveLength(3);
  });
});

// ─── SB2 ─────────────────────────────────────────────────────────────────────

describe('SB2: Tab buttons have aria-pressed=false initially', () => {
  it('all tab buttons start unpressed', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('b')] });
    for (const btn of railButtons(m)) expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});

// ─── SB3 ─────────────────────────────────────────────────────────────────────

describe('SB3: Clicking a tab opens the drawer', () => {
  it('content appears after clicking its tab', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    await click(m, tabButton(m, 'a'));
    expect(content(m, 'a')).toBe(true);
  });
});

// ─── SB4 ─────────────────────────────────────────────────────────────────────

describe('SB4: Clicking active tab again closes the drawer', () => {
  it('second click deactivates the tab', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    await click(m, tabButton(m, 'a'));
    expect(tabButton(m, 'a').getAttribute('aria-pressed')).toBe('true');
    await click(m, tabButton(m, 'a'));
    expect(tabButton(m, 'a').getAttribute('aria-pressed')).toBe('false');
    expect(drawer(m).style.flexBasis).toBe('0px');
  });
});

// ─── SB5 ─────────────────────────────────────────────────────────────────────

describe('SB5: eagerMount tabs are rendered before any click', () => {
  it('content is in DOM before tab is clicked', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a', { eagerMount: true })] });
    expect(content(m, 'a')).toBe(true);
  });
});

// ─── SB6 ─────────────────────────────────────────────────────────────────────

describe('SB6: Non-eagerMount tabs are not rendered before click', () => {
  it('content is absent before tab is clicked', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    expect(content(m, 'a')).toBe(false);
  });
});

// ─── SB7 ─────────────────────────────────────────────────────────────────────

describe('SB7: preserveState tabs remain in DOM after close', () => {
  it('content stays in DOM (hidden) after drawer closes', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a', { preserveState: true })] });
    await click(m, tabButton(m, 'a'));
    expect(content(m, 'a')).toBe(true);
    await click(m, tabButton(m, 'a'));
    expect(content(m, 'a')).toBe(true);
    expect(get(m, '[data-ndd-sidebar-pane="a"]').style.display).toBe('none');
  });
});

// ─── SB8 ─────────────────────────────────────────────────────────────────────

describe('SB8: Non-preserveState tabs are removed from DOM after close', () => {
  it('content is removed from DOM after drawer closes', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    await click(m, tabButton(m, 'a'));
    expect(content(m, 'a')).toBe(true);
    await click(m, tabButton(m, 'a'));
    expect(content(m, 'a')).toBe(false);
  });
});

// ─── SB9 ─────────────────────────────────────────────────────────────────────

describe('SB9: visible=false collapses the tab strip', () => {
  it('strip wrapper has width 0px when visible=false', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], visible: false });
    expect(stripOuter(m).style.width).toBe('0px');
  });

  it('strip wrapper has width 56px when visible=true (default)', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], visible: true });
    expect(stripOuter(m).style.width).toBe('56px');
  });
});

// ─── SB10 ────────────────────────────────────────────────────────────────────

describe('SB10: Controlled activeTabId drives which drawer is open', () => {
  it('renders the controlled tab as active', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('b')], activeTabId: 'b' });
    expect(tabButton(m, 'b').getAttribute('aria-pressed')).toBe('true');
    expect(tabButton(m, 'a').getAttribute('aria-pressed')).toBe('false');
    expect(content(m, 'b')).toBe(true);
  });

  it('emits activeTabIdChange when a tab is clicked in controlled mode', async () => {
    const onUpdate = vi.fn();
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('b')], activeTabId: 'a' }, { activeTabId: onUpdate });
    await click(m, tabButton(m, 'b'));
    expect(onUpdate).toHaveBeenCalledWith('b');
  });
});

// ─── SB11-SB14: what rdd's imperative handle did ─────────────────────────────

describe('SB11-SB14: injectSidebar() and the models replace the imperative handle', () => {
  it('SB11: injectSidebar().openTab() activates the correct tab', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('b')] });
    m.api().openTab('b');
    await m.stable();
    expect(tabButton(m, 'b').getAttribute('aria-pressed')).toBe('true');
    expect(content(m, 'b')).toBe(true);
  });

  it('SB12: injectSidebar().closeDrawer() closes the drawer', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    m.api().openTab('a');
    await m.stable();
    expect(drawer(m).style.flexBasis).not.toBe('0px');
    m.api().closeDrawer();
    await m.stable();
    expect(drawer(m).style.flexBasis).toBe('0px');
  });

  it('SB14: injectSidebar().activeTabId reads null initially, the tab id when open', async () => {
    // rdd needed getActiveTab() because a React context value is a snapshot. This is a
    // signal, so it is not only readable but reactive — a computed() over it would update.
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    const api = m.api();
    expect(api.activeTabId()).toBeNull();
    api.openTab('a');
    await m.stable();
    expect(api.activeTabId()).toBe('a');
    api.closeDrawer();
    await m.stable();
    expect(api.activeTabId()).toBeNull();
  });

  it('SB13: the visible model set to true shows the strip (rdd: show())', async () => {
    // rdd's show()/hide()/toggle() existed only to flip a boolean the caller could not write
    // to. The equivalent assertion is that the DOM follows the model in both directions.
    const m = await mountSidebar({ tabs: [makeTab('a')], visible: false });
    await m.setProps({ visible: true });
    expect(stripOuter(m).style.width).toBe('56px');
  });

  it('SB13: the visible model set to false hides the strip (rdd: hide())', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], visible: true });
    await m.setProps({ visible: false });
    expect(stripOuter(m).style.width).toBe('0px');
  });

  it('SB13: flipping the visible model false -> true shows it (rdd: toggle())', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], visible: false });
    expect(stripOuter(m).style.width).toBe('0px');
    await m.setProps({ visible: true });
    expect(stripOuter(m).style.width).toBe('56px');
  });

  it('SB13: flipping the visible model true -> false hides it (rdd: toggle())', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], visible: true });
    expect(stripOuter(m).style.width).toBe('56px');
    await m.setProps({ visible: false });
    expect(stripOuter(m).style.width).toBe('0px');
  });
});

// ─── SB15 ────────────────────────────────────────────────────────────────────

@Component({ selector: 'ndd-test-bare-sidebar', template: '' })
class BareSidebar {
  readonly api = injectSidebar();
}

@Component({ selector: 'ndd-test-bare-tab', template: '' })
class BareTab {
  readonly api = injectSidebarTab();
}

describe('SB15: injectSidebar() outside a sidebar throws', () => {
  it('throws when rendered outside a Sidebar tree', () => {
    expect(() => TestBed.createComponent(BareSidebar)).toThrow(/injectSidebar\(\)/);
  });
});

// ─── SB16 ────────────────────────────────────────────────────────────────────

describe('SB16: injectSidebarTab() outside a tab throws', () => {
  it("throws when rendered outside a sidebar tab's content", () => {
    expect(() => TestBed.createComponent(BareTab)).toThrow(/injectSidebarTab\(\)/);
  });
});

// ─── SB17 ────────────────────────────────────────────────────────────────────

describe('SB17: position controls strip and drawer order', () => {
  const order = (m: Mounted) => {
    const children = Array.from(m.el.children);
    return {
      strip: children.findIndex(el => el.classList.contains('ndd-sidebar-strip-outer')),
      drawer: children.findIndex(el => el.classList.contains('ndd-sidebar-content-drawer')),
    };
  };

  it("position='left': strip comes before drawer in DOM", async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], position: 'left', activeTabId: 'a' });
    const { strip, drawer: d } = order(m);
    expect(strip).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(strip).toBeLessThan(d);
  });

  it("position='right' (default): drawer comes before strip in DOM", async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], position: 'right', activeTabId: 'a' });
    const { strip, drawer: d } = order(m);
    expect(strip).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThan(strip);
  });
});

// ─── SB18 ────────────────────────────────────────────────────────────────────

describe('SB18: activeTabIdChange is emitted on tab selection changes', () => {
  it('fires with tab id when tab is opened', async () => {
    const onUpdate = vi.fn();
    const m = await mountSidebar({ tabs: [makeTab('a')] }, { activeTabId: onUpdate });
    await click(m, tabButton(m, 'a'));
    expect(onUpdate).toHaveBeenCalledWith('a');
  });

  it('fires with null when active tab is clicked to close', async () => {
    const onUpdate = vi.fn();
    const m = await mountSidebar({ tabs: [makeTab('a')] }, { activeTabId: onUpdate });
    await click(m, tabButton(m, 'a'));
    onUpdate.mockClear();
    await click(m, tabButton(m, 'a'));
    expect(onUpdate).toHaveBeenCalledWith(null);
  });
});

// ─── SB19 ────────────────────────────────────────────────────────────────────

describe('SB19: the width model initialises the drawer width in pixels', () => {
  it('drawer flex-basis reflects the initial width (rdd: defaultWidth)', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a', width: 320 });
    expect(drawer(m).style.flexBasis).toBe('320px');
  });

  it('defaults to 280px when width is omitted', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a' });
    expect(drawer(m).style.flexBasis).toBe('280px');
  });
});

// ─── SB21 ────────────────────────────────────────────────────────────────────

/** A pointer drag on the resizer, by `dx`, from `from`. */
function dragBy(bar: HTMLElement, dx: number, from = 500): void {
  bar.setPointerCapture = vi.fn();
  bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: from, clientY: 0 }));
  bar.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: from + dx, clientY: 0 }));
  bar.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
}

describe('SB21: the width model replaces setWidth/getWidth', () => {
  it('writing the width model updates drawer flex-basis (rdd: setWidth)', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a', width: 280 });
    await m.setProps({ width: 400 });
    expect(drawer(m).style.flexBasis).toBe('400px');
  });

  it("the caller's own value is the current pixel width (rdd: getWidth)", async () => {
    // There is nothing to read back from: the model *is* the caller's value. rdd needed a
    // getter only because the width lived inside the component.
    let width = 310;
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a', width }, { width: v => (width = v) });
    expect(width).toBe(310);
    expect(drawer(m).style.flexBasis).toBe('310px');
  });

  it('reading reflects a write (rdd: getWidth after setWidth)', async () => {
    let width = 280;
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a', width }, { width: v => (width = v) });
    width = 350;
    await m.setProps({ width: 350 });
    expect(width).toBe(350);
    expect(drawer(m).style.flexBasis).toBe('350px');
  });

  it('dragging the resizer emits widthChange (rdd: onWidthChange)', async () => {
    const onUpdate = vi.fn();
    const m = await mountSidebar(
      { tabs: [makeTab('a')], activeTabId: 'a', position: 'right', width: 300 },
      { width: onUpdate },
    );
    // A right-hand drawer grows when the pointer moves left.
    dragBy(get(m, '[data-ndd-sidebar-resizer]'), -40, 100);
    expect(onUpdate).toHaveBeenCalledWith(340);
  });
});

// ─── SB22 ────────────────────────────────────────────────────────────────────

describe('SB22: the width stays within minWidth and maxWidth', () => {
  /**
   * rdd clamped inside `setWidth`. A model has no setter to clamp in, and silently rewriting
   * the caller's own value is not something a component should do — so, as in vdd, the value
   * is clamped where it is produced (the drag) and the render is bounded with min/max-width so
   * even a value the caller sets out of range cannot draw out of range. Both are asserted.
   */
  it('a drag past minWidth is clamped to minWidth', async () => {
    const onUpdate = vi.fn();
    const m = await mountSidebar(
      { tabs: [makeTab('a')], activeTabId: 'a', position: 'right', width: 300, minWidth: 200, maxWidth: 600 },
      { width: onUpdate },
    );
    dragBy(get(m, '[data-ndd-sidebar-resizer]'), 1000); // shrink hard
    expect(onUpdate).toHaveBeenLastCalledWith(200);
  });

  it('a drag past maxWidth is clamped to maxWidth, and the render is bounded too', async () => {
    const onUpdate = vi.fn();
    const m = await mountSidebar(
      { tabs: [makeTab('a')], activeTabId: 'a', position: 'right', width: 300, minWidth: 200, maxWidth: 600 },
      { width: onUpdate },
    );
    dragBy(get(m, '[data-ndd-sidebar-resizer]'), -1000); // grow hard
    expect(onUpdate).toHaveBeenLastCalledWith(600);
    await m.stable();
    const style = drawer(m).style;
    expect(style.minWidth).toBe('200px');
    expect(style.maxWidth).toBe('600px');
  });
});

// ─── SB23 ────────────────────────────────────────────────────────────────────

describe('SB23: stripVisible=false collapses only the strip', () => {
  it('strip wrapper collapses to 0px when stripVisible=false', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], stripVisible: false });
    expect(stripOuter(m).style.width).toBe('0px');
  });

  it('strip wrapper is visible (56px) when stripVisible is omitted', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    expect(stripOuter(m).style.width).toBe('56px');
  });

  it('stripVisible=false does not hide the drawer when a tab is open', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a', stripVisible: false, width: 280 });
    expect(stripOuter(m).style.width).toBe('0px');
    expect(drawer(m).style.flexBasis).toBe('280px');
    expect(content(m, 'a')).toBe(true);
  });
});

// ─── SB24 ────────────────────────────────────────────────────────────────────

describe('SB24: the stripVisible model replaces showStrip/hideStrip', () => {
  it('setting stripVisible to true shows the strip (rdd: showStrip())', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], stripVisible: false });
    await m.setProps({ stripVisible: true });
    expect(stripOuter(m).style.width).toBe('56px');
  });

  it('setting stripVisible to false hides the strip (rdd: hideStrip())', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], stripVisible: true });
    await m.setProps({ stripVisible: false });
    expect(stripOuter(m).style.width).toBe('0px');
  });
});

// ─── SB25 ────────────────────────────────────────────────────────────────────

describe('SB25: resize handle renders only when drawer is open', () => {
  it('no .ndd-resizer-bar when no tab is active', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    expect(exists(m, '.ndd-resizer-bar')).toBe(false);
  });

  it('.ndd-resizer-bar is present when a tab is active', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a' });
    expect(exists(m, '.ndd-resizer-bar')).toBe(true);
  });
});

// ─── SB26 ────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-main-host',
  imports: [NddSidebar],
  template: `<ndd-sidebar [tabs]="tabs"><div>workspace content</div></ndd-sidebar>`,
})
class MainHost {
  readonly tabs = [makeTab('a')];
}

describe("SB26: the content wrapper uses flex-basis:0 (content can't inflate it and shift the drawer)", () => {
  it('.ndd-sidebar-main has flex-basis 0 and min-width 0', async () => {
    // rdd set this inline; vdd moved every structural rule to the stylesheet (divergence D12)
    // and jsdom loads no stylesheet, so the rule is read from the CSS source.
    //
    // flex-basis: auto (what a bare flex-grow:1 leaves in place) makes a flex item's
    // hypothetical size its content's max-content width, and min-width:0 lowers only the
    // shrink floor, not that starting size. So a wide panel inside would inflate this wrapper
    // and steal width from the drawer beside it.
    const css = readFileSync(resolve(process.cwd(), 'projects/angular-dockable-desktop/src/styles/styles.css'), 'utf8');
    const rule = css.match(/\.ndd-sidebar-main\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/flex-basis:\s*0/);
    expect(rule![0]).toMatch(/min-width:\s*0/);
    // And the class is actually the one the component emits, not a name only the CSS knows.
    const fixture = TestBed.createComponent(MainHost);
    await fixture.whenStable();
    const main = (fixture.nativeElement as HTMLElement).querySelector('.ndd-sidebar-main');
    expect(main?.textContent?.trim()).toBe('workspace content');
  });
});

// ─── SB27 ────────────────────────────────────────────────────────────────────

describe('SB27: drawer auto-closes when the active tab stops existing in tabs', () => {
  it('uncontrolled: closes when the active tab is removed but other tabs remain', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('b')] });
    await click(m, tabButton(m, 'a'));
    expect(content(m, 'a')).toBe(true);
    await m.setProps({ tabs: [makeTab('b')] });
    expect(drawer(m).style.flexBasis).toBe('0px');
    expect(content(m, 'a')).toBe(false);
  });

  it('uncontrolled: closes when tabs becomes fully empty', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    await click(m, tabButton(m, 'a'));
    await m.setProps({ tabs: [] });
    expect(drawer(m).style.flexBasis).toBe('0px');
    expect(railButtons(m)).toHaveLength(0);
  });

  it('does NOT fall back to a different tab when the active one vanishes', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('b')] });
    await click(m, tabButton(m, 'a'));
    await m.setProps({ tabs: [makeTab('b')] });
    expect(tabButton(m, 'b').getAttribute('aria-pressed')).toBe('false');
    expect(content(m, 'b')).toBe(false);
  });

  it('controlled: emits activeTabIdChange with null when the controlled active tab vanishes', async () => {
    const onUpdate = vi.fn();
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('b')], activeTabId: 'a' }, { activeTabId: onUpdate });
    await m.setProps({ tabs: [makeTab('b')] });
    expect(onUpdate).toHaveBeenCalledWith(null);
  });
});

// ─── SB28 ────────────────────────────────────────────────────────────────────

@Component({ selector: 'ndd-test-custom-entry', template: `<div data-custom="yes">custom</div>` })
class CustomEntry {}

describe('SB28: headerAction renders a standalone, non-toggling button above the tabs', () => {
  it('renders no extra button when headerAction is omitted', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    expect(railButtons(m)).toHaveLength(1);
    expect(exists(m, '.ndd-sidebar-header-area')).toBe(false);
  });

  it('renders a button with the given icon/label, calls onClick, and never opens the drawer', async () => {
    const onClick = vi.fn();
    const onUpdate = vi.fn();
    const m = await mountSidebar(
      { tabs: [makeTab('a')], headerAction: { id: 'burger', icon: Icon, label: 'Menu', onClick } },
      { activeTabId: onUpdate },
    );
    const btn = get(m, '[data-ndd-rail-action="burger"]');
    expect(btn.getAttribute('title')).toBe('Menu');
    expect(btn.getAttribute('aria-label')).toBe('Menu');
    await click(m, btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(drawer(m).style.flexBasis).toBe('0px');
  });

  it('disabled: true renders a disabled button that does not fire onClick', async () => {
    const onClick = vi.fn();
    const m = await mountSidebar({
      tabs: [makeTab('a')],
      headerAction: { id: 'burger', icon: Icon, label: 'Menu', onClick, disabled: true },
    });
    const btn = get(m, '[data-ndd-rail-action="burger"]');
    expect(btn.hasAttribute('disabled')).toBe(true);
    await click(m, btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a custom entry renders wholesale, with no .ndd-sidebar-tab-btn generated for it', async () => {
    // rdd's `render: () => node`. ndd takes a component, since that is what an Angular caller has.
    const m = await mountSidebar({ tabs: [], headerAction: { id: 'x', custom: true, component: CustomEntry } });
    expect(get(m, '[data-custom="yes"]').textContent).toBe('custom');
    expect(railButtons(m)).toHaveLength(0);
  });

  it('adds the reduced-top-padding modifier class to the strip only when headerAction is present', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    const strip = () => get(m, '.ndd-sidebar-tabs-strip');
    expect(strip().classList).not.toContain('ndd-sidebar-tabs-strip--has-header-action');
    await m.setProps({ headerAction: { icon: Icon, label: 'Menu', onClick: () => {} } });
    expect(strip().classList).toContain('ndd-sidebar-tabs-strip--has-header-action');
  });

  it('wraps headerAction in .ndd-sidebar-header-area (both forms) and tabs in .ndd-sidebar-tabs-list', async () => {
    const single = { icon: Icon, label: 'Menu', onClick: () => {} };
    const m = await mountSidebar({ tabs: [makeTab('a')], headerAction: single });
    expect(get(m, '.ndd-sidebar-header-area').querySelectorAll('button')).toHaveLength(1);
    expect(get(m, '.ndd-sidebar-tabs-list').querySelectorAll('button')).toHaveLength(1);
    await m.setProps({ headerAction: [single, { icon: Icon, label: 'Other', onClick: () => {} }] });
    expect(get(m, '.ndd-sidebar-header-area').querySelectorAll('button')).toHaveLength(2);
    expect(get(m, '.ndd-sidebar-tabs-list').querySelectorAll('button')).toHaveLength(1);
  });
});

// ─── SB29 ────────────────────────────────────────────────────────────────────

describe('SB29: showCloseButton adds an extra close control to the drawer header', () => {
  it('renders no close button when showCloseButton is omitted', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a' });
    expect(exists(m, '.ndd-sidebar-drawer-close-button')).toBe(false);
    expect(exists(m, '.ndd-sidebar-drawer-header')).toBe(true);
  });

  it('renders a close button in the drawer header when showCloseButton is true', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a', showCloseButton: true });
    const btn = get(m, '.ndd-sidebar-drawer-close-button');
    expect(get(m, '.ndd-sidebar-drawer-header').contains(btn)).toBe(true);
  });

  it('clicking the close button collapses the drawer via the same path as clicking the active tab icon', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], showCloseButton: true });
    await click(m, tabButton(m, 'a'));
    expect(drawer(m).style.flexBasis).not.toBe('0px');
    await click(m, get(m, '.ndd-sidebar-drawer-close-button'));
    expect(drawer(m).style.flexBasis).toBe('0px');
    expect(tabButton(m, 'a').getAttribute('aria-pressed')).toBe('false');
  });

  it('does not render a close button when the drawer is closed (no active tab)', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], showCloseButton: true });
    expect(exists(m, '.ndd-sidebar-drawer-close-button')).toBe(false);
  });
});

// ─── SB30 ────────────────────────────────────────────────────────────────────

describe('SB30: footerAction mirrors headerAction, pinned to the bottom, and can mix tabs and action buttons', () => {
  it('renders no footer-area when footerAction is omitted', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    expect(exists(m, '.ndd-sidebar-footer-area')).toBe(false);
  });

  it('renders a single action button in .ndd-sidebar-footer-area, firing onClick without touching activeTabId', async () => {
    const onClick = vi.fn();
    const onUpdate = vi.fn();
    const m = await mountSidebar(
      { tabs: [makeTab('a')], footerAction: { id: 'settings', icon: Icon, label: 'Settings', onClick } },
      { activeTabId: onUpdate },
    );
    const area = get(m, '.ndd-sidebar-footer-area');
    expect(area.querySelectorAll('button')).toHaveLength(1);
    await click(m, area.querySelector('button')!);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('adds the --has-footer-action modifier class to the strip only when footerAction is present', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')] });
    const strip = () => get(m, '.ndd-sidebar-tabs-strip');
    expect(strip().classList).not.toContain('ndd-sidebar-tabs-strip--has-footer-action');
    await m.setProps({ footerAction: { icon: Icon, label: 'Settings', onClick: () => {} } });
    expect(strip().classList).toContain('ndd-sidebar-tabs-strip--has-footer-action');
  });

  it('accepts an array mixing an action button and a real tab, rendering both in the footer area', async () => {
    const m = await mountSidebar({
      tabs: [makeTab('a')],
      footerAction: [{ id: 'settings', icon: Icon, label: 'Settings', onClick: () => {} }, makeTab('help')],
    });
    const area = get(m, '.ndd-sidebar-footer-area');
    expect(area.querySelectorAll('button')).toHaveLength(2);
    expect(area.querySelector('[data-ndd-rail-action="settings"]')).not.toBeNull();
    expect(area.querySelector('[data-ndd-sidebar-tab="help"]')).not.toBeNull();
  });

  it('a tab entry inside footerAction behaves exactly like a main-list tab: mounts, activates, and renders its content on click', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], footerAction: [makeTab('help')] });
    expect(content(m, 'help')).toBe(false);
    await click(m, tabButton(m, 'help'));
    expect(tabButton(m, 'help').getAttribute('aria-pressed')).toBe('true');
    expect(content(m, 'help')).toBe(true);
  });

  it('removing a footer tab while active closes the drawer instead of leaving stale content (SB27 for rail tabs)', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], footerAction: [makeTab('help')] });
    await click(m, tabButton(m, 'help'));
    expect(content(m, 'help')).toBe(true);
    await m.setProps({ footerAction: [] });
    expect(drawer(m).style.flexBasis).toBe('0px');
    expect(content(m, 'help')).toBe(false);
  });

  it('a single-object headerAction keeps working alongside footerAction', async () => {
    const onHeader = vi.fn();
    const onFooter = vi.fn();
    const m = await mountSidebar({
      tabs: [makeTab('a')],
      headerAction: { id: 'burger', icon: Icon, label: 'Menu', onClick: onHeader },
      footerAction: { id: 'settings', icon: Icon, label: 'Settings', onClick: onFooter },
    });
    await click(m, get(m, '[data-ndd-rail-action="burger"]'));
    await click(m, get(m, '[data-ndd-rail-action="settings"]'));
    expect(onHeader).toHaveBeenCalledTimes(1);
    expect(onFooter).toHaveBeenCalledTimes(1);
  });
});

// ─── SB31 ────────────────────────────────────────────────────────────────────

describe('SB31: hidden tab renders no rail button', () => {
  it('omits the button for a hidden tab while other tabs still render theirs', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('secret', { hidden: true }), makeTab('b')] });
    expect(railButtons(m)).toHaveLength(2);
    expect(exists(m, '[data-ndd-sidebar-tab="secret"]')).toBe(false);
    expect(exists(m, '[data-ndd-sidebar-tab="a"]')).toBe(true);
  });
});

// ─── SB32 ────────────────────────────────────────────────────────────────────

describe('SB32: hidden tab still opens through injectSidebar()', () => {
  it('mounts drawer content for a hidden tab when opened programmatically', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('secret', { hidden: true })] });
    m.api().openTab('secret');
    await m.stable();
    expect(content(m, 'secret')).toBe(true);
    expect(drawer(m).style.flexBasis).not.toBe('0px');
  });
});

// ─── SB33 ────────────────────────────────────────────────────────────────────

describe('SB33: hidden tab still opens via a controlled activeTabId', () => {
  it('mounts drawer content for a hidden tab set as the controlled active tab', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('secret', { hidden: true })], activeTabId: 'secret' });
    expect(content(m, 'secret')).toBe(true);
    expect(railButtons(m)).toHaveLength(1);
  });
});

// ─── SB34 ────────────────────────────────────────────────────────────────────

describe('SB34: hidden entry inside headerAction/footerAction renders no button but still opens', () => {
  it('headerAction: a hidden tab entry renders no button but still opens', async () => {
    const m = await mountSidebar({ tabs: [], headerAction: [makeTab('secret', { hidden: true })] });
    expect(railButtons(m)).toHaveLength(0);
    m.api().openTab('secret');
    await m.stable();
    expect(content(m, 'secret')).toBe(true);
  });

  it('footerAction: a hidden tab entry renders no button but still opens', async () => {
    const m = await mountSidebar({ tabs: [], footerAction: [makeTab('secret', { hidden: true })] });
    expect(railButtons(m)).toHaveLength(0);
    m.api().openTab('secret');
    await m.stable();
    expect(content(m, 'secret')).toBe(true);
  });
});

// ─── SB35 ────────────────────────────────────────────────────────────────────

describe('SB35: every tab hidden -> zero rail buttons, all still individually openable', () => {
  it('renders no buttons in the tabs list when every tab is hidden, but each still opens', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a', { hidden: true }), makeTab('b', { hidden: true })] });
    expect(get(m, '.ndd-sidebar-tabs-list').querySelectorAll('button')).toHaveLength(0);
    for (const id of ['a', 'b']) {
      m.api().openTab(id);
      await m.stable();
      expect(content(m, id)).toBe(true);
    }
  });

  it('composes with a visible headerAction hamburger: rail shows exactly one button while all tabs stay hidden', async () => {
    const m = await mountSidebar({
      tabs: [makeTab('a', { hidden: true }), makeTab('b', { hidden: true })],
      headerAction: { id: 'burger', icon: Icon, label: 'Menu', onClick: () => {} },
    });
    expect(railButtons(m)).toHaveLength(1);
    expect(exists(m, '[data-ndd-rail-action="burger"]')).toBe(true);
  });
});

// ─── SB36 ────────────────────────────────────────────────────────────────────

describe('SB36: auto-close-if-removed guard still fires when the removed active tab was hidden', () => {
  it('closes when the active hidden tab is removed, mirroring SB27 for a visible tab', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a'), makeTab('secret', { hidden: true })] });
    m.api().openTab('secret');
    await m.stable();
    expect(content(m, 'secret')).toBe(true);
    await m.setProps({ tabs: [makeTab('a')] });
    expect(drawer(m).style.flexBasis).toBe('0px');
    expect(content(m, 'secret')).toBe(false);
  });
});

// ─── SB37 ────────────────────────────────────────────────────────────────────

describe('SB37: hideDefaultHeader suppresses the drawer header for every tab, not per-tab', () => {
  it('renders no .ndd-sidebar-drawer-header for any tab, even with showCloseButton set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await mountSidebar({
      tabs: [makeTab('a'), makeTab('b')],
      activeTabId: 'a',
      hideDefaultHeader: true,
      showCloseButton: true,
    });
    expect(exists(m, '.ndd-sidebar-drawer-header')).toBe(false);
    await m.setProps({ activeTabId: 'b' });
    expect(exists(m, '.ndd-sidebar-drawer-header')).toBe(false);
    warn.mockRestore();
  });
});

// ─── SB38 ────────────────────────────────────────────────────────────────────

describe('SB38: the default header still renders when hideDefaultHeader is omitted', () => {
  it('renders .ndd-sidebar-drawer-header and its title as before (contrast with SB37)', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a' });
    expect(exists(m, '.ndd-sidebar-drawer-header')).toBe(true);
    expect(get(m, '.ndd-sidebar-header-title').textContent).toBe('Tab a');
  });
});

// ─── SB39 ────────────────────────────────────────────────────────────────────

/** A sidebar with an `nddSidebarHeader` template: interactive (SB39) or static (SB41, SB42). */
@Component({
  selector: 'ndd-test-header-host',
  imports: [NddSidebar, NddSidebarHeaderTemplate],
  template: `
    <ndd-sidebar [tabs]="tabs()" [activeTabId]="activeTabId()" [showCloseButton]="showCloseButton()">
      <ng-template nddSidebarHeader let-tab let-close="close">
        @if (staticHeader()) {
          <div data-custom-header="yes">mine</div>
        } @else {
          <div [attr.data-custom-header]="tab.id">
            <button data-custom-close (click)="close()">x</button>
          </div>
        }
      </ng-template>
    </ndd-sidebar>
  `,
})
class HeaderHost {
  readonly tabs = signal([makeTab('a')]);
  readonly activeTabId = signal<string | null>(null);
  readonly showCloseButton = signal(false);
  readonly staticHeader = signal(false);
}

async function mountHost<T>(type: Type<T>, setup: (host: T) => void = () => {}): Promise<Mounted & { host: T }> {
  const fixture = TestBed.createComponent(type);
  setup(fixture.componentInstance);
  await fixture.whenStable();
  return {
    fixture,
    host: fixture.componentInstance,
    el: fixture.nativeElement as HTMLElement,
    setProps: () => Promise.reject(new Error('a host is driven through its own signals')),
    api: () => probes[probes.length - 1]!,
    stable: () => fixture.whenStable(),
  };
}

describe('SB39: the nddSidebarHeader template renders in place of the default header and its close collapses the drawer', () => {
  it('renders the header template for the active tab, and its close closes the drawer', async () => {
    const m = await mountHost(HeaderHost);
    await click(m, tabButton(m, 'a'));
    expect(exists(m, '[data-custom-header="a"]')).toBe(true);
    expect(exists(m, '.ndd-sidebar-drawer-header')).toBe(false);
    await click(m, get(m, '[data-custom-close]'));
    expect(drawer(m).style.flexBasis).toBe('0px');
  });
});

// ─── SB40 ────────────────────────────────────────────────────────────────────

describe('SB40: hideDefaultHeader with no header template renders nothing for the header; injectSidebarTab().close still works', () => {
  it('renders no default header, no template output, and a nested close still collapses the drawer', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a', { component: Closer, inputs: {} })], hideDefaultHeader: true });
    await click(m, tabButton(m, 'a'));
    expect(exists(m, '.ndd-sidebar-drawer-header')).toBe(false);
    await click(m, get(m, '[data-nested-close="a"]'));
    expect(drawer(m).style.flexBasis).toBe('0px');
  });
});

// ─── SB41 ────────────────────────────────────────────────────────────────────

describe('SB41: the header template alone, without hideDefaultHeader, suppresses the default header', () => {
  it('renders the template output and no default header, with hideDefaultHeader omitted entirely', async () => {
    const m = await mountHost(HeaderHost, h => {
      h.activeTabId.set('a');
      h.staticHeader.set(true);
    });
    expect(exists(m, '[data-custom-header="yes"]')).toBe(true);
    expect(exists(m, '.ndd-sidebar-drawer-header')).toBe(false);
  });

  it('renders no .ndd-sidebar-drawer-close-button even with showCloseButton set, since the default header is fully skipped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await mountHost(HeaderHost, h => {
      h.activeTabId.set('a');
      h.staticHeader.set(true);
      h.showCloseButton.set(true);
    });
    expect(exists(m, '.ndd-sidebar-drawer-close-button')).toBe(false);
    warn.mockRestore();
  });
});

// ─── SB42 ────────────────────────────────────────────────────────────────────

describe('SB42: dev-only console.warn when showCloseButton has no effect', () => {
  let warn: MockInstance<(...args: unknown[]) => void>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) as MockInstance<(...args: unknown[]) => void>;
  });
  afterEach(() => warn.mockRestore());

  const messages = () => warn.mock.calls.map(c => String(c[0])).filter(msg => msg.includes('showCloseButton'));

  it('warns when showCloseButton and hideDefaultHeader are both set', async () => {
    await mountSidebar({ tabs: [makeTab('a')], showCloseButton: true, hideDefaultHeader: true });
    expect(messages()).toHaveLength(1);
  });

  it('warns when showCloseButton and a header template are both given, with hideDefaultHeader omitted', async () => {
    await mountHost(HeaderHost, h => {
      h.staticHeader.set(true);
      h.showCloseButton.set(true);
    });
    expect(messages()).toHaveLength(1);
  });

  it('does not warn when only showCloseButton is set', async () => {
    await mountSidebar({ tabs: [makeTab('a')], showCloseButton: true });
    expect(messages()).toHaveLength(0);
  });

  it('does not warn when only hideDefaultHeader is set (no showCloseButton)', async () => {
    await mountSidebar({ tabs: [makeTab('a')], hideDefaultHeader: true });
    expect(messages()).toHaveLength(0);
  });

  it('warns only once even across multiple updates', async () => {
    const m = await mountSidebar({ tabs: [makeTab('a')], showCloseButton: true, hideDefaultHeader: true });
    await m.setProps({ tabs: [makeTab('a'), makeTab('b')] });
    await m.setProps({ activeTabId: 'a' });
    await m.setProps({ hideDefaultHeader: false });
    await m.setProps({ hideDefaultHeader: true });
    expect(messages()).toHaveLength(1);
  });
});

// ─── SB43 ────────────────────────────────────────────────────────────────────

interface PairInputs {
  tabs: SidebarTab[];
  position?: SidebarPosition;
  activeTabId?: string | null;
  headerAction?: SidebarRailEntry;
}

/** A primary with a secondary nested in its content, and optional probes at both levels. */
@Component({
  selector: 'ndd-test-pair-host',
  imports: [NddSidebar, NddSecondarySidebar, Probe],
  template: `
    <ndd-sidebar
      [tabs]="primary().tabs"
      [position]="primary().position ?? 'right'"
      [activeTabId]="primary().activeTabId ?? null"
      (activeTabIdChange)="onPrimary($event)"
    >
      @if (primaryProbe()) {
        <ndd-test-probe />
      }
      <ndd-secondary-sidebar
        [tabs]="secondary().tabs"
        [headerAction]="secondary().headerAction"
        [activeTabId]="secondary().activeTabId ?? null"
        (activeTabIdChange)="onSecondary($event)"
      >
        @if (secondaryProbe()) {
          <ndd-test-probe />
        }
      </ndd-secondary-sidebar>
    </ndd-sidebar>
  `,
})
class PairHost {
  readonly primary = signal<PairInputs>({ tabs: [] });
  readonly secondary = signal<PairInputs>({ tabs: [] });
  readonly primaryProbe = signal(false);
  readonly secondaryProbe = signal(false);
  onPrimary: (id: string | null) => void = () => {};
  onSecondary: (id: string | null) => void = () => {};
}

const mountPair = (
  primary: PairInputs,
  secondary: PairInputs,
  extra: Partial<Pick<PairHost, 'onPrimary' | 'onSecondary'>> & { primaryProbe?: boolean; secondaryProbe?: boolean } = {},
) =>
  mountHost(PairHost, h => {
    h.primary.set(primary);
    h.secondary.set(secondary);
    h.primaryProbe.set(extra.primaryProbe ?? false);
    h.secondaryProbe.set(extra.secondaryProbe ?? false);
    if (extra.onPrimary) h.onPrimary = extra.onPrimary;
    if (extra.onSecondary) h.onSecondary = extra.onSecondary;
  });

describe('SB43: NddSecondarySidebar renders on the opposite side automatically', () => {
  it('primary position="left" -> secondary renders on the right', async () => {
    const m = await mountPair({ tabs: [makeTab('a')], position: 'left' }, { tabs: [makeTab('b')] });
    expect(all(m, '[data-ndd-sidebar]').map(el => el.getAttribute('data-ndd-sidebar'))).toEqual(['left', 'right']);
  });

  it('primary position="right" -> secondary renders on the left', async () => {
    const m = await mountPair({ tabs: [makeTab('a')], position: 'right' }, { tabs: [makeTab('b')] });
    expect(all(m, '[data-ndd-sidebar]').map(el => el.getAttribute('data-ndd-sidebar'))).toEqual(['right', 'left']);
  });
});

// ─── SB44 ────────────────────────────────────────────────────────────────────

describe('SB44: NddSecondarySidebar with no primary ancestor throws', () => {
  it('throws when rendered standalone', () => {
    expect(() => TestBed.createComponent(NddSecondarySidebar)).toThrow(/must be rendered inside an <ndd-sidebar>/);
  });
});

// ─── SB45 ────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-triple-host',
  imports: [NddSidebar, NddSecondarySidebar],
  template: `
    <ndd-sidebar [tabs]="[]" position="left">
      <ndd-secondary-sidebar [tabs]="[]">
        <ndd-secondary-sidebar [tabs]="[]" />
      </ndd-secondary-sidebar>
    </ndd-sidebar>
  `,
})
class TripleHost {}

describe('SB45: NddSecondarySidebar nested inside another one throws', () => {
  it('throws on triple nesting', () => {
    expect(() => TestBed.createComponent(TripleHost).detectChanges()).toThrow(/cannot be nested inside another one/);
  });
});

// ─── SB46 ────────────────────────────────────────────────────────────────────

describe('SB46: injectSidebar() reports the correct position/isSecondary at both levels', () => {
  it('each level sees its own correct context value', async () => {
    await mountPair(
      { tabs: [makeTab('a')], position: 'left' },
      { tabs: [makeTab('b')] },
      { primaryProbe: true, secondaryProbe: true },
    );
    expect(seen).toEqual([
      { position: 'left', isSecondary: false },
      { position: 'right', isSecondary: true },
    ]);
  });
});

// ─── SB47 ────────────────────────────────────────────────────────────────────

describe("SB47: resizing one sidebar does not suppress the other's transition", () => {
  it("dragging the primary's resize handle leaves the secondary's drawer transition untouched, and vice versa", async () => {
    // Each instance owns its own `resizing` flag. A single module-level flag would work in
    // every single-sidebar test and fail only here — which is why this test exists.
    const m = await mountPair(
      { tabs: [makeTab('a')], position: 'left', activeTabId: 'a' },
      { tabs: [makeTab('b')], activeTabId: 'b' },
    );
    const drawers = all(m, '.ndd-sidebar-content-drawer');
    const bars = all(m, '[data-ndd-sidebar-resizer]');
    expect(drawers).toHaveLength(2);
    expect(bars).toHaveLength(2);
    const [primaryDrawer, secondaryDrawer] = drawers as [HTMLElement, HTMLElement];
    const [primaryBar, secondaryBar] = bars as [HTMLElement, HTMLElement];

    const down = (bar: HTMLElement, id: number) => {
      bar.setPointerCapture = vi.fn();
      bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: id, clientX: 0, clientY: 0 }));
    };
    const up = (bar: HTMLElement, id: number) => bar.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: id }));

    const secondaryBefore = secondaryDrawer.style.transition;
    down(primaryBar, 1);
    await m.stable();
    expect(primaryDrawer.style.transition).toBe('none');
    expect(secondaryDrawer.style.transition).toBe(secondaryBefore);
    up(primaryBar, 1);
    await m.stable();

    const primaryBefore = primaryDrawer.style.transition;
    down(secondaryBar, 2);
    await m.stable();
    expect(secondaryDrawer.style.transition).toBe('none');
    expect(primaryDrawer.style.transition).toBe(primaryBefore);
    up(secondaryBar, 2);
  });
});

// ─── SB48 ────────────────────────────────────────────────────────────────────

describe('SB48: a hidden tab on the secondary has no rail button but is still openable', () => {
  it('renders no rail button for the hidden secondary tab, but opening it still works', async () => {
    const m = await mountPair(
      { tabs: [makeTab('a')], position: 'left' },
      { tabs: [makeTab('hid', { hidden: true })] },
      { secondaryProbe: true },
    );
    expect(exists(m, '[data-ndd-sidebar-tab="hid"]')).toBe(false);
    m.api().openTab('hid');
    await m.stable();
    expect(content(m, 'hid')).toBe(true);
  });
});

// ─── SB49 ────────────────────────────────────────────────────────────────────

describe('SB49: headerAction on the secondary renders and fires onClick', () => {
  it("renders the secondary's headerAction button and calls onClick", async () => {
    const onClick = vi.fn();
    const m = await mountPair(
      { tabs: [makeTab('a')], position: 'left' },
      { tabs: [makeTab('b')], headerAction: { id: 'sec', icon: Icon, label: 'Sec', onClick } },
    );
    await click(m, get(m, '[data-ndd-rail-action="sec"]'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// ─── SB50 ────────────────────────────────────────────────────────────────────

describe('SB50: a controlled activeTabId works on the secondary', () => {
  it('the secondary drawer reflects the controlled activeTabId, and reports changes', async () => {
    const onUpdate = vi.fn();
    const m = await mountPair(
      { tabs: [makeTab('a')], position: 'left' },
      { tabs: [makeTab('b'), makeTab('c')], activeTabId: 'b' },
      { onSecondary: onUpdate },
    );
    expect(content(m, 'b')).toBe(true);
    await click(m, tabButton(m, 'c'));
    expect(onUpdate).toHaveBeenCalledWith('c');
  });
});

// ─── SB51 ────────────────────────────────────────────────────────────────────

describe("SB51: injectSidebarTab() inside a secondary tab resolves to that tab's own close", () => {
  it('closing from inside the secondary tab closes the secondary, not the primary', async () => {
    const onSecondary = vi.fn();
    const onPrimary = vi.fn();
    const m = await mountPair(
      { tabs: [makeTab('a')], position: 'left', activeTabId: 'a' },
      { tabs: [makeTab('b', { component: Closer, inputs: {} })], activeTabId: 'b' },
      { onPrimary, onSecondary },
    );
    const drawers = all(m, '.ndd-sidebar-content-drawer');
    expect(drawers[0]!.style.flexBasis).toBe('280px');
    expect(drawers[1]!.style.flexBasis).toBe('280px');

    await click(m, get(m, '[data-sec-close="b"]'));
    expect(onSecondary).toHaveBeenCalledWith(null);
    expect(onPrimary).not.toHaveBeenCalled();
    expect(drawers[0]!.style.flexBasis).toBe('280px');
  });
});

// ─── Angular additions: [( )] twins ──────────────────────────────────────────

type Models = Partial<{
  activeTabId: WritableSignal<string | null>;
  visible: WritableSignal<boolean>;
  stripVisible: WritableSignal<boolean>;
  width: WritableSignal<number>;
}>;

/**
 * `twoWayBinding(name, sig)` is exactly what `[(name)]="sig"` compiles to. The other inputs go
 * through `inputBinding` (a component created with bindings takes no `setInput`), each backed by
 * a signal so a test can change it — `inputs.tabs.set(...)`.
 */
const boundInputs = new WeakMap<object, Record<string, WritableSignal<unknown>>>();
async function mountTwoWay(models: Models, props: Omit<SidebarInputs, keyof Models>): Promise<Mounted> {
  const inputs = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, signal<unknown>(v)]));
  const fixture = TestBed.createComponent(NddSidebar, {
    bindings: [
      ...Object.entries(models).map(([name, sig]) => twoWayBinding(name, sig as WritableSignal<unknown>)),
      ...Object.entries(inputs).map(([name, sig]) => inputBinding(name, sig)),
    ],
  });
  boundInputs.set(fixture, inputs);
  await fixture.whenStable();
  return {
    fixture,
    el: fixture.nativeElement as HTMLElement,
    setProps: () => Promise.reject(new Error('drive the bound signals instead')),
    api: () => runInInjectionContext(fixture.componentRef.injector, injectSidebar),
    stable: () => fixture.whenStable(),
  };
}

describe('[(activeTabId)] twins', () => {
  it('[(activeTabId)] SB10: the bound signal drives the open tab, and a click writes it back', async () => {
    const active = signal<string | null>('b');
    const m = await mountTwoWay({ activeTabId: active }, { tabs: [makeTab('a'), makeTab('b')] });
    expect(tabButton(m, 'b').getAttribute('aria-pressed')).toBe('true');
    expect(content(m, 'b')).toBe(true);
    await click(m, tabButton(m, 'a'));
    expect(active()).toBe('a');
    active.set('b');
    await m.stable();
    expect(tabButton(m, 'b').getAttribute('aria-pressed')).toBe('true');
  });

  it('[(activeTabId)] SB18: opening writes the id and closing writes null', async () => {
    const active = signal<string | null>(null);
    const m = await mountTwoWay({ activeTabId: active }, { tabs: [makeTab('a')] });
    await click(m, tabButton(m, 'a'));
    expect(active()).toBe('a');
    await click(m, tabButton(m, 'a'));
    expect(active()).toBeNull();
  });

  it('[(activeTabId)] SB11-SB14: injectSidebar().openTab/closeDrawer write the bound signal', async () => {
    const active = signal<string | null>(null);
    const m = await mountTwoWay({ activeTabId: active }, { tabs: [makeTab('a')] });
    m.api().openTab('a');
    await m.stable();
    expect(active()).toBe('a');
    m.api().closeDrawer();
    await m.stable();
    expect(active()).toBeNull();
  });

  it('[(activeTabId)] SB27: the bound signal is reset to null when its tab vanishes', async () => {
    const active = signal<string | null>('a');
    const m = await mountTwoWay({ activeTabId: active }, { tabs: [makeTab('a'), makeTab('b')] });
    boundInputs.get(m.fixture)!['tabs']!.set([makeTab('b')]);
    await m.stable();
    expect(active()).toBeNull();
    expect(drawer(m).style.flexBasis).toBe('0px');
  });
});

describe('[(activeTabId)] twins: what must not change', () => {
  it('[(activeTabId)] SB28/SB30: header and footer action buttons never write the bound signal', async () => {
    const active = signal<string | null>(null);
    const onHeader = vi.fn();
    const onFooter = vi.fn();
    const m = await mountTwoWay(
      { activeTabId: active },
      {
        tabs: [makeTab('a')],
        headerAction: { id: 'burger', icon: Icon, label: 'Menu', onClick: onHeader },
        footerAction: [{ id: 'settings', icon: Icon, label: 'Settings', onClick: onFooter }, makeTab('help')],
      },
    );
    await click(m, get(m, '[data-ndd-rail-action="burger"]'));
    await click(m, get(m, '[data-ndd-rail-action="settings"]'));
    expect(onHeader).toHaveBeenCalledTimes(1);
    expect(onFooter).toHaveBeenCalledTimes(1);
    expect(active()).toBeNull();
    // ...while a tab pinned to the footer does write it, like any other tab.
    await click(m, tabButton(m, 'help'));
    expect(active()).toBe('help');
  });

  it('[(activeTabId)] SB37: switching the bound tab keeps the default header suppressed for every tab', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const active = signal<string | null>('a');
    const m = await mountTwoWay(
      { activeTabId: active },
      { tabs: [makeTab('a'), makeTab('b')], hideDefaultHeader: true, showCloseButton: true },
    );
    expect(exists(m, '.ndd-sidebar-drawer-header')).toBe(false);
    active.set('b');
    await m.stable();
    expect(content(m, 'b')).toBe(true);
    expect(exists(m, '.ndd-sidebar-drawer-header')).toBe(false);
    warn.mockRestore();
  });

  it('[(activeTabId)] SB42: changing the bound tab does not repeat the showCloseButton warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const active = signal<string | null>(null);
    const m = await mountTwoWay({ activeTabId: active }, { tabs: [makeTab('a'), makeTab('b')], showCloseButton: true, hideDefaultHeader: true });
    for (const id of ['a', 'b', null, 'a']) {
      active.set(id);
      await m.stable();
    }
    expect(warn.mock.calls.filter(c => String(c[0]).includes('showCloseButton'))).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('[(visible)] and [(stripVisible)] twins', () => {
  it('[(visible)] SB9/SB13: writing the bound signal hides and shows the strip', async () => {
    const visible = signal(true);
    const m = await mountTwoWay({ visible }, { tabs: [makeTab('a')] });
    expect(stripOuter(m).style.width).toBe('56px');
    visible.set(false);
    await m.stable();
    expect(stripOuter(m).style.width).toBe('0px');
    visible.set(true);
    await m.stable();
    expect(stripOuter(m).style.width).toBe('56px');
  });

  it('[(visible)] SB13: hiding the whole sidebar also closes the drawer view, keeping the open tab', async () => {
    const visible = signal(true);
    const active = signal<string | null>('a');
    const m = await mountTwoWay({ visible, activeTabId: active }, { tabs: [makeTab('a')] });
    expect(drawer(m).style.flexBasis).toBe('280px');
    visible.set(false);
    await m.stable();
    expect(drawer(m).style.flexBasis).toBe('0px');
    expect(active()).toBe('a');
  });

  it('[(stripVisible)] SB23/SB24: writing the bound signal collapses only the strip', async () => {
    const stripVisible = signal(true);
    const m = await mountTwoWay({ stripVisible, activeTabId: signal<string | null>('a') }, { tabs: [makeTab('a')] });
    stripVisible.set(false);
    await m.stable();
    expect(stripOuter(m).style.width).toBe('0px');
    expect(drawer(m).style.flexBasis).toBe('280px');
    stripVisible.set(true);
    await m.stable();
    expect(stripOuter(m).style.width).toBe('56px');
  });

  it('[(visible)] a write from inside the component reaches the bound signal', async () => {
    const visible = signal(true);
    const m = await mountTwoWay({ visible }, { tabs: [makeTab('a')] });
    (m.fixture.componentInstance as NddSidebar).visible.set(false);
    await m.stable();
    expect(visible()).toBe(false);
  });
});

describe('[(width)] twins', () => {
  it('[(width)] SB19/SB21: the bound signal sets the drawer width', async () => {
    const width = signal(320);
    const m = await mountTwoWay({ width, activeTabId: signal<string | null>('a') }, { tabs: [makeTab('a')] });
    expect(drawer(m).style.flexBasis).toBe('320px');
    width.set(400);
    await m.stable();
    expect(drawer(m).style.flexBasis).toBe('400px');
  });

  it('[(width)] SB21: dragging the resizer writes the bound signal', async () => {
    const width = signal(300);
    const m = await mountTwoWay({ width, activeTabId: signal<string | null>('a') }, { tabs: [makeTab('a')], position: 'right' });
    dragBy(get(m, '[data-ndd-sidebar-resizer]'), -40, 100);
    await m.stable();
    expect(width()).toBe(340);
    expect(drawer(m).style.flexBasis).toBe('340px');
  });

  it('[(width)] SB22: a drag writes the clamped value, and a left drawer grows rightwards', async () => {
    const width = signal(300);
    const m = await mountTwoWay(
      { width, activeTabId: signal<string | null>('a') },
      { tabs: [makeTab('a')], position: 'left', minWidth: 200, maxWidth: 600 },
    );
    dragBy(get(m, '[data-ndd-sidebar-resizer]'), 50);
    expect(width()).toBe(350);
    dragBy(get(m, '[data-ndd-sidebar-resizer]'), 1000);
    expect(width()).toBe(600);
    dragBy(get(m, '[data-ndd-sidebar-resizer]'), -1000);
    expect(width()).toBe(200);
  });
});

/** The same models through real `[( )]` template syntax, on a primary and on a secondary. */
@Component({
  selector: 'ndd-test-banana-host',
  imports: [NddSidebar, NddSecondarySidebar],
  template: `
    <ndd-sidebar position="left" [tabs]="tabs" [(activeTabId)]="primaryTab" [(width)]="primaryWidth">
      <ndd-secondary-sidebar [tabs]="secondaryTabs" [(activeTabId)]="secondaryTab" [(visible)]="secondaryVisible" />
    </ndd-sidebar>
  `,
})
class BananaHost {
  readonly tabs = [makeTab('a')];
  readonly secondaryTabs = [makeTab('b', { component: Closer, inputs: {} })];
  readonly primaryTab = signal<string | null>(null);
  readonly primaryWidth = signal(300);
  readonly secondaryTab = signal<string | null>('b');
  readonly secondaryVisible = signal(true);
}

describe('[( )] template twins', () => {
  it('[(activeTabId)] and [(width)] in a template: both directions, on the primary', async () => {
    const m = await mountHost(BananaHost);
    const host = m.host;
    await click(m, tabButton(m, 'a'));
    expect(host.primaryTab()).toBe('a');
    const primaryDrawer = all(m, '.ndd-sidebar-content-drawer')[0]!;
    expect(primaryDrawer.style.flexBasis).toBe('300px');
    host.primaryWidth.set(360);
    await m.stable();
    expect(primaryDrawer.style.flexBasis).toBe('360px');
    dragBy(all(m, '[data-ndd-sidebar-resizer]')[0]!, 20);
    await m.stable();
    expect(host.primaryWidth()).toBe(380);
  });

  it('[(activeTabId)] SB50/SB51 and [(visible)] in a template, on the secondary', async () => {
    const m = await mountHost(BananaHost);
    const host = m.host;
    expect(content(m, 'b')).toBe(false); // Closer renders a button, not Content
    expect(exists(m, '[data-sec-close="b"]')).toBe(true);
    await click(m, get(m, '[data-sec-close="b"]'));
    expect(host.secondaryTab()).toBeNull();
    expect(host.primaryTab()).toBeNull();
    host.secondaryVisible.set(false);
    await m.stable();
    expect(all(m, '.ndd-sidebar-strip-outer')[1]!.style.width).toBe('0px');
  });
});

// ─── Angular additions: templates ────────────────────────────────────────────

@Component({
  selector: 'ndd-test-template-host',
  imports: [NddSidebar, NddSidebarTabTemplate, Closer],
  template: `
    <ndd-sidebar [tabs]="tabs" [(activeTabId)]="active">
      <ng-template nddSidebarTab="a" let-tab let-close="close">
        <div data-template="a">{{ tab.label }}</div>
        <button data-template-close (click)="close()">x</button>
        <ndd-test-closer />
      </ng-template>
    </ndd-sidebar>
  `,
})
class TemplateHost {
  /** `b` has only a `component`; `a` has both, and the template wins. */
  readonly tabs = [makeTab('a'), makeTab('b')];
  readonly active = signal<string | null>(null);
}

describe('nddSidebarTab templates', () => {
  it('a tab template wins over the component, gets the typed context, and scopes injectSidebarTab()', async () => {
    const m = await mountHost(TemplateHost);
    m.host.active.set('a');
    await m.stable();
    expect(get(m, '[data-template="a"]').textContent).toBe('Tab a');
    expect(content(m, 'a')).toBe(false);
    // injectSidebarTab() inside the template's content resolves to this tab.
    expect(exists(m, '[data-nested-close="a"]')).toBe(true);
    await click(m, get(m, '[data-template-close]'));
    expect(m.host.active()).toBeNull();
  });

  it('a tab without a template falls back to its component', async () => {
    const m = await mountHost(TemplateHost);
    m.host.active.set('b');
    await m.stable();
    expect(content(m, 'b')).toBe(true);
  });

  it('warns once, in dev, when an opened tab has neither a template nor a component', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await mountSidebar({ tabs: [makeTab('empty', { component: undefined })] });
    await click(m, tabButton(m, 'empty'));
    const hits = warn.mock.calls.filter(c => String(c[0]).includes('has no content'));
    expect(hits).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('Right-to-left', () => {
  it('a left sidebar in a right-to-left container sits on the right edge, so its resizer grows it leftwards', async () => {
    const onUpdate = vi.fn();
    const m = await mountSidebar({ tabs: [makeTab('a')], activeTabId: 'a', position: 'left', width: 300 }, { width: onUpdate });
    // The flex row reverses under RTL: the logical 'left' pieces render from the right edge.
    m.el.style.direction = 'rtl';
    dragBy(get(m, '[data-ndd-sidebar-resizer]'), -40, 500);
    expect(onUpdate).toHaveBeenLastCalledWith(340);
    m.el.style.direction = '';
    dragBy(get(m, '[data-ndd-sidebar-resizer]'), -40, 500);
    expect(onUpdate).toHaveBeenLastCalledWith(300);
  });
});
