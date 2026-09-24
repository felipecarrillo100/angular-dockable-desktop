/**
 * Milestone backup, in place of version control (plan B5).
 *
 *   node scripts/backup.mjs M<n>
 *
 * Writes docs/evidence/M<n>.tree.txt (SHA-256 of every source file) and
 * .backups/M<n>-<yyyymmdd-hhmm>.zip, then verifies the zip with `unzip -t`.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const milestone = process.argv[2];
if (!/^M\d+[a-z]?$/.test(milestone ?? '')) { console.error('usage: node scripts/backup.mjs M<n>'); process.exit(2); }

const EXCLUDE = new Set(['node_modules', 'dist', '.angular', 'artifacts', '.backups', '.DS_Store', 'out-tsc', 'coverage']);
const files = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else files.push(p);
  }
};
walk(ROOT);
files.sort();

mkdirSync(join(ROOT, 'docs/evidence'), { recursive: true });
const manifest = files
  .filter(f => !relative(ROOT, f).startsWith(`docs/evidence/${milestone}.tree.txt`))
  .map(f => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(ROOT, f)}`)
  .join('\n') + '\n';
writeFileSync(join(ROOT, `docs/evidence/${milestone}.tree.txt`), manifest);

const d = new Date(), pad = n => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
mkdirSync(join(ROOT, '.backups'), { recursive: true });
const zip = join(ROOT, '.backups', `${milestone}-${stamp}.zip`);
const args = ['-r', '-q', zip, '.', ...[...EXCLUDE].flatMap(e => ['-x', `${e}/*`, '-x', `*/${e}/*`, '-x', e, '-x', `*/${e}`])];
execFileSync('zip', args, { cwd: ROOT, stdio: 'inherit' });
execFileSync('unzip', ['-t', '-q', zip], { stdio: 'inherit' });
console.log(`backup ${relative(ROOT, zip)} (${(statSync(zip).size / 1024).toFixed(0)} KB, ${files.length} files) verified`);
