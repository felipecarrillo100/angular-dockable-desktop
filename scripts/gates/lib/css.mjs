/** Minimal CSS reading shared by the prefix and correspondence gates. */
export const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Class names used in selectors (not in declarations, @keyframes or at-rule preludes). */
export function selectorClasses(css) {
  const body = stripComments(css).replace(/url\([^)]*\)/g, '').replace(/"[^"]*"|'[^']*'/g, '""');
  const out = new Set();
  const stack = [];            // one entry per open block: 'rule' | 'at' | 'keyframes'
  let text = '';               // characters since the last { } or ;
  for (const ch of body) {
    if (ch === '{') {
      const prelude = text.trim();
      const inKeyframes = stack.includes('keyframes');
      if (/^@keyframes\b/.test(prelude) || /^@-\w+-keyframes\b/.test(prelude)) stack.push('keyframes');
      else if (prelude.startsWith('@')) stack.push('at');
      else {
        if (!inKeyframes) for (const m of prelude.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) out.add(m[1]);
        stack.push('rule');
      }
      text = '';
    } else if (ch === '}') { stack.pop(); text = ''; }
    else if (ch === ';') text = '';
    else text += ch;
  }
  return out;
}

/** Custom properties *declared* (`--x: …`), not merely read. */
export function declaredProperties(css) {
  const out = new Set();
  for (const m of stripComments(css).matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) out.add(m[1]);
  return out;
}

export function keyframeNames(css) {
  return new Set([...stripComments(css).matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));
}

/** Animation names referenced by `animation:` / `animation-name:` declarations. */
export function animationRefs(css) {
  const out = new Set();
  const KEYWORDS = /^(?:none|infinite|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|forwards|backwards|both|alternate|alternate-reverse|normal|reverse|running|paused|initial|inherit|unset|revert)$/;
  for (const m of stripComments(css).matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    for (const part of m[1].split(',')) {
      for (const tok of part.trim().split(/\s+/)) {
        if (/^-?[A-Za-z_][\w-]*$/.test(tok) && !KEYWORDS.test(tok) && !/^var$/.test(tok)) out.add(tok);
      }
    }
  }
  return out;
}
