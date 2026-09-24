/** Ported from vue-dockable-desktop `test/store/eventBus.test.ts` — driving code converted to Angular by scripts/port/convert.py, then reviewed; assertions and test names unchanged unless a comment says otherwise (ADR 0009). */
/**
 * Ported from react-dockable-desktop `EventBus.test.tsx` (9 tests), names preserved.
 *
 * rdd drove these through mounted components because its bus only existed inside a
 * provider. Here the workspace is live from creation, so the same assertions hold with no
 * component at all — which is itself the point of
 * docs/decisions/0004-store-outside-components.md.
 */
import { describe, it, expect, vi } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';

const ws = () => createWorkspace();

describe('Inter-Panel Event Bus', () => {
  it('should deliver a published event to a subscriber', () => {
    const w = ws();
    const seen: unknown[] = [];
    w.subscribe('map:zoom', (d) => seen.push(d));
    w.publish('map:zoom', { level: 12 });
    expect(seen).toEqual([{ level: 12 }]);
  });

  it('should deliver the same event to multiple independent subscribers', () => {
    const w = ws();
    const a: unknown[] = [];
    const b: unknown[] = [];
    w.subscribe('ping', (d) => a.push(d));
    w.subscribe('ping', (d) => b.push(d));
    w.publish('ping', 1);
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
  });

  it('should not deliver events to subscribers on a different event name', () => {
    const w = ws();
    const seen: unknown[] = [];
    w.subscribe('wanted', (d) => seen.push(d));
    w.publish('other', 1);
    expect(seen).toEqual([]);
  });

  it('should stop delivering after unsubscribe', () => {
    const w = ws();
    const seen: unknown[] = [];
    const off = w.subscribe('e', (d) => seen.push(d));
    w.publish('e', 1);
    off();
    w.publish('e', 2);
    expect(seen).toEqual([1]);
  });

  it('should deliver multiple publishes sequentially', () => {
    const w = ws();
    const seen: unknown[] = [];
    w.subscribe('e', (d) => seen.push(d));
    w.publish('e', 1);
    w.publish('e', 2);
    w.publish('e', 3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('should publish without throwing when there are no subscribers', () => {
    expect(() => ws().publish('nobody:listening', { a: 1 })).not.toThrow();
  });

  it('should publish and subscribe from outside any component', () => {
    // rdd's equivalent needed useWindowManagerActions + usePanelContext inside a mounted
    // tree. The workspace exists before any component here, so no mounting is involved.
    const w = ws();
    const fn = vi.fn();
    w.subscribe('svc:event', fn);
    w.publish('svc:event', { from: 'a plain module' });
    expect(fn).toHaveBeenCalledWith({ from: 'a plain module' });
  });

  it('should support subscribing before anything is published', () => {
    const w = ws();
    const fn = vi.fn();
    w.subscribe('later', fn);
    expect(fn).not.toHaveBeenCalled();
    w.publish('later', null);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should handle payload of any serialisable shape', () => {
    const w = ws();
    const seen: unknown[] = [];
    w.subscribe('p', (d) => seen.push(d));
    const payloads = [undefined, null, 0, '', false, [1, 2], { deep: { nested: true } }];
    for (const p of payloads) w.publish('p', p);
    expect(seen).toEqual(payloads);
  });

  // ── additions ─────────────────────────────────────────────────────────────

  it('lets a listener unsubscribe itself mid-dispatch without disturbing the others', () => {
    const w = ws();
    const order: string[] = [];
    const off1 = w.subscribe('e', () => {
      order.push('first');
      off1();
    });
    w.subscribe('e', () => order.push('second'));
    w.publish('e', null);
    w.publish('e', null);
    expect(order).toEqual(['first', 'second', 'second']);
  });

  it('dispose() drops every listener', () => {
    const w = ws();
    const fn = vi.fn();
    w.subscribe('e', fn);
    w.dispose();
    w.publish('e', null);
    expect(fn).not.toHaveBeenCalled();
  });
});
