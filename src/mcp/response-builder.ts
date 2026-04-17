import type { MCPToolResponse } from '../contracts/mcp/server.js';

export function buildResponse<T>(
  data: T,
  lastIndexed: string,
  options?: {
    total_count?: number;
    max_results?: number;
    actualCount?: number;
    canvas_url?: string;
  },
): MCPToolResponse<T> {
  const truncated = options?.max_results !== undefined && options?.actualCount !== undefined
    && options.actualCount > options.max_results;

  return {
    data,
    last_indexed: lastIndexed,
    truncated,
    total_count: options?.total_count ?? options?.actualCount,
    canvas_url: options?.canvas_url,
  };
}

/** Format MCP content response (what the SDK expects) */
export function toMCPContent(response: MCPToolResponse<unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
  };
}

/** Format MCP error response */
export function toMCPError(error: string, suggestions: string[] = [], lastIndexed = '') {
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error, suggestions, last_indexed: lastIndexed }, null, 2),
    }],
  };
}
