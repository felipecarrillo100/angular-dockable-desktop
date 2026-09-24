/**
 * Ported from vue-dockable-desktop `test/core/serializable.test.ts` (12 tests; itself rdd's 8
 * plus 4 Vue-specific). The 8 rdd-derived cases keep their names; rdd's React-element case,
 * which vdd made "rejects VNodes", becomes "rejects DOM nodes" — the nearest Angular value
 * that can leak into panel data. vdd's 4 Vue-specific cases are replaced by the Angular
 * values an application could plausibly put in a panel's inputs.
 *
 * This classification is a compatibility surface: it must agree with rdd's and vdd's, or the
 * same workspace would prune different panels in each library (ADR 0008).
 */
import { Component, ElementRef, Injector, computed, signal } from '@angular/core';
import { isSerializable } from '../../src/lib/core/serializable';

class CustomClass {
  value = 1;
}

@Component({ selector: 'ndd-test-cmp', template: '' })
class TestCmp {}

describe('isSerializable', () => {
  it('accepts primitives and null', () => {
    expect(isSerializable('hello')).toBe(true);
    expect(isSerializable(42)).toBe(true);
    expect(isSerializable(true)).toBe(true);
    expect(isSerializable(null)).toBe(true);
  });

  it('rejects a bare undefined', () => {
    expect(isSerializable(undefined)).toBe(false);
  });

  it('accepts arrays and plain objects of serializable values', () => {
    expect(isSerializable([1, 'two', true, null])).toBe(true);
    expect(isSerializable({ a: 1, b: { c: 'nested' }, d: [1, 2, 3] })).toBe(true);
    expect(isSerializable(Object.create(null))).toBe(true);
  });

  it('rejects an array or object containing undefined anywhere', () => {
    expect(isSerializable([1, undefined, 3])).toBe(false);
    expect(isSerializable({ a: 1, b: { c: undefined } })).toBe(false);
  });

  it('rejects functions and symbols, anywhere in the tree', () => {
    expect(isSerializable(() => {})).toBe(false);
    expect(isSerializable(Symbol('s'))).toBe(false);
    expect(isSerializable({ a: 1, nested: { deep: () => {} } })).toBe(false);
    expect(isSerializable([1, [2, [() => {}]]])).toBe(false);
  });

  it('rejects DOM nodes', () => {
    expect(isSerializable(document.createElement('div'))).toBe(false);
    expect(isSerializable({ icon: document.createElement('span') })).toBe(false);
    expect(isSerializable(document.createTextNode('x'))).toBe(false);
  });

  it('rejects class instances, Map, and Set', () => {
    expect(isSerializable(new CustomClass())).toBe(false);
    expect(isSerializable(new Map())).toBe(false);
    expect(isSerializable(new Set())).toBe(false);
    expect(isSerializable(/re/)).toBe(false);
    expect(isSerializable({ ok: 1, bad: new CustomClass() })).toBe(false);
  });

  it("treats Date as serializable-enough, matching JSON.stringify's own behavior", () => {
    expect(isSerializable(new Date())).toBe(true);
    expect(isSerializable({ when: new Date() })).toBe(true);
  });

  // ── Angular-specific ──────────────────────────────────────────────────────
  // None of these needs a special case in isSerializable; each is asserted so the reasoning in
  // its doc comment cannot silently rot.

  it('rejects an Angular component class passed as an input', () => {
    expect(isSerializable(TestCmp)).toBe(false);
    expect(isSerializable({ renderer: TestCmp })).toBe(false);
  });

  it('rejects a lazy loadComponent loader, which is a function', () => {
    expect(isSerializable(() => Promise.resolve(TestCmp))).toBe(false);
    expect(isSerializable({ loadComponent: () => Promise.resolve(TestCmp) })).toBe(false);
  });

  it('rejects signals, including computed ones — pass the value, not the signal', () => {
    const s = signal({ a: 1 });
    expect(isSerializable(s)).toBe(false);
    expect(isSerializable(computed(() => s().a))).toBe(false);
    expect(isSerializable({ value: s })).toBe(false);
    expect(isSerializable(s())).toBe(true);
  });

  it('rejects framework handles: ElementRef and Injector', () => {
    expect(isSerializable(new ElementRef(document.createElement('div')))).toBe(false);
    expect(isSerializable(Injector.create({ providers: [] }))).toBe(false);
  });
});
