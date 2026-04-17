/**
 * flowlens serve — starts the MCP server for AI assistant integration.
 *
 * Currently supports stdio transport only. The server exposes all 12
 * FlowLens tools over the Model Context Protocol.
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import { AnnotationStore } from '../../mcp/annotation-store.js';
import { SnapshotManager } from '../../analysis/snapshot-manager.js';
import { createFlowLensServer } from '../../mcp/server.js';
import { printError } from '../output.js';
import { ChokidarFileWatcher } from '../../watch/file-watcher.js';
import { applyWatchEvents } from '../../watch/incremental-updater.js';
import { readFile } from 'node:fs/promises';
import type { FlowLensConfig } from '../../contracts/config.js';

export const serveCommand = new Command('serve')
  .description('Start the MCP server for AI assistant integration')
  .option('--transport <type>', 'Transport: stdio (default)', 'stdio')
  .option('--port <port>', 'HTTP port (default 3333, only with --transport http)', '3333')
  .option('--watch', 'Re-index on file changes while serving')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(1);
    }

    try {
      // Open graph store
      const graph = new LevelGraphStore();
      await graph.open(join(flowlensDir, 'graph'));

      // Load annotations
      const annotationStore = new AnnotationStore(join(flowlensDir, 'annotations.json'));
      await annotationStore.load();

      // Snapshot manager
      const snapshotManager = new SnapshotManager(join(flowlensDir, 'snapshots'));

      // Create MCP server with all 12 tools
      const server = createFlowLensServer({
        graph,
        annotationStore,
        snapshotManager,
        flowlensDir,
        rootDir,
        fileIndexPath: join(flowlensDir, 'file_index.json'),
      });

      // --watch: incrementally re-index on file changes while serving.
      if (opts.watch) {
        const config: FlowLensConfig = JSON.parse(
          await readFile(join(flowlensDir, 'config.json'), 'utf-8'),
        );
        const watcher = new ChokidarFileWatcher();
        watcher.onChanges(async (events) => {
          const result = await applyWatchEvents(events, { rootDir, graph });
          process.stderr.write(
            `[watch] ${result.filesReparsed} reparsed / ${result.filesDeleted} deleted / ${result.errors.length} errors in ${result.durationMs}ms\n`,
          );
        });
        watcher.start(rootDir, { debounceMs: 300, ignore: config.exclude });
        process.stderr.write('[watch] file watcher started\n');
      }

      if (opts.transport === 'stdio') {
        // Write to stderr since stdout is used for MCP protocol
        process.stderr.write('FlowLens MCP server starting (stdio)...\n');
        const transport = new StdioServerTransport();
        await server.connect(transport);
        process.stderr.write('FlowLens MCP server running. Waiting for tool calls...\n');
      } else {
        printError(`Unsupported transport: ${opts.transport}. Use 'stdio'.`);
        process.exit(1);
      }
    } catch (err) {
      printError(`Server failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
