/**
 * M17 browser gate — brand surfaces and corner scale (1.2.0), in real Chrome. The port of
 * react-dockable-desktop 7.3.0's `radius.browser.ts` and the brand-surface cases of its
 * `branding.browser.ts`, on the 14 branding scenes M16 uses (scripts/gates/lib/branding-scenes.mjs).
 *
 *   corners    the four computed corner radii of every ndd- element and its ::before/::after match
 *              the 1.1.0 baseline with --ndd-radius-scale unset; at 0 every scaled corner is 0px, at
 *              1.5 every one is 1.5× its baseline; circles and pills (50%, 999px) never change
 *   surfaces   with --ndd-brand-surface / --ndd-brand-text set (navy dark, warm grey light), no
 *              colour of any skin's own surface palette remains — rendered, hovered or as a token —
 *              the workspace, panel and tab bar are three distinct colours, and text on the panel
 *              meets 4.5:1 (muted text 3:1)
 *   one input  only one of the two set leaves the scene exactly as M16's 1.0.0 baseline allows
 *
 * With nothing set, colours are M16's job: its baseline gate still has to pass unchanged. The
 * zoneless run covers all 14 scenes; the zone.js run (the stylesheet does not depend on the
 * scheduler) covers one.
 *
 *   node scripts/gates/browser/m17.mjs                     the gate
 *   node scripts/gates/browser/m17.mjs --write-baseline    capture the corner fixture — only from
 *        a stylesheet known to be right; every scene is captured twice and the two must agree
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runBrowserGate } from '../lib/browser.mjs';
import { ROOT, STYLES } from '../lib/config.mjs';
import { SKINS, FROSTED, colours, diff, hoverSnapshots, intended, isRgb, lines, openBase, openOverlays, rgbOf, snapshot, tokens } from '../lib/branding-scenes.mjs';

const WRITE = process.argv.includes('--write-baseline');
const FIXTURE = join(ROOT, 'scripts/gates/browser/fixtures/m17-radius-baseline.json');
const COLOUR_FIXTURE = join(ROOT, 'scripts/gates/browser/fixtures/m16-branding-baseline.json');
const ONLY = process.env['NDD_M17_ONLY']; // development: `skin/cs` to run one scene; never set at a gate
const SCENES = SKINS.flatMap(skin => ['dark', 'light'].map(cs => ({ skin, cs }))).filter(s => !ONLY || `${s.skin}/${s.cs}` === ONLY);
const BRAND = { dark: { bs: '0b1f3a', bt: 'e8eef7' }, light: { bs: 'f4f1ec', bt: '2b2620' } };
const CORNERS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
/** Every piece of chrome a scene must show, so no check can pass on a scene missing one. */
const SCENE_PARTS = ['.ndd-sidebar-tab-btn.ndd-active', '.ndd-toolbar-group-flyout', '.ndd-side-panel', '.ndd-modal-overlay',
  '.ndd-btn-primary', '.ndd-toast', '.ndd-context-menu', '.ndd-floating-window', '.ndd-panel-toolbar', '.ndd-taskbar-glassmorphic-item'];

