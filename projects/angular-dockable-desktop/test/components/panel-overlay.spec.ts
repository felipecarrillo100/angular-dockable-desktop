/**
 * `<ndd-panel-overlay>`, `<ndd-panel-toolbar>`, `<ndd-floating-widget>` and
 * `injectFloatingWidgets()`.
 *
 * Ported from vue-dockable-desktop `test/components/panelOverlay.test.ts` (69 tests, PO1–PO35,
 * names preserved, `vdd-` → `ndd-`), itself a port of rdd's `PanelOverlay.test.tsx`:
 *
 *   rdd                                       ndd
 *   ───────────────────────────────────────   ──────────────────────────────────────────
 *   `usePanelFloatingWindow()`                `[(open)]`                           (PO6)
 *   `defaultAnchor` + `defaultStretch`
 *     + `stretch` + `onPlacementChange`       one `[(placement)]`           (PO21, PO24)
 *   `usePanelFloatingWindowManager()`         `injectFloatingWidgets()`      (PO7, PO8)
 *   three React contexts for render isolation one signal store             (PO10, PO11)
 *
 * vdd's `@update:x` listener is the model's `(xChange)` output. One test changes shape and says
 * so: PO24's "controlled without a listener". An Angular `model()` is locally writable — a
 * one-way `[placement]` seeds it and follows the parent's *changes*, but does not freeze it —
 * so the Angular way to veto a gesture is to answer `(placementChange)` with the parent's own
 * value, which re-syncs the widget. PO24 asserts that (divergence N10).
 *
 * jsdom performs no layout: every rect is zero, `offsetParent` is `null` and `offsetHeight` is 0.
 * `stubGeometry` supplies just enough for the pointer arithmetic to mean something, exactly as
 * rdd's and vdd's suites do; the geometry that cannot be faked is the browser gate's job (D5).
 */
import { Component, input, signal } from '@angular/core';
import type { Type, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddPanelOverlay, NddPanelToolbar, injectFloatingWidgets, injectPanelOverlay } from '../../src/lib/panel-overlay/panel-overlay';
import type { FloatingWidgetsApi } from '../../src/lib/panel-overlay/panel-overlay';
import { NddFloatingWidget } from '../../src/lib/panel-overlay/floating-widget';
import type { PanelOverlayStore } from '../../src/lib/panel-overlay/overlay-store';
import type { PanelFloatPlacement, Stretch } from '../../src/lib/core/stretch';
import type { FloatAnchor, Label } from '../../src/lib/core/types';
import type { MessageDescriptor } from '../../src/lib/core/types';

// ─── Harness ─────────────────────────────────────────────────────────────────

let fixture: ComponentFixture<unknown> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.body.classList.remove('ndd-dragging-active', 'ndd-resizing-active');
});

@Component({ selector: 'ndd-test-dot', template: '<span></span>' })
class Dot {}

/** Mount `host` inside a workspace; `setup` runs on the instance before the first render. */
async function render<T>(host: Type<T>, setup: (instance: T) => void = () => {}, dir: 'ltr' | 'rtl' = 'ltr', formatMessage?: (m: MessageDescriptor) => string) {
  const ws = createWorkspace({ panels: {}, ...(formatMessage ? { formatMessage } : {}) });
  if (dir === 'rtl') ws.setDirection('rtl');
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const f = TestBed.createComponent(host);
  fixture = f as ComponentFixture<unknown>;
  setup(f.componentInstance);
  await f.whenStable();
  return { ws, host: f.componentInstance, el: f.nativeElement as HTMLElement };
}
const stable = () => fixture!.whenStable();

const domRect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

interface GeometryStub {
  overlay: DOMRect;
  widget: DOMRect;
  /** What each toolbar edge reports through offsetHeight/offsetWidth. */
  toolbars?: Partial<Record<'top' | 'bottom' | 'left' | 'right', number>>;
}

/** Installs the layout jsdom will not do. Call before rendering; returns the restore. */
function stubGeometry({ overlay, widget, toolbars = {} }: GeometryStub): () => void {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const props = ['offsetParent', 'clientWidth', 'clientHeight', 'offsetHeight', 'offsetWidth'] as const;
  const saved = Object.fromEntries(props.map(p => [p, Object.getOwnPropertyDescriptor(HTMLElement.prototype, p)]));
  const isRoot = (el: HTMLElement) => !!el.classList?.contains('ndd-panel-overlay-root');
  const isWidget = (el: HTMLElement) => !!el.classList?.contains('ndd-panel-float');
  const edgeOf = (el: HTMLElement) => (['top', 'bottom', 'left', 'right'] as const).find(e => el.classList?.contains(`ndd-panel-toolbar--${e}`)) ?? null;

  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (isRoot(this)) return overlay;
    if (isWidget(this)) return widget;
    return originalRect.call(this);
  };
  const define = (prop: string, get: (el: HTMLElement) => unknown) =>
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get() {
        return get(this as HTMLElement);
      },
    });
  define('offsetParent', el => (isWidget(el) ? el.closest('.ndd-panel-overlay-root') : null));
  define('clientWidth', el => (isRoot(el) ? overlay.width : 0));
  define('clientHeight', el => (isRoot(el) ? overlay.height : 0));
  define('offsetHeight', el => {
    const e = edgeOf(el);
    return e ? (toolbars[e] ?? 0) : 0;
  });
  define('offsetWidth', el => {
    const e = edgeOf(el);
    return e ? (toolbars[e] ?? 0) : 0;
  });
  return () => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    for (const [prop, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
  };
}

const ALL_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
/** The handles currently offered, sorted, so the expectation reads as a set. */
const handlesOn = (host: ParentNode): string[] => ALL_DIRS.filter(d => host.querySelector(`.ndd-resize-${d}`) !== null).sort();
const pointer = (type: string, init: PointerEventInit = {}) => new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, ...init });
const widgets = () => Array.from(document.querySelectorAll<HTMLElement>('.ndd-panel-float'));
const firstWidget = () => widgets()[0]!;

