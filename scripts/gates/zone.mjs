/**
 * Standing gate — the playground boots under both schedulers (ADR 0006).
 *
 * Builds nothing itself: the runner has already built the library and the playground. Opens
 * the playground zoneless and with `?zone`, and requires: it becomes ready, the scheduler is
 * the one asked for, and there are no console or page errors.
 */
import { runBrowserGate } from './lib/browser.mjs';

await runBrowserGate('zone', {}, async (page, { open }) => {
  await open();
  return { ok: true };
});
