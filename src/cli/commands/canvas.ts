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
  .option('--no-open', 'Print the sign-in URL instead of opening the browser')
  .option('--watch', 'Keep this project in sync with file changes while the command runs')
  .option('--debounce <ms>', 'Debounce for --watch (ms)', '300')
  .option('--dev', 'Contributors: serve the UI sources through Vite (source checkout only)')
  .option('--port <port>', 'Port for --dev (the explorer itself is served by the daemon)', '5173')
  .action(async (opts: CanvasOptions) => {
    let graph: GraphStore | null = null;
    let dev: DevHost | null = null;
    try {
      printHeader('FlowLens Explorer');
      const launch = await prepareExplorer(process.cwd());
      const daemonOrigin = `http://127.0.0.1:${launch.client.info.port}`;
      let url = launch.url;
      if (opts.dev) {
        dev = await startDevHost({ daemonPort: launch.client.info.port, port: parsePort(opts.port) });
        url = url.replace(daemonOrigin, dev.origin);
      }
      launch.client.destroy();

      const where = launch.project ? `project "${launch.project.name}"` : 'Home (no .flowlens/ here — run "flowlens init" to add this folder)';
      printSuccess(`Explorer at ${dev ? dev.origin : daemonOrigin} — opening ${where}`);
      console.log(`  Sign-in link (works once, for 60 s):\n  ${url}`);
      if (opts.open !== false) openBrowser(url);

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
