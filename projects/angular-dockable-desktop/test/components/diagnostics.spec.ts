/**
 * The two diagnostics, and `injectColorScheme()`.
 *
 * Ported from vue-dockable-desktop `test/components/diagnostics.test.ts` (14 tests, names
 * preserved), itself a port of rdd's `V3Diagnostics.test.tsx` and `useColorScheme.test.tsx`.
 * Both diagnostics exist for the same reason: the failure they describe produces a black
 * rectangle and **no error anywhere**. Each is development-only.
 *
 * vdd flipped `process.env.NODE_ENV`; Angular's switch is the `ngDevMode` global, which the CLI's
 * production build defines as `false` — so the "is development-only" tests set it to `false` for
 * their duration. The M12 gate checks the other half: a production bundle carries neither message.
 * The stylesheet message names Angular's fix (the `styles` array), not vdd's import line.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { injectColorScheme } from '../../src/lib/core/color-scheme';
import type { ColorScheme } from '../../src/lib/core/color-scheme';

@Component({ selector: 'ndd-test-panel', template: 'panel' })
class Panel {}

let fixture: ComponentFixture<unknown> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.querySelectorAll('.ndd-panel-store, .ndd-panel-mount').forEach(el => el.remove());
  document.documentElement.removeAttribute('data-color-scheme');
});

const mountDesktop = async () => {
  const ws = createWorkspace({ panels: { map: { component: Panel } } });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  fixture = TestBed.createComponent(NddDesktop);
  await fixture.whenStable();
  return ws;
};

/** Run with Angular's development mode switched off, as a production build is. */
async function inProduction(fn: () => Promise<void>): Promise<void> {
  const g = globalThis as unknown as { ngDevMode: unknown };
  const saved = g.ngDevMode;
  g.ngDevMode = false;
  try {
    await fn();
  } finally {
    g.ngDevMode = saved;
  }
}

// ─── C5: the stylesheet sentinel ─────────────────────────────────────────────

describe('C5: the stylesheet sentinel (--ndd-styles-loaded)', () => {
  let original: typeof getComputedStyle;
  let value = '';

  beforeEach(() => {
    original = globalThis.getComputedStyle;
    // setup.ts declares the sentinel for every other suite; here it is proxied to say whatever the
    // test needs, absent included.
    globalThis.getComputedStyle = ((el: Element) => {
      const real = original(el);
      return new Proxy(real, {
        get(target, prop) {
          if (prop === 'getPropertyValue') return (name: string) => (name === '--ndd-styles-loaded' ? value : target.getPropertyValue(name));
          return Reflect.get(target, prop);
        },
      });
    }) as typeof getComputedStyle;
  });
  afterEach(() => {
    globalThis.getComputedStyle = original;
  });

  const errors = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(c => String(c[0])).filter(m => m.includes('stylesheet is not loaded'));

  it('emits console.error when the sentinel is absent', async () => {
    value = '';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mountDesktop();
      expect(errors(error).length).toBeGreaterThan(0);
    } finally {
      error.mockRestore();
    }
  });

  it('does NOT emit console.error when the sentinel is present', async () => {
    value = '1';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mountDesktop();
      expect(errors(error)).toHaveLength(0);
    } finally {
      error.mockRestore();
    }
  });

  it('the message includes the exact configuration to paste', async () => {
    value = '';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mountDesktop();
      const message = errors(error)[0];
      expect(message).toBeDefined();
      // The whole point of the diagnostic is that the fix is copy-pasteable.
      expect(message).toContain('"styles": ["angular-dockable-desktop/styles.css"');
    } finally {
      error.mockRestore();
    }
  });

  it('is development-only', async () => {
    value = '';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await inProduction(async () => {
        await mountDesktop();
      });
      expect(errors(error)).toHaveLength(0);
    } finally {
      error.mockRestore();
    }
  });
});

// ─── C6: the zero-height warning ─────────────────────────────────────────────

describe('C6: the zero-height warning', () => {
  let trigger: ((height: number) => void) | null = null;
  let original: typeof ResizeObserver;

  beforeEach(() => {
    original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        trigger = (height: number) => cb([{ contentRect: { height, width: 1024 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
    trigger = null;
  });

  const zeroHeight = async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountDesktop();
    return { warn, messages: () => warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('no height')) };
  };

  it('emits console.warn when the observer reports a height of 0', async () => {
    const { warn, messages } = await zeroHeight();
    try {
      expect(trigger).not.toBeNull();
      trigger!(0);
      expect(messages()).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('warns only once, however many times the observer reports zero', async () => {
    const { warn, messages } = await zeroHeight();
    try {
      trigger!(0);
      trigger!(0);
      trigger!(0);
      expect(messages()).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('the message explains the CSS height-inheritance rule and names where it breaks', async () => {
    const { warn, messages } = await zeroHeight();
    try {
      trigger!(0);
      const message = messages()[0]!;
      // The cause is always the same, and saying it is the whole value of the warning.
      expect(message).toContain('height: 100%');
      expect(message).toContain('Zero height starts at:');
      expect(message).toContain('.ndd-fill-viewport');
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT warn when the workspace has a positive height', async () => {
    const { warn, messages } = await zeroHeight();
    try {
      trigger!(600);
      expect(messages()).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('is development-only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await inProduction(async () => {
        await mountDesktop();
        trigger?.(0);
      });
      expect(warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('no height'))).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});

// ─── injectColorScheme ───────────────────────────────────────────────────────

describe('injectColorScheme', () => {
  let scheme: () => ColorScheme;

  @Component({ selector: 'ndd-test-scheme', template: '{{ scheme() }}' })
  class Probe {
    protected readonly scheme = injectColorScheme();
    constructor() {
      scheme = this.scheme;
    }
  }

  const probe = async () => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(Probe);
    await fixture.whenStable();
    return fixture;
  };

  /** The attribute is the contract, so a change has to reach the signal through the DOM. */
  const setScheme = async (value: string | null) => {
    if (value === null) document.documentElement.removeAttribute('data-color-scheme');
    else document.documentElement.setAttribute('data-color-scheme', value);
    // A MutationObserver delivers on a microtask.
    await Promise.resolve();
    await fixture?.whenStable();
  };

  it('CS1: returns "dark" with no attribute set', async () => {
    await probe();
    expect(scheme()).toBe('dark');
  });

  it('CS2: reads an existing attribute on first evaluation', async () => {
    document.documentElement.setAttribute('data-color-scheme', 'light');
    await probe();
    expect(scheme()).toBe('light');
  });

  it('CS3: follows attribute changes, both ways', async () => {
    await probe();
    expect(scheme()).toBe('dark');
    await setScheme('light');
    expect(scheme()).toBe('light');
    await setScheme('dark');
    expect(scheme()).toBe('dark');
  });

  it('CS4: any value other than "light" reads as dark', async () => {
    await probe();
    for (const value of ['sepia', 'DARK', '', 'Light']) {
      await setScheme(value);
      expect(scheme(), value).toBe('dark');
    }
    // ...and removing it entirely is also dark, so there is no third state to handle.
    await setScheme(null);
    expect(scheme()).toBe('dark');
  });

  it('CS5: stops following once the component is destroyed', async () => {
    const f = await probe();
    const read = scheme;
    await setScheme('light');
    expect(read()).toBe('light');

    f.destroy();
    fixture = null;
    await setScheme('dark');
    // The observer is disconnected with the component, so the signal is frozen at its last value
    // rather than leaking an observer for the life of the page.
    expect(read()).toBe('light');
  });
});
