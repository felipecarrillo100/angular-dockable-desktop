/**
 * Standing gate — documentation cannot reference API that does not exist.
 *
 * Every ```ts / ```typescript / ```html code block in the README and the manual is scanned
 * for `import { … } from 'angular-dockable-desktop'`; every imported name must be in
 * api-surface.json. The same for `<ndd-…>` elements used in templates: each must be the
 * selector of an exported component (checked against the built bundle's selectors).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { API_SURFACE, DIST, DOC_ROOTS, ROOT } from './lib/config.mjs';

if (!existsSync(API_SURFACE)) { console.error('docs-api: api-surface.json missing'); process.exit(1); }
const surface = JSON.parse(readFileSync(API_SURFACE, 'utf8'));
const known = new Set([...(surface.exports ?? []), ...(surface.types ?? [])]);

let selectors = new Set();
const pkgPath = join(DIST, 'package.json');
if (existsSync(pkgPath)) {
  const esm = readFileSync(join(DIST, JSON.parse(readFileSync(pkgPath, 'utf8')).module), 'utf8');
  selectors = new Set([...esm.matchAll(/selector:\s*"([^"]+)"/g)].flatMap(m => m[1].split(',').map(s => s.trim())));
}
const elementSelectors = new Set([...selectors].filter(s => /^ndd-[\w-]+$/.test(s)));

const docs = [];
const collect = p => {
  if (!existsSync(p)) return;
  if (statSync(p).isDirectory()) readdirSync(p).forEach(f => collect(join(p, f)));
  else if (p.endsWith('.md')) docs.push(p);
};
DOC_ROOTS.forEach(collect);

const failures = [];
let blocks = 0;
for (const file of docs) {
  const md = readFileSync(file, 'utf8');
  for (const m of md.matchAll(/```(ts|typescript|html|angular-html|angular-ts)\n([\s\S]*?)```/g)) {
    blocks++;
    const code = m[2];
    for (const imp of code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]angular-dockable-desktop['"]/g)) {
      for (const raw of imp[1].split(',')) {
        const name = raw.replace(/\btype\s+/, '').trim().split(/\s+as\s+/)[0].trim();
        if (name && !known.has(name)) failures.push(`${relative(ROOT, file)}: imports "${name}", which is not exported`);
      }
    }
    for (const el of code.matchAll(/<(ndd-[\w-]+)/g)) {
      if (elementSelectors.size && !elementSelectors.has(el[1])) failures.push(`${relative(ROOT, file)}: uses <${el[1]}>, which no exported component declares`);
    }
  }
}
if (failures.length) {
  console.error('docs-api: FAIL');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`docs-api: ok — ${blocks} code block(s) in ${docs.length} document(s) reference only exported API`);
