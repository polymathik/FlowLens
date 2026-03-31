/**
 * diff_interface tool — compares the current graph state against a stored
 * snapshot identified by git SHA, reporting breaking and non-breaking changes.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerDependencies } from '../server.js';
import { computeDiff } from '../../analysis/diff-computer.js';
import { buildResponse, toMCPContent, toMCPError } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';

export interface DiffInterfaceInput {
  since: string;
  scope?: string;
  breaking_only?: boolean;
  max_results?: number;
}

const MAX_RESULTS_CAP = 250;

export async function handleDiffInterface(
  args: DiffInterfaceInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);

  const snapshot = await deps.snapshotManager.loadSnapshot(args.since);
  if (!snapshot) {
    return toMCPError(
      `Snapshot not found for SHA: '${args.since}'`,
      ['Run "flowlens snapshot" to create a snapshot first'],
      lastIndexed,
    );
  }

  const breakingOnly = args.breaking_only ?? true;
  const maxResults = Math.min(args.max_results ?? 50, MAX_RESULTS_CAP);

  const diff = await computeDiff(deps.graph, snapshot, {
    breaking_only: breakingOnly,
    scope: args.scope,
  });

  const totalChanges = diff.changes.length;
  const truncatedChanges = diff.changes.slice(0, maxResults);

  const data = {
    ...diff,
    changes: truncatedChanges,
  };

  return toMCPContent(buildResponse(data, lastIndexed, {
    max_results: maxResults,
    actualCount: truncatedChanges.length,
    total_count: totalChanges,
  }));
}

export function registerDiffInterface(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'diff_interface',
    {
      description:
        'Compares the current code graph against a stored snapshot to detect breaking and non-breaking interface changes.',
      inputSchema: {
        since: z.string().describe('Git SHA of the snapshot to compare against'),
        scope: z.string().optional().describe('Restrict diff to file path prefix'),
        breaking_only: z.boolean().optional().default(true).describe('Only show breaking changes'),
        max_results: z.number().optional().default(50).describe('Max results (default 50, max 250)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleDiffInterface(args as DiffInterfaceInput, deps),
  );
}
