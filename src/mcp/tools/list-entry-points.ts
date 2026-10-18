/**
 * list_entry_points — what starts a flow in this project: HTTP routes, CLI
 * commands, bin/main scripts, page routes, UI roots, event handlers (tests
 * and library exports on request). Each entry carries a label, the entity
 * to trace, a confidence and the evidence it was detected from.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../../contracts/mcp/server.js';
import { FLOW_LIMITS } from '../../contracts/flow.js';
import { FlowToolSchemas, type ListEntryPointsInput, type ListEntryPointsOutput } from '../../contracts/mcp/tools.js';
import { queryEntryPoints } from '../../flow/queries.js';
import { buildResponse, toMCPContent, type ToolResult } from '../response-builder.js';
import { flowContextFor } from '../flow-context.js';
import { openView } from '../tool-runtime.js';

export async function handleListEntryPoints(args: ListEntryPointsInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const ctx = await flowContextFor(deps, view);
  const { result, total, limit } = queryEntryPoints(ctx, args, FLOW_LIMITS.mcpEntryPoints);
  const data: ListEntryPointsOutput = result;
  return toMCPContent(buildResponse(data, view.lastIndexed, { page: { total, returned: result.entry_points.length, limit } }));
}

export function registerListEntryPoints(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'list_entry_points',
    {
      description:
        "List what starts a flow: HTTP routes ('GET /api/users'), CLI commands, bin/main scripts, page routes, UI component roots, event handlers (kind filter: http_route, cli_command, main, bin, page_route, event_handler, ui_component_root, test, export_api). Use a label as the `entity` of trace_flow.",
      inputSchema: FlowToolSchemas.ListEntryPointsInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleListEntryPoints(args, deps),
  );
}
