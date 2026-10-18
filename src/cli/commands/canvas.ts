/**
 * `flowlens canvas` — serve the visual canvas + graph API on one local port.
 *
 * Default: serves the pre-built bundle shipped in the package
 * (`dist/canvas/app`), located via `import.meta.url`, so it works from a
 * global install, `npx`, or a tarball install in any project directory.
 * `--dev` (source checkout only) mounts Vite middleware for HMR.
 */
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { printHeader, printError, printSuccess, printWarning } from '../output.js';
import { startCanvasHost } from '../canvas-host/static-host.js';
import { openBrowser } from '../canvas-host/open-browser.js';
import { CanvasHostError } from '../../contracts/canvas-host.js';

export const canvasCommand = new Command('canvas')
  .description('Open the visual dependency graph canvas in the browser')
  .option('--port <port>', 'Port for the canvas (UI + API on one port)', '5173')
  .option('--host <host>', 'Interface to bind (default: local only)', '127.0.0.1')
  .option('--api-port <port>', 'Internal graph API port (default: auto)')
  .option('--no-open', "Don't auto-open browser")
  .option('--dev', 'Contributors: serve canvas sources through Vite (source checkout only)')
  .option('--watch', 'Re-index on file changes and push updates to the canvas')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(1);
    }

    const port = parsePort(opts.port, '--port');
    const apiPort = opts.apiPort !== undefined ? parsePort(opts.apiPort, '--api-port') : undefined;

    try {
      printHeader('FlowLens Canvas');
      const host = await startCanvasHost({
        flowlensDir,
        port,
        host: opts.host,
        apiPort,
        mode: opts.dev ? 'dev' : 'static',
      });
      printSuccess(`Canvas running at ${host.url}${host.mode === 'dev' ? ' (Vite dev mode)' : ''}`);

      if (opts.watch) {
        // The graph API server holds the LevelDB lock; a second writer in this
        // process would crash (audit §4.3 P0). Live updates arrive with the
        // graph service (Phase 9), which owns the DB and broadcasts changes.
        printWarning(
          '--watch is not available in canvas yet (graph DB is single-writer); ' +
            'reload the page after "flowlens index" instead.',
        );
      }

      if (opts.open !== false) openBrowser(host.url);

      const cleanup = async () => {
        await host.close();
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(`Canvas failed: ${msg}`);
      process.exit(err instanceof CanvasHostError ? 2 : 1);
    }
  });

function parsePort(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    printError(`${flag} must be an integer between 0 and 65535 (got "${raw}")`);
    process.exit(2);
  }
  return n;
}
