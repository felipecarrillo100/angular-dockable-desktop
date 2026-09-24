/**
 * Paths every gate rule reads. Each is overridable by an environment variable so that
 * `selftest.mjs` can point a rule at a scratch tree with a seeded violation and prove the
 * rule fails on it — a rule that cannot fail proves nothing.
 */
import { resolve } from 'node:path';

export const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const env = (name, fallback) => resolve(ROOT, process.env[name] ?? fallback);

export const LIB = env('NDD_GATE_LIB', 'projects/angular-dockable-desktop');
export const LIB_SRC = env('NDD_GATE_LIB_SRC', 'projects/angular-dockable-desktop/src');
export const STYLES = env('NDD_GATE_STYLES', 'projects/angular-dockable-desktop/src/styles/styles.css');
export const DIST = env('NDD_GATE_DIST', 'dist/angular-dockable-desktop');
export const API_SURFACE = env('NDD_GATE_API', 'api-surface.json');
export const VITEST_JSON = env('NDD_GATE_VITEST', 'artifacts/.vitest.json');
export const BASELINE = env('NDD_GATE_BASELINE', 'projects/angular-dockable-desktop/test/baseline-counts.json');
export const PORT_MAP = env('NDD_GATE_PORTMAP', 'projects/angular-dockable-desktop/test/port-map.json');
export const PROGRESS = env('NDD_GATE_PROGRESS', 'docs/PROGRESS.md');
export const DOC_ROOTS = (process.env['NDD_GATE_DOCS'] ?? 'README.md,docs/manual,projects/angular-dockable-desktop/README.md')
  .split(',').map(p => resolve(ROOT, p));
/** The milestone being gated, e.g. 3 for M3; set by the gate runner. */
export const MILESTONE = Number(process.env['NDD_GATE_MILESTONE'] ?? 99);
