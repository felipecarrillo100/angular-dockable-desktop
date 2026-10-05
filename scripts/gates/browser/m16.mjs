/**
 * M16 browser gate — skin branding (1.1.0), in real Chrome. The port of react-dockable-desktop
 * 7.2.0's `branding.browser.ts` and the skin-font / brand-font cases of its `fonts.browser.ts`.
 *
 * `--ndd-brand-accent` / `--ndd-brand-on-accent` set on :root must reach every built-in skin, a
 * skin's font must reach every piece of chrome, a consumer's `--ndd-font-family` must beat every
 * skin's font — and with none of them set, every skin must render exactly as 1.0.0 did.
 *
 *   baseline  the computed colours (color, backgrounds, borders, outline, box-shadow, fill,
 *             stroke) of every ndd- element and its ::before/::after, 8 hover states, and every
 *             --ndd-* token resolved inside the workspace, inside the toolbar (outside the
 *             workspace) and on <body> (where portaled chrome lives), in 14 scenes — 7 skins ×
 *             dark/light, with the chrome opened (active sidebar tab, radio, toggle, focused tab,
 *             a minimised panel, the toolbar flyout, a drawer, the confirm modal, a toast, the
 *             context menu, a floating window, a panel toolbar) — match the 1.0.0 baseline
 *             except exactly the intended fixes: a stale accent-family literal (for obsidian also
 *             its white/black) now drawn in the scene's own accent at the same alpha;
 *   brand     with `--ndd-brand-accent: #e4002b` no trace of the skin's own accent, nor of any
 *             stale literal, remains anywhere — rendered, hovered or as a token — and red is used
 *             many times;
 *   on-accent a yellow brand with `--ndd-brand-on-accent: #1a1a1a` puts #1a1a1a text on the
 *             yellow primary button, in dark and in light;
 *   fonts     each skin's font reaches every chrome root, portaled ones included (a custom skin
 *             and obsidian get the library stack); a consumer :root `--ndd-font-family`, in a
 *             stylesheet after the library's, wins in every skin.
 *
 * The zoneless run covers all 14 scenes; the zone.js run (the stylesheet does not depend on the
 * scheduler) covers one scene of each check.
 *
 *   node scripts/gates/browser/m16.mjs                     the gate
 *   node scripts/gates/browser/m16.mjs --write-baseline    regenerate the fixture — only for an
 *        intended visual change, and only from a stylesheet known to be right; every scene is
 *        captured twice and the two must agree before either is written
 *   node scripts/gates/browser/m16.mjs --control           a planted defect (nord redeclares its
 *        accent without the brand hook and sets --ndd-font-family itself); the gate must reject it
 *   NDD_BRANDING_REPORT=file                               also append every difference found,
 *        intended ones included, to `file`
 *
 * Chrome reports BlinkMacSystemFont as "system-ui", and color-mix() results as color(srgb …);
 * colours are compared parsed, to ±1/255.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runBrowserGate } from '../lib/browser.mjs';
import { ROOT, STYLES } from '../lib/config.mjs';
import { SKINS, STALE, accentOf, colours, diff, hoverSnapshots, intended, isRgb, lines, openBase, openOverlays, rgbOf, snapshot, tokens } from '../lib/branding-scenes.mjs';

const WRITE = process.argv.includes('--write-baseline');
const CONTROL = process.argv.includes('--control');
const REPORT = process.env['NDD_BRANDING_REPORT'];
const FIXTURE = join(ROOT, 'scripts/gates/browser/fixtures/m16-branding-baseline.json');

const ONLY = process.env['NDD_M16_ONLY']; // development: `skin/cs` to run one scene; never set at a gate
const SCENES = SKINS.flatMap(skin => ['dark', 'light'].map(cs => ({ skin, cs }))).filter(s => !ONLY || `${s.skin}/${s.cs}` === ONLY);
const RED = '#e4002b';

/** Every --ndd-* property the stylesheet declares. */
const declaredTokens = () => [...new Set(readFileSync(STYLES, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').match(/--ndd-[a-z0-9-]+(?=\s*:)/g) ?? [])];

/** A planted defect for `--control`: nord's accent without the brand hook, and a skin-level font. */
const plantControl = page => page.evaluate(() => {
  const s = document.createElement('style');
  s.textContent = '[data-ndd-skin="nord"] { --ndd-accent-color: #88c0d0; --ndd-font-family: Georgia, serif; }';
  document.head.appendChild(s);
});

async function captureScene(page, open, skin, cs, names, brand = '') {
  await openBase(page, open, skin, cs, brand);
  if (CONTROL) await plantControl(page);
  const hovers = await hoverSnapshots(page);
  await openOverlays(page);
  return { ...await snapshot(page), ...await tokens(page, names), ...hovers };
}

// ── fonts ───────────────────────────────────────────────────────────────────

/**
 * Chrome inside the workspace, beside it (toolbar, sidebar) and portaled to <body>. Not listed:
 * the few elements the stylesheet sets in `monospace` on purpose (`.ndd-btn`, the sidebar header
 * title, the drag ghost tab, the placeholders).
 */
const FONT_ROOTS = [
  '.ndd-workspace', '.ndd-workspace-tab', '.ndd-floating-window-title', '.ndd-taskbar-glassmorphic-item',
  '.ndd-toolbar-strip', '.ndd-toolbar-btn', '.ndd-sidebar-tabs-strip', '.ndd-sidebar-tab-btn',
  '.ndd-sidebar-drawer-header', '.ndd-toolbar-group-flyout', '.ndd-toolbar-group-flyout-item',
  '.ndd-context-menu', '.ndd-context-menu__item', '.ndd-side-panel', '.ndd-side-panel-title',
  '.ndd-modal-overlay', '.ndd-modal-title', '.ndd-toast-container', '.ndd-toast', '.ndd-panel-toolbar',
];
const fontsOf = page => page.evaluate(sels => Object.fromEntries(sels.map(s => {
  const el = document.querySelector(s);
  return [s, el ? getComputedStyle(el).fontFamily : 'MISSING'];
})), FONT_ROOTS);

/** The library stack (obsidian, custom skins) and each skin's own. Chrome reports BlinkMacSystemFont as "system-ui", quoted. */
const OUTFIT = /^Outfit, Inter, system-ui, -apple-system, sans-serif$/;
const SKIN_FONT = {
  vscode: /^-apple-system, "system-ui", "Segoe WPC", "Segoe UI", system-ui, Ubuntu, "Droid Sans", sans-serif$/,
  macos: /^-apple-system, "system-ui", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif$/,
  chrome: /^"Google Sans Text", "Google Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif$/,
  slate: /^"Segoe UI Variable Text", "Segoe UI", -apple-system, "system-ui", Roboto, "Helvetica Neue", sans-serif$/,
  nord: /^"Avenir Next", Nunito, "Segoe UI", system-ui, sans-serif$/,
  tokyo: /^"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace$/,
  obsidian: OUTFIT,
  'my-brand': OUTFIT,
};
const BRAND_FONT = /^"Acme Sans", Georgia, serif$/;

async function fontCheck(page, open, fail, skin, brandFont) {
  await openBase(page, open, skin, 'dark');
  if (CONTROL) await plantControl(page);
  if (brandFont) {
    // The way an application does it: its own stylesheet, after the library's.
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = ":root { --ndd-font-family: 'Acme Sans', Georgia, serif; }";
      document.head.appendChild(s);
    });
  }
  await openOverlays(page);
  const want = brandFont ? BRAND_FONT : SKIN_FONT[skin];
  const fonts = await fontsOf(page);
  const wrong = Object.entries(fonts).filter(([, f]) => !want.test(f));
  if (wrong.length) fail(`fonts ${skin}${brandFont ? ' + brand font' : ''}: ${wrong.slice(0, 6).map(([s, f]) => `${s} = ${f}`).join(' | ')}`);
}

// ── the gate ────────────────────────────────────────────────────────────────

const fixture = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;
if (!WRITE && !fixture) { console.error(`M16 browser: no baseline at ${FIXTURE} — run with --write-baseline from the 1.0.0 stylesheet`); process.exit(1); }

await runBrowserGate(CONTROL ? 'M16-control' : WRITE ? 'M16-baseline' : 'M16', { readyTimeout: 60000 }, async (page, { fail, open, sched, shot }) => {
  page.setDefaultTimeout(60000);
  const full = sched.name === 'zoneless';

  if (WRITE) {
    if (!full) return {};
    const names = declaredTokens();
    const scenes = {};
    for (const { skin, cs } of SCENES) {
      const a = await captureScene(page, open, skin, cs, names);
      const b = await captureScene(page, open, skin, cs, names);
      const d = lines(diff(a, b));
      if (d.length) { fail(`${skin}/${cs}: two captures disagree (${d.length}), e.g. ${d.slice(0, 3).join(' | ')}`); continue; }
      scenes[`${skin}/${cs}`] = a;
      console.log(`  captured ${skin}/${cs}: ${Object.keys(a).length} entries`);
    }
    if (ONLY) fail('NDD_M16_ONLY is set: a partial baseline is never written');
    else if (Object.keys(scenes).length === SCENES.length) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify({ tokens: names, scenes }));
      console.log(`  wrote ${FIXTURE}`);
    } else fail('a scene was unstable; nothing written');
    return {};
  }

  const report = {};

  // ── baseline: no brand renders as 1.0.0, except the intended fixes ──
  const baseScenes = full ? SCENES : [{ skin: 'tokyo', cs: 'dark' }];
  for (const { skin, cs } of CONTROL ? [] : baseScenes) {
    const base = fixture.scenes[`${skin}/${cs}`];
    const check = async () => diff(base, await captureScene(page, open, skin, cs, fixture.tokens));
    // A stylesheet change is deterministic; a hover or entrance caught mid-flight on a loaded
    // machine is not. A scene that differs is captured once more, and only differences both
    // captures agree on count. The transient ones are reported, never silently dropped.
    const isUnexpected = v => { const [before, now] = v.split(' -> '); return now === undefined || !intended(before, now, skin, cs); };
    let d = await check();
    // Only an unexpected difference earns a second capture: the intended fixes are in every capture.
    if ([...d.values()].some(isUnexpected)) {
      const d2 = await check();
      const transient = [...d.keys(), ...d2.keys()].filter(k => !(d.has(k) && d2.has(k)));
      if (transient.length) console.warn(`  ${skin}/${cs}: ${transient.length} transient difference(s), e.g. ${transient[0]}`);
      d = new Map([...d].filter(([k]) => d2.has(k)));
    }
    const unexpected = [...d].filter(([, v]) => isUnexpected(v));
    if (REPORT) appendFileSync(REPORT, lines(d).map(l => `${sched.name} ${skin}/${cs} ${l}`).join('\n') + '\n');
    report[`${skin}/${cs}`] = { changed: d.size, unexpected: unexpected.length };
    if (unexpected.length) fail(`baseline ${skin}/${cs}: ${unexpected.length} unintended difference(s): ${lines(new Map(unexpected)).slice(0, 8).join(' | ')}`);
  }

  // ── a red brand reaches everything ──
  const redScenes = CONTROL ? [{ skin: 'nord', cs: 'dark' }] : full ? SCENES : [{ skin: 'obsidian', cs: 'light' }];
  for (const { skin, cs } of redScenes) {
    const snap = await captureScene(page, open, skin, cs, declaredTokens(), `&ba=${RED.slice(1)}`);
    const own = accentOf(skin, cs);
    const neutral = own.every(v => v === 0) || own.every(v => v === 255); // obsidian: white/black stay as text
    const leftovers = [];
    let branded = 0;
    for (const [key, rec] of Object.entries(snap)) {
      for (const [p, v] of Object.entries(rec)) {
        for (const c of colours(v)) {
          if (c[3] === 0) continue;
          if (isRgb(c, rgbOf(RED))) branded++;
          else if (STALE.some(s => isRgb(c, s)) || (!neutral && isRgb(c, own))) leftovers.push(`${key} ${p}: ${v}`);
        }
      }
    }
    report[`brand ${skin}/${cs}`] = { branded, leftovers: leftovers.length };
    if (leftovers.length) fail(`brand ${skin}/${cs}: ${leftovers.length} trace(s) of the original accent: ${leftovers.slice(0, 6).join(' | ')}`);
    if (branded <= 40) fail(`brand ${skin}/${cs}: the brand colour is used only ${branded} times`);
    if (skin === 'tokyo' && cs === 'dark') await shot('brand-red-tokyo');
  }

  // ── on-accent, in both schemes ──
  if (!CONTROL) {
    for (const cs of ['dark', 'light']) {
      await openBase(page, open, 'vscode', cs, '&ba=facc15&bon=1a1a1a');
      await openOverlays(page);
      const btn = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('.ndd-btn-primary'));
        return { bg: s.backgroundColor, fg: s.color };
      });
      await shot(`on-accent-${cs}`);
      if (!isRgb(colours(btn.bg)[0] ?? [], [250, 204, 21])) fail(`on-accent ${cs}: the primary button is ${btn.bg}, not the yellow brand`);
      if (!isRgb(colours(btn.fg)[0] ?? [], [26, 26, 26])) fail(`on-accent ${cs}: the primary button's text is ${btn.fg}, not --ndd-brand-on-accent #1a1a1a`);
      report[`on-accent ${cs}`] = btn;
    }
  }

  // ── fonts ──
  const fontSkins = CONTROL ? ['nord'] : full ? Object.keys(SKIN_FONT) : ['tokyo'];
  for (const skin of fontSkins) await fontCheck(page, open, fail, skin, false);
  for (const skin of CONTROL ? ['nord'] : full ? SKINS : ['nord']) await fontCheck(page, open, fail, skin, true);
  return report;
});
