import type { Detail } from './schemas/common.js';
import type { GraphStore } from '../graph.js';
import type { AnnotationStore } from '../../mcp/annotation-store.js';
import type { SnapshotManager } from '../../analysis/snapshot-manager.js';

/**
 * Everything the MCP server and its tool/resource handlers need (Phase 12:
 * moved here from `src/mcp/server.ts` so handlers do not import the server
 * module that registers them; `server.ts` re-exports it).
 */
export interface ServerDependencies {
  graph: GraphStore;
  annotationStore: AnnotationStore;
  snapshotManager: SnapshotManager;
  flowlensDir: string;
  rootDir: string;
  fileIndexPath: string;
  /** LevelDB directory used for cache fingerprinting (default `<flowlensDir>/graph`). */
  graphPath?: string;
  /** Optional graph version token (e.g. from a graph service) for cache invalidation. */
  graphVersion?: () => string | Promise<string>;
}

export interface MCPServerConfig {
  graphPath: string;
  configPath: string;
  port?: number;
}

/**
 * Envelope of every tool response (runtime schema: `toolResponseSchema` in
 * `./schemas/common.ts`, which documents the exact count/truncation semantics).
 */
export interface MCPToolResponse<T> {
  data: T;
  last_indexed: string;
  /** List tools: returned_count < total_count. Always false for non-list tools. */
  truncated: boolean;
  /** List tools: number of items matching the query before the limit. */
  total_count?: number;
  /** List tools: number of items returned in the primary list. */
  returned_count?: number;
  /** Present only when total_count is a lower bound. */
  total_is_estimate?: true;
  /** List tools: effective limit after clamping. */
  limit?: number;
  /** Detail level used for entity-heavy tools. */
  detail?: Detail;
  /** Deep-link to the canvas view for this response's primary target. */
  canvas_url?: string;
}
