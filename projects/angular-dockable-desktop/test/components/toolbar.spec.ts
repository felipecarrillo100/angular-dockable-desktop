/**
 * `<ndd-toolbar>` and `injectToolbar()`.
 *
 * Ported from vue-dockable-desktop `test/components/toolbar.test.ts` (42 tests, same TB numbers,
 * same order, names preserved with `vdd-` → `ndd-`). vdd's own mapping from rdd carries over:
 *
 *   rdd                                  ndd
 *   ──────────────────────────────────   ─────────────────────────────────────────────────
 *   <ToolbarProvider> in the tree        state lives on the workspace, so `injectToolbar()`
 *                                        works anywhere `injectWorkspace()` does       (TB1)
 *   getActiveInGroup / setActiveInGroup  activeInGroup / setActiveInGroup
 *   isModifierActive / … / toggleModifier  isToggled / setToggled / toggle
 *   handle show() / hide() / toggle()    writing the `visible` model                  (TB20)
 *
 * Items stay plain data with rdd's field names, so every item test is a near-literal
 * transcription. Icons here are CSS-class icons (`NddIcon` accepts a class string), which lets
 * TB33 find the default icon by class where vdd found it by attribute.
 *
 * The `visible` model is driven two ways: `setInput` (a one-way `[visible]` binding, as vdd's
 * `setProps`) in TB18-TB20, and `twoWayBinding` — exactly what `[(visible)]` compiles to — in the
 * `[(visible)]` twins at the end, which also check the component's writes reach the parent.
 */
import { Component, inputBinding, signal, twoWayBinding } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddToolbar, injectToolbar } from '../../src/lib/toolbar/toolbar';
import type { ToolbarPosition } from '../../src/lib/toolbar/toolbar';
import type { ToolbarGroupItem, ToolbarItem } from '../../src/lib/core/toolbar-types';
import type { ToolbarState } from '../../src/lib/core/toolbar-state';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const Icon = 'icon';
const named = (id: string) => `icon-${id}`;

interface ToolbarInputs {
  items: ToolbarItem[];
  position?: ToolbarPosition;
  visible?: boolean;
}

interface Mounted {
  ws: Workspace;
  fixture: ComponentFixture<NddToolbar>;
  el: HTMLElement;
  toolbar: ToolbarState;
  setProps: (props: Partial<ToolbarInputs>) => Promise<void>;
}

