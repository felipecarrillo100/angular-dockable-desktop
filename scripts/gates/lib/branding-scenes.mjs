/**
 * The 14 branding scenes — 7 skins × dark/light with the chrome opened in the playground — and the
 * colour tools the branding gates share: M16 (accent and fonts) and M17 (surfaces and corners).
 */

export const SKINS = ['vscode', 'macos', 'chrome', 'slate', 'nord', 'obsidian', 'tokyo'];

// ── colours ─────────────────────────────────────────────────────────────────

/** Every colour in a computed value, as [r, g, b, a] with r/g/b in 0–255. */
export function colours(value) {
  const out = [];
  const re = /rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/g;
  for (let m; (m = re.exec(value));) {
    if (m[1]) {
      const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
      out.push([+r, +g, +b, +a]);
    } else {
      const [r, g, b, a = '1'] = m[2].split(/[\s/]+/).filter(Boolean);
      out.push([+r * 255, +g * 255, +b * 255, +a]);
    }
  }
  return out;
}
export const skeleton = value => value.replace(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g, 'C');
export const close = (c, d) => c.every((v, j) => Math.abs(v - d[j]) <= (j === 3 ? 0.005 : 1));
export function sameColours(a, b) {
  if (skeleton(a) !== skeleton(b)) return false;
  const ca = colours(a), cb = colours(b);
  return ca.length === cb.length && ca.every((c, i) => close(c, cb[i]));
}
export const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export const isRgb = (c, rgb) => rgb.every((v, i) => Math.abs(c[i] - v) <= 1);

/** Each scene's own accent in 1.1.0 (vscode light gained #0066cc, the blue its light tokens used). */
export const ACCENT = {
  vscode: ['#38bdf8', '#0066cc'], macos: ['#38bdf8', '#0066cc'], chrome: ['#8ab4f8', '#1a73e8'],
  slate: ['#38bdf8', '#0078d4'], nord: ['#88c0d0', '#5e81ac'], obsidian: ['#ffffff', '#000000'], tokyo: ['#bb9af7', '#9854f1'],
};
export const accentOf = (skin, cs) => rgbOf(ACCENT[skin][cs === 'light' ? 1 : 0]);
/**
 * The only colours 1.1.0 may change without a brand: accent-family literals a skin showed instead
 * of its own accent — the default cyan and #0066cc left in other skins, the active-state blues of
 * slate and tokyo, obsidian's violet panel toolbar — and, in obsidian, its white/black glows.
 */
export const STALE = [...new Set(Object.values(ACCENT).flat())].filter(h => h !== '#ffffff' && h !== '#000000').map(rgbOf)
  .concat([[96, 165, 250], [122, 162, 247], [56, 90, 246], [167, 139, 250]]);
export const staleIn = skin => (skin === 'obsidian' ? STALE.concat([[255, 255, 255], [0, 0, 0]]) : STALE);

/** True when `now` differs from `before` only by stale literals turned into the scene's accent at the same alpha. */
export function intended(before, now, skin, cs) {
  if (skeleton(before) !== skeleton(now)) return false;
  const cb = colours(before), cn = colours(now), acc = accentOf(skin, cs), stale = staleIn(skin);
  return cb.length === cn.length && cb.every((c, i) =>
    close(c, cn[i]) || (stale.some(s => isRgb(c, s)) && isRgb(cn[i], acc) && Math.abs(c[3] - cn[i][3]) <= 0.005));
}

// ── the scene ───────────────────────────────────────────────────────────────

export const PROPS = ['color', 'background-color', 'background-image', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'outline-color', 'box-shadow', 'fill', 'stroke'];

/** Opens a scene with the active states on: a selected sidebar tab, radio and toggle, a focused tab, a minimised panel. */
export async function openBase(page, open, skin, cs, extra = '') {
  await open(`chrome&anim=0&skin=${skin}${cs === 'light' ? '&cs=light' : ''}${extra}`);
  await page.evaluate(() => {
    const { ws } = window.__pg;
    ws.openPanel('p1', 'hostile', { title: 'Panel One' });
    ws.openPanel('p2', 'editor', { title: 'Panel Two' });
    ws.openPanel('p3', 'overlay', { title: 'Overlay' });
    ws.dockPanelToWorkspaceEdge('p3', 'right');
    ws.openPanel('p4', 'hostile', { title: 'Floating' });
    ws.floatPanel('p4', { x: 60, y: 300, width: 320, height: 200 });
    ws.openPanel('p5', 'hostile', { title: 'Minimised' });
    ws.minimizePanel('p5');
  });
  await page.waitForSelector('[data-ndd-tab="p1"]');
  await page.click('.ndd-sidebar-tab-btn[title="Files"]');
  await page.click('.ndd-toolbar-btn[aria-label="Select"]');
  await page.click('.ndd-toolbar-btn[aria-label="Snap to grid"]');
  await page.click('[data-ndd-tab="p1"]');
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
}

/** The overlays on top: the flyout, a drawer, the confirm modal (the primary button), a toast, the context menu. */
export async function openOverlays(page) {
  await page.click('.ndd-toolbar-btn-group');
  await page.evaluate(() => {
    const { ws, modals, components, toast } = window.__pg;
    ws.overlays.openLeftPanel(components.hostile, {}, { title: 'Drawer' });
    modals.open(components.confirm, { message: 'Sure?' }, { title: 'Modal' });
    toast('hello', { duration: 600000 });
    ws.showContextMenu({ x: 40, y: 40, items: [{ label: 'Item A' }, { separator: true }, { label: 'Item B', checkbox: { value: true } }, { label: 'More', items: [{ label: 'Sub' }] }] });
  });
  await page.waitForTimeout(700);
}

