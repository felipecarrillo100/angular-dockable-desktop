/**
 * Whether a value can round-trip through `JSON.stringify`/`JSON.parse` without silently
 * losing information.
 *
 * Deliberately **not** a `JSON.stringify` try/catch: that does not throw for the failure
 * case this guards against — a function-valued property is quietly dropped, not rejected.
 * This walks the value tree instead, returning `false` as soon as it finds a function,
 * symbol, `undefined`, DOM node, or any non-plain object (a class instance, `Map`, `Set`,
 * `RegExp`, …).
 *
 * Angular's own values need no special case, and the spec asserts that reasoning so it
 * cannot silently rot:
 *   - a component or directive **class** is a function;
 *   - a **signal** (including `input()` / `model()` / `computed()`) is a function;
 *   - a `loadComponent` lazy loader is a function;
 *   - `TemplateRef`, `ElementRef`, `ComponentRef`, `Injector` are class instances.
 *
 * `Date` is an explicit exception — serialisable-enough, matching `JSON.stringify`'s own
 * behaviour — even though it comes back as an ISO string rather than a `Date`.
 *
 * This classification is a **compatibility surface**: it must agree with rdd's and vdd's, or
 * the same workspace would prune different panels in each library (ADR 0008). The one place
 * vdd needed a framework hook (`isVNode`) is covered here by the prototype check, since a DOM
 * node — the nearest Angular equivalent of a VNode leaking into data — is a class instance.
 */
export function isSerializable(value: unknown): boolean {
  if (value === null) return true;
  if (value === undefined) return false;

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  if (type === 'function' || type === 'symbol' || type === 'bigint') return false;

  // type === 'object' from here on.
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.every(isSerializable);

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false; // class instance, Map, Set, RegExp, Node, …

  return Object.values(value as Record<string, unknown>).every(isSerializable);
}
