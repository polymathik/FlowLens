/**
 * Response envelope construction. List tools compute their full result set,
 * then `paginate` slices it, so `total_count`/`truncated` are truthful by
 * construction (semantics documented on `toolResponseSchema`).
 */

import type { MCPToolResponse } from '../contracts/mcp/server.js';
import type { Detail, EntityCandidate, ToolError, ToolErrorCode } from '../contracts/mcp/tools.js';

export interface PageInfo {
  /** Items matching the query before the limit. */
  total: number;
  /** Items actually returned. */
  returned: number;
  /** Effective limit. */
  limit: number;
  /** total is a lower bound. */
  estimate?: boolean;
}

/** Slice a fully computed list to `limit`, returning truthful page info. */
export function paginate<T>(items: T[], limit: number, opts: { total?: number; estimate?: boolean } = {}) {
  const page = items.slice(0, limit);
  const info: PageInfo = { total: opts.total ?? items.length, returned: page.length, limit, estimate: opts.estimate };
  return { items: page, page: info };
}

export function buildResponse<T>(
  data: T,
  lastIndexed: string,
  options: { page?: PageInfo; detail?: Detail; canvas_url?: string } = {},
): MCPToolResponse<T> {
  const { page } = options;
  const response: MCPToolResponse<T> = {
    data,
    last_indexed: lastIndexed,
    truncated: page ? page.returned < page.total : false,
  };
  if (page) {
    response.total_count = page.total;
    response.returned_count = page.returned;
    response.limit = page.limit;
    if (page.estimate) response.total_is_estimate = true;
  }
  if (options.detail) response.detail = options.detail;
  if (options.canvas_url) response.canvas_url = options.canvas_url;
  return response;
}

/** Format MCP content response (compact JSON keeps agent context budgets small). */
export function toMCPContent(response: MCPToolResponse<unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response) }],
  };
}

export interface ToolErrorInit {
  error: string;
  code: ToolErrorCode;
  suggestions?: string[];
  candidates?: EntityCandidate[];
}

/** Format an MCP error result with the contract's structured error body. */
export function toMCPError(init: ToolErrorInit, lastIndexed = '') {
  const body: ToolError = {
    error: init.error,
    code: init.code,
    suggestions: init.suggestions ?? [],
    last_indexed: lastIndexed,
  };
  if (init.candidates && init.candidates.length > 0) body.candidates = init.candidates;
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
  };
}

export type ToolResult = ReturnType<typeof toMCPContent> | ReturnType<typeof toMCPError>;
