/**
 * annotate tool — creates an annotation on a code entity.
 *
 * Persists annotations via AnnotationStore so they survive across sessions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../server.js';
import { EntityToolSchemas, type AnnotateInput, type AnnotateOutput } from '../../contracts/mcp/tools.js';
import { buildResponse, toMCPContent, type ToolResult } from '../response-builder.js';
import { openView, resolveOrError } from '../tool-runtime.js';

export async function handleAnnotate(args: AnnotateInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const resolved = resolveOrError(view, args.entity);
  if (resolved.error) return resolved.error;

  const annotation = deps.annotationStore.add({
    entity_id: resolved.entity.id,
    text: args.text,
    category: args.category,
    author: args.author ?? 'unknown',
  });
  await deps.annotationStore.save();

  const data: AnnotateOutput = {
    annotation_id: annotation.id,
    entity_id: resolved.entity.id,
    created_at: annotation.created_at,
  };
  return toMCPContent(buildResponse(data, view.lastIndexed));
}

export function registerAnnotate(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'annotate',
    {
      description:
        'Creates an annotation on a code entity for tracking conventions, decisions, warnings, or TODOs.',
      inputSchema: EntityToolSchemas.AnnotateInputShape,
    },
    async (args) => handleAnnotate(args, deps),
  );
}
