/**
 * trace_flow — "what happens when X runs?" (direction out) or "what
 * triggers X?" (direction in), answered from the static call graph.
 *
 * Input: an entry-point label ('GET /api/users'), or an entity id /
 * qualified name / file path / unique name. Output: the structured trace
 * (hops in call order, swimlanes, per-hop resolution + confidence) plus a
 * terminal-friendly indented tree, and a `canvas_url` to the Flow view.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../../contracts/mcp/server.js';
import { FLOW_LIMITS } from '../../contracts/flow.js';
import { FlowToolSchemas, type TraceFlowInput, type TraceFlowOutput } from '../../contracts/mcp/tools.js';
import { queryTrace } from '../../flow/queries.js';
import { renderTraceText } from '../../flow/render.js';
import { buildResponse, toMCPContent, toMCPError, type ToolResult } from '../response-builder.js';
import { flowCanvasUrl, flowContextFor } from '../flow-context.js';
import { openView } from '../tool-runtime.js';

export async function handleTraceFlow(args: TraceFlowInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const ctx = await flowContextFor(deps, view);
  const res = queryTrace(ctx, args, FLOW_LIMITS.mcpMaxNodes);
  if (!res.ok) {
    const { error, candidates, suggestions } = res.error;
    return toMCPError({ error: error.message, code: error.code === 'bad_request' ? 'invalid_argument' : error.code, suggestions: suggestions ?? [], candidates }, view.lastIndexed);
  }
  const { trace } = res;
  const data: TraceFlowOutput = { trace, text: renderTraceText(trace) };
  return toMCPContent(buildResponse(data, view.lastIndexed, { canvas_url: flowCanvasUrl(trace.root, args.depth ?? FLOW_LIMITS.depth.default, deps) }));
}

export function registerTraceFlow(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'trace_flow',
    {
      description:
        "What happens when X runs? Follows call/create edges from an entry point or any function (default depth 4, max 5) and returns the hops in call order with a resolved/ambiguous/unresolved flag and confidence per hop, swimlanes by package/folder, and an indented text tree. direction 'in' answers what triggers X (callers up to entry points). Static analysis: calls through instance receivers, JSX children and dynamic dispatch are not seen.",
      inputSchema: FlowToolSchemas.TraceFlowInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleTraceFlow(args, deps),
  );
}
