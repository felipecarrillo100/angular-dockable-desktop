/**
 * Assertions against the stylesheet source.
 *
 * Ported from vue-dockable-desktop `test/core/stylesheet.test.ts` (7 tests, names preserved,
 * `vdd-` → `ndd-`), which includes rdd's `sidePanelPositioning.test.ts` (SP1). jsdom never
 * loads the stylesheet, so a computed-style test would pass no matter which class a component
 * emitted — exactly how rdd shipped four rules that matched nothing. These read the CSS text.
 * Two Angular-port additions at the end.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(
  resolve(process.cwd(), 'projects/angular-dockable-desktop/src/styles/styles.css'),
  'utf8',
);
/** Rules only — a comment explaining why a selector was removed must not look like the selector. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string): string | null => {
  const m = rules.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`),
  );
  return m ? m[0] : null;
};

describe('SP1: .ndd-side-panel stays position: fixed', () => {
  it('does not regress to position: absolute', () => {
    const r = rule('.ndd-side-panel');
    expect(r).not.toBeNull();
    expect(r!).toMatch(/position:\s*fixed/);
    expect(r!).not.toMatch(/position:\s*absolute/);
  });
});

describe('the maximized-window rule matches the class the component renders', () => {
  it('targets .ndd-maximized, not a bare .maximized (rdd D9)', () => {
    expect(rules).toMatch(/\.ndd-floating-window\.ndd-maximized\s*\{/);
    expect(rules).not.toMatch(/\.ndd-floating-window\.maximized\s*\{/);
  });
});

describe('the library does not style the host page', () => {
  it('has no html, body or #root rules (rdd D8)', () => {
    expect(rules).not.toMatch(/(^|[},\s])html\s*[,{]/);
    expect(rules).not.toMatch(/(^|[},\s])body\s*[,{]/);
    expect(rules).not.toMatch(/#root/);
  });

  it('offers .ndd-fill-viewport as the opt-in alternative', () => {
    expect(rules).toMatch(/\.ndd-fill-viewport\s*\{/);
  });
});

describe('resize handles are not clipped away (D5)', () => {
  it('positions every handle inside its box, never at a negative inset', () => {
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'se', 'sw', 'nw']) {
      const all = [...rules.matchAll(new RegExp(`\\.ndd-resize-${dir}\\b[^{]*\\{([^}]*)\\}`, 'g'))];
      expect(all.length, `.ndd-resize-${dir} has no rule`).toBeGreaterThan(0);
      for (const decl of all) {
        expect(decl[1], `.ndd-resize-${dir} is positioned outside its box`).not.toMatch(
          /(top|bottom|left|right)\s*:\s*-\d/,
        );
      }
    }
  });
});

describe('no third-party vendor classes are hard-coded', () => {
  it("does not target a specific mapping library's own class (rdd D10)", () => {
    expect(rules).not.toMatch(/\.luciad\b/);
  });
});

describe('the styles-loaded sentinel is present', () => {
  it('declares --ndd-styles-loaded so a missing import can be detected at mount', () => {
    expect(rules).toMatch(/--ndd-styles-loaded:\s*1/);
  });
});

// ── Angular-port additions ──────────────────────────────────────────────────

describe('the port left nothing of the Vue implementation behind', () => {
  it('has no vdd- names, and no Vue or Teleport references even in comments', () => {
    expect(css).not.toMatch(/\bvdd-[a-z]/);
    expect(css).not.toMatch(/\bVue\b(?!-dockable)|Teleport|<Vdd/);
  });

  it('keeps the skin hook on the library prefix: data-ndd-skin, never data-vdd-skin', () => {
    expect(rules).toMatch(/\[data-ndd-skin="macos"\]/);
    expect(rules).not.toMatch(/data-vdd-skin|data-workspace-skin/);
  });
});
