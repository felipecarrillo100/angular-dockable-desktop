# 0010 — No git: zip backups and hash manifests

**Status:** Accepted (owner decision, 2026-09-24)

The port is developed without git — no `git init`, no commits. After every green milestone
gate, `npm run backup -- M<n>` writes:

- `docs/evidence/M<n>.tree.txt` — a SHA-256 of every source file, so a regression can be
  located by diffing two manifests;
- `.backups/M<n>-<stamp>.zip` — the project minus `node_modules`, `dist`, `.angular`,
  `artifacts` and `.backups`, verified with `unzip -t` immediately.

A rollback restores from the last zip and is noted in PROGRESS.md. Non-vacuity checks copy a
module aside and restore it rather than using `git stash`. The M1 gate asserts there is no
`.git` directory.
