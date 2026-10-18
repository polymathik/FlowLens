import type { Detail } from './schemas/common.js';

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
