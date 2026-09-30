/**
 * The package README (what npm shows) is the root README's user-facing half — install, quick
 * start, features, documentation — with repository-relative links made absolute, since the
 * package carries no `docs/`. Run after editing README.md; the M15 gate fails when the two drift.
 *
 * The package also ships the CHANGELOG (1.3.0), the root one with the same link rewriting:
 * ng-packagr copies assets only from inside the library project, so the copy lives there, and the
 * M18 gate fails when it drifts. Run after editing CHANGELOG.md too.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = 'https://github.com/felipecarrillo100/angular-dockable-desktop/blob/main/';
const absolute = text => text.replace(/\]\((?!https?:|#)([^)]+)\)/g, (_, path) => `](${REPO}${path})`);

/** The package CHANGELOG: the root one, its repository-relative links made absolute. */
export function packageChangelog(root) {
  return absolute(root);
}

export function packageReadme(root) {
  const cut = root.indexOf('\n## Repository layout');
  const body = absolute(cut > 0 ? root.slice(0, cut) : root);
  return `${body.trimEnd()}\n\n## License\n\n[MIT](${REPO}LICENSE)\n`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  writeFileSync('projects/angular-dockable-desktop/README.md', packageReadme(readFileSync('README.md', 'utf8')));
  console.log('projects/angular-dockable-desktop/README.md written from README.md');
  writeFileSync('projects/angular-dockable-desktop/CHANGELOG.md', packageChangelog(readFileSync('CHANGELOG.md', 'utf8')));
  console.log('projects/angular-dockable-desktop/CHANGELOG.md written from CHANGELOG.md');
}
