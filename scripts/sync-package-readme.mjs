/**
 * The package README (what npm shows) is the root README's user-facing half — install, quick
 * start, features, documentation — with repository-relative links made absolute, since the
 * package carries no `docs/`. Run after editing README.md; the M15 gate fails when the two drift.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = 'https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/';
export function packageReadme(root) {
  const cut = root.indexOf('\n## Repository layout');
  const body = (cut > 0 ? root.slice(0, cut) : root).replace(/\]\((?!https?:|#)([^)]+)\)/g, (_, path) => `](${REPO}${path})`);
  return `${body.trimEnd()}\n\n## License\n\n[MIT](${REPO}LICENSE)\n`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  writeFileSync('projects/angular-dockable-desktop/README.md', packageReadme(readFileSync('README.md', 'utf8')));
  console.log('projects/angular-dockable-desktop/README.md written from README.md');
}
