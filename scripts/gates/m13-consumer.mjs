/**
 * M13 consumer smoke — the packed library, installed into a fresh `ng new --ssr --zoneless` app,
 * builds, server-renders and runs.
 *
 *   pack     `npm pack` of dist/angular-dockable-desktop — exactly what a registry would serve
 *   new      a fresh strict, zoneless, SSR application from the real `ng new` schematic
 *   install  the tarball, as a consumer installs it
 *   code     the quick start: provideDockableDesktop, <ndd-desktop>, the stylesheet in angular.json
 *   build    `ng build`, which also prerenders `/` on the server — the SSR smoke
 *   serve    the SSR server answers `/` with the workspace and the panel already rendered
 *   browser  real Chrome loads it, hydrates with no console error, and the panel is on screen
 *
 * The CLI that runs `ng new` must live outside this workspace: a CLI inside it finds this
 * repository's angular.json above its own install directory and refuses (`ng new` is
 * "not available inside a workspace"). NDD_CONSUMER_CLI names its directory; it defaults to the
 * OS temp dir. The app itself is generated under artifacts/consumer/, with no git repository.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { DIST, ROOT } from './lib/config.mjs';

const failures = [];
const fail = msg => failures.push(msg);
const run = (cmd, args, cwd, label) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, NG_CLI_ANALYTICS: 'false', CI: '1' } });
  if (r.status !== 0) {
    console.error(`── ${label} failed\n${(r.stdout ?? '').slice(-2000)}\n${(r.stderr ?? '').slice(-2000)}`);
    fail(`${label} failed (exit ${r.status}${r.error ? `, ${r.error.message}` : ''})`);
    return null;
  }
  return (r.stdout ?? '') + (r.stderr ?? '');
};

const cliVersion = JSON.parse(readFileSync(join(ROOT, 'node_modules/@angular/cli/package.json'), 'utf8')).version;
const CLI_DIR = process.env.NDD_CONSUMER_CLI ?? join(tmpdir(), 'ndd-consumer-cli');
const OUT = join(ROOT, 'artifacts/consumer');
const APP = join(OUT, 'app');

// ── the CLI, outside the workspace ──
const cliBin = join(CLI_DIR, 'node_modules/@angular/cli/bin/ng.js');
const installed = existsSync(cliBin) && JSON.parse(readFileSync(join(CLI_DIR, 'node_modules/@angular/cli/package.json'), 'utf8')).version === cliVersion;
if (!installed) {
  mkdirSync(CLI_DIR, { recursive: true });
  if (!existsSync(join(CLI_DIR, 'package.json'))) writeFileSync(join(CLI_DIR, 'package.json'), '{ "name": "ndd-consumer-cli", "private": true }\n');
  run('npm', ['install', `@angular/cli@${cliVersion}`], CLI_DIR, 'install the CLI');
}

// ── pack ──
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
if (!existsSync(resolve(ROOT, DIST, 'package.json'))) fail('no library build to pack (the standing gate builds it)');
run('npm', ['pack', resolve(ROOT, DIST), '--pack-destination', OUT], ROOT, 'npm pack');
const tarball = readdirSync(OUT).find(f => f.endsWith('.tgz'));
if (!tarball) fail('npm pack produced no tarball');

// ── new + install ──
// `ng new` resolves --directory against its own cwd and refuses to leave it, and a cwd inside this
// repository is "inside a workspace" — so the app is generated next to the CLI and copied in.
const staging = join(CLI_DIR, 'consumer');
rmSync(staging, { recursive: true, force: true });
if (!failures.length) run('node', [cliBin, 'new', 'consumer', '--directory', 'consumer', '--ssr', '--zoneless', '--style', 'css', '--skip-git', '--skip-tests', '--defaults', '--ai-config', 'none', '--package-manager', 'npm'], CLI_DIR, 'ng new');
if (!failures.length) {
  cpSync(staging, APP, { recursive: true, verbatimSymlinks: true });
  rmSync(staging, { recursive: true, force: true });
}
if (!failures.length) run('npm', ['install', join(OUT, tarball)], APP, 'install the tarball');

// ── the quick start ──
if (!failures.length) {
  writeFileSync(join(APP, 'src/app/hello-panel.ts'), `import { Component } from '@angular/core';
import { injectPanel } from 'angular-dockable-desktop';

@Component({
  selector: 'app-hello-panel',
  template: \`<p class="hello">Hello from a panel ({{ panel.id }})</p>\`,
})
export class HelloPanel {
  protected readonly panel = injectPanel();
}
`);
  writeFileSync(join(APP, 'src/app/app.ts'), `import { Component, inject } from '@angular/core';
import { NddDesktop, Workspace } from 'angular-dockable-desktop';

@Component({
  selector: 'app-root',
  imports: [NddDesktop],
  template: \`<ndd-desktop class="ndd-fill-viewport" />\`,
})
export class App {
  constructor() {
    inject(Workspace).openPanel('hello-1', 'hello');
  }
}
`);
  const configPath = join(APP, 'src/app/app.config.ts');
  let config = readFileSync(configPath, 'utf8');
  config = `import { provideDockableDesktop } from 'angular-dockable-desktop';\nimport { HelloPanel } from './hello-panel';\n${config}`;
  config = config.replace(/providers:\s*\[/, "providers: [\n    provideDockableDesktop({ panels: { hello: { component: HelloPanel, defaultOptions: { title: 'Hello' } } } }),");
  if (!config.includes('provideDockableDesktop({')) fail('could not add provideDockableDesktop to the generated app.config.ts');
  writeFileSync(configPath, config);
  rmSync(join(APP, 'src/app/app.html'), { force: true });
  rmSync(join(APP, 'src/app/app.css'), { force: true });
  const ngJson = JSON.parse(readFileSync(join(APP, 'angular.json'), 'utf8'));
  const build = ngJson.projects.consumer.architect.build.options;
  build.styles = ['angular-dockable-desktop/styles.css', ...(build.styles ?? [])];
  writeFileSync(join(APP, 'angular.json'), JSON.stringify(ngJson, null, 2) + '\n');
}

// ── build (and prerender) ──
// The prerender logs a server-side render error and still exits 0, so the log is read too.
const buildLog = failures.length ? null : run('npx', ['ng', 'build'], APP, 'ng build');
if (buildLog !== null && /\bERROR\b/.test(buildLog)) fail(`the server-side render logged an error during prerender: ${buildLog.slice(buildLog.indexOf('ERROR'), buildLog.indexOf('ERROR') + 300)}`);
const server = join(APP, 'dist/consumer/server/server.mjs');
const prerendered = join(APP, 'dist/consumer/browser/index.html');
if (!failures.length) {
  if (!existsSync(server)) fail('the build produced no server bundle');
  if (existsSync(prerendered)) {
    const html = readFileSync(prerendered, 'utf8');
    if (!/class="[^"]*ndd-workspace/.test(html)) fail('the prerendered page has no rendered <ndd-desktop> workspace');
  }
}

// ── serve + browser ──
if (!failures.length) {
  const port = 4411;
  // Angular's SSR server allows no host by default (SSRF protection); the smoke serves localhost only.
  const proc = spawn('node', [server], { cwd: APP, env: { ...process.env, PORT: String(port), NG_ALLOWED_HOSTS: 'localhost' } });
  let serverErr = '';
  proc.stderr.on('data', d => (serverErr += d));
  try {
    const url = `http://localhost:${port}/`;
    let html = '';
    for (let i = 0; i < 50 && !html; i++) {
      await new Promise(r => setTimeout(r, 200));
      html = await fetch(url).then(r => (r.ok ? r.text() : ''), () => '');
    }
    if (!html) fail('the SSR server never answered /');
    else {
      if (!/class="[^"]*ndd-workspace/.test(html)) fail('the served HTML has no rendered workspace');
      if (!html.includes('data-ndd-tab="hello-1"')) fail('the served HTML has no tab for the opened panel');
    }
    const browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('.hello', { timeout: 10000 }).catch(() => fail('the panel never appeared in the browser'));
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const ws = document.querySelector('.ndd-workspace');
      return { height: ws?.getBoundingClientRect().height ?? 0, hello: document.querySelector('.hello')?.textContent ?? null, styled: getComputedStyle(document.documentElement).getPropertyValue('--ndd-styles-loaded').trim() };
    });
    if (state.height < 200) fail(`the workspace is ${state.height}px tall in the consumer app`);
    if (state.styled !== '1') fail('the consumer app did not load the library stylesheet');
    if (!state.hello?.includes('hello-1')) fail(`the panel content is ${JSON.stringify(state.hello)}`);
    for (const e of errors) fail(`browser console: ${e}`);
    await page.screenshot({ path: join(OUT, 'consumer.png') });
    await browser.close();
    if (/error/i.test(serverErr)) fail(`the SSR server logged: ${serverErr.slice(0, 400)}`);
  } finally {
    proc.kill();
  }
}

writeFileSync(join(OUT, 'consumer.json'), JSON.stringify({ passed: failures.length === 0, failures, tarball }, null, 2) + '\n');
if (failures.length) { console.error('m13-consumer: FAIL'); failures.forEach(f => console.error('  ' + f)); process.exit(1); }
console.log(`m13-consumer: ok — ${tarball} installed into a fresh ng new --ssr --zoneless app; built, prerendered, served, hydrated`);
