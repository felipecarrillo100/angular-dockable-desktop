/**
 * Styles in a pop-out window (1.12.0, rdd 7.12.1's `PopOutStyles.test.tsx` as vdd 1.14.0's
 * `test/components/popOutStyles.test.ts`, ids prefixed `X`): the main page's stylesheets,
 * `<html>` / `<body>` and the workspace's scope, copied into the child document and kept in step.
 * The child is an `<iframe>`'s document (its own window and DOM constructors, as a real pop-out's).
 *
 * XPS1: the head's stylesheets are cloned in order, after the child's own head content; a link's
 *       href is absolute
 * XPS2: sheets added and removed later follow, in order
 * XPS3: a <style>'s text, and a link's href / media / disabled, follow
 * XPS4: adoptedStyleSheets are copied as text, after the rest, and re-read on a change
 * XPS5: <html> and <body>: attributes (not style), custom properties and color-scheme follow; the
 *       child's own classes and inline layout stay
 * XPS6: the frame repeats the workspace's colour scheme, skin and ndd-no-animations, in step
 * XPS7: ready once every copied link has loaded or failed, or after the limit; at once with none
 * XPS8: stopping disconnects everything: later changes are not copied
 * XPS9: through the workspace: the frame is hidden until ready, is also .ndd-workspace, gets the
 *       page's sheets, and stops following on return; nothing observes the page with popOut off
 * ndd additions:
 * XPSN1: the page's `lang` and `dir` reach the window through the `<html>` mirror, and follow
 * XPSN2: the frame follows the desktop's own inputs: a skin switch and animations off
 * XPSN3: a link's href alone follows (no other change of the page)
 */
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { POPOUT_STYLES_TIMEOUT_MS, startPopOutStyles } from '../../src/lib/core/pop-out-styles';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';

type AnyWindow = Window & typeof globalThis;
const frames: HTMLIFrameElement[] = [];
const added: Node[] = [];
const stops: (() => void)[] = [];
const cleanups: (() => void)[] = [];

function child(): { win: AnyWindow; doc: Document } {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const win = frame.contentWindow as AnyWindow;
  // jsdom tears an iframe's document down on close(); a real pop-out's document stays readable.
  let closed = false;
  Object.defineProperty(win, 'closed', { get: () => closed, configurable: true });
  Object.defineProperty(win, 'close', {
    value: () => {
      closed = true;
    },
    configurable: true,
  });
  Object.defineProperty(win, 'focus', { value: () => {}, configurable: true });
  return { win, doc: frame.contentDocument! };
}
/** Adds `node` to the main <head>, removed after the test. */
function head<T extends Node>(node: T): T {
  document.head.appendChild(node);
  added.push(node);
  return node;
}
const style = (text: string, id?: string) => {
  const s = document.createElement('style');
  s.textContent = text;
  if (id) s.id = id;
  return s;
};
const link = (href: string) => {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.setAttribute('href', href);
  return l;
};
/** Lets MutationObserver callbacks run. */
const flush = () => new Promise(r => setTimeout(r, 0));
/** The child head's copied sheets: tag and id or href. */
const copied = (doc: Document) =>
  Array.from(doc.head.querySelectorAll('style, link')).map(
    el => `${el.localName}:${el.id || el.getAttribute('href') || (el.hasAttribute('data-ndd-adopted') ? 'adopted' : el.textContent)}`,
  );

function start(doc: Document, extra: Partial<Parameters<typeof startPopOutStyles>[0]> = {}) {
  const frame = doc.createElement('div');
  doc.body.appendChild(frame);
  const onReady = vi.fn();
  const stop = startPopOutStyles({ child: doc, frame, scope: null, onReady, ...extra });
  stops.push(stop);
  return { frame, onReady, stop };
}

