#!/usr/bin/env python3
"""Rewrite `a.b` to `a['b']` at every TS4111 position tsc reports (noPropertyAccessFromIndexSignature)."""
import re, sys, collections
errs = collections.defaultdict(list)
for line in open(sys.argv[1]):
    m = re.match(r"(.+?)\((\d+),(\d+)\).*Property '(\w+)'", line)
    if m: errs[m[1]].append((int(m[2]), int(m[3]), m[4]))
for f, lst in errs.items():
    lines = open(f).read().split('\n')
    for ln, col, prop in sorted(lst, key=lambda x: (x[0], -x[1])):
        L = lines[ln - 1]; i = col - 1
        assert L[i:i + len(prop)] == prop, (f, ln, L)
        if L[i - 2:i] == '?.': lines[ln - 1] = L[:i - 2] + f"?.['{prop}']" + L[i + len(prop):]
        else:
            assert L[i - 1] == '.', (f, ln, L)
            lines[ln - 1] = L[:i - 1] + f"['{prop}']" + L[i + len(prop):]
    open(f, 'w').write('\n'.join(lines))
    print(f, len(lst))
