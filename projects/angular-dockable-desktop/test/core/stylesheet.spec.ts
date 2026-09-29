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

// ── Branding (1.1.0) ────────────────────────────────────────────────────────
// Ported from react-dockable-desktop 7.2.0 `StylesheetContract.test.ts`, "branding contract"
// (5 tests, names kept, `rdd-` → `ndd-`). A consumer sets --ndd-brand-accent /
// --ndd-brand-on-accent on :root and every built-in skin follows. Two things make that work, and
// both are easy to undo by accident: the library only ever *reads* the brand variables (a
// declaration here would override the consumer's :root value on the element that carries
// data-ndd-skin), and each skin's accent colour appears exactly once, in its --ndd-accent-color
// declaration. The rendered result is gated in real Chrome by scripts/gates/browser/m16.mjs.

describe('branding contract (styles.css)', () => {
  /** Every skin accent, plus the active-state colours slate, tokyo and obsidian used before 1.1.0. */
  const ACCENT_FAMILY = ['#38bdf8', '#0066cc', '#8ab4f8', '#1a73e8', '#0078d4', '#88c0d0', '#5e81ac', '#bb9af7', '#9854f1']
    .map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)))
    .concat([[96, 165, 250], [122, 162, 247], [56, 90, 246], [167, 139, 250]]);

  it('every --ndd-accent-color declaration reads --ndd-brand-accent first', () => {
    const decls = [...rules.matchAll(/--ndd-accent-color\s*:\s*([^;]+);/g)].map(m => m[1]!.trim());
    expect(decls.length).toBeGreaterThanOrEqual(14); // :root, the light scheme, and 6 skins × 2
    expect(decls.filter(v => !/^var\(--ndd-brand-accent,\s*#[0-9a-f]{6}\)$/i.test(v))).toEqual([]);
  });

  it('never declares a --ndd-brand-* variable (the consumer does)', () => {
    expect(rules.match(/--ndd-brand-[\w-]+\s*:/g) ?? []).toEqual([]);
  });

  it('no accent colour is written as a literal outside its --ndd-accent-color declaration', () => {
    const literals: string[] = [];
    for (const m of rules.matchAll(/#[0-9a-fA-F]{6}\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)[^)]*\)/g)) {
      const rgb = m[0].startsWith('#') ? [1, 3, 5].map(i => parseInt(m[0].slice(i, i + 2), 16)) : [m[1], m[2], m[3]].map(Number);
      if (!ACCENT_FAMILY.some(a => a.every((v, i) => v === rgb[i]))) continue;
      const before = rules.slice(Math.max(0, m.index - 60), m.index);
      // A var() fallback — the skin's own colour inside var(--ndd-brand-accent, …), or a fallback
      // of a variable that is always defined — is the one place a literal belongs.
      if (/var\(--ndd-[\w-]+,\s*$/.test(before)) continue;
      literals.push(`${m[0]} after …${before.slice(-40).replace(/\s+/g, ' ')}`);
    }
    expect(literals).toEqual([]);
  });

  it('only :root declares --ndd-font-family; a skin sets --ndd-skin-font-family instead', () => {
    // A skin-level --ndd-font-family would override the consumer's :root font on the workspace.
    const declaring = [...rules.matchAll(/([^{}]+)\{[^{}]*--ndd-font-family\s*:/g)].map(m => m[1]!.trim());
    expect(declaring).toEqual([':root']);
    expect(rules).toMatch(/--ndd-font-family:\s*var\(--ndd-skin-font-family,/);
  });

  it('text on a solid accent fill reads --ndd-brand-on-accent', () => {
    for (const sel of ['.ndd-btn-primary', '[data-color-scheme="light"] .ndd-btn-primary', '.ndd-dock-target-box--active']) {
      const body = rules.match(new RegExp(`(^|\\})\\s*${sel.replace(/[.\-[\]"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[2] ?? '';
      expect(body, sel).toMatch(/(^|[;\s])color:\s*var\(--ndd-brand-on-accent,/);
    }
  });
});
