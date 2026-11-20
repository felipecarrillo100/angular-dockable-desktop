/**
 * Components with static host classes (1.11.1, MapEvolution's report on 1.11.0).
 *
 * A panel's and a managed widget's component is created on a library-owned element
 * (`createComponent(…, { hostElement })`). Angular writes a component's static `host: { class }`
 * as the element's `class` attribute, replacing what was there, so the library's own class
 * (`ndd-panel-content`, `ndd-panel-float__content`) and the kind's `className` were lost, and
 * with them the full size: content that fills its panel or widget no longer did.
 *
 * HC1: a workspace panel's content keeps `ndd-panel-content` and the kind's `className`, beside
 *      its component's host classes, docked and floating
 * HC2: a managed widget's content keeps `ndd-panel-float__content` beside its component's host
 *      classes, in the panel and docked out of it
 * HC3: a component with no host class is unchanged
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { PanelDefinition, Workspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { NddDesktop } from '../../src/lib/desktop/desktop';
import { NddPanelOverlay, injectFloatingWidgets } from '../../src/lib/panel-overlay/panel-overlay';
import type { FloatingWidgetsApi } from '../../src/lib/panel-overlay/panel-overlay';

let api: FloatingWidgetsApi | null = null;

@Component({ selector: 'ndd-test-hc-dense', host: { class: 'app-dense app-compact' }, template: '<span id="hc-dense"></span>' })
class Dense {}

@Component({ selector: 'ndd-test-hc-bare', template: '<span id="hc-bare"></span>' })
class Bare {}

@Component({ selector: 'ndd-test-hc-grab', template: '' })
class Grab {
  constructor() {
    api = injectFloatingWidgets();
  }
}

@Component({
  selector: 'ndd-test-hc-owner',
  imports: [NddPanelOverlay, Grab],
  template: `<ndd-panel-overlay><ndd-test-hc-grab /></ndd-panel-overlay>`,
})
class Owner {}

let fixture: ComponentFixture<unknown> | null = null;
afterEach(() => {
  fixture?.destroy();
  fixture = null;
  document.body.innerHTML = '';
  api = null;
});
const stable = () => fixture!.whenStable();

async function desktop(panels: Record<string, PanelDefinition>): Promise<Workspace> {
  const ws = createWorkspace({ panels }) as unknown as Workspace;
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  fixture = TestBed.createComponent(NddDesktop) as ComponentFixture<unknown>;
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await stable();
  return ws;
}

const hostOf = (sel: string) => document.querySelector(sel)!.parentElement as HTMLElement;
const classes = (el: Element) => [...el.classList].sort();

describe('HC1: a workspace panel whose component declares host classes', () => {
  it("keeps ndd-panel-content and the kind's className, docked and floating", async () => {
    const ws = await desktop({ dense: { component: Dense, defaultOptions: { className: 'app-chart' } } });
    ws.openPanel('d', 'dense');
    await stable();
    const el = hostOf('#hc-dense');
    expect(classes(el)).toEqual(['app-chart', 'app-compact', 'app-dense', 'ndd-panel-content']);
    ws.floatPanel('d');
    await stable();
    expect(hostOf('#hc-dense')).toBe(el);
    expect(classes(el)).toEqual(['app-chart', 'app-compact', 'app-dense', 'ndd-panel-content']);
  });
});

describe('HC2: a managed widget whose component declares host classes', () => {
  it('keeps ndd-panel-float__content, in the panel and docked out of it', async () => {
    const ws = await desktop({ map: { component: Owner } });
    ws.openPanel('map', 'map', { title: 'Map' });
    await stable();
    api!.open('w', { title: 'W', component: Dense, anchor: 'top-left', width: 200, height: 120 });
    await stable();
    const el = hostOf('#hc-dense');
    expect(classes(el)).toEqual(['app-compact', 'app-dense', 'ndd-panel-float__content']);
    expect(el.parentElement!.classList.contains('ndd-panel-float__body')).toBe(true);
    expect(api!.move('w', { to: 'docked', position: 'right' }).ok).toBe(true);
    await stable();
    expect(hostOf('#hc-dense')).toBe(el);
    expect(classes(el)).toEqual(['app-compact', 'app-dense', 'ndd-panel-float__content']);
  });
});

describe('HC3: a component with no host class', () => {
  it('is unchanged: only the library class', async () => {
    const ws = await desktop({ bare: { component: Bare }, map: { component: Owner } });
    ws.openPanel('b', 'bare');
    ws.openPanel('map', 'map');
    await stable();
    expect(hostOf('#hc-bare').className).toBe('ndd-panel-content');
    api!.open('w', { title: 'W', component: Bare, anchor: 'top-left', width: 200, height: 120 });
    await stable();
    expect(document.querySelectorAll('#hc-bare')).toHaveLength(2);
    expect(hostOf('.ndd-panel-float__body #hc-bare').className).toBe('ndd-panel-float__content');
  });
});