/** A toolbar with a live workspace behind it — the workspace is where the state lives. */
async function mountToolbar(props: ToolbarInputs): Promise<Mounted> {
  const ws = createWorkspace({ panels: {} });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const fixture = TestBed.createComponent(NddToolbar);
  const setProps = async (next: Partial<ToolbarInputs>) => {
    for (const [key, value] of Object.entries(next)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
  };
  await setProps(props);
  return { ws, fixture, el: fixture.nativeElement as HTMLElement, toolbar: ws.toolbar, setProps };
}

const strip = (m: Mounted) => m.el;
const get = (m: Mounted, selector: string) => {
  const found = m.el.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};
const flyout = () => document.body.querySelector('.ndd-toolbar-group-flyout');
const flyoutItems = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ndd-toolbar-group-flyout-item'));
/** `HTMLElement.click()`, which — like a real click, and like vdd's `trigger` — does nothing on a disabled button. */
const click = async (m: Mounted, el: Element) => {
  (el as HTMLElement).click();
  await m.fixture.whenStable();
};

afterEach(() => {
  document.querySelectorAll('.ndd-toolbar-group-flyout').forEach(el => el.remove());
});

// ─── TB1 ─────────────────────────────────────────────────────────────────────

@Component({ selector: 'ndd-test-toolbar-probe', template: '' })
class ToolbarProbe {
  readonly state = injectToolbar();
}

describe('TB1: injectToolbar() with no workspace', () => {
  it('throws when rendered outside a workspace', () => {
    // rdd required a <ToolbarProvider> of its own. ndd keeps toolbar state on the workspace,
    // so there is one less provider to forget — and the only prerequisite is the
    // provideDockableDesktop() every ndd app has anyway.
    TestBed.configureTestingModule({});
    expect(() => TestBed.createComponent(ToolbarProbe)).toThrow(/provideDockableDesktop\(/);
  });
});

// ─── TB2-TB8 ─────────────────────────────────────────────────────────────────

describe('TB2-TB8: toolbar state on the workspace', () => {
  /** No component needed: the store is live the moment it is created. */
  const toolbar = () => createWorkspace({ panels: {} }).toolbar;

  it('TB2: activeInGroup() returns null initially', () => {
    expect(toolbar().activeInGroup('tools')).toBeNull();
  });

  it('TB3: setActiveInGroup() -> activeInGroup() round-trip', () => {
    const t = toolbar();
    t.setActiveInGroup('tools', 'pencil');
    expect(t.activeInGroup('tools')).toBe('pencil');
  });

  it('TB4: setActiveInGroup(group, null) deselects', () => {
    const t = toolbar();
    t.setActiveInGroup('tools', 'pencil');
    t.setActiveInGroup('tools', null);
    expect(t.activeInGroup('tools')).toBeNull();
  });

  it('TB5: isToggled() returns false initially (rdd: isModifierActive)', () => {
    expect(toolbar().isToggled('snap')).toBe(false);
  });

  it('TB6: setToggled(id, true) enables the toggle (rdd: setModifierActive)', () => {
    const t = toolbar();
    t.setToggled('snap', true);
    expect(t.isToggled('snap')).toBe(true);
  });

  it('TB7: toggle() flips state (rdd: toggleModifier)', () => {
    const t = toolbar();
    t.toggle('snap');
    expect(t.isToggled('snap')).toBe(true);
    t.toggle('snap');
    expect(t.isToggled('snap')).toBe(false);
  });

  it('TB8: multiple radio groups are independent', () => {
    const t = toolbar();
    t.setActiveInGroup('tools', 'pencil');
    t.setActiveInGroup('shapes', 'circle');
    expect(t.activeInGroup('tools')).toBe('pencil');
    expect(t.activeInGroup('shapes')).toBe('circle');
    t.setActiveInGroup('tools', null);
    expect(t.activeInGroup('tools')).toBeNull();
    expect(t.activeInGroup('shapes')).toBe('circle');
  });
});

// ─── TB9 ─────────────────────────────────────────────────────────────────────

describe('TB9: Toolbar renders action buttons', () => {
  it('renders a button for each action item', async () => {
    const items: ToolbarItem[] = [
      { type: 'action', id: 'a', label: 'A', icon: Icon, onClick: () => {} },
      { type: 'action', id: 'b', label: 'B', icon: Icon, onClick: () => {} },
    ];
    const m = await mountToolbar({ items });
    const buttons = m.el.querySelectorAll('.ndd-toolbar-btn-action');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute('aria-label')).toBe('A');
    expect(buttons[1]!.getAttribute('aria-label')).toBe('B');
  });
});

// ─── TB10 ────────────────────────────────────────────────────────────────────

describe('TB10: Action button click fires onClick', () => {
  it('onClick is called when action button is clicked', async () => {
    const onClick = vi.fn();
    const m = await mountToolbar({ items: [{ type: 'action', id: 'a', label: 'A', icon: Icon, onClick }] });
    await click(m, get(m, '[data-ndd-toolbar-item="a"]'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// ─── TB11 ────────────────────────────────────────────────────────────────────

describe('TB11: Toolbar renders separators', () => {
  it('renders a separator div with role=separator', async () => {
    const m = await mountToolbar({
      items: [
        { type: 'action', id: 'a', label: 'A', icon: Icon, onClick: () => {} },
        { type: 'separator' },
        { type: 'action', id: 'b', label: 'B', icon: Icon, onClick: () => {} },
      ],
    });
    expect(get(m, '.ndd-toolbar-separator').getAttribute('role')).toBe('separator');
  });
});

// ─── TB12-TB14 ───────────────────────────────────────────────────────────────

describe('TB12-TB14: Radio buttons', () => {
  const pencil = { type: 'radio', id: 'pencil', group: 'tools', label: 'Pencil', icon: Icon } as const;
  const brush = { type: 'radio', id: 'brush', group: 'tools', label: 'Brush', icon: Icon } as const;
  const radios: ToolbarItem[] = [pencil, brush];

  it('TB12: radio button is inactive (no .ndd-active class) by default', async () => {
    const m = await mountToolbar({ items: radios });
    for (const btn of Array.from(m.el.querySelectorAll('.ndd-toolbar-btn-radio'))) {
      expect(btn.classList).not.toContain('ndd-active');
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('TB13: clicking radio button activates it and calls onActivate', async () => {
    const onActivate = vi.fn();
    const m = await mountToolbar({ items: [{ ...pencil, onActivate }, brush] });
    await click(m, get(m, '[data-ndd-toolbar-item="pencil"]'));
    expect(get(m, '[data-ndd-toolbar-item="pencil"]').classList).toContain('ndd-active');
    expect(onActivate).toHaveBeenCalledWith('pencil');
    expect(m.toolbar.activeInGroup('tools')).toBe('pencil');
  });

  it('TB14: clicking second radio in same group deactivates first', async () => {
    const m = await mountToolbar({ items: radios });
    await click(m, get(m, '[data-ndd-toolbar-item="pencil"]'));
    await click(m, get(m, '[data-ndd-toolbar-item="brush"]'));
    expect(get(m, '[data-ndd-toolbar-item="pencil"]').classList).not.toContain('ndd-active');
    expect(get(m, '[data-ndd-toolbar-item="brush"]').classList).toContain('ndd-active');
  });
});

// ─── TB15-TB17 ───────────────────────────────────────────────────────────────

describe('TB15-TB17: Toggle buttons', () => {
  it('TB15: toggle button is inactive by default', async () => {
    const m = await mountToolbar({ items: [{ type: 'toggle', id: 'snap', label: 'Snap', icon: Icon }] });
    const btn = get(m, '.ndd-toolbar-btn-toggle');
    expect(btn.classList).not.toContain('ndd-active');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('TB16: clicking toggle activates it and calls onToggle(true)', async () => {
    const onToggle = vi.fn();
    const m = await mountToolbar({ items: [{ type: 'toggle', id: 'snap', label: 'Snap', icon: Icon, onToggle }] });
    await click(m, get(m, '[data-ndd-toolbar-item="snap"]'));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(get(m, '[data-ndd-toolbar-item="snap"]').classList).toContain('ndd-active');
    expect(m.toolbar.isToggled('snap')).toBe(true);
  });

  it('TB17: clicking toggle again deactivates it and calls onToggle(false)', async () => {
    const onToggle = vi.fn();
    const m = await mountToolbar({ items: [{ type: 'toggle', id: 'snap', label: 'Snap', icon: Icon, onToggle }] });
    const btn = get(m, '[data-ndd-toolbar-item="snap"]');
    await click(m, btn);
    await click(m, btn);
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(btn.classList).not.toContain('ndd-active');
  });
});

// ─── TB18-TB19 ───────────────────────────────────────────────────────────────

describe('TB18-TB19: Toolbar visibility', () => {
  const one: ToolbarItem[] = [{ type: 'action', id: 'a', label: 'A', icon: Icon, onClick: () => {} }];

  it('TB18: visible=false collapses a vertical (left) strip to width 0px', async () => {
    const m = await mountToolbar({ items: one, position: 'left', visible: false });
    expect(strip(m).style.width).toBe('0px');
  });

  it('TB18b: visible=true leaves width to CSS (no inline collapse override)', async () => {
    // The open size belongs to the stylesheet, including its coarse-pointer override. An
    // inline width here would quietly undo the larger touch targets.
    const m = await mountToolbar({ items: [], position: 'left', visible: true });
    expect(strip(m).style.width).toBe('');
  });

  it('TB19: visible=false collapses a horizontal (top) strip to height 0px', async () => {
    const m = await mountToolbar({ items: [], position: 'top', visible: false });
    expect(strip(m).style.height).toBe('0px');
  });

  it('TB19b: visible=true leaves height to CSS (no inline collapse override)', async () => {
    const m = await mountToolbar({ items: [], position: 'top', visible: true });
    expect(strip(m).style.height).toBe('');
  });
});

// ─── TB20 ────────────────────────────────────────────────────────────────────

describe('TB20: the visible model replaces the imperative handle', () => {
  const one: ToolbarItem[] = [{ type: 'action', id: 'a', label: 'A', icon: Icon, onClick: () => {} }];

  it('setting visible to true shows the strip (rdd: show())', async () => {
    // rdd's show()/hide()/toggle() existed only to flip a boolean the caller could not write.
    // With a model the caller owns it, so what is left to assert is that the DOM follows.
    const m = await mountToolbar({ items: one, position: 'left', visible: false });
    await m.setProps({ visible: true });
    expect(strip(m).style.width).toBe('');
  });

  it('setting visible to false hides the strip (rdd: hide())', async () => {
    const m = await mountToolbar({ items: one, position: 'left', visible: true });
    await m.setProps({ visible: false });
    expect(strip(m).style.width).toBe('0px');
  });

  it('flipping visible false -> true shows it (rdd: toggle())', async () => {
    const m = await mountToolbar({ items: one, position: 'top', visible: false });
    expect(strip(m).style.height).toBe('0px');
    await m.setProps({ visible: true });
    expect(strip(m).style.height).toBe('');
  });

  it('flipping visible true -> false hides it (rdd: toggle())', async () => {
    const m = await mountToolbar({ items: one, position: 'top', visible: true });
    expect(strip(m).style.height).toBe('');
    await m.setProps({ visible: false });
    expect(strip(m).style.height).toBe('0px');
  });
});

// ─── TB21 ────────────────────────────────────────────────────────────────────

describe('TB21: Disabled buttons', () => {
  it('disabled action button has disabled attribute and click does not fire', async () => {
    const onClick = vi.fn();
    const m = await mountToolbar({
      items: [{ type: 'action', id: 'a', label: 'A', icon: Icon, onClick, disabled: true }],
    });
    const btn = get(m, '[data-ndd-toolbar-item="a"]');
    expect(btn.hasAttribute('disabled')).toBe(true);
    await click(m, btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled radio button cannot be activated', async () => {
    const onActivate = vi.fn();
    const m = await mountToolbar({
      items: [{ type: 'radio', id: 'pencil', group: 'tools', label: 'Pencil', icon: Icon, onActivate, disabled: true }],
    });
    const btn = get(m, '[data-ndd-toolbar-item="pencil"]');
    expect(btn.hasAttribute('disabled')).toBe(true);
    await click(m, btn);
    expect(onActivate).not.toHaveBeenCalled();
    expect(m.toolbar.activeInGroup('tools')).toBeNull();
  });
});

// ─── TB22-TB29 ───────────────────────────────────────────────────────────────

describe('TB22-TB29: Group button / flyout', () => {
  const onActivate = vi.fn();
  beforeEach(() => {
    onActivate.mockReset();
  });

  const groupItems = (): ToolbarItem[] => [
    {
      type: 'group',
      id: 'draw-tool',
      label: 'Drawing Tools',
      defaultIcon: named('default'),
      items: [
        { id: 'tool-pen', label: 'Pen', shortcut: 'P', icon: named('pen'), onActivate },
        { type: 'separator' },
        { id: 'tool-eraser', label: 'Eraser', icon: named('eraser') },
      ],
    },
  ];

  const mountGroup = async () => {
    const m = await mountToolbar({ items: groupItems() });
    return { m, btn: get(m, '.ndd-toolbar-btn-group') };
  };

  it('TB22: group button renders with default label when no sub-item active', async () => {
    const { btn } = await mountGroup();
    expect(btn.getAttribute('aria-label')).toBe('Drawing Tools');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.classList).not.toContain('ndd-active');
  });

  it('TB23: clicking group button renders flyout in document.body', async () => {
    const { m, btn } = await mountGroup();
    await click(m, btn);
    const f = flyout();
    expect(f).not.toBeNull();
    expect(f!.getAttribute('role')).toBe('menu');
    // In document.body, so the strip's own overflow: hidden cannot clip it.
    expect(f!.closest('.ndd-toolbar-strip')).toBeNull();
    expect(f!.parentElement).toBe(document.body);
  });

  it('TB24: clicking sub-item activates it, closes flyout, calls onActivate', async () => {
    const { m, btn } = await mountGroup();
    await click(m, btn);
    await click(m, flyoutItems()[0]!);
    expect(flyout()).toBeNull();
    expect(onActivate).toHaveBeenCalledWith('tool-pen');
  });

  it('TB25: active sub-item label replaces default label on parent button', async () => {
    const { m, btn } = await mountGroup();
    await click(m, btn);
    await click(m, flyoutItems()[0]!);
    expect(btn.getAttribute('aria-label')).toBe('Pen');
  });

  it('TB26: parent button gets .ndd-active class when any sub-item is active', async () => {
    const { m, btn } = await mountGroup();
    await click(m, btn);
    await click(m, flyoutItems()[0]!);
    expect(btn.classList).toContain('ndd-active');
  });

  it('TB27: clicking group button again when open closes the flyout', async () => {
    const { m, btn } = await mountGroup();
    await click(m, btn);
    expect(flyout()).not.toBeNull();
    await click(m, btn);
    expect(flyout()).toBeNull();
  });

  it('TB28: separator entry renders with role="separator" inside flyout', async () => {
    const { m, btn } = await mountGroup();
    await click(m, btn);
    const sep = document.body.querySelector('.ndd-toolbar-group-flyout-sep');
    expect(sep).not.toBeNull();
    expect(sep!.getAttribute('role')).toBe('separator');
  });

  it('TB29: disabled group button has disabled attribute and does not open flyout', async () => {
    const m = await mountToolbar({
      items: [
        {
          type: 'group',
          id: 'disabled-group',
          label: 'Disabled Group',
          defaultIcon: Icon,
          items: [{ id: 'sub1', label: 'Sub 1', icon: Icon }],
          disabled: true,
        },
      ],
    });
    const btn = get(m, '.ndd-toolbar-btn-group');
    expect(btn.hasAttribute('disabled')).toBe(true);
    await click(m, btn);
    expect(flyout()).toBeNull();
  });
});

// ─── TB30-TB33 ───────────────────────────────────────────────────────────────

describe('TB30-TB33: Controlled group mode', () => {
  const base = {
    type: 'group' as const,
    id: 'draw-tool',
    label: 'Drawing Tools',
    defaultIcon: named('default'),
    items: [
      { id: 'tool-pen', label: 'Pen', icon: named('pen') },
      { id: 'tool-eraser', label: 'Eraser', icon: named('eraser') },
    ],
  };
  /** `activeItemId` present at all — `null` included — makes the caller the owner. */
  const controlled = (extra: Partial<ToolbarGroupItem>): ToolbarItem[] => [{ ...base, ...extra }];

  it('TB30: activeItemId="tool-pen" shows Pen label and .ndd-active class without any workspace state', async () => {
    const m = await mountToolbar({ items: controlled({ activeItemId: 'tool-pen' }) });
    const btn = get(m, '.ndd-toolbar-btn-group');
    expect(btn.getAttribute('aria-label')).toBe('Pen');
    expect(btn.classList).toContain('ndd-active');
    expect(m.toolbar.activeInGroup('draw-tool')).toBeNull();
  });

  it('TB31: clicking sub-item fires onActiveItemChange and does NOT write to the workspace', async () => {
    const onActiveItemChange = vi.fn();
    const m = await mountToolbar({ items: controlled({ activeItemId: null, onActiveItemChange }) });
    await click(m, get(m, '.ndd-toolbar-btn-group'));
    await click(m, flyoutItems()[0]!);
    expect(onActiveItemChange).toHaveBeenCalledWith('tool-pen');
    expect(m.toolbar.activeInGroup('draw-tool')).toBeNull();
  });

  it('TB32: controlled group does not self-update after click (frozen until the prop changes)', async () => {
    const onActiveItemChange = vi.fn();
    const m = await mountToolbar({ items: controlled({ activeItemId: null, onActiveItemChange }) });
    const btn = get(m, '.ndd-toolbar-btn-group');
    await click(m, btn);
    await click(m, flyoutItems()[0]!);
    expect(btn.getAttribute('aria-label')).toBe('Drawing Tools');
    expect(btn.classList).not.toContain('ndd-active');
    expect(onActiveItemChange).toHaveBeenCalledWith('tool-pen');
    // ...and it does follow the input once the caller changes it.
    await m.setProps({ items: controlled({ activeItemId: 'tool-pen', onActiveItemChange }) });
    expect(btn.getAttribute('aria-label')).toBe('Pen');
  });

  it('TB33: activeItemId=null ignores workspace state — shows the default icon and no .ndd-active', async () => {
    const m = await mountToolbar({ items: controlled({ activeItemId: null }) });
    m.toolbar.setActiveInGroup('draw-tool', 'tool-pen');
    await m.fixture.whenStable();
    const btn = get(m, '.ndd-toolbar-btn-group');
    expect(btn.getAttribute('aria-label')).toBe('Drawing Tools');
    expect(btn.querySelector('.icon-default')).not.toBeNull();
    expect(btn.classList).not.toContain('ndd-active');
  });
});

// ─── TB34-TB36 ───────────────────────────────────────────────────────────────

describe('TB34-TB36: Controlled toggle mode', () => {
  it('TB34: active=true shows .ndd-active class and aria-pressed=true without any workspace state', async () => {
    const m = await mountToolbar({ items: [{ type: 'toggle', id: 'snap', label: 'Snap', icon: Icon, active: true }] });
    const btn = get(m, '.ndd-toolbar-btn-toggle');
    expect(btn.classList).toContain('ndd-active');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(m.toolbar.isToggled('snap')).toBe(false);
  });

  it('TB35: clicking a controlled toggle calls onToggle and does NOT write to the workspace', async () => {
    const onToggle = vi.fn();
    const m = await mountToolbar({
      items: [{ type: 'toggle', id: 'snap', label: 'Snap', icon: Icon, active: false, onToggle }],
    });
    await click(m, get(m, '[data-ndd-toolbar-item="snap"]'));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(m.toolbar.isToggled('snap')).toBe(false);
  });

  it('TB36: active=false ignores workspace state even if that id is toggled there', async () => {
    const m = await mountToolbar({ items: [{ type: 'toggle', id: 'snap', label: 'Snap', icon: Icon, active: false }] });
    // Unrelated uncontrolled code writing the same id must not leak into a controlled item —
    // which is what makes two instances of one panel type able to hold independent state.
    m.toolbar.setToggled('snap', true);
    await m.fixture.whenStable();
    const btn = get(m, '.ndd-toolbar-btn-toggle');
    expect(btn.classList).not.toContain('ndd-active');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});

// ─── Angular additions ───────────────────────────────────────────────────────

describe('[(visible)] twins', () => {
  /** `twoWayBinding('visible', sig)` is what `[(visible)]="sig"` compiles to. */
  async function mountTwoWay(position: ToolbarPosition, initial: boolean) {
    const ws = createWorkspace({ panels: {} });
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
    const visible = signal(initial);
    const fixture = TestBed.createComponent(NddToolbar, {
      bindings: [twoWayBinding('visible', visible), inputBinding('items', () => []), inputBinding('position', () => position)],
    });
    await fixture.whenStable();
    return { visible, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('[(visible)] TB18-TB20: the parent writing false collapses the strip, writing true restores it', async () => {
    const { visible, fixture, el } = await mountTwoWay('left', true);
    expect(el.style.width).toBe('');
    visible.set(false);
    await fixture.whenStable();
    expect(el.style.width).toBe('0px');
    visible.set(true);
    await fixture.whenStable();
    expect(el.style.width).toBe('');
  });

  it('[(visible)] TB20: a write from inside the component reaches the parent signal', async () => {
    const { visible, fixture, el } = await mountTwoWay('top', true);
    fixture.componentInstance.visible.set(false);
    await fixture.whenStable();
    expect(visible()).toBe(false);
    expect(el.style.height).toBe('0px');
  });
});

describe('Group flyout dismissal and placement', () => {
  const items = (): ToolbarItem[] => [
    { type: 'group', id: 'g', label: 'G', defaultIcon: Icon, items: [{ id: 's', label: 'S', icon: Icon }] },
  ];

  it('closes on Escape and on a pointerdown outside, but not on one inside the flyout', async () => {
    const m = await mountToolbar({ items: items() });
    const btn = get(m, '.ndd-toolbar-btn-group');
    await click(m, btn);
    flyout()!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await m.fixture.whenStable();
    expect(flyout()).not.toBeNull();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await m.fixture.whenStable();
    expect(flyout()).toBeNull();
    await click(m, btn);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await m.fixture.whenStable();
    expect(flyout()).toBeNull();
  });

  it('is removed from document.body when the toolbar is destroyed while it is open', async () => {
    const m = await mountToolbar({ items: items() });
    await click(m, get(m, '.ndd-toolbar-btn-group'));
    expect(flyout()).not.toBeNull();
    m.fixture.destroy();
    expect(flyout()).toBeNull();
  });

  it('opens away from the strip by the strip\'s own direction, and carries the workspace\'s reading direction', async () => {
    const m = await mountToolbar({ items: items(), position: 'left' });
    const btn = () => get(m, '.ndd-toolbar-btn-group');
    await click(m, btn());
    const ltr = flyout() as HTMLElement;
    expect(ltr.style.position).toBe('fixed');
    expect(ltr.style.left).not.toBe('');
    expect(ltr.getAttribute('dir')).toBe('ltr');
    await click(m, btn());
    // An RTL workspace alone does not move the strip, so the flyout stays on the same side (N5)...
    m.ws.setDirection('rtl');
    await m.fixture.whenStable();
    await click(m, btn());
    expect((flyout() as HTMLElement).style.left).not.toBe('');
    expect(flyout()!.getAttribute('dir')).toBe('rtl');
    await click(m, btn());
    // ...while a strip that is itself laid out right-to-left opens the other way.
    m.el.style.direction = 'rtl';
    await click(m, btn());
    expect((flyout() as HTMLElement).style.right).not.toBe('');
  });
});

describe('Collapsed strip', () => {
  it('marks the collapsed strip, so the stylesheet can drop its edge border too', async () => {
    const m = await mountToolbar({ items: [], position: 'left', visible: false });
    expect(m.el.classList).toContain('ndd-toolbar-strip--collapsed');
    await m.setProps({ visible: true });
    expect(m.el.classList).not.toContain('ndd-toolbar-strip--collapsed');
  });
});
