/**
 * Assertions against the stylesheet source.
 *
 * Ported from vue-dockable-desktop `test/core/stylesheet.test.ts` (7 tests, names preserved,
 * `vdd-` → `ndd-`), which includes rdd's `sidePanelPositioning.test.ts` (SP1). jsdom never
 * loads the stylesheet, so a computed-style test would pass no matter which class a component
 * emitted — exactly how rdd shipped four rules that matched nothing. These read the CSS text.
 * Two Angular-port additions at the end, and (1.5.1) the check that `styles.css`, generated from
 * `styles/parts/*.css` by `scripts/build-css.mjs`, was regenerated after an edit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

// ── Brand surfaces and corners (1.2.0) ──────────────────────────────────────
// Ported from react-dockable-desktop 7.3.0 `StylesheetContract.test.ts`, "corner contract" and
// "surface contract" (names kept, `rdd-` → `ndd-`). The rendered result is gated in real Chrome by
// scripts/gates/browser/m17.mjs.

describe('corner contract (styles.css)', () => {
  /** Kept as they are at every scale: circles and pills stay round, a zero is a zero. */
  const UNSCALED = /^(0|0px|50%|999px|inherit)$/;

  it('every corner length is multiplied by --ndd-radius-scale', () => {
    const bare: string[] = [];
    for (const m of rules.matchAll(/(border(?:-(?:top|bottom)-(?:left|right))?-radius)\s*:\s*([^;]+);/g)) {
      const parts = m[2]!.replace(/\s*!important\s*$/, '').match(/calc\([^()]*(?:\([^()]*\)[^()]*)*\)|var\([^)]*\)|[^\s]+/g) ?? [];
      for (const p of parts) {
        if (UNSCALED.test(p)) continue;
        if (/^calc\(.+ \* var\(--ndd-radius-scale, 1\)\)$/.test(p)) continue;
        bare.push(`${m[1]}: ${m[2]!.trim()}`);
        break;
      }
    }
    expect(bare).toEqual([]);
  });

  it('never declares --ndd-radius-scale (the consumer does)', () => {
    expect(rules.match(/--ndd-radius-scale\s*:/g) ?? []).toEqual([]);
  });
});

describe('surface contract (styles.css)', () => {
  /** Tokens that are not surfaces: status colours and shadows. */
  const NOT_SURFACES = new Set(['danger-color', 'toast-info-color', 'toast-success-color', 'toast-warning-color',
    'toast-error-color', 'window-shadow', 'window-shadow-focused', 'panel-float-shadow', 'panel-float-shadow-active',
    'tab-btn-active-shadow', 'toolbar-btn-active-shadow']);
  /** Translucent pure white or black: a neutral tint or shade, right over any surface. */
  const NEUTRAL = /^rgba\(\s*(0|255)\s*,\s*\1\s*,\s*\1\s*,\s*0?\.\d+\s*\)$/;

  it('every coloured surface declaration reads a --ndd--b-* value first', () => {
    const bare: string[] = [];
    for (const m of rules.matchAll(/--ndd-([\w-]+)\s*:\s*([^;{}]+);/g)) {
      const [tok, value] = [m[1]!, m[2]!.trim()];
      if (tok.startsWith('-') || NOT_SURFACES.has(tok) || /accent|brand|--ndd--b-/.test(value) || value.startsWith('var(')) continue;
      if (!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(value) || NEUTRAL.test(value)) continue;
      bare.push(`--ndd-${tok}: ${value}`);
    }
    expect(bare).toEqual([]);
  });

  it('no element rule paints a coloured literal, outside status colours and macOS window buttons', () => {
    // A colour an element rule writes itself is one no token, brand or skin can reach. ndd also
    // allows the unregistered-panel message, drawn in the danger red (rdd reads a token there).
    const ALLOWED = /\.ndd-confirmation-alert-(danger|info|warning|success)$|\[data-ndd-skin="macos"\] \.ndd-btn-(close|minimize|maximize)-tab$|^\.ndd-unregistered-panel$/;
    const bare: string[] = [];
    for (const m of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1]!.replace(/\s+/g, ' ').trim();
      if (sel.startsWith('@') || /^(from|to|\d+%)/.test(sel) || ALLOWED.test(sel)) continue;
      for (const d of m[2]!.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)) {
        if (d[1]!.startsWith('--')) continue; // tokens: the rule above
        const value = d[2]!.replace(/var\(--ndd-[\w-]+,\s*(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\)/g, 'V')
          .replace(/rgba\(\s*(0|255)\s*,\s*\1\s*,\s*\1\s*,[^)]*\)|#(?:fff|000)(?:fff|000)?\b/gi, 'N');
        if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(value)) bare.push(`${sel} { ${d[1]}: ${d[2]!.trim()} }`);
      }
    }
    expect(bare).toEqual([]);
  });

  it('declares the --ndd--b-* values in one :root block only, each built on --ndd--b-base', () => {
    const blocks = [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(b => /--ndd--b-[\w-]+\s*:/.test(b[2]!));
    expect(blocks.map(b => b[1]!.trim())).toEqual([':root']);
    const defs = [...blocks[0]![2]!.matchAll(/(--ndd--b-[\w-]+)\s*:\s*([^;]+);/g)];
    expect(defs.length).toBeGreaterThan(30);
    // Built on the base, so that each is valid only while both brand inputs are set.
    const base = defs.find(d => d[1] === '--ndd--b-base')?.[2] ?? '';
    expect(base).toMatch(/var\(--ndd-brand-surface\).*var\(--ndd-brand-text\)/);
    expect(defs.filter(d => d[1] !== '--ndd--b-base' && !d[2]!.includes('var(--ndd--b-base)')).map(d => d[1])).toEqual([]);
  });
});

// ── The field-report fixes (1.3.0) ──────────────────────────────────────────
// Ported from react-dockable-desktop 7.4.0 `StylesheetContract.test.ts`, "consumer content
// contract". The rendered result is gated by scripts/gates/browser/m18.mjs.

describe('consumer content contract (styles.css)', () => {
  const CONTENT_HOSTS = /\.ndd-(floating-window|side-panel|workspace-panel|panel-float|panel-toolbar)(\.[\w-]+|\[[^\]]+\])*$/;

  it('no container that hosts consumer content carries a backdrop-filter or filter itself (only its ::before)', () => {
    const offending: string[] = [];
    for (const m of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1]!.split(',').map(s => s.replace(/\s+/g, ' ').trim());
      if (!selectors.some(s => CONTENT_HOSTS.test(s))) continue;
      if (/(^|[;\s])(-webkit-)?(backdrop-)?filter\s*:\s*(?!none)/.test(m[2]!)) offending.push(selectors.join(', '));
    }
    expect(offending).toEqual([]);
  });

  it('honours prefers-reduced-motion for the library elements', () => {
    const block = rules.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}\s*\}/)?.[1] ?? '';
    expect(block).toMatch(/\[class\*="ndd-"\]/);
    expect(block).toMatch(/transition:\s*none\s*!important/);
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });
});

describe('generated stylesheet', () => {
  it('styles.css is exactly what styles/parts/*.css give (run `npm run css` after an edit)', () => {
    const run = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/build-css.mjs'), '--check'], { encoding: 'utf8' });
    expect(run.stderr.trim()).toBe('');
    expect(run.status).toBe(0);
  });
});