const css = readFileSync(STYLES, 'utf8');
const declaredTokens = [...new Set(css.replace(/\/\*[\s\S]*?\*\//g, '').match(/--ndd-[a-z0-9-]+(?=\s*:)/g) ?? [])];
/**
 * Every skin colour a brand surface replaces: the fallbacks written inside var(--ndd--b-…, <colour>).
 * Pure white and black are left out — they are also the neutral tints and shades every skin keeps.
 */
const PALETTE = [...css.matchAll(/var\(--ndd--b-[\w-]+, (#[0-9a-fA-F]{6}|rgb\((\d+) (\d+) (\d+)\))\)/g)]
  .map(m => (m[1].startsWith('#') ? rgbOf(m[1]) : [+m[2], +m[3], +m[4]]))
  .filter(c => !c.every(v => v === 0) && !c.every(v => v === 255));

// ── corners ─────────────────────────────────────────────────────────────────

/** Every ndd- element's four corners, keyed by a DOM path; elements with no rounded corner are left out. */
const radii = page => page.evaluate(([corners, frostedSrc]) => {
  const frosted = new RegExp(frostedSrc);
  const out = {};
  const seg = el => {
    const parent = el.parentElement;
    const idx = parent ? Array.prototype.indexOf.call(parent.children, el) : 0;
    return `${el.tagName.toLowerCase()}${[...el.classList].filter(c => c.startsWith('ndd-')).map(c => '.' + c).join('')}:${idx}`;
  };
  const path = el => { const p = []; for (let e = el; e && e !== document.body; e = e.parentElement) p.unshift(seg(e)); return p.join('>'); };
  for (const el of document.querySelectorAll('[class*="ndd-"]')) {
    if (!(typeof el.className === 'string' ? el.className : el.className.baseVal)) continue;
    for (const pseudo of ['', '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo || null);
      if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
      const r = corners.map(c => cs.getPropertyValue(c));
      if (r.every(v => v === '0px')) continue;
      // A frosted container's ::before (1.3.0) takes border-radius: inherit — its corners are its element's.
      if (pseudo === '::before' && frosted.test(path(el).split('>').pop() ?? '')) continue;
      out[path(el) + pseudo] = r;
    }
  }
  return out;
}, [CORNERS, FROSTED.source]);

const round = v => v === '50%' || v === '999px';
const px = v => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : NaN);
const matches = (base, v, scale) => (round(base) || Number.isNaN(px(base)) ? v === base : Math.abs(px(v) - px(base) * scale) <= 0.01);
function cornerMismatches(base, now, scale) {
  const out = [];
  const none = ['0px', '0px', '0px', '0px'];
  for (const key of new Set([...Object.keys(base), ...Object.keys(now)])) {
    const b = base[key] ?? none, n = now[key] ?? none;
    b.forEach((v, i) => { if (!matches(v, n[i], scale)) out.push(`${key} ${CORNERS[i]}: ${v} -> ${n[i]} (scale ${scale})`); });
  }
  return out;
}

// ── colours ─────────────────────────────────────────────────────────────────

const lum = c => { const [r, g, b] = c.slice(0, 3).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** `top` composited over the opaque `under` (macOS panels are glass over the workspace). */
const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3]));

// ── the gate ────────────────────────────────────────────────────────────────

const fixture = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;
if (!WRITE && !fixture) { console.error(`M17 browser: no corner baseline at ${FIXTURE} — run with --write-baseline from the 1.1.0 stylesheet`); process.exit(1); }

await runBrowserGate(WRITE ? 'M17-baseline' : 'M17', { readyTimeout: 60000 }, async (page, { fail, open, sched, shot }) => {
  page.setDefaultTimeout(60000);
  const full = sched.name === 'zoneless';

  /** A scene with every piece of chrome open, or a named failure when one is missing. */
  const scene = async (skin, cs, extra = '') => {
    await openBase(page, open, skin, cs, extra);
    const hovers = await hoverSnapshots(page);
    await openOverlays(page);
    const absent = await page.evaluate(sels => sels.filter(s => !document.querySelector(s)), SCENE_PARTS);
    if (absent.length) throw new Error(`${skin}/${cs}${extra}: the scene is incomplete: ${absent.join(', ')}`);
    return hovers;
  };

  if (WRITE) {
    if (!full) return {};
    const scenes = {};
    for (const { skin, cs } of SCENES) {
      await scene(skin, cs); const a = await radii(page);
      await scene(skin, cs); const b = await radii(page);
      const d = cornerMismatches(a, b, 1);
      if (d.length) { fail(`${skin}/${cs}: two captures disagree (${d.length}), e.g. ${d[0]}`); continue; }
      if (Object.keys(a).length < 10) { fail(`${skin}/${cs}: only ${Object.keys(a).length} rounded elements captured`); continue; }
      scenes[`${skin}/${cs}`] = a;
      console.log(`  captured ${skin}/${cs}: ${Object.keys(a).length} rounded elements`);
    }
    if (ONLY) fail('NDD_M17_ONLY is set: a partial baseline is never written');
    else if (Object.keys(scenes).length === SCENES.length) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify({ scenes }));
      console.log(`  wrote ${FIXTURE}`);
    }
    return {};
  }

  const report = {};
  if (PALETTE.length < 100) fail(`the surface palette parsed to ${PALETTE.length} colours — the parse is wrong`);
  const colourBase = JSON.parse(readFileSync(COLOUR_FIXTURE, 'utf8'));

  for (const { skin, cs } of full ? SCENES : [{ skin: 'nord', cs: 'light' }]) {
    const base = fixture.scenes[`${skin}/${cs}`];
    // ── corners: unset, 0 and 1.5 ──
    for (const scale of [1, 0, 1.5]) {
      await scene(skin, cs, scale === 1 ? '' : `&rs=${scale}`);
      const d = cornerMismatches(base, await radii(page), scale);
      report[`corners ${skin}/${cs} @${scale}`] = d.length;
      if (d.length) fail(`corners ${skin}/${cs} at scale ${scale}: ${d.length} wrong, e.g. ${d.slice(0, 4).join(' | ')}`);
    }

    // ── surfaces ──
    const { bs, bt } = BRAND[cs];
    const hovers = await scene(skin, cs, `&bs=${bs}&bt=${bt}`);
    const snap = { ...await snapshot(page), ...await tokens(page, declaredTokens), ...hovers };
    const leftovers = [];
    for (const [key, rec] of Object.entries(snap)) {
      for (const [p, v] of Object.entries(rec)) {
        // Text on a solid accent fill is --ndd-brand-on-accent's, not a surface.
        if (/ndd-btn-primary|ndd-dock-target-box--active/.test(key) && /^(color|outline-color)$/.test(p)) continue;
        for (const c of colours(v)) if (c[3] > 0 && PALETTE.some(s => isRgb(c, s))) leftovers.push(`${key} ${p}: ${v}`);
      }
    }
    if (leftovers.length) fail(`surfaces ${skin}/${cs}: ${leftovers.length} skin colour(s) left: ${leftovers.slice(0, 5).join(' | ')}`);
    const token = n => colours(snap[`token ${n} @ws`]?.['background-color'] ?? '')[0] ?? [0, 0, 0, 0];
    const ws = token('--ndd-bg-workspace'), panel = over(token('--ndd-bg-panel'), ws), bar = over(token('--ndd-bg-tab-bar'), ws);
    const layers = [ws.slice(0, 3), panel, bar].map(c => c.map(Math.round).join(','));
    if (new Set(layers).size !== 3) fail(`surfaces ${skin}/${cs}: workspace / panel / tab bar are not distinct: ${layers.join(' | ')}`);
    const main = contrast(token('--ndd-text-primary'), panel), muted = contrast(token('--ndd-text-secondary'), panel);
    if (main < 4.5) fail(`surfaces ${skin}/${cs}: text on the panel is ${main.toFixed(2)}:1, under 4.5:1`);
    if (muted < 3) fail(`surfaces ${skin}/${cs}: muted text on the panel is ${muted.toFixed(2)}:1, under 3:1`);
    report[`surfaces ${skin}/${cs}`] = { leftovers: leftovers.length, layers, contrast: +main.toFixed(2), muted: +muted.toFixed(2) };
    if (full && (skin === 'nord' || skin === 'macos')) await shot(`surface-${skin}-${cs}`);
  }

  // ── both inputs, or neither ──
  for (const [skin, cs, only] of ONLY || !full ? [] : [['vscode', 'dark', 'bs'], ['nord', 'light', 'bt']]) {
    const hovers = await scene(skin, cs, `&${only}=${BRAND[cs][only]}`);
    const snap = { ...await snapshot(page), ...await tokens(page, colourBase.tokens), ...hovers };
    const unexpected = [...diff(colourBase.scenes[`${skin}/${cs}`], snap)].filter(([, v]) => {
      const [before, now] = v.split(' -> ');
      return now === undefined || !intended(before, now, skin, cs);
    });
    report[`only ${only} ${skin}/${cs}`] = unexpected.length;
    if (unexpected.length) fail(`only ${only} set, ${skin}/${cs}: ${unexpected.length} change(s): ${lines(new Map(unexpected)).slice(0, 4).join(' | ')}`);
  }
  return report;
});
