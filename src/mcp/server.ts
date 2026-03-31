/**
 * MCP Server core — creates and configures the FlowLens MCP server
 * with all registered tool handlers.
 *
 * Each tool is registered via a dedicated register function from the
 * tools/ directory, keeping the server module thin and composable.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GraphStore } from '../contracts/graph.js';
import type { AnnotationStore } from './annotation-store.js';
import type { SnapshotManager } from '../analysis/snapshot-manager.js';
import { registerGetContext } from './tools/get-context.js';
import { registerGetDependents } from './tools/get-dependents.js';
import { registerGetModuleInterface } from './tools/get-module-interface.js';
import { registerAnnotate } from './tools/annotate.js';

export interface ServerDependencies {
  graph: GraphStore;
  annotationStore: AnnotationStore;
  snapshotManager: SnapshotManager;
  flowlensDir: string;
  rootDir: string;
  fileIndexPath: string;
}

export function createFlowLensServer(deps: ServerDependencies): McpServer {
  const server = new McpServer({
    name: 'flowlens',
    version: '1.0.0',
  });

  // Phase 4, Task 4: core tools
  registerGetContext(server, deps);
  registerGetDependents(server, deps);
  registerGetModuleInterface(server, deps);
  registerAnnotate(server, deps);

  // Phase 4, Task 5: traverse, detect_cycles, get_metrics
  // Phase 4, Task 6: diff_interface, check_architecture, get_summary, get_hotspots, get_layer_map

  return server;
}