/** One widget in an overlay; its inputs are signals the test sets before the first render. */
@Component({
  selector: 'ndd-test-one-widget',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `
    <ndd-panel-overlay>
      <ndd-floating-widget
        widgetId="w"
        title="Widget"
        [open]="open()"
        [placement]="placement()"
        [width]="width()"
        [height]="height()"
        [stretchable]="stretchable()"
      ><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class OneWidget {
  readonly open = signal(true);
  readonly placement = signal<PanelFloatPlacement>({ anchor: 'top-right', stretch: null });
  readonly width = signal(320);
  readonly height = signal(240);
  readonly stretchable = signal(true);
}

interface WidgetProps {
  open?: boolean;
  placement?: PanelFloatPlacement;
  width?: number;
  height?: number;
  stretchable?: boolean;
}
const oneWidget = (props: WidgetProps = {}, dir: 'ltr' | 'rtl' = 'ltr') =>
  render(
    OneWidget,
    h => {
      for (const [key, value] of Object.entries(props)) (h[key as keyof WidgetProps] as WritableSignal<unknown>).set(value);
    },
    dir,
  );

/** Press the header, optionally move past the threshold, then end the gesture. */
async function pressHeader(el: HTMLElement, move?: { x: number; y: number }, end: 'up' | 'cancel' = 'cancel'): Promise<void> {
  const header = el.querySelector('[data-ndd-widget-header]') as HTMLElement;
  el.setPointerCapture = vi.fn();
  header.dispatchEvent(pointer('pointerdown', { clientX: 50, clientY: 50 }));
  await stable();
  if (move) {
    el.dispatchEvent(pointer('pointermove', { clientX: move.x, clientY: move.y }));
    await stable();
  }
  el.dispatchEvent(pointer(end === 'up' ? 'pointerup' : 'pointercancel', { clientX: move?.x ?? 50, clientY: move?.y ?? 50 }));
  await stable();
}

/** Drag one resize handle from a point to a point. */
async function dragHandle(el: HTMLElement, dir: string, from: { x: number; y: number }, to: { x: number; y: number } | null, release = true): Promise<void> {
  const handle = el.querySelector(`.ndd-resize-${dir}`) as HTMLElement;
  expect(handle, `handle ${dir} should exist`).not.toBeNull();
  handle.setPointerCapture = vi.fn();
  handle.dispatchEvent(pointer('pointerdown', { clientX: from.x, clientY: from.y }));
  await stable();
  if (to) {
    handle.dispatchEvent(pointer('pointermove', { clientX: to.x, clientY: to.y }));
    await stable();
  }
  if (release) {
    handle.dispatchEvent(pointer('pointerup', { clientX: to?.x ?? from.x, clientY: to?.y ?? from.y }));
    await stable();
  }
}

// ─── PO1 ─────────────────────────────────────────────────────────────────────

@Component({ selector: 'ndd-test-bare-overlay', imports: [NddPanelOverlay], template: '<ndd-panel-overlay><span></span></ndd-panel-overlay>' })
class BareOverlay {}

describe('PO1: NddPanelOverlay', () => {
  it('renders the overlay root container', async () => {
    const { el } = await render(BareOverlay);
    expect(el.querySelector('.ndd-panel-overlay-root')).not.toBeNull();
  });
});

// ─── PO2 ─────────────────────────────────────────────────────────────────────

describe('PO2: NddFloatingWidget open=true', () => {
  it('renders .ndd-panel-float in the DOM', async () => {
    await oneWidget({ open: true, placement: { anchor: 'top-right', stretch: null } });
    expect(widgets()).toHaveLength(1);
  });
});

describe('PO2b: anchor positioning under RTL', () => {
  it('sets dir="rtl" and positions a top-right anchor with inset-inline-end, not a flipped left/right', async () => {
    await oneWidget({ placement: { anchor: 'top-right', stretch: null } }, 'rtl');
    const el = firstWidget();
    expect(el.getAttribute('dir')).toBe('rtl');
    expect(el.style.insetInlineEnd).not.toBe('');
    expect(el.style.insetInlineStart).toBe('');
  });

  it('uses the same inset-inline-end property under LTR — the logical key does not depend on direction', async () => {
    await oneWidget({ placement: { anchor: 'top-right', stretch: null } }, 'ltr');
    const el = firstWidget();
    expect(el.getAttribute('dir')).toBe('ltr');
    expect(el.style.insetInlineEnd).not.toBe('');
    expect(el.style.insetInlineStart).toBe('');
  });
});

// ─── PO3 ─────────────────────────────────────────────────────────────────────

describe('PO3: NddFloatingWidget open=false', () => {
  it('renders nothing when closed', async () => {
    await oneWidget({ open: false });
    expect(widgets()).toHaveLength(0);
  });
});

// ─── PO4 ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-closeable',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `<ndd-panel-overlay><ndd-floating-widget widgetId="w" title="Closeable" [open]="true" (openChange)="onUpdate($event)"><span></span></ndd-floating-widget></ndd-panel-overlay>`,
})
class Closeable {
  onUpdate: (v: boolean) => void = () => {};
}

describe('PO4: the close button reports through the open model', () => {
  it('emits openChange with false when the close button is clicked', async () => {
    // rdd took an `onClose` callback and required the caller to flip its own `open` input. The
    // model is both halves of that.
    const onUpdate = vi.fn();
    await render(Closeable, h => (h.onUpdate = onUpdate));
    const close = firstWidget().querySelector<HTMLButtonElement>('[data-ndd-widget-close]');
    expect(close).not.toBeNull();
    close!.click();
    await stable();
    expect(onUpdate).toHaveBeenCalledWith(false);
  });
});

// ─── PO5 ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-with-toolbar',
  imports: [NddPanelOverlay, NddPanelToolbar],
  template: `<ndd-panel-overlay><ndd-panel-toolbar [position]="position()"><button type="button">Tool</button></ndd-panel-toolbar></ndd-panel-overlay>`,
})
class WithToolbar {
  readonly position = signal<'top' | 'bottom'>('top');
}

describe('PO5: NddPanelToolbar position class', () => {
  it('renders .ndd-panel-toolbar--top for position="top"', async () => {
    const { el } = await render(WithToolbar, h => h.position.set('top'));
    expect(el.querySelector('.ndd-panel-toolbar--top')).not.toBeNull();
    expect(el.querySelector('.ndd-panel-toolbar--bottom')).toBeNull();
  });

  it('renders .ndd-panel-toolbar--bottom for position="bottom"', async () => {
    const { el } = await render(WithToolbar, h => h.position.set('bottom'));
    expect(el.querySelector('.ndd-panel-toolbar--bottom')).not.toBeNull();
  });
});

// ─── PO6 ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-hooked',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `<ndd-panel-overlay><ndd-floating-widget widgetId="w" title="Hooked" [(open)]="open"><span></span></ndd-floating-widget></ndd-panel-overlay>`,
})
class Hooked {
  readonly open = signal(false);
}

describe('PO6: [(open)] replaces usePanelFloatingWindow()', () => {
  it('starts closed; setting the model true shows the widget; false hides it', async () => {
    // rdd's hook was `useState(false)` plus `open`, `close` and `toggle` callbacks. Here it is a
    // signal the caller already has, so the hook would be more code than it saves.
    const { host } = await render(Hooked);
    expect(widgets()).toHaveLength(0);

    host.open.set(true);
    await stable();
    expect(widgets()).toHaveLength(1);

    // And the widget's own close button writes back through the same model.
    firstWidget().querySelector<HTMLButtonElement>('[data-ndd-widget-close]')!.click();
    await stable();
    expect(host.open()).toBe(false);
    expect(widgets()).toHaveLength(0);
  });
});

// ─── PO7 ─────────────────────────────────────────────────────────────────────

/** Publishes `injectFloatingWidgets()` and the store, from inside an overlay. */
let api: FloatingWidgetsApi;
let store: PanelOverlayStore;
@Component({ selector: 'ndd-test-api-probe', template: '<span></span>' })
class ApiProbe {
  constructor() {
    api = injectFloatingWidgets();
    store = injectPanelOverlay();
  }
}
@Component({ selector: 'ndd-test-api-host', imports: [NddPanelOverlay, ApiProbe], template: '<ndd-panel-overlay><ndd-test-api-probe /></ndd-panel-overlay>' })
class ApiHost {}

describe('PO7: injectFloatingWidgets — open and close', () => {
  it('starts with no open widgets', async () => {
    await render(ApiHost);
    expect(api.openIds()).toEqual([]);
  });

  it('open() shows a widget and updates openIds', async () => {
    await render(ApiHost);
    api.open('p1', { title: 'Panel 1', component: Dot });
    await stable();
    expect(api.openIds()).toContain('p1');
    expect(api.isOpen('p1')).toBe(true);
    expect(widgets()).toHaveLength(1);
  });

  it('close() removes a widget and updates openIds', async () => {
    await render(ApiHost);
    api.open('p2', { title: 'Panel 2', component: Dot });
    await stable();
    api.close('p2');
    await stable();
    expect(api.openIds()).not.toContain('p2');
    expect(api.isOpen('p2')).toBe(false);
    expect(widgets()).toHaveLength(0);
  });

  it('multiple managed widgets can coexist', async () => {
    await render(ApiHost);
    api.open('ma', { title: 'A', component: Dot });
    api.open('mb', { title: 'B', component: Dot });
    await stable();
    expect(api.openIds()).toHaveLength(2);
    expect(widgets()).toHaveLength(2);
  });
});

// ─── PO8 ─────────────────────────────────────────────────────────────────────

describe('PO8: injectFloatingWidgets — closeAll', () => {
  it('closeAll() removes every managed widget at once', async () => {
    await render(ApiHost);
    for (const id of ['ca-1', 'ca-2', 'ca-3']) api.open(id, { title: id, component: Dot });
    await stable();
    expect(api.openIds()).toHaveLength(3);

    api.closeAll();
    await stable();
    expect(api.openIds()).toHaveLength(0);
    expect(widgets()).toHaveLength(0);
  });
});

// ─── PO9 ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-two-widgets',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `
    <ndd-panel-overlay>
      <ndd-floating-widget widgetId="a" title="A"><span></span></ndd-floating-widget>
      <ndd-floating-widget widgetId="b" title="B"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class TwoWidgets {}

describe('PO9: widget focus — active class', () => {
  it('the focused widget gains .ndd-panel-float--active and the others lose it', async () => {
    await render(TwoWidgets);
    const [a, b] = widgets();
    b!.dispatchEvent(pointer('pointerdown'));
    await stable();
    expect(b!.classList.contains('ndd-panel-float--active')).toBe(true);
    expect(a!.classList.contains('ndd-panel-float--active')).toBe(false);
  });
});

// ─── PO10 ────────────────────────────────────────────────────────────────────

let renders = 0;
@Component({ selector: 'ndd-test-render-probe', template: '<span>{{ tick() }}</span>' })
class RenderProbe {
  tick(): string {
    renders++;
    return '';
  }
}
@Component({ selector: 'ndd-test-manager-probe', template: '<span>{{ tick() }}</span>' })
class ManagerProbe {
  constructor() {
    injectFloatingWidgets();
  }
  tick(): string {
    renders++;
    return '';
  }
}

@Component({
  selector: 'ndd-test-isolation',
  imports: [NddPanelOverlay, NddPanelToolbar, NddFloatingWidget, RenderProbe],
  template: `
    <ndd-panel-overlay>
      <ndd-panel-toolbar position="top"><ndd-test-render-probe /></ndd-panel-toolbar>
      <ndd-floating-widget widgetId="a" title="A"><span></span></ndd-floating-widget>
      <ndd-floating-widget widgetId="b" title="B"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class ToolbarIsolation {}

@Component({
  selector: 'ndd-test-manager-isolation',
  imports: [NddPanelOverlay, NddFloatingWidget, ManagerProbe],
  template: `
    <ndd-panel-overlay>
      <ndd-test-manager-probe />
      <ndd-floating-widget widgetId="a" title="A"><span></span></ndd-floating-widget>
      <ndd-floating-widget widgetId="b" title="B"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class ManagerIsolation {}

describe('PO10: toolbar render isolation', () => {
  it('a toolbar does not re-render when a widget gains focus', async () => {
    // rdd split this state across three React contexts purely for this. Signals are tracked
    // one by one, so one store gives the same isolation — a toolbar that never reads `topId`
    // is untouched.
    renders = 0;
    await render(ToolbarIsolation);
    const before = renders;
    expect(before).toBeGreaterThan(0);

    widgets()[1]!.dispatchEvent(pointer('pointerdown'));
    await stable();
    await stable();
    expect(renders).toBe(before);
  });
});

// ─── PO11 ────────────────────────────────────────────────────────────────────

describe('PO11: manager consumer render isolation', () => {
  it('an injectFloatingWidgets() consumer does not re-render when a widget gains focus', async () => {
    renders = 0;
    await render(ManagerIsolation);
    const before = renders;
    expect(before).toBeGreaterThan(0);

    widgets()[1]!.dispatchEvent(pointer('pointerdown'));
    await stable();
    await stable();
    expect(renders).toBe(before);
  });
});

// ─── PO12 ────────────────────────────────────────────────────────────────────

describe('PO12: a resize drag suppresses selection', () => {
  it('toggles .ndd-resizing-active on the body for the drag duration (WebKit selection bleed-through)', async () => {
    await oneWidget({ placement: { anchor: 'top-right', stretch: null }, width: 300, height: 200 });
    const el = firstWidget();

    // Undock first: a docked top-right widget offers no `se` handle (PO15). The move matters —
    // undocking happens at the drag threshold, not on the press (PO19). Ended with pointercancel
    // because jsdom reports a 0x0 container, so every coordinate reads as a corner.
    await pressHeader(el, { x: 80, y: 80 });

    expect(document.body.classList.contains('ndd-resizing-active')).toBe(false);
    const handle = el.querySelector<HTMLElement>('.ndd-resize-se');
    expect(handle).not.toBeNull();
    handle!.setPointerCapture = vi.fn();

    handle!.dispatchEvent(pointer('pointerdown', { pointerId: 2, clientX: 100, clientY: 100 }));
    await stable();
    expect(document.body.classList.contains('ndd-resizing-active')).toBe(true);

    handle!.dispatchEvent(pointer('pointerup', { pointerId: 2, clientX: 130, clientY: 130 }));
    await stable();
    expect(document.body.classList.contains('ndd-resizing-active')).toBe(false);
  });
});

// ─── PO13 ────────────────────────────────────────────────────────────────────

describe('PO13: a header drag suppresses selection', () => {
  it('toggles .ndd-dragging-active on the body for the drag duration', async () => {
    await oneWidget({ placement: { anchor: 'top-right', stretch: null }, width: 300, height: 200 });
    const el = firstWidget();
    el.setPointerCapture = vi.fn();
    const header = el.querySelector('[data-ndd-widget-header]') as HTMLElement;

    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
    header.dispatchEvent(pointer('pointerdown', { clientX: 50, clientY: 50 }));
    await stable();
    // Applied once the drag actually starts, not on the press itself.
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);

    el.dispatchEvent(pointer('pointermove', { clientX: 80, clientY: 80 }));
    await stable();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(true);

    el.dispatchEvent(pointer('pointerup', { clientX: 80, clientY: 80 }));
    await stable();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
  });

  it('cancelling the drag also removes .ndd-dragging-active', async () => {
    await oneWidget({ placement: { anchor: 'top-right', stretch: null }, width: 300, height: 200 });
    const el = firstWidget();
    el.setPointerCapture = vi.fn();
    const header = el.querySelector('[data-ndd-widget-header]') as HTMLElement;

    header.dispatchEvent(pointer('pointerdown', { clientX: 50, clientY: 50 }));
    el.dispatchEvent(pointer('pointermove', { clientX: 80, clientY: 80 }));
    await stable();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(true);

    el.dispatchEvent(pointer('pointercancel', { clientX: 80, clientY: 80 }));
    await stable();
    expect(document.body.classList.contains('ndd-dragging-active')).toBe(false);
  });
});

// ─── PO14 ────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-toolbar-float',
  imports: [NddPanelOverlay, NddPanelToolbar, NddFloatingWidget],
  template: `
    <ndd-panel-overlay>
      <ndd-panel-toolbar position="top"><button type="button">Tool</button></ndd-panel-toolbar>
      <ndd-floating-widget widgetId="w" title="Float" [placement]="{ anchor: 'top-left', stretch: null }"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class ToolbarFloat {}

describe('PO14: the toolbar re-measures through a ResizeObserver', () => {
  it("updates a docked widget's inset when the toolbar resizes after mount, not only at mount", async () => {
    // A one-shot measurement is right for a live mount. During a layout restore the DOM is not
    // settled at that instant, so rdd baked in a wrong size — usually 0 — permanently.
    let trigger: (() => void) | null = null;
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        trigger = cb;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;

    try {
      await render(ToolbarFloat);
      const toolbar = document.querySelector('.ndd-panel-toolbar') as HTMLElement;
      const el = firstWidget();
      expect(trigger).not.toBeNull();
      // jsdom reports offsetHeight 0, which is exactly the reported bug's "0 baked in" case.
      expect(el.style.top).toBe('0px');

      Object.defineProperty(toolbar, 'offsetHeight', { configurable: true, value: 48 });
      trigger!();
      await stable();
      expect(el.style.top).toBe('48px');
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});

// ─── PO15–PO18: anchor-aware resize handles ──────────────────────────────────

const anchored = (anchor: FloatAnchor, dir: 'ltr' | 'rtl' = 'ltr', extra: WidgetProps = {}) =>
  oneWidget({ placement: { anchor, stretch: null }, width: 300, height: 200, ...extra }, dir);

describe('PO15: docked resize handles follow the anchor', () => {
  it.each([
    ['top-left', ['e', 's', 'se']],
    ['top-right', ['s', 'sw', 'w']],
    ['bottom-left', ['e', 'n', 'ne']],
    ['bottom-right', ['n', 'nw', 'w']],
  ] as const)('%s offers exactly its free edges plus their corner', async (anchor, expected) => {
    await anchored(anchor);
    expect(handlesOn(firstWidget())).toEqual([...expected].sort());
  });

  it('never offers a handle on a pinned edge (bottom-right pins bottom and right)', async () => {
    await anchored('bottom-right');
    const el = firstWidget();
    // The two rdd rendered that could not work, plus their corner.
    expect(el.querySelector('.ndd-resize-s')).toBeNull();
    expect(el.querySelector('.ndd-resize-e')).toBeNull();
    expect(el.querySelector('.ndd-resize-se')).toBeNull();
  });
});

describe('PO16: the inline half mirrors under RTL', () => {
  it('top-right under RTL pins the physical left, so the free inline handle is `e`', async () => {
    await anchored('top-right', 'rtl');
    expect(handlesOn(firstWidget())).toEqual(['e', 's', 'se'].sort());
  });

  it('bottom-left under RTL pins the physical right, so the free inline handle is `w`', async () => {
    await anchored('bottom-left', 'rtl');
    expect(handlesOn(firstWidget())).toEqual(['n', 'nw', 'w'].sort());
  });

  it('the block axis is unaffected by direction', async () => {
    await anchored('bottom-right', 'rtl');
    expect(firstWidget().querySelector('.ndd-resize-n')).not.toBeNull();
    expect(firstWidget().querySelector('.ndd-resize-s')).toBeNull();
  });
});

describe('PO17: a free-floating widget keeps all eight handles', () => {
  it('offers every direction once undocked', async () => {
    await anchored('bottom-right');
    await pressHeader(firstWidget(), { x: 80, y: 80 });
    expect(handlesOn(firstWidget())).toEqual([...ALL_DIRS].sort());
  });
});

describe('PO18: a bottom-anchored widget resizes from the top', () => {
  it('dragging the `n` handle upward makes it taller, leaving the pinned bottom edge alone', async () => {
    // An 800x600 overlay holding a 300x200 widget pinned bottom-right, so its top edge is y=400.
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(492, 400, 300, 200) });
    try {
      await anchored('bottom-right');
      const el = firstWidget();
      const pinnedBefore = el.style.bottom;
      expect(el.style.height).toBe('200px');

      await dragHandle(el, 'n', { x: 640, y: 400 }, { x: 640, y: 350 }, false);
      expect(el.style.height).toBe('250px');
      // The anchored edge must not move — growth comes out of the top.
      expect(el.style.bottom).toBe(pinnedBefore);
    } finally {
      restore();
    }
  });
});

// ─── PO19 ────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-stack',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `
    <ndd-panel-overlay>
      <ndd-floating-widget widgetId="first" title="First" [placement]="{ anchor: 'top-left', stretch: null }" [width]="240" [height]="160"><span></span></ndd-floating-widget>
      <ndd-floating-widget widgetId="second" title="Second" [placement]="{ anchor: 'top-left', stretch: null }" [width]="240" [height]="100"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class Stack {}

describe('PO19: clicking the header does not undock', () => {
  // Undocking on pointerdown meant a plain click tore the widget off its anchor: it looked
  // unchanged, but its stacked siblings reflowed to close the gap.
  it('a click leaves the widget docked', async () => {
    await render(Stack);
    const first = widgets()[0]!;
    await pressHeader(first);
    // Docked positioning keeps the logical inset and writes no free-mode `left`.
    expect(first.style.insetInlineStart).toBe('8px');
    expect(first.style.left).toBe('');
    expect(handlesOn(first)).toEqual(['e', 's', 'se'].sort());
  });

  it('a click does not reflow its stacked siblings', async () => {
    await render(Stack);
    const [first, second] = widgets();
    const before = second!.style.top;
    expect(before).toBe('168px'); // 160px sibling + 8px gap
    await pressHeader(first!);
    expect(second!.style.top).toBe(before);
  });

  it('a sub-threshold move does not undock either', async () => {
    // The threshold is what stops a 1px jitter during a click from tearing the widget off.
    await render(Stack);
    const first = widgets()[0]!;
    await pressHeader(first, { x: 52, y: 51 }); // 3px total, under DRAG_THRESHOLD
    expect(first.style.insetInlineStart).toBe('8px');
    expect(first.style.left).toBe('');
    expect(handlesOn(first)).toEqual(['e', 's', 'se'].sort());
  });

  it('a real drag past the threshold still undocks', async () => {
    await render(Stack);
    const first = widgets()[0]!;
    await pressHeader(first, { x: 90, y: 90 });
    expect(first.style.left).not.toBe('');
    expect(first.style.insetInlineStart).toBe('');
    expect(handlesOn(first)).toEqual([...ALL_DIRS].sort());
  });
});

// ─── PO20 ────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-po20',
  imports: [NddPanelOverlay, NddPanelToolbar, NddFloatingWidget],
  template: `
    <ndd-panel-overlay>
      <ndd-panel-toolbar position="bottom"><span></span></ndd-panel-toolbar>
      <ndd-floating-widget widgetId="w" title="PO20" [placement]="{ anchor: 'top-left', stretch: null }" [stretchable]="false" [width]="300" [height]="200"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class Po20 {}

describe('PO20: docked resize respects toolbar insets', () => {
  it('stops at a bottom toolbar instead of the container edge', async () => {
    // rdd bounded growth by the raw container edge, so a docked widget could be resized clean
    // over a toolbar on the far side.
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 0, 300, 200), toolbars: { bottom: 40 } });
    try {
      await render(Po20);
      const el = firstWidget();
      await dragHandle(el, 's', { x: 150, y: 198 }, { x: 150, y: 900 });
      // 600 container - 40 toolbar - 0 top offset. rdd reached 600, straight over the toolbar.
      expect(el.style.height).toBe('560px');
    } finally {
      restore();
    }
  });
});

// ─── PO21–PO23: edge-stretch placement ───────────────────────────────────────

const stretched = async (anchor: FloatAnchor, stretch: Stretch | null = null, dir: 'ltr' | 'rtl' = 'ltr') => {
  await oneWidget({ placement: { anchor, stretch }, width: 240, height: 160 }, dir);
  return firstWidget();
};

describe('PO21: placement.stretch positioning', () => {
  it('width: pins both inline ends and writes no width', async () => {
    const el = await stretched('bottom-left', 'width');
    expect(el.style.insetInlineStart).toBe('8px');
    expect(el.style.insetInlineEnd).toBe('8px');
    expect(el.style.width).toBe(''); // implied by the two pins — the whole mechanism
    expect(el.style.height).toBe('160px'); // the block axis still carries its size
  });

  it('height: pins both block ends and writes no height', async () => {
    const el = await stretched('top-right', 'height');
    expect(el.style.top).toBe('0px');
    expect(el.style.bottom).toBe('0px');
    expect(el.style.height).toBe('');
    expect(el.style.width).toBe('240px');
  });

  it('both: fills the panel, carrying neither size', async () => {
    const el = await stretched('top-left', 'both');
    expect(el.style.insetInlineStart).toBe('8px');
    expect(el.style.insetInlineEnd).toBe('8px');
    expect(el.style.top).toBe('0px');
    expect(el.style.bottom).toBe('0px');
    expect(el.style.width).toBe('');
    expect(el.style.height).toBe('');
  });

  it('unstretched is unchanged — one inset per axis, both sizes written', async () => {
    const el = await stretched('bottom-right');
    expect(el.style.insetInlineEnd).toBe('8px');
    expect(el.style.insetInlineStart).toBe('');
    expect(el.style.width).toBe('240px');
    expect(el.style.height).toBe('160px');
  });
});

describe('PO22: handle sets while stretched', () => {
  it('inline-stretched: the free block edge, plus both inline ends to release from', async () => {
    expect(handlesOn(await stretched('bottom-left', 'width'))).toEqual(['n', 'e', 'w'].sort());
  });

  it('block-stretched: the free inline edge, plus both block ends', async () => {
    expect(handlesOn(await stretched('top-right', 'height'))).toEqual(['w', 'n', 's'].sort());
  });

  it('fills the panel: all four edges are releasable — never a dead end', async () => {
    expect(handlesOn(await stretched('top-left', 'both'))).toEqual(['n', 's', 'e', 'w'].sort());
  });

  it('no corner handle in a stretched state (it would mix a resize with a release)', async () => {
    for (const s of ['width', 'height', 'both'] as const) {
      const el = await stretched('top-left', s);
      for (const corner of ['ne', 'nw', 'se', 'sw']) expect(el.querySelector(`.ndd-resize-${corner}`)).toBeNull();
      fixture!.destroy();
      fixture = null;
      TestBed.resetTestingModule();
    }
  });

  it('the inline pair is direction-agnostic — both physical ends, either way', async () => {
    expect(handlesOn(await stretched('bottom-left', 'width', 'rtl'))).toEqual(['n', 'e', 'w'].sort());
  });
});

describe('PO23: releasing a stretched axis by dragging its end', () => {
  it('dragging the right edge inward pins the left end and adopts the dragged width', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 432, 784, 160) });
    try {
      const el = await stretched('bottom-left', 'width');
      expect(el.style.width).toBe('');

      await dragHandle(el, 'e', { x: 790, y: 500 }, { x: 690, y: 500 });

      expect(el.style.width).toBe('684px'); // 784 measured - 100 dragged
      expect(el.style.insetInlineStart).toBe('8px');
      expect(el.style.insetInlineEnd).toBe('');
      expect(handlesOn(el)).toEqual(['e', 'n', 'ne'].sort());
    } finally {
      restore();
    }
  });

  it('dragging the left edge inward pins the right end instead', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 432, 784, 160) });
    try {
      const el = await stretched('bottom-left', 'width');
      await dragHandle(el, 'w', { x: 10, y: 500 }, { x: 110, y: 500 });
      expect(el.style.width).toBe('684px');
      expect(el.style.insetInlineEnd).toBe('8px');
      expect(el.style.insetInlineStart).toBe('');
    } finally {
      restore();
    }
  });

  it('releasing one axis of `both` leaves the other stretched', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 0, 784, 600) });
    try {
      const el = await stretched('top-left', 'both');
      await dragHandle(el, 'e', { x: 790, y: 300 }, { x: 690, y: 300 });
      expect(el.style.width).toBe('684px'); // inline released
      expect(el.style.height).toBe(''); // block still stretched
      expect(el.style.top).toBe('0px');
      expect(el.style.bottom).toBe('0px');
    } finally {
      restore();
    }
  });

  it('dragging the free edge of the unstretched axis does not release anything', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 432, 784, 160) });
    try {
      const el = await stretched('bottom-left', 'width');
      await dragHandle(el, 'n', { x: 400, y: 434 }, { x: 400, y: 384 });
      expect(el.style.width).toBe(''); // still stretched
      expect(el.style.height).toBe('210px'); // 160 + 50, an ordinary resize
    } finally {
      restore();
    }
  });
});

// ─── PO24 ────────────────────────────────────────────────────────────────────

/** The parent answers every report with its own value — the Angular way to veto a gesture. */
@Component({
  selector: 'ndd-test-controlled',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `
    <ndd-panel-overlay>
      <ndd-floating-widget widgetId="ctl" title="Ctl" [width]="240" [height]="160" [placement]="placement()" (placementChange)="onPlacement($event)"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class Controlled {
  readonly placement = signal<PanelFloatPlacement>({ anchor: 'bottom-left', stretch: 'width' });
  readonly seen: PanelFloatPlacement[] = [];
  onPlacement(p: PanelFloatPlacement): void {
    this.seen.push(p);
    this.placement.set({ ...this.placement() });
  }
}

@Component({
  selector: 'ndd-test-atomic',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `
    <ndd-panel-overlay>
      <ndd-floating-widget widgetId="atomic" title="Atomic" [width]="240" [height]="160" [(placement)]="placement" (placementChange)="seen.push($event)"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class Atomic {
  readonly placement = signal<PanelFloatPlacement>({ anchor: 'bottom-left', stretch: 'width' });
  readonly seen: PanelFloatPlacement[] = [];
}

describe('PO24: controlled placement', () => {
  it('does not keep a gesture the parent answers with its own placement', async () => {
    // vdd: bound without a listener, the widget never self-updates. An Angular model is locally
    // writable, so "controlled" is answering `(placementChange)` with the parent's own value —
    // which re-syncs the widget. Reported, and not kept (N10).
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 432, 784, 160) });
    try {
      const { host } = await render(Controlled);
      const el = firstWidget();
      expect(el.style.width).toBe(''); // the caller's value is applied

      await dragHandle(el, 'e', { x: 790, y: 500 }, { x: 690, y: 500 });

      expect(host.seen).toEqual([{ anchor: 'bottom-left', stretch: null }]);
      expect(el.style.width).toBe('');
    } finally {
      restore();
    }
  });

  it('reports anchor and stretch together, as one atomic placement', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 432, 784, 160) });
    try {
      const { host } = await render(Atomic);
      const el = firstWidget();
      // Dragging the left end pins the right one, so both halves change in a single report.
      await dragHandle(el, 'w', { x: 10, y: 500 }, { x: 110, y: 500 });
      expect(host.seen).toHaveLength(1);
      expect(host.seen[0]).toEqual({ anchor: 'bottom-right', stretch: null });
      // With the model bound two-way, it did apply.
      expect(host.placement()).toEqual({ anchor: 'bottom-right', stretch: null });
      expect(el.style.insetInlineEnd).toBe('8px');
    } finally {
      restore();
    }
  });
});

// ─── PO25 ────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-edge',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `
    <ndd-panel-overlay>
      <ndd-floating-widget widgetId="left-card" title="left-card" [placement]="{ anchor: 'bottom-left', stretch: null }" [width]="200" [height]="90"><span></span></ndd-floating-widget>
      <ndd-floating-widget widgetId="right-card" title="right-card" [placement]="{ anchor: 'bottom-right', stretch: null }" [width]="200" [height]="120"><span></span></ndd-floating-widget>
      <ndd-floating-widget widgetId="strip" title="strip" [placement]="{ anchor: 'bottom-left', stretch: 'width' }" [width]="240" [height]="60"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class Edge {}

const byId = (id: string) => document.querySelector(`[data-ndd-widget="${id}"]`) as HTMLElement;

describe('PO25: a strip stacks against both corners of its edge', () => {
  // The taller card is deliberately in the corner the strip is *not* anchored to, so "clears
  // both buckets" and "clears only my bucket" give different answers.
  it('clears the taller of the two corners it spans', async () => {
    await render(Edge);
    expect(byId('left-card').style.bottom).toBe('0px');
    expect(byId('right-card').style.bottom).toBe('0px');
    // In both bottom buckets, so it clears the 120px card in the *other* corner (128px), not the
    // 90px one it shares a corner with (which would be 98px).
    expect(byId('strip').style.bottom).toBe('128px');
  });

  it('does not disturb the corner widgets themselves', async () => {
    await render(Edge);
    expect(byId('left-card').style.width).toBe('200px');
    expect(byId('right-card').style.width).toBe('200px');
  });
});

// ─── PO26 ────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-detach',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `
    <ndd-panel-overlay>
      <ndd-floating-widget widgetId="detach" title="Detach" [width]="240" [height]="160" [(placement)]="placement" (placementChange)="seen.push($event)"><span></span></ndd-floating-widget>
    </ndd-panel-overlay>
  `,
})
class Detach {
  readonly placement = signal<PanelFloatPlacement>({ anchor: 'bottom-left', stretch: 'width' });
  readonly seen: PanelFloatPlacement[] = [];
}

describe('PO26: detaching a stretched widget', () => {
  it('materialises the measured size and clears stretch', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 432, 784, 160) });
    try {
      const { host } = await render(Detach);
      const el = firstWidget();
      await pressHeader(el, { x: 440, y: 480 });
      // Free mode positions from an explicit box, so the 784px it was occupying is adopted —
      // not the stale 240px it had before stretching.
      expect(el.style.width).toBe('784px');
      expect(el.style.left).not.toBe('');
      expect(host.seen.some(p => p.stretch === null)).toBe(true);
    } finally {
      restore();
    }
  });
});

// ─── PO27 ────────────────────────────────────────────────────────────────────

describe('PO27: resize-to-stretch snapping', () => {
  // An 800x600 overlay with no toolbars and a 300x200 widget at top-left: the full inline
  // extent is 800 - 8 - 8 = 784, and the full block extent is 600.
  const snappable = async (extra: WidgetProps = {}) => {
    await oneWidget({ placement: { anchor: 'top-left', stretch: null }, width: 300, height: 200, ...extra });
    return firstWidget();
  };

  it('snaps the block axis to stretched when dragged to the far extent', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 0, 300, 200) });
    try {
      const el = await snappable();
      await dragHandle(el, 's', { x: 150, y: 198 }, { x: 150, y: 900 });
      expect(el.style.height).toBe(''); // no explicit height — both block ends pinned
      expect(el.style.top).toBe('0px');
      expect(el.style.bottom).toBe('0px');
      expect(el.style.width).toBe('300px'); // the inline axis is untouched
    } finally {
      restore();
    }
  });

  it('shows the snapping cue while armed, before release', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 0, 300, 200) });
    try {
      const el = await snappable();
      expect(el.className).not.toContain('ndd-panel-float--snapping');
      await dragHandle(el, 's', { x: 150, y: 198 }, { x: 150, y: 900 }, false);
      expect(el.className).toContain('ndd-panel-float--snapping');

      const handle = el.querySelector('.ndd-resize-s') as HTMLElement;
      handle.dispatchEvent(pointer('pointerup', { clientX: 150, clientY: 900 }));
      await stable();
      expect(el.className).not.toContain('ndd-panel-float--snapping');
    } finally {
      restore();
    }
  });

  it('restores the pre-drag size on the snapped axis, so releasing returns to it', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 0, 300, 200) });
    try {
      const el = await snappable();
      await dragHandle(el, 's', { x: 150, y: 198 }, { x: 150, y: 900 });
      expect(el.style.height).toBe('');
      // Release the axis by dragging its bottom end inward: it returns to 200, the size the user
      // last chose deliberately, not the 600 the drag passed through.
      await dragHandle(el, 's', { x: 150, y: 598 }, { x: 150, y: 300 });
      expect(el.style.height).not.toBe('');
    } finally {
      restore();
    }
  });

  it('stays armed within the release tolerance (hysteresis)', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 0, 300, 200) });
    try {
      const el = await snappable();
      const handle = el.querySelector('.ndd-resize-s') as HTMLElement;
      handle.setPointerCapture = vi.fn();
      handle.dispatchEvent(pointer('pointerdown', { clientX: 150, clientY: 198 }));
      handle.dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 900 }));
      await stable();
      // Pull back 30px — inside SNAP_OUT (40), so it stays armed.
      handle.dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 568 }));
      await stable();
      expect(el.className).toContain('ndd-panel-float--snapping');

      handle.dispatchEvent(pointer('pointerup', { clientX: 150, clientY: 568 }));
      await stable();
      expect(el.style.height).toBe('');
    } finally {
      restore();
    }
  });

  it('disarms once pulled back past the release tolerance', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 0, 300, 200) });
    try {
      const el = await snappable();
      const handle = el.querySelector('.ndd-resize-s') as HTMLElement;
      handle.setPointerCapture = vi.fn();
      handle.dispatchEvent(pointer('pointerdown', { clientX: 150, clientY: 198 }));
      handle.dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 900 }));
      await stable();
      handle.dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 548 }));
      await stable();
      expect(el.className).not.toContain('ndd-panel-float--snapping');

      handle.dispatchEvent(pointer('pointerup', { clientX: 150, clientY: 548 }));
      await stable();
      expect(el.style.height).toBe('550px'); // an ordinary resize, no stretch
    } finally {
      restore();
    }
  });

  it('stretchable=false never snaps', async () => {
    const restore = stubGeometry({ overlay: domRect(0, 0, 800, 600), widget: domRect(8, 0, 300, 200) });
    try {
      const el = await snappable({ stretchable: false });
      await dragHandle(el, 's', { x: 150, y: 198 }, { x: 150, y: 900 });
      expect(el.style.height).toBe('600px'); // clamped, still explicit
      expect(el.style.bottom).toBe('');
    } finally {
      restore();
    }
  });
});

// ─── PO28–PO30 ───────────────────────────────────────────────────────────────

type Locale = 'es' | 'ru';
const TABLES: Record<Locale, Record<string, string>> = {
  es: { 'legend.title': 'Leyenda SLD' },
  ru: { 'legend.title': 'Легенда SLD' },
};
const DESCRIPTOR = { id: 'legend.title', defaultMessage: 'SLD Legend' };

@Component({
  selector: 'ndd-test-template-legend',
  imports: [NddPanelOverlay, NddFloatingWidget],
  template: `<ndd-panel-overlay><ndd-floating-widget widgetId="legend" [title]="title"><span></span></ndd-floating-widget></ndd-panel-overlay>`,
})
class TemplateLegend {
  readonly title: Label = DESCRIPTOR;
}

describe('PO28–PO30: a stored widget title is localisable', () => {
  /** A formatter reading a signal, which is how an application switches language. */
  const renderWithLocale = (locale: WritableSignal<Locale>) =>
    render(ApiHost, () => {}, 'ltr', m => TABLES[locale()][m.id] ?? m.defaultMessage ?? m.id);
  const titleText = () => document.querySelector('.ndd-panel-float__title')?.textContent;

  it('PO28: open() accepts a descriptor title and resolves it through the formatter', async () => {
    await renderWithLocale(signal<Locale>('es'));
    api.open('legend', { title: DESCRIPTOR, component: Dot });
    await stable();
    expect(titleText()).toBe('Leyenda SLD');
  });

  it('PO29: the title re-resolves when the locale changes, with no reopen', async () => {
    const locale = signal<Locale>('es');
    await renderWithLocale(locale);
    api.open('legend', { title: DESCRIPTOR, component: Dot });
    await stable();
    expect(titleText()).toBe('Leyenda SLD');
    locale.set('ru');
    await stable();
    expect(titleText()).toBe('Легенда SLD');
  });

  it('PO30: a plain string title renders unchanged', async () => {
    await renderWithLocale(signal<Locale>('es'));
    api.open('legend', { title: 'SLD Legend', component: Dot });
    await stable();
    expect(titleText()).toBe('SLD Legend');
  });

  it('PO30: a descriptor on a template widget resolves too', async () => {
    await render(TemplateLegend, () => {}, 'ltr', m => TABLES.es[m.id] ?? m.defaultMessage ?? m.id);
    expect(titleText()).toBe('Leyenda SLD');
  });
});

// ─── PO31–PO35 ───────────────────────────────────────────────────────────────

/**
 * Added in vdd 1.0.1, for a defect a user reported: a widget opened through
 * `useFloatingWidgets()` discarded every placement gesture, because the overlay bound its
 * `placement` model to a fresh object literal that re-synced on every render. The overlay owns
 * placement per widget id, so these tests are about *ownership*: a gesture sticks (PO31), an
 * unrelated render does not disturb it (PO32), `open()`'s anchor is a seed (PO33), closing is
 * what resets it (PO34), and the record does not outlive its widget (PO35).
 */
describe('PO31–PO35: a managed widget owns its placement', () => {
  /** Wide enough that a full-width stretch is unambiguous, with the widget in the far corner. */
  const OVERLAY = domRect(0, 0, 1000, 600);
  const WIDGET = domRect(732, 372, 260, 220);
  const titleOf = (id: string) => byId(id).querySelector('.ndd-panel-float__title')?.textContent;
  const openBottomRight = (id = 'w1', title = 'W') => api.open(id, { title, component: Dot, anchor: 'bottom-right', width: 260, height: 220 });
  /** Drag the header onto the top-left drop zone and release there. */
  const dropTopLeft = (id = 'w1') => pressHeader(byId(id), { x: 10, y: 10 }, 'up');

  it('PO31: a managed widget keeps the corner it is dropped on', async () => {
    const restore = stubGeometry({ overlay: OVERLAY, widget: WIDGET });
    try {
      await render(ApiHost);
      openBottomRight();
      await stable();
      expect(byId('w1').style.insetInlineEnd).toBe('8px'); // seeded where open() said
      await dropTopLeft();
      expect(byId('w1').style.insetInlineStart).toBe('8px');
      expect(byId('w1').style.insetInlineEnd).toBe('');
      expect(byId('w1').style.top).toBe('0px');
    } finally {
      restore();
    }
  });

  it('PO32: a stretched managed widget is not reset when another widget opens', async () => {
    const restore = stubGeometry({ overlay: OVERLAY, widget: WIDGET });
    try {
      await render(ApiHost);
      openBottomRight();
      await stable();
      // Drag the inline-start edge out to the panel's full width: resize-to-stretch arms.
      await dragHandle(byId('w1'), 'w', { x: 732, y: 480 }, { x: 8, y: 480 });
      expect(byId('w1').style.insetInlineStart).toBe('8px');
      expect(byId('w1').style.insetInlineEnd).toBe('8px');
      expect(byId('w1').style.width).toBe(''); // two pins, no width

      api.open('w2', { title: 'Other', component: Dot });
      await stable();
      expect(byId('w1').style.insetInlineStart).toBe('8px');
      expect(byId('w1').style.insetInlineEnd).toBe('8px');
      expect(byId('w1').style.width).toBe('');
    } finally {
      restore();
    }
  });

  it('PO33: re-opening a live id refreshes its content without moving it', async () => {
    const restore = stubGeometry({ overlay: OVERLAY, widget: WIDGET });
    try {
      await render(ApiHost);
      openBottomRight();
      await stable();
      await dropTopLeft();
      expect(byId('w1').style.insetInlineStart).toBe('8px');

      // `anchor` is a seed: it must not yank the widget back to the corner it started in.
      openBottomRight('w1', 'Renamed');
      await stable();
      expect(titleOf('w1')).toBe('Renamed');
      expect(byId('w1').style.insetInlineStart).toBe('8px');
      expect(byId('w1').style.insetInlineEnd).toBe('');
    } finally {
      restore();
    }
  });

  it('PO34: closing and reopening re-seeds the placement', async () => {
    const restore = stubGeometry({ overlay: OVERLAY, widget: WIDGET });
    try {
      await render(ApiHost);
      openBottomRight();
      await stable();
      await dropTopLeft();
      expect(byId('w1').style.insetInlineStart).toBe('8px');

      api.close('w1');
      await stable();
      openBottomRight();
      await stable();
      expect(byId('w1').style.insetInlineEnd).toBe('8px'); // back to the seed
      expect(byId('w1').style.insetInlineStart).toBe('');
    } finally {
      restore();
    }
  });

  it('PO35: the placement record does not outlive its widget', async () => {
    const restore = stubGeometry({ overlay: OVERLAY, widget: WIDGET });
    try {
      await render(ApiHost);
      openBottomRight();
      await stable();
      expect(store.managedPlacements()['w1']).toEqual({ anchor: 'bottom-right', stretch: null });

      api.close('w1');
      await stable();
      expect('w1' in store.managedPlacements()).toBe(false);

      // A gesture that lands after a close must not resurrect the widget.
      store.setManagedPlacement('w1', { anchor: 'top-left', stretch: null });
      expect('w1' in store.managedPlacements()).toBe(false);
      expect(widgets()).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

// ─── Angular additions ───────────────────────────────────────────────────────

@Component({ selector: 'ndd-test-bare-toolbar', imports: [NddPanelToolbar], template: '<ndd-panel-toolbar position="top" />' })
class BareToolbar {}

describe('Panel overlay: Angular additions', () => {
  it('a toolbar outside an overlay throws a directed error', async () => {
    TestBed.configureTestingModule({ providers: [provideDockableDesktop(createWorkspace({ panels: {} }))] });
    expect(() => TestBed.createComponent(BareToolbar).detectChanges()).toThrow(/inside an <ndd-panel-overlay>/);
  });

  it('managed widget content receives its inputs', async () => {
    @Component({ selector: 'ndd-test-info', template: '<b data-info>{{ label() }}</b>' })
    class Info {
      readonly label = input('');
    }
    await render(ApiHost);
    api.open('i', { title: 'Info', component: Info, inputs: { label: 'feature 42' } });
    await stable();
    expect(document.querySelector('[data-info]')!.textContent).toBe('feature 42');
  });
});
