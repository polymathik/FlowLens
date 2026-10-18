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
import { registerTraverse } from './tools/traverse.js';
import { registerDetectCycles } from './tools/detect-cycles.js';
import { registerGetMetrics } from './tools/get-metrics.js';
import { registerDiffInterface } from './tools/diff-interface.js';
import { registerCheckArchitecture } from './tools/check-architecture.js';
import { registerGetSummary } from './tools/get-summary.js';
import { registerGetHotspots } from './tools/get-hotspots.js';
import { registerGetLayerMap } from './tools/get-layer-map.js';
import { registerAgentPrompts, registerAgentResources } from './agent-resources.js';

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
  registerTraverse(server, deps);
  registerDetectCycles(server, deps);
  registerGetMetrics(server, deps);

  // Phase 4, Task 6: diff_interface, check_architecture, get_summary, get_hotspots, get_layer_map
  registerDiffInterface(server, deps);
  registerCheckArchitecture(server, deps);
  registerGetSummary(server, deps);
  registerGetHotspots(server, deps);
  registerGetLayerMap(server, deps);

  // Phase 7: agent-native MCP resources and prompts
  registerAgentResources(server, deps);
  registerAgentPrompts(server, deps);

  return server;
}
