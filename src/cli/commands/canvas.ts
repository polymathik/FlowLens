import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { printHeader, printError, printSuccess } from '../output.js';
import type { FlowLensConfig } from '../../contracts/config.js';

export const canvasCommand = new Command('canvas')
  .description('Open the visual dependency graph canvas in the browser')
  .option('--port <port>', 'Dev server port', '5173')
  .option('--api-port <port>', 'API server port', '3001')
  .option('--no-open', 'Don\'t auto-open browser')
  .option('--watch', 'Re-index on file changes and push updates to the canvas')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(1);
    }

    try {
      printHeader('FlowLens Canvas');

      // Start graph API server
      const { startGraphServer } = await import('../../canvas/api/graph-server.js');
      const apiServer = await startGraphServer(flowlensDir, parseInt(opts.apiPort));
      printSuccess(`Graph API server running on port ${opts.apiPort}`);

      // Optional watch mode: re-index on change, broadcast SSE events.
      let stopWatch: (() => Promise<void>) | null = null;
      if (opts.watch) {
        const { LevelGraphStore } = await import('../../graph/levelgraph-store.js');
        const { ChokidarFileWatcher } = await import('../../watch/file-watcher.js');
        const { applyWatchEvents } = await import('../../watch/incremental-updater.js');
        const config: FlowLensConfig = JSON.parse(
          await readFile(join(flowlensDir, 'config.json'), 'utf-8'),
        );
        const watchGraph = new LevelGraphStore();
        await watchGraph.open(join(flowlensDir, 'graph'));
        const watcher = new ChokidarFileWatcher();
        watcher.onChanges(async (events) => {
          const result = await applyWatchEvents(events, { rootDir, graph: watchGraph });
          apiServer.broadcast('graph-updated', {
            filesReparsed: result.filesReparsed,
            filesDeleted: result.filesDeleted,
            durationMs: result.durationMs,
          });
        });
        watcher.start(rootDir, { debounceMs: 300, ignore: config.exclude });
        stopWatch = async () => {
          await watcher.stop();
          await watchGraph.close();
        };
        printSuccess('Watch mode: file changes will push SSE updates to the canvas');
      }

      // Start Vite dev server
      const { createServer } = await import('vite');
      const vite = await createServer({
        root: join(rootDir, 'src/canvas'),
        server: {
          port: parseInt(opts.port),
          open: opts.open !== false,
          proxy: {
            '/flowlens-api': {
              target: `http://localhost:${opts.apiPort}`,
              changeOrigin: true,
            },
          },
        },
      });
      await vite.listen();
      printSuccess(`Canvas running at http://localhost:${opts.port}`);

      // Handle shutdown
      const cleanup = async () => {
        if (stopWatch) await stopWatch();
        await vite.close();
        apiServer.close();
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    } catch (err) {
      printError(`Canvas failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
