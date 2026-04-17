/**
 * `flowlens watch` — standalone watch mode. Keeps `.flowlens/graph/` in
 * sync with file changes without serving MCP or canvas. Useful for:
 *   - running alongside another tool that reads the graph via fs
 *   - pre-warming the graph for downstream commands (check, export)
 *   - keeping the canvas's HTTP graph server fresh
 *
 * For graph updates alongside MCP tool calls, prefer `flowlens serve --watch`.
 */
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import { ChokidarFileWatcher } from '../../watch/file-watcher.js';
import { applyWatchEvents } from '../../watch/incremental-updater.js';
import { printHeader, printError, printSuccess } from '../output.js';
import type { FlowLensConfig } from '../../contracts/config.js';

export const watchCommand = new Command('watch')
  .description('Watch for file changes and incrementally re-index')
  .option('--debounce <ms>', 'Debounce window in milliseconds', '300')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(1);
    }

    try {
      printHeader('FlowLens Watch');

      const config: FlowLensConfig = JSON.parse(
        await readFile(join(flowlensDir, 'config.json'), 'utf-8'),
      );

      const graph = new LevelGraphStore();
      await graph.open(join(flowlensDir, 'graph'));

      const watcher = new ChokidarFileWatcher();
      watcher.onChanges(async (events) => {
        const result = await applyWatchEvents(events, { rootDir, graph });
        console.log(
          `[${new Date().toISOString()}] ${result.filesReparsed} reparsed / ${result.filesDeleted} deleted / ${result.errors.length} errors in ${result.durationMs}ms`,
        );
      });
      watcher.start(rootDir, {
        debounceMs: parseInt(opts.debounce, 10),
        ignore: config.exclude,
      });

      printSuccess(`Watching ${rootDir} (debounce ${opts.debounce}ms)`);
      printSuccess('Press Ctrl+C to stop');

      // Keep process alive
      const cleanup = async () => {
        await watcher.stop();
        await graph.close();
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
      // Prevent event loop exit
      await new Promise<void>(() => { /* forever */ });
    } catch (err) {
      printError(`Watch failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
