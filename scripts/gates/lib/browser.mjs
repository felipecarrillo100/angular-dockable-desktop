/**
 * Shared browser-gate harness: real Chrome via playwright-core (no browser download), the
 * built app served statically, and a failure list every check appends to.
 *
 * Every browser gate runs its scenario under BOTH schedulers — zoneless (the default) and
 * zone.js (`?zone`) — because ADR 0006 promises both work.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { serve } from './serve.mjs';

export const SCHEDULERS = [
  { name: 'zoneless', query: '', zone: false },
  { name: 'zone', query: 'zone', zone: true },
];

/**
 * Run `scenario(page, ctx)` once per scheduler against the built `app`.
 * `ctx.fail(msg)` records a failure; console errors and page errors fail automatically.
 *
 * `handle` names the app's window handle (`__pg` for the playground, `__demo` for the demo);
 * `ignoreConsole` lists console errors a *third-party* dependency raises (a map tile that 404s
 * offline), which are not the library's and are the only ones a gate may pass over.
 */
export async function runBrowserGate(name, { app = 'playground', viewport = { width: 1280, height: 800 }, contextOptions = {}, handle = '__pg', readyTimeout = 15000, ignoreConsole = [] }, scenario) {
  const out = join(ROOT, 'artifacts', name);
  mkdirSync(out, { recursive: true });
  const server = await serve(join(ROOT, 'dist', app, 'browser'));
  // One retry of the *launch* only: Chrome once failed to start within Playwright's timeout
  // (M5, host stall). A browser that never starts is not a test result; no check is retried.
  const launch = () => chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const browser = await launch().catch(err => {
    console.warn(`browser launch failed once (${err.name}); retrying the launch`);
    return launch();
  });
  const failures = [];
  const report = {};
  try {
    for (const sched of SCHEDULERS) {
      const context = await browser.newContext({ viewport, ...contextOptions });
      const page = await context.newPage();
      const fail = msg => failures.push(`[${sched.name}] ${msg}`);
      page.on('console', m => {
        if (m.type() !== 'error') return;
        if (ignoreConsole.some(pattern => pattern.test(m.text()))) return;
        fail(`console error: ${m.text()}`);
      });
      page.on('pageerror', e => fail(`page error: ${e.message}`));
      const url = (params = '') => {
        const q = [sched.query, params].filter(Boolean).join('&');
        return `${server.url}${q ? `?${q}` : ''}`;
      };
      const open = async (params = '') => {
        await page.goto(url(params));
        await page.waitForFunction(h => (window)[h]?.ready === true, handle, { timeout: readyTimeout });
        const zone = await page.evaluate(h => (window)[h].zone, handle);
        if (zone !== sched.zone) fail(`scheduler: expected zone=${sched.zone}, page reports zone=${zone}`);
      };
      const shot = file => page.screenshot({ path: join(out, `${sched.name}-${file}.png`) });
      try {
        report[sched.name] = await scenario(page, { fail, open, url, shot, sched, context }) ?? {};
      } catch (e) {
        fail(`scenario threw: ${e.stack ?? e}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(join(out, 'browser.json'), JSON.stringify({ passed: failures.length === 0, failures, report }, null, 2));
  if (failures.length) {
    console.error(`${name} browser: FAIL`);
    failures.forEach(f => console.error('  ' + f));
    process.exit(1);
  }
  console.log(`${name} browser: ok (zoneless + zone)`);
}
