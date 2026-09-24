# Architecture decision records

| # | Decision |
|---|---|
| [0001](0001-angular-native-rewrite.md) | An Angular-native rewrite, not a transliteration |
| [0002](0002-zero-unmount-via-host-element.md) | Zero unmount via a library-owned host element (M0) |
| [0003](0003-prefix-ndd.md) | The `ndd-` prefix |
| [0004](0004-angular-22-only.md) | Angular 22 only; toolchain pins |
| [0005](0005-no-cdk-no-aria.md) | No dependency on `@angular/cdk` or `@angular/aria` |
| [0006](0006-zoneless-first.md) | Zoneless-first; zone.js supported and tested |
| [0007](0007-styling-agnostic.md) | Agnostic about styling frameworks and component libraries |
| [0008](0008-layout-json-compatibility.md) | Layout JSON is byte-compatible with rdd and vdd |
| [0009](0009-tests-as-specification.md) | vdd's tests are the specification; gate integrity |
| [0010](0010-no-version-control.md) | No git: zip backups and hash manifests |
| [0011](0011-token-only-unscoped-selectors.md) | Unscoped selectors may declare only `--ndd-*` tokens |
| [0012](0012-demo-scope.md) | Demo: vdd's capabilities, no framework wrappers |
| [0013](0013-actions-are-untracked.md) | Every action is untracked; an unchanged write publishes nothing |
