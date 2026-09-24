/**
 * Drag-and-dock gestures with real pointer events, driven through an adapter so the *same*
 * script runs against ndd's playground and vdd's (the M6 differential gate). The adapter says
 * how to reach the workspace and which data-attribute prefix the library renders; everything
 * else — the gesture, the timings, the targets — is shared.
 *
 * Ported from vdd `scripts/gates/browser/m6.mjs`.
 */
export const NDD = { name: 'ndd', prefix: 'ndd', ws: 'window.__pg.ws', signals: true };
export const VDD = { name: 'vdd', prefix: 'vdd', ws: 'window.__vdd', signals: false };

const inPage = (page, a, fn, arg) => page.evaluate(([src, a, arg]) => {
  const ws = (0, eval)(a.ws);
  const state = () => (a.signals ? ws.state() : ws.state);
  return (0, eval)(`(${src})`)(ws, state, arg);
}, [fn.toString(), a, arg]);

export const TWO_LEAF = JSON.stringify({
  version: 2,
  gridRoot: {
    type: 'branch', orientation: 'horizontal', sizes: [0.5, 0.5],
    children: [
      { type: 'leaf', id: 'L', panels: [], activePanelId: null },
      { type: 'leaf', id: 'R', panels: [], activePanelId: null },
    ],
  },
  floating: [], minimized: [], panels: {},
});

/** Reset to a known two-leaf layout with a keeper in each leaf plus the panel to drag. */
export const reset = (page, a, dir) => inPage(page, a, (ws, _s, [layout, dir, flip]) => {
  ws.loadLayout(layout);
  // `flipDir` exists only for the differential gate's negative control: a planted
  // direction-mirroring bug on one side, which the diff must catch.
  ws.setDirection(flip ? (dir === 'ltr' ? 'rtl' : 'ltr') : dir);
  ws.openPanel('keepL', 'hostile');
  ws.openPanel('keepR', 'hostile');
  ws.dockPanelToGroup('keepR', 'R', 'center');
  ws.openPanel('drag', 'hostile');
  ws.dockPanelToGroup('drag', 'L', 'center');
}, [TWO_LEAF, dir, a.flipDir === true]);

export const tree = (page, a) => inPage(page, a, (_ws, state) => {
  const walk = n => (n.type === 'leaf' ? { leaf: n.id, panels: n.panels } : { branch: n.orientation, children: n.children.map(walk) });
  const s = state();
  return { tree: walk(s.gridRoot), floating: s.floating.map(w => ({ id: w.id, anchor: w.anchor ?? null })), active: s.activePanelId };
});

export const saveLayout = (page, a) => inPage(page, a, ws => ws.saveLayout());
export const run = (page, a, fn, arg) => inPage(page, a, fn, arg);

export const leafOf = (t, id) => {
  const walk = n => (n.leaf ? (n.panels.includes(id) ? n.leaf : null) : n.children.reduce((acc, c) => acc ?? walk(c), null));
  return walk(t.tree);
};

/** Drag the "drag" tab to `target` (a selector, with `%p` for the prefix) or to a point. */
export async function dragTabTo(page, a, dir, target, { to } = {}) {
  await reset(page, a, dir);
  await page.waitForTimeout(250);
  const tab = await page.locator(`[data-${a.prefix}-tab="drag"]`).boundingBox();
  if (!tab) return { error: 'no tab to drag' };
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.mouse.down();
  // Past the 5px threshold first, so the zones are rendered before aiming at one.
  await page.mouse.move(tab.x + tab.width / 2 + 30, tab.y + tab.height / 2 + 30, { steps: 4 });
  await page.waitForTimeout(120);
  if (target) {
    const box = await page.locator(target.replaceAll('%p', a.prefix)).first().boundingBox();
    if (!box) {
      await page.mouse.up();
      return { error: `target ${target} not on screen` };
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
    await page.waitForTimeout(140);
  } else if (to) {
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.waitForTimeout(120);
  }
  await page.mouse.up();
  await page.waitForTimeout(220);
  return tree(page, a);
}

/** Reorder "drag" to just after "third" within leaf L, by dragging onto the right half of its tab. */
export async function reorder(page, a, dir) {
  await reset(page, a, dir);
  await run(page, a, ws => {
    ws.openPanel('third', 'hostile');
    ws.dockPanelToGroup('third', 'L', 'center');
  });
  await page.waitForTimeout(220);
  const leafL = () => run(page, a, (_ws, state) => state().gridRoot.children.find(c => c.id === 'L')?.panels ?? []);
  const before = await leafL();
  const src = await page.locator(`[data-${a.prefix}-tab="drag"]`).boundingBox();
  const dst = await page.locator(`[data-${a.prefix}-tab="third"]`).boundingBox();
  if (!src || !dst) return { error: 'tabs not on screen', before };
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + src.width / 2 + 20, src.y + src.height / 2, { steps: 4 });
  await page.mouse.move(dst.x + dst.width * 0.8, dst.y + dst.height / 2, { steps: 8 }); // right half
  await page.waitForTimeout(140);
  await page.mouse.up();
  await page.waitForTimeout(220);
  return { before, after: await leafL() };
}

/** The canonical case list both the M6 gate and the differential gate run. */
export const CASES = [
  { name: 'centre of R', target: '[data-%p-drop-zone="center"][data-%p-leaf="R"]' },
  { name: 'bottom of R', target: '[data-%p-drop-zone="bottom"][data-%p-leaf="R"]' },
  { name: 'edge left', target: '[data-%p-edge="left"]' },
  { name: 'corner bottom-right', target: '[data-%p-corner="bottom-right"]' },
  { name: 'free float', to: { x: 620, y: 420 } },
];

/**
 * A saved layout with generated leaf ids (`group-split-<time>-<rand>`) replaced by their order
 * of appearance, so two libraries' output for the same gestures can be compared exactly.
 */
export function normalizeLayout(json) {
  const layout = JSON.parse(json);
  const map = new Map();
  const name = id => (/^group-(split|edge)-/.test(id) ? (map.has(id) || map.set(id, `generated-${map.size + 1}`), map.get(id)) : id);
  const walk = n => (n.type === 'leaf' ? { ...n, id: name(n.id) } : { ...n, children: n.children.map(walk) });
  layout.gridRoot = walk(layout.gridRoot);
  for (const p of Object.values(layout.panels)) if (p.lastLeafId) p.lastLeafId = name(p.lastLeafId);
  return layout;
}
