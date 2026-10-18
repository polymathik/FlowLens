#!/usr/bin/env node
/**
 * Canvas + explorer E2E runner (Playwright + Chromium, no test framework).
 *
 *   node test/canvas/e2e/run.mjs [--dev] [--headed] [--only <name>] [--shots <dir>]
 *
 * Starts test/canvas/e2e/serve.ts (two indexed fixture projects + a missing
 * one in a temp FLOWLENS_HOME, the daemon with the explorer, a watch lease
 * on project A). Default: the daemon serves the BUILT bundle (run
 * `npm run build:canvas` first); `--dev` puts the Vite dev host in front.
 * Every scenario (scenarios.mjs + explorer-scenarios.mjs) runs in a fresh
 * browser context; prints pass/fail per scenario, exits non-zero on failure.
 *
 * Playwright is resolved from the project first, then from
 * $PLAYWRIGHT_MODULE or /opt/npm-tools/node_modules/playwright. Chromium:
 * $PLAYWRIGHT_CHROMIUM_EXECUTABLE, else /opt/pw-browsers/chromium when it
 * exists, else Playwright's own download (run `npx playwright install chromium`).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scenarios as canvasScenarios } from './scenarios.mjs';
import { explorerScenarios } from './explorer-scenarios.mjs';
import { mapScenarios } from './map-scenarios.mjs';
import { zoneScenarios } from './zone-scenarios.mjs';
import { communityScenarios } from './community-scenarios.mjs';
import { timelineScenarios } from './timeline-scenarios.mjs';
import { configureExplorer } from './canvas-page.mjs';

const scenarios = [...canvasScenarios, ...explorerScenarios, ...mapScenarios, ...zoneScenarios, ...communityScenarios, ...timelineScenarios];

const ROOT = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const fallback = process.env.PLAYWRIGHT_MODULE ?? '/opt/npm-tools/node_modules/playwright';
    return createRequire(import.meta.url)(fallback);
  }
}

function startServer(workDir, dev) {
  return new Promise((resolveStart, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'test/canvas/e2e/serve.ts', workDir, ...(dev ? ['--dev'] : [])], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 120_000);
    const onData = (buf) => {
      out += buf.toString();
      const line = out.split('\n').find((l) => l.startsWith('READY '));
      if (line) {
        clearTimeout(timer);
        resolveStart({ child, info: JSON.parse(line.slice(6)) });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (b) => (out += b.toString()));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited (${code}):\n${out}`));
    });
  });
}

const workDir = await mkdtemp(join(tmpdir(), 'flowlens-canvas-e2e-'));
const shots = opt('--shots');
if (shots) await mkdir(shots, { recursive: true });

let server;
let browser;
let failed = 0;
try {
  server = await startServer(workDir, flag('--dev'));
  const { info } = server;
  configureExplorer({ projectId: info.projects.a.id, daemon: info.daemon, token: info.token });
  const api = `${info.daemon}/api/projects/${encodeURIComponent(info.projects.a.id)}/canvas`;
  console.log(`explorer E2E (${info.mode}) at ${info.base}`);
  const { chromium } = await loadPlaywright();
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  browser = await chromium.launch({ headless: !flag('--headed'), executablePath });
  const only = opt('--only');

  for (const scenario of scenarios) {
    if (only && !scenario.name.includes(only)) continue;
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, ...(scenario.contextOptions ?? {}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const t0 = Date.now();
    try {
      await scenario.run({ page, context, base: info.base, api, hasGit: info.hasGit, projects: info.projects, shots });
      if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
      console.log(`  ok   ${scenario.name} (${Date.now() - t0} ms)`);
    } catch (err) {
      failed++;
      console.log(`  FAIL ${scenario.name}: ${err?.stack ?? err}`);
      if (shots) await page.screenshot({ path: join(shots, `FAIL-${scenario.name.replace(/\W+/g, '-')}.png`) }).catch(() => {});
    } finally {
      await context.close();
    }
  }
} catch (err) {
  failed++;
  console.error(err?.stack ?? err);
} finally {
  await browser?.close().catch(() => {});
  server?.child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  await rm(workDir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} scenario(s) failed` : '\nall canvas E2E scenarios passed');
process.exit(failed ? 1 : 0);
