/**
 * annotate tool — creates an annotation on a code entity.
 *
 * Persists annotations via AnnotationStore so they survive across sessions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerDependencies } from '../server.js';
import { resolveEntity, isResolveError } from '../entity-resolver.js';
import { buildResponse, toMCPContent, toMCPError } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';

export interface AnnotateInput {
  entity: string;
  text: string;
  category: 'convention' | 'decision' | 'warning' | 'todo';
  author?: string;
}

export interface AnnotateResult {
  annotation_id: string;
  entity_id: string;
  created_at: string;
}

export async function handleAnnotate(
  args: AnnotateInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);
  const outcome = await resolveEntity(deps.graph, args.entity);

  if (isResolveError(outcome)) {
    return toMCPError(outcome.error, outcome.suggestions, lastIndexed);
  }

  const { entity } = outcome;

  const annotation = deps.annotationStore.add({
    entity_id: entity.id,
    text: args.text,
    category: args.category,
    author: args.author ?? 'unknown',
  });

  await deps.annotationStore.save();

  const data: AnnotateResult = {
    annotation_id: annotation.id,
    entity_id: entity.id,
    created_at: annotation.created_at,
  };

  const response = buildResponse(data, lastIndexed);
  return toMCPContent(response);
}

export function registerAnnotate(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'annotate',
    {
      description:
        'Creates an annotation on a code entity for tracking conventions, decisions, warnings, or TODOs.',
      inputSchema: {
        entity: z.string().describe('Entity identifier: qualified name, ID, or file path'),
        text: z.string().describe('Annotation text'),
        category: z.enum(['convention', 'decision', 'warning', 'todo']).describe('Annotation category'),
        author: z.string().optional().default('unknown').describe('Author name'),
      },
    },
    async (args) => handleAnnotate(args as AnnotateInput, deps),
  );
}