/** Colour-bearing computed properties of every ndd- element under `root` and its pseudo-elements, keyed by a DOM path. */
export function snapshot(page, root = 'body', tag = '') {
  return page.evaluate(([props, rootSel, prefix]) => {
    const out = {};
    const seg = el => {
      const parent = el.parentElement;
      const idx = parent ? Array.prototype.indexOf.call(parent.children, el) : 0;
      return `${el.tagName.toLowerCase()}${[...el.classList].filter(c => c.startsWith('ndd-')).map(c => '.' + c).join('')}:${idx}`;
    };
    const path = el => { const p = []; for (let e = el; e && e !== document.body; e = e.parentElement) p.unshift(seg(e)); return p.join('>'); };
    const rootEl = document.querySelector(rootSel);
    if (!rootEl) return { [`${prefix}MISSING ${rootSel}`]: {} };
    const els = [rootEl, ...rootEl.querySelectorAll('[class*="ndd-"]')].filter(e => e === rootEl || (typeof e.className === 'string' ? e.className : e.className.baseVal));
    for (const el of els) {
      const key = prefix + path(el);
      for (const pseudo of ['', '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo || null);
        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
        const rec = {};
        for (const p of props) rec[p] = cs.getPropertyValue(p);
        out[key + pseudo] = rec;
      }
    }
    return out;
  }, [PROPS, root, tag]);
}

/**
 * Every token resolved as a colour and as a shadow — inside the workspace, inside the toolbar
 * (outside the workspace: it reads what <html> carries) and on <body> (portaled chrome). Covers
 * tokens no scene renders, including ones only consumers read (--ndd-sidebar-card-*).
 */
export function tokens(page, names) {
  return page.evaluate(list => {
    const out = {};
    for (const [where, sel] of [['ws', '.ndd-workspace'], ['tb', '.ndd-toolbar-strip'], ['body', 'body']]) {
      const host = document.querySelector(sel);
      const probe = document.createElement('div');
      host.appendChild(probe);
      for (const n of list) {
        probe.style.cssText = `background-color: var(${n}); box-shadow: var(${n}); color: var(${n})`;
        const cs = getComputedStyle(probe);
        out[`token ${n} @${where}`] = { 'background-color': cs.backgroundColor, 'box-shadow': cs.boxShadow, color: cs.color };
      }
      probe.remove();
    }
    return out;
  }, names);
}

export const HOVERS = [
  '.ndd-toolbar-btn[aria-label="Pan"]',
  '.ndd-toolbar-btn-group',
  '.ndd-sidebar-tab-btn[title="Search"]',
  '[data-ndd-tab="p2"]',
  '[data-ndd-tab="p3"]',
  '.ndd-floating-window-titlebar .ndd-custom-tab-btn',
  '.ndd-taskbar-glassmorphic-item',
  '.ndd-panel-toolbar-btn',
];

export async function hoverSnapshots(page) {
  const out = {};
  for (const [i, sel] of HOVERS.entries()) {
    const loc = page.locator(sel).first();
    if (!(await loc.count())) { out[`hover ${sel} MISSING`] = {}; continue; }
    await loc.hover({ force: true });
    await page.waitForTimeout(350); // past the hover transitions
    await loc.evaluate((el, m) => el.setAttribute(m, ''), `data-m16-probe-${i}`);
    Object.assign(out, await snapshot(page, `[data-m16-probe-${i}]`, `hover ${sel} | `));
    await page.mouse.move(1, 1);
    await page.waitForTimeout(350);
  }
  return out;
}

/** `key prop` → "old -> new" for every colour that differs; keys missing on either side count too. */
/**
 * The containers whose frost (and, where it saturates, background) moved onto their own ::before
 * in 1.3.0, so a consumer's position: fixed content inside them keeps the viewport. See M18.
 */
export const FROSTED = /\.ndd-(floating-window|side-panel|panel-float|workspace-panel|panel-toolbar)(\.|:|$)/;

/**
 * A snapshot taken before 1.3.0 painted a frosted container's background on the element; from
 * 1.3.0 it is on the element's ::before. Folds that ::before back onto its element — only where
 * the baseline has no such pseudo-element — so the two compare as what is drawn, not where.
 */
export function foldFrost(snap, base) {
  const out = { ...snap };
  for (const key of Object.keys(snap)) {
    if (!key.endsWith('::before') || base[key]) continue;
    const el = key.slice(0, -'::before'.length);
    if (!FROSTED.test(el.split('>').pop() ?? '') || !out[el]) continue;
    const bg = snap[key]['background-color'];
    // A pseudo that only frosts (a plain blur leaves the background on the element) paints nothing to fold.
    if (bg && !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(bg)) {
      out[el] = { ...out[el], 'background-color': bg, 'background-image': snap[key]['background-image'] ?? out[el]['background-image'] };
    }
    delete out[key];
  }
  return out;
}

export function diff(base, now) {
  const snap = foldFrost(now, base);
  const out = new Map();
  for (const key of new Set([...Object.keys(base), ...Object.keys(snap)])) {
    if (!base[key] || !snap[key]) { out.set(key, base[key] ? 'gone' : 'new'); continue; }
    for (const p of new Set([...Object.keys(base[key]), ...Object.keys(snap[key])])) {
      if (!sameColours(base[key][p] ?? '', snap[key][p] ?? '')) out.set(`${key} ${p}`, `${base[key][p]} -> ${snap[key][p]}`);
    }
  }
  return out;
}
export const lines = d => [...d].map(([k, v]) => `${k}: ${v}`);

