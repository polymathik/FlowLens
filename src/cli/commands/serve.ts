/**
 * flowlens serve — starts the MCP server for AI assistant integration.
 *
 * Currently supports stdio transport only. The server exposes all 12
 * FlowLens tools over the Model Context Protocol.
 */

import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openGraphStore } from '../../service/open-graph-store.js';
import { autoInit } from '../../service/project-setup.js';
import { startWatching } from '../../service/watch-session.js';
import { AnnotationStore } from '../../mcp/annotation-store.js';
import { SnapshotManager } from '../../analysis/snapshot-manager.js';
import { createFlowLensServer } from '../../mcp/server.js';
import { printError } from '../output.js';

export const serveCommand = new Command('serve')
  .description('Start the MCP server for AI assistant integration')
  .option('--transport <type>', 'Transport: stdio (default)', 'stdio')
  .option('--port <port>', 'HTTP port (default 3333, only with --transport http)', '3333')
  .option('--watch', 'Re-index on file changes while serving')
  .option('--no-daemon', 'Open the graph directly instead of via the FlowLens daemon')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    try {
      // Index on first use instead of exiting, then open via the graph service.
      await autoInit(rootDir, { daemon: opts.daemon });
      const graph = await openGraphStore(rootDir, { daemon: opts.daemon, client: 'serve' });

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

      // --watch: the daemon's per-project watcher keeps the graph fresh.
      if (opts.watch) {
        await startWatching(graph, rootDir, {
          debounceMs: 300,
          onUpdate: (r) => process.stderr.write(
            `[watch] ${r.filesReparsed} reparsed / ${r.filesDeleted} deleted / ${r.errors.length} errors in ${r.durationMs}ms\n`,
          ),
        });
        process.stderr.write('[watch] file watcher started\n');
      }

      if (opts.transport === 'stdio') {
        // Write to stderr since stdout is used for MCP protocol
        process.stderr.write('FlowLens MCP server starting (stdio)...\n');
        const transport = new StdioServerTransport();
        await server.connect(transport);
        // Release the daemon lease promptly when the client disconnects.
        process.stdin.once('end', () => void graph.close());
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
