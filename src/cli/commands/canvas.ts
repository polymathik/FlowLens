/**
 * `flowlens canvas` — open the multi-project explorer.
 *
 * The FlowLens daemon (auto-started) serves the explorer UI and every
 * registered project's graph/health API on 127.0.0.1. This command
 * registers the current project (when it has `.flowlens/`), mints a
 * one-time sign-in link and opens the browser on that project's Health
 * screen (or Home). It then exits, unless:
 *
 *   --watch  keep running and let the daemon re-index this project on file
 *            changes; open explorer tabs update live over SSE
 *   --dev    contributors: serve the UI sources through Vite (HMR) on --port
 */
import { Command } from 'commander';
import { printError, printHeader, printSuccess } from '../output.js';
import { openBrowser } from '../canvas-host/open-browser.js';
import { pruneLaunchFiles, scheduleLaunchFileRemoval, writeLaunchFile } from '../canvas-host/launch-file.js';
import { AUTH_CODE_MANUAL_TTL_MS, LAUNCH_FILE_TTL_MS } from '../../contracts/canvas/explorer.js';
import { startDevHost } from '../canvas-host/dev-host.js';
import { CanvasHostError } from '../../contracts/canvas-host.js';
import type { DevHost } from '../../contracts/canvas/explorer.js';
import { prepareExplorer } from '../../service/explorer-launch.js';
import { openGraphStore } from '../../service/open-graph-store.js';
import { startWatching } from '../../service/watch-session.js';
import type { GraphStore } from '../../contracts/graph.js';

interface CanvasOptions {
  open: boolean;
  watch?: boolean;
  dev?: boolean;
  port: string;
  debounce: string;
}

export const canvasCommand = new Command('canvas')
  .description('Open the FlowLens explorer (all registered projects) in the browser')
  .option('--no-open', 'Print a sign-in URL (valid 2 min, shown in the terminal) instead of opening the browser')
  .option('--watch', 'Keep this project in sync with file changes while the command runs')
  .option('--debounce <ms>', 'Debounce for --watch (ms)', '300')
  .option('--dev', 'Contributors: serve the UI sources through Vite (source checkout only)')
  .option('--port <port>', 'Port for --dev (the explorer itself is served by the daemon)', '5173')
  .action(async (opts: CanvasOptions) => {
    let graph: GraphStore | null = null;
    let dev: DevHost | null = null;
    try {
      printHeader('FlowLens Explorer');
      const manual = opts.open === false;
      const launch = await prepareExplorer(process.cwd(), manual ? { codeTtlMs: AUTH_CODE_MANUAL_TTL_MS } : {});
      const daemonOrigin = `http://127.0.0.1:${launch.client.info.port}`;
      let url = launch.url;
      if (opts.dev) {
        dev = await startDevHost({ daemonPort: launch.client.info.port, port: parsePort(opts.port) });
        url = url.replace(daemonOrigin, dev.origin);
      }
      launch.client.destroy();

      const where = launch.project ? `project "${launch.project.name}"` : 'Home (no .flowlens/ here — run "flowlens init" to add this folder)';
      printSuccess(`Explorer at ${dev ? dev.origin : daemonOrigin} — opening ${where}`);
      if (manual) {
        // Trade-off: the printed link shows the one-time code in this terminal (and its scrollback).
        console.log(`  Sign-in link (works once, for ${AUTH_CODE_MANUAL_TTL_MS / 1000} s):\n  ${url}`);
      } else {
        // The code never reaches the browser's argv: open a 0600 launch file that redirects.
        const file = writeLaunchFile(url);
        openBrowser(file);
        if (opts.watch || dev) setTimeout(() => pruneLaunchFiles(), LAUNCH_FILE_TTL_MS + 1_000).unref();
        else scheduleLaunchFileRemoval(file);
        console.log('  If no browser opened, run "flowlens canvas --no-open" and paste the link it prints.');
      }

      if (opts.watch) {
        if (!launch.project) throw new CanvasHostError('--watch needs a project: run it in a folder with .flowlens/ (flowlens init).');
        graph = await openGraphStore(launch.project.root, { client: 'canvas' });
        await startWatching(graph, launch.project.root, {
          debounceMs: Number(opts.debounce) || 300,
          onUpdate: (u) => console.log(`  updated: ${u.filesReparsed} re-parsed, ${u.filesDeleted} removed (${u.durationMs} ms)`),
        });
        printSuccess('Watching for changes — press Ctrl+C to stop');
      }
      if (!graph && !dev) return;

      const cleanup = async () => {
        await graph?.close().catch(() => undefined);
        await dev?.close().catch(() => undefined);
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    } catch (err) {
      await graph?.close().catch(() => undefined);
      await dev?.close().catch(() => undefined);
      printError(`Explorer failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(err instanceof CanvasHostError ? 2 : 1);
    }
  });

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new CanvasHostError(`--port must be an integer between 0 and 65535 (got "${raw}")`);
  }
  return n;
}
