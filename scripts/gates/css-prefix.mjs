/**
 * Standing gate — everything the library owns in CSS is `ndd-` prefixed (ADR 0003).
 *
 * Checks, in the shipped stylesheet: class selectors, declared custom properties, @keyframes
 * names, and the animation names declarations reference (vdd D13: an unprefixed keyframe is
 * silently replaced by any host stylesheet that defines the same name). And in the library
 * source: every class a component emits.
 *
 * Also enforces D6 — the library styles only its own DOM — by rejecting type or universal
 * selectors that reach outside it (`html`, `body`, `*`, bare element selectors) unless they
 * are scoped under an `ndd-` class or attribute.
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { LIB_SRC, ROOT, STYLES } from './lib/config.mjs';
import { animationRefs, declaredProperties, keyframeNames, stripComments } from './lib/css.mjs';
import { selectorClasses } from './lib/css.mjs';
import { emittedClasses, sourceFiles } from './lib/emitted.mjs';

const failures = [];
const rel = p => relative(ROOT, p);
const css = existsSync(STYLES) ? readFileSync(STYLES, 'utf8') : null;
if (css === null) failures.push(`${rel(STYLES)}: stylesheet missing`);
else {
  for (const c of selectorClasses(css)) if (!c.startsWith('ndd-')) failures.push(`${rel(STYLES)}: unprefixed class selector ".${c}"`);
  for (const p of declaredProperties(css)) if (!p.startsWith('--ndd-')) failures.push(`${rel(STYLES)}: unprefixed custom property "${p}"`);
  for (const k of keyframeNames(css)) if (!k.startsWith('ndd-')) failures.push(`${rel(STYLES)}: unprefixed @keyframes "${k}"`);
  for (const a of animationRefs(css)) if (!a.startsWith('ndd-')) failures.push(`${rel(STYLES)}: animation references unprefixed "${a}"`);

  // D6: selectors must be anchored in library DOM — unless the block declares only --ndd-*
  // tokens, which are namespaced and inert on host elements (ADR 0011).
  const body = stripComments(css);
  const stack = []; // { kind, selectors?, decls }
  let text = '';
  for (const ch of body) {
    if (ch === '{') {
      const prelude = text.trim();
      if (prelude.startsWith('@')) stack.push({ kind: /^@(-\w+-)?keyframes/.test(prelude) ? 'kf' : 'at' });
      else stack.push({ kind: 'rule', selectors: prelude.split(',').map(x => x.trim()).filter(Boolean), decls: '' });
      text = '';
    } else if (ch === '}') {
      const top = stack.pop();
      if (top?.kind === 'rule') {
        top.decls += text;
        if (!stack.some(b => b.kind === 'kf')) {
          const decls = top.decls.split(';').map(d => d.trim()).filter(Boolean);
          const tokensOnly = decls.every(d => d.startsWith('--ndd-'));
          for (const sel of top.selectors) {
            const anchored = /\.ndd-|\[data-ndd-|\[ndd-|\[class[*^|~]?=["']?ndd-|^:root$|^ndd-/.test(sel);
            if (!anchored && !tokensOnly) failures.push(`${rel(STYLES)}: selector "${sel}" is not scoped to library DOM and declares more than --ndd-* tokens (D6, ADR 0011)`);
          }
        }
      }
      text = '';
    } else if (ch === ';') {
      const top = stack.at(-1);
      if (top?.kind === 'rule') top.decls += text + ';';
      text = '';
    } else text += ch;
  }
}

const sources = existsSync(LIB_SRC) ? sourceFiles() : [];
for (const file of sources) {
  for (const cls of emittedClasses(file)) if (!cls.startsWith('ndd-')) failures.push(`${rel(file)}: emits unprefixed class "${cls}"`);
}

if (failures.length) {
  console.error('css-prefix: FAIL');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`css-prefix: ok — stylesheet and ${sources.length} source file(s) clean`);
