/**
 * `injectModals()` and `injectSidePanels()`.
 *
 * Ported from vue-dockable-desktop `test/composables/useOverlays.test.ts` (9 tests, names
 * preserved, `useModals` → `injectModals`, `useSidePanels` → `injectSidePanels`). These are the
 * surface an application calls, and two behaviours are their own: the async drawer open that can
 * resolve `null`, and `closeAll()` meaning different things for drawers and for the modal stack.
 *
 * ndd's `open()` returns an `NddModalRef` rather than a bare id, so where vdd compared ids,
 * these compare `ref.id`.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { provideDockableDesktop } from '../../src/lib/workspace/provide';
import { injectModals, injectSidePanels } from '../../src/lib/overlays/modals';

@Component({ selector: 'ndd-test-body', template: 'body' })
class Body {}

/** Both, from an injection context, with the workspace they read. */
function setup() {
  const ws = createWorkspace({ panels: {} });
  TestBed.configureTestingModule({ providers: [provideDockableDesktop(ws)] });
  const modals = TestBed.runInInjectionContext(() => injectModals());
  const panels = TestBed.runInInjectionContext(() => injectSidePanels());
  return { ws, modals, panels };
}

describe('injectModals', () => {
  it('reports the stack and the topmost modal, reactively', () => {
    const { modals } = setup();
    expect(modals.stack()).toEqual([]);
    expect(modals.topmost()).toBeNull();

    const first = modals.open(Body, {}, { title: 'First' });
    const second = modals.open(Body, {}, { title: 'Second' });
    expect(modals.stack().map(m => m.id)).toEqual([first.id, second.id]);
    expect(modals.topmost()?.id).toBe(second.id);
  });

  it('close() goes through the guard and the dirty check', async () => {
    const { ws, modals } = setup();
    const { id } = modals.open(Body, {}, { title: 'Guarded' });
    ws.overlays.registerCloseGuard(id, () => false);

    await modals.close(id);
    expect(modals.stack()).toHaveLength(1); // the guard refused

    await modals.close(id, { force: true });
    expect(modals.stack()).toHaveLength(0); // force skips it
  });

  it('a dirty modal with nothing able to ask stays open', async () => {
    // No `<ndd-modals>` is mounted here, so there is no renderer for the question — and
    // refusing is the only acceptable default when the alternative is discarding edits.
    const { ws, modals } = setup();
    const { id } = modals.open(Body, {}, { title: 'Dirty' });
    ws.overlays.setDirty(id, true);
    await modals.close(id);
    expect(modals.stack()).toHaveLength(1);
  });

  it('closeAll() empties the stack and leaves the drawers alone', async () => {
    const { modals, panels } = setup();
    await panels.openLeft(Body, {}, { title: 'Left' });
    modals.open(Body, {}, { title: 'A' });
    modals.open(Body, {}, { title: 'B' });

    modals.closeAll();
    expect(modals.stack()).toHaveLength(0);
    expect(panels.left()).not.toBeNull();
  });
});

describe('injectSidePanels', () => {
  it('opens each drawer and reports it', async () => {
    const { panels } = setup();
    expect(panels.left()).toBeNull();
    expect(panels.right()).toBeNull();

    const left = await panels.openLeft(Body, { a: 1 }, { title: 'Left' });
    const right = await panels.openRight(Body, {}, { title: 'Right', width: 320 });
    expect(panels.left()?.id).toBe(left);
    expect(panels.right()?.id).toBe(right);
    expect(panels.left()?.inputs).toEqual({ a: 1 });
  });

  it('opening a drawer that is already occupied resolves null when the occupant refuses', async () => {
    // A drawer is one slot, so opening is also closing — which is the whole reason these are
    // async. A synchronous return would have to ignore the guard or lie about the id.
    const { ws, panels } = setup();
    const first = await panels.openLeft(Body, {}, { title: 'First' });
    ws.overlays.registerCloseGuard(first!, () => false);

    const second = await panels.openLeft(Body, {}, { title: 'Second' });
    expect(second).toBeNull();
    expect(panels.left()?.id).toBe(first);

    // ...and succeeds once nothing objects.
    const guard = vi.fn(() => true);
    ws.overlays.registerCloseGuard(first!, guard);
    const third = await panels.openLeft(Body, {}, { title: 'Third' });
    expect(third).not.toBeNull();
    expect(guard).toHaveBeenCalled();
    expect(panels.left()?.id).toBe(third);
  });

  it('closeAll() closes both drawers and leaves the modal stack alone', async () => {
    const { modals, panels } = setup();
    await panels.openLeft(Body, {}, { title: 'Left' });
    await panels.openRight(Body, {}, { title: 'Right' });
    modals.open(Body, {}, { title: 'Modal' });

    panels.closeAll();
    expect(panels.left()).toBeNull();
    expect(panels.right()).toBeNull();
    expect(modals.stack()).toHaveLength(1);
  });

  it('close() honours a guard, and force skips it', async () => {
    const { ws, panels } = setup();
    const id = await panels.openRight(Body, {}, { title: 'Right' });
    ws.overlays.registerCloseGuard(id!, () => false);

    await panels.close(id!);
    expect(panels.right()).not.toBeNull();
    await panels.close(id!, { force: true });
    expect(panels.right()).toBeNull();
  });
});

describe('both outside a workspace', () => {
  it('throw with a message naming what is missing', () => {
    TestBed.configureTestingModule({});
    expect(() => TestBed.runInInjectionContext(() => injectModals())).toThrow(/provideDockableDesktop\(/);
    expect(() => TestBed.runInInjectionContext(() => injectSidePanels())).toThrow(/provideDockableDesktop\(/);
  });
});

describe('Drawer eviction', () => {
  it('a drawer replaced by another settles its afterClosed-style waiter with undefined', async () => {
    const { ws, panels } = setup();
    const first = await panels.openLeft(Body, {}, { title: 'First' });
    const closed = ws.overlays.whenClosed(first!);
    await panels.openLeft(Body, {}, { title: 'Second' });
    await expect(closed).resolves.toBeUndefined();
    await expect(ws.overlays.whenClosed('not-open')).resolves.toBeUndefined();
  });
});
