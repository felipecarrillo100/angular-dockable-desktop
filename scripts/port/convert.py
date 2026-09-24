#!/usr/bin/env python3
"""
Mechanical part of porting a vdd test file to an ndd spec (ADR 0009).

Only *driving code* is rewritten; assertions are left alone. What it does:
  - vue component stubs  -> Angular @Component stubs
  - w.state.X            -> w.state().X          (reactive proxy -> signal read)
  - openPanel(..., { props: ... })  -> inputs: (the Angular spelling; JSON keeps `props`)
  - import paths         -> ndd layout (src/lib/..., kebab-case)
  - import.meta.dirname  -> process.cwd()-relative paths
Anything Vue-specific that remains is left for a human port and reported.
"""
import re, sys

PATHS = {
  "'../../src/core/workspace'": "'../../src/lib/workspace/workspace'",
  "'../../src/core/layoutTree'": "'../../src/lib/core/layout-tree'",
  "'../../src/core/registry'": "'../../src/lib/core/registry'",
  "'../../src/core/serialize'": "'../../src/lib/core/serialize'",
  "'../../src/core/eventBus'": "'../../src/lib/core/event-bus'",
  "'../../src/types'": "'../../src/lib/core/types'",
}

def convert(src, header):
    s = src
    for a, b in PATHS.items():
        s = s.replace(a, b)
    # vue imports -> Angular Component
    s = re.sub(r"import \{[^}]*\} from 'vue'\n", "", s)
    s = re.sub(r"import type \{[^}]*\} from 'vue'\n", "", s)
    # const X = defineComponent({ name: 'Y', setup: ... })   -> @Component stub
    def stub(m):
        var, name = m.group(1), m.group(2) or m.group(1)
        sel = 'ndd-test-' + re.sub(r'(?<!^)(?=[A-Z])', '-', name).lower()
        return f"@Component({{ selector: '{sel}', template: '' }})\nclass {var} {{}}"
    s = re.sub(r"const (\w+) = defineComponent\(\{\s*name:\s*'(\w+)',[^\n]*\}\)", stub, s)
    if '@Component(' in s and "from '@angular/core'" not in s:
        s = s.replace("import ", "import { Component } from '@angular/core';\nimport ", 1)
    # state reads
    # Only a workspace variable's `.state` (an identifier right before it) is the store; a
    # `panels[id]!.state` / `p.state` after `]`, `!`, `)` or `.` is PanelInfo's own field.
    s = re.sub(r"(?<![.\]!)\w])(\b[A-Za-z_]\w*)\.state\.(?=[A-Za-z_])", r"\1.state().", s)
    s = re.sub(r"(?<![.\]!)\w])(\b[A-Za-z_]\w*)\.state\)", r"\1.state())", s)  # expect(w.state).toMatchObject
    # `typeof w.state().x` is not a type: use the signal's return type instead
    s = re.sub(r"typeof (\w+)\.state\(\)\.(\w+)", r"ReturnType<typeof \1.state>['\2']", s)
    # openPanel options: props -> inputs
    s = re.sub(r"(openPanel\([^;\n]*?\{[^;\n]*?)\bprops:", r"\1inputs:", s)
    s = s.replace("import.meta.dirname, '../fixtures/rdd-6.2.0'", "process.cwd(), 'projects/angular-dockable-desktop/test/fixtures/rdd-6.2.0'")
    remaining = sorted(set(re.findall(r"\b(defineComponent|mount|nextTick|markRaw|reactive|toRaw|isReactive|ref\(|h\()", s)))
    return header + s, remaining

if __name__ == '__main__':
    src_path, dst_path, header = sys.argv[1], sys.argv[2], sys.argv[3]
    out, remaining = convert(open(src_path).read(), header + "\n")
    open(dst_path, 'w').write(out)
    print(f"{dst_path}: remaining Vue-isms: {remaining or 'none'}")
