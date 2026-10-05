/**
 * Running one gate from inside another — the one place every sub-gate goes through.
 *
 * It does two things:
 *
 *   timing    every run is appended to `artifacts/gate-runs.jsonl` (script, args, outcome,
 *             seconds), so a slow gate can be broken down without guessing.
 *   reuse     inside one release pass (`npm run gate -- M13 M15 …`, which sets NDD_GATE_SESSION),
 *             a sub-gate that already *passed* in this pass is not run again — M13 and M15 both
 *             re-run the earlier browser gates, the consumer smoke and the round trips. A sub-gate
 *             that failed is never reused, and outside a session nothing is ever reused, so a gate
 *             run on its own still runs everything it always did.
 *
 * The reuse key is the script, its arguments and whether it is expected to fail (a control), so
 * a control and its gate are never confused.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ROOT } from './config.mjs';

// Overridable so the selftest can exercise reuse without touching the real log.
const LOG = process.env['NDD_GATE_RUNLOG'] ?? join(ROOT, 'artifacts/gate-runs.jsonl');
const SESSION = process.env['NDD_GATE_SESSION'] ?? null;

/** Passed runs already recorded in this session, by key. */
function passedInSession() {
  if (!SESSION || !existsSync(LOG)) return new Set();
  const keys = new Set();
  for (const line of readFileSync(LOG, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (r.session === SESSION && r.ok) keys.add(r.key);
    } catch { /* a torn line from an interrupted run */ }
  }
  return keys;
}

export function record(entry) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, JSON.stringify({ session: SESSION, at: new Date().toISOString(), ...entry }) + '\n');
}

/**
 * Run `node <script> <args…>` and say whether it did what was required of it: exit 0, or for a
 * control (`expectFail`) a non-zero exit. Controls are piped so their intended failure does not
 * read as one in the log.
 */
export function runSub(script, args = [], { expectFail = false, env = {}, from = 'gate' } = {}) {
  const name = relative(ROOT, join(ROOT, script));
  const key = JSON.stringify([name, args, expectFail]);
  if (passedInSession().has(key)) {
    console.log(`\n  ↺ ${name} ${args.join(' ')} — already passed in this release pass`);
    record({ key, script: name, args, expectFail, from, ok: true, reused: true, seconds: 0 });
    return true;
  }
  const t = Date.now();
  const r = spawnSync('node', [join(ROOT, script), ...args], {
    stdio: expectFail ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, ...env },
  });
  const ok = expectFail ? r.status !== 0 : r.status === 0;
  record({ key, script: name, args, expectFail, from, ok, reused: false, seconds: Math.round((Date.now() - t) / 1000) });
  return ok;
}