afterEach(() => {
  stops.splice(0).forEach(s => s());
  cleanups.splice(0).forEach(f => f());
  added.splice(0).forEach(n => (n as ChildNode).remove());
  frames.splice(0).forEach(f => f.remove());
  for (const el of [document.documentElement, document.body]) {
    for (const name of ['data-test', 'data-bs-theme']) el.removeAttribute(name);
    el.classList.remove('dark', 'mui-theme');
    el.style.removeProperty('--app-accent');
    el.style.removeProperty('color-scheme');
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('XPS1: the head is copied in order', () => {
  it("clones every stylesheet, in order, after the child's own head content; links get an absolute href", () => {
    head(style('a{}', 's1'));
    head(link('/lib.css'));
    head(style('b{}', 's2'));
    head(document.createElement('meta'));
    const { doc } = child();
    const own = doc.createElement('title');
    doc.head.appendChild(own);
    start(doc);
    const mine = copied(doc).filter(c => /s1|s2|lib\.css/.test(c));
    expect(mine).toEqual(['style:s1', `link:${new URL('/lib.css', location.href).href}`, 'style:s2']);
    expect(doc.head.firstElementChild).toBe(own);
    expect(doc.getElementById('s1')!.textContent).toBe('a{}');
  });
});

describe('XPS2: sheets added and removed later', () => {
  it('follow, in order', async () => {
    const s1 = head(style('a{}', 's1'));
    const { doc } = child();
    start(doc);
    const s2 = head(style('b{}', 's2'));
    document.head.insertBefore(style('z{}', 's0'), s1);
    added.push(document.getElementById('s0')!);
    await flush();
    expect(copied(doc).filter(c => /s\d/.test(c))).toEqual(['style:s0', 'style:s1', 'style:s2']);
    s1.remove();
    s2.remove();
    await flush();
    expect(copied(doc).filter(c => /s\d/.test(c))).toEqual(['style:s0']);
  });
});

describe('XPS3: changes to a sheet', () => {
  it("a <style>'s text, and a link's href, media and disabled", async () => {
    const s = head(style('a{}', 's1'));
    const l = head(link('/one.css'));
    const { doc } = child();
    start(doc);
    s.textContent = 'a{color:red}';
    l.setAttribute('href', '/two.css');
    l.setAttribute('media', 'print');
    l.setAttribute('disabled', '');
    await flush();
    expect(doc.getElementById('s1')!.textContent).toBe('a{color:red}');
    const clone = Array.from(doc.head.querySelectorAll('link')).find(x => x.getAttribute('href')!.endsWith('/two.css'))!;
    expect(clone).toBeDefined();
    expect(clone.getAttribute('media')).toBe('print');
    expect(clone.hasAttribute('disabled')).toBe(true);
    l.removeAttribute('disabled');
    await flush();
    expect(clone.hasAttribute('disabled')).toBe(false);
  });
});

describe("XPSN3: a link's href alone", () => {
  it('follows, with no other change of the page', async () => {
    const l = head(link('/one.css'));
    const { doc } = child();
    start(doc);
    l.setAttribute('href', '/two.css');
    await flush();
    const hrefs = Array.from(doc.head.querySelectorAll('link'), x => x.getAttribute('href'));
    expect(hrefs).toContain(new URL('/two.css', location.href).href);
    expect(hrefs).not.toContain(new URL('/one.css', location.href).href);
  });
});

describe('XPS4: adoptedStyleSheets', () => {
  it('are copied as text, after the rest, and re-read on a change of the page', async () => {
    let sheets = [{ cssRules: [{ cssText: '.x { color: red; }' }] }];
    Object.defineProperty(document, 'adoptedStyleSheets', {
      get: () => sheets,
      configurable: true,
    });
    try {
      head(style('a{}', 's1'));
      const { doc } = child();
      start(doc);
      const last = Array.from(doc.head.children).at(-1)!;
      expect(last.hasAttribute('data-ndd-adopted')).toBe(true);
      expect(last.textContent).toBe('.x { color: red; }');
      sheets = [{ cssRules: [{ cssText: '.y { color: blue; }' }] }];
      document.documentElement.setAttribute('data-test', '1'); // a change of the page re-reads them
      await flush();
      expect(doc.querySelector('[data-ndd-adopted]')!.textContent).toBe('.y { color: blue; }');
    } finally {
      delete (document as unknown as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
    }
  });
});

describe('XPS5: <html> and <body>', () => {
  it("attributes, custom properties and color-scheme follow; the child's own classes and layout stay", async () => {
    const html = document.documentElement;
    html.setAttribute('data-bs-theme', 'dark');
    html.classList.add('dark');
    html.style.setProperty('--app-accent', 'red');
    html.style.setProperty('color-scheme', 'dark');
    document.body.classList.add('mui-theme');
    const { doc } = child();
    doc.documentElement.classList.add('own');
    doc.body.style.margin = '0px';
    start(doc);
    const ch = doc.documentElement;
    expect(ch.getAttribute('data-bs-theme')).toBe('dark');
    expect(ch.classList.contains('dark')).toBe(true);
    expect(ch.classList.contains('own')).toBe(true);
    expect(ch.style.getPropertyValue('--app-accent')).toBe('red');
    expect(ch.style.getPropertyValue('color-scheme')).toBe('dark');
    expect(doc.body.classList.contains('mui-theme')).toBe(true);
    html.setAttribute('data-bs-theme', 'light');
    html.classList.remove('dark');
    html.style.removeProperty('--app-accent');
    document.body.classList.remove('mui-theme');
    await flush();
    expect(ch.getAttribute('data-bs-theme')).toBe('light');
    expect(ch.classList.contains('dark')).toBe(false);
    expect(ch.classList.contains('own')).toBe(true);
    expect(ch.style.getPropertyValue('--app-accent')).toBe('');
    expect(doc.body.classList.contains('mui-theme')).toBe(false);
    expect(doc.body.style.margin).toBe('0px');
    html.removeAttribute('data-bs-theme');
    await flush();
    expect(ch.hasAttribute('data-bs-theme')).toBe(false);
  });

  it("only custom properties and color-scheme, not the rest of the page's inline style", () => {
    document.documentElement.style.setProperty('--app-accent', 'red');
    document.documentElement.style.fontSize = '30px';
    try {
      const { doc } = child();
      start(doc);
      expect(doc.documentElement.style.getPropertyValue('--app-accent')).toBe('red');
      expect(doc.documentElement.style.fontSize).toBe('');
    } finally {
      document.documentElement.style.removeProperty('font-size');
    }
  });
});

describe("XPS6: the workspace's scope on the frame", () => {
  it('colour scheme, skin and ndd-no-animations, in step', async () => {
    const scope = document.createElement('div');
    scope.setAttribute('data-color-scheme', 'light');
    scope.setAttribute('data-ndd-skin', 'nord');
    scope.className = 'ndd-workspace ndd-no-animations';
    document.body.appendChild(scope);
    added.push(scope);
    const { doc } = child();
    const { frame } = start(doc, { scope });
    expect(frame.getAttribute('data-color-scheme')).toBe('light');
    expect(frame.getAttribute('data-ndd-skin')).toBe('nord');
    expect(frame.classList.contains('ndd-no-animations')).toBe(true);
    scope.setAttribute('data-color-scheme', 'dark');
    scope.removeAttribute('data-ndd-skin');
    scope.classList.remove('ndd-no-animations');
    await flush();
    expect(frame.getAttribute('data-color-scheme')).toBe('dark');
    expect(frame.hasAttribute('data-ndd-skin')).toBe(false);
    expect(frame.classList.contains('ndd-no-animations')).toBe(false);
  });
});

describe('XPS7: ready', () => {
  it('at once with no link to wait for', () => {
    head(style('a{}'));
    const { doc } = child();
    const { onReady } = start(doc);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('once every copied link has loaded or failed', () => {
    head(link('/one.css'));
    head(link('/two.css'));
    const { doc } = child();
    const { onReady } = start(doc);
    const clones = Array.from(doc.head.querySelectorAll('link'));
    expect(clones.length).toBeGreaterThanOrEqual(2);
    expect(onReady).not.toHaveBeenCalled();
    clones.forEach((c, i) => {
      if (i < clones.length - 1) c.dispatchEvent(new Event('load'));
    });
    expect(onReady).not.toHaveBeenCalled();
    clones.at(-1)!.dispatchEvent(new Event('error'));
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('...or after the time limit', () => {
    vi.useFakeTimers();
    head(link('/never.css'));
    const { doc } = child();
    const { onReady } = start(doc);
    vi.advanceTimersByTime(POPOUT_STYLES_TIMEOUT_MS - 10);
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

describe('XPS8: stopping', () => {
  it('nothing follows any more', async () => {
    const s = head(style('a{}', 's1'));
    const scope = document.createElement('div');
    document.body.appendChild(scope);
    added.push(scope);
    const { doc } = child();
    const { stop, frame } = start(doc, { scope });
    stop();
    s.textContent = 'changed{}';
    head(style('b{}', 's2'));
    document.documentElement.setAttribute('data-test', 'after');
    scope.setAttribute('data-ndd-skin', 'nord');
    await flush();
    expect(doc.getElementById('s1')!.textContent).toBe('a{}');
    expect(doc.getElementById('s2')).toBeNull();
    expect(doc.documentElement.hasAttribute('data-test')).toBe(false);
    expect(frame.hasAttribute('data-ndd-skin')).toBe(false);
  });
});

// ─── through the workspace ────────────────────────────────────────────────────

@Component({
  selector: 'ndd-test-ps-plain',
  template: `<div class="ps-panel">{{ panelId() }}</div>`,
})
class Plain {
  readonly panelId = input('');
}

const skin = signal('nord');
const animations = signal(true);
@Component({
  selector: 'ndd-test-ps-shell',
  imports: [NddDesktop],
  template: `<ndd-desktop [skin]="skin()" [animations]="animations()" />`,
})
class Shell {
  protected readonly skin = skin;
  protected readonly animations = animations;
}

let fixture: ComponentFixture<unknown> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  skin.set('nord');
  animations.set(true);
  document.body.innerHTML = '';
});

const settle = async () => {
  await fixture?.whenStable();
  await fixture?.whenStable();
};

async function mountDesktop(popOut: boolean): Promise<Workspace> {
  const ws = createWorkspace({
    popOut,
    panels: { plain: { component: Plain, defaultOptions: { canPopOut: true } } },
  }) as unknown as Workspace;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const f = TestBed.createComponent(Shell) as ComponentFixture<unknown>;
  document.body.appendChild(f.nativeElement as HTMLElement);
  fixture = f;
  await settle();
  ws.openPanel('a', 'plain');
  await settle();
  return ws;
}

/** Pops panel `a` out into a fresh child window. */
async function popOutA(ws: Workspace): Promise<{ win: AnyWindow; doc: Document }> {
  const c = child();
  vi.spyOn(window, 'open').mockImplementation(() => c.win);
  ws.popOutPanel('a');
  await settle();
  return c;
}

const headObserved = (observe: { mock: { calls: unknown[][] } }) => observe.mock.calls.some(c => c[0] === document.head);

describe('XPS9: through the workspace', () => {
  it("the frame waits hidden for the page's sheets, is also .ndd-workspace with its scope, and stops on return", async () => {
    head(style('.page{}', 's1'));
    const l = head(link('/lib.css'));
    const ws = await mountDesktop(true);
    const { doc } = await popOutA(ws);
    const frame = doc.querySelector<HTMLElement>('.ndd-popout-frame')!;
    expect(frame.classList.contains('ndd-workspace')).toBe(true);
    expect(frame.getAttribute('data-ndd-skin')).toBe('nord');
    expect(frame.style.visibility).toBe('hidden');
    expect(doc.getElementById('s1')).not.toBeNull();
    const clone = Array.from(doc.head.querySelectorAll('link')).find(x => x.getAttribute('href') === l.href)!;
    clone.dispatchEvent(new Event('load'));
    // Other links of the page (if any) settle too; the frame shows once they all have.
    doc.head.querySelectorAll('link').forEach(x => x.dispatchEvent(new Event('load')));
    await settle();
    expect(frame.style.visibility).toBe('');
    ws.returnPanel('a');
    await settle();
    head(style('.later{}', 's2'));
    await flush();
    expect(doc.getElementById('s2')).toBeNull();
  });

  it('with popOut off, nothing observes the page', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    await mountDesktop(false);
    expect(headObserved(observe)).toBe(false);
  });

  it('with popOut on, the page is observed only while a panel is out', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const ws = await mountDesktop(true);
    expect(headObserved(observe)).toBe(false);
    await popOutA(ws);
    expect(headObserved(observe)).toBe(true);
    const before = disconnect.mock.calls.length;
    ws.returnPanel('a');
    await settle();
    expect(disconnect.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("XPSN1: the page's lang and dir", () => {
  it('reach the window through the <html> mirror, and follow', async () => {
    const html = document.documentElement;
    html.setAttribute('lang', 'nl');
    html.setAttribute('dir', 'rtl');
    cleanups.push(() => {
      html.removeAttribute('lang');
      html.removeAttribute('dir');
    });
    const ws = await mountDesktop(true);
    const { doc } = await popOutA(ws);
    expect(doc.documentElement.getAttribute('lang')).toBe('nl');
    expect(doc.documentElement.getAttribute('dir')).toBe('rtl');
    html.setAttribute('lang', 'de');
    await flush();
    expect(doc.documentElement.getAttribute('lang')).toBe('de');
  });
});

describe("XPSN2: the desktop's own inputs", () => {
  it('a skin switch and animations off reach the frame', async () => {
    const ws = await mountDesktop(true);
    const { doc } = await popOutA(ws);
    const frame = doc.querySelector<HTMLElement>('.ndd-popout-frame')!;
    expect(frame.getAttribute('data-ndd-skin')).toBe('nord');
    expect(frame.classList.contains('ndd-no-animations')).toBe(false);
    skin.set('tokyo');
    animations.set(false);
    await settle();
    await flush();
    expect(frame.getAttribute('data-ndd-skin')).toBe('tokyo');
    expect(frame.classList.contains('ndd-no-animations')).toBe(true);
    // The page's <html> carries them too (the document mirror), and so does the window's.
    expect(doc.documentElement.getAttribute('data-ndd-skin')).toBe('tokyo');
    expect(doc.documentElement.classList.contains('ndd-no-animations')).toBe(true);
    // The frame's own classes stay.
    expect(frame.classList.contains('ndd-popout-frame')).toBe(true);
  });
});
