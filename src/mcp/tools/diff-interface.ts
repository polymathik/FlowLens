/**
 * diff_interface tool — compares the current code graph against a stored
 * snapshot (any ref git can resolve: full/short SHA, HEAD~1, branch, tag),
 * reporting breaking and non-breaking interface changes.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../../contracts/mcp/server.js';
import type { InterfaceDiffEntry } from '../../contracts/analysis/diff.js';
import {
  ANALYSIS_LIMITS, AnalysisToolSchemas,
  type Detail, type DiffInterfaceInput, type DiffInterfaceOutput,
} from '../../contracts/mcp/tools.js';
import { resolveSnapshotRef } from '../../analysis/snapshot-refs.js';
import { isInScope, normalizeScope } from '../../analysis/module-path.js';
import { buildResponse, paginate, toMCPContent, toMCPError, type ToolResult } from '../response-builder.js';
import { clampLimit } from '../limits.js';
import { DEFAULT_DETAIL } from '../entity-view.js';
import { openView } from '../tool-runtime.js';
import { cachedDiff } from '../analysis-cache.js';

/** Summary detail drops the before/after entity payloads. */
export function toDiffEntryView(c: InterfaceDiffEntry, detail: Detail): InterfaceDiffEntry {
  if (detail === 'full') return c;
  const { before: _b, after: _a, ...rest } = c;
  return rest;
}

function summarize(changes: InterfaceDiffEntry[]): DiffInterfaceOutput['summary'] {
  const breaking = changes.filter((c) => c.severity === 'breaking').length;
  const top = [...changes].sort((a, b) => b.affected_dependents - a.affected_dependents)[0];
  return {
    total_changes: changes.length,
    breaking_changes: breaking,
    non_breaking_changes: changes.length - breaking,
    ...(top && top.affected_dependents > 0 ? { most_impacted_entity: top.entity_name } : {}),
  };
}

export async function handleDiffInterface(args: DiffInterfaceInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const lastIndexed = view.lastIndexed;
  const ref = await resolveSnapshotRef(args.since, deps.snapshotManager, deps.rootDir);
  if (!ref.ok) {
    return toMCPError({
      error: ref.message,
      code: ref.code === 'invalid_ref' ? 'invalid_argument' : 'no_snapshot',
      suggestions: ref.suggestions,
    }, lastIndexed);
  }

  const limit = clampLimit(args.max_results, ANALYSIS_LIMITS.diff);
  const detail = args.detail ?? DEFAULT_DETAIL;
  const scope = normalizeScope(args.scope);
  const diff = await cachedDiff(view, ref.snapshot, {
    breaking_only: args.breaking_only ?? true,
    scope,
  });
  // diff-computer scopes by raw string prefix; re-apply segment-boundary scope.
  const changes = scope
    ? diff.changes.filter((c) => isInScope(c.before?.file ?? '', scope) || isInScope(c.after?.file ?? '', scope))
    : diff.changes;

  const { items, page } = paginate(changes, limit);
  const data: DiffInterfaceOutput = {
    requested_ref: args.since,
    from_sha: diff.from_sha,
    to_sha: diff.to_sha,
    changes: items.map((c) => toDiffEntryView(c, detail)),
    summary: changes === diff.changes ? diff.summary : summarize(changes),
  };

  return toMCPContent(buildResponse(data, lastIndexed, { page, detail }));
}

export function registerDiffInterface(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'diff_interface',
    {
      description:
        'Compares the current code graph against a stored snapshot (SHA, short SHA, HEAD~1, branch) to find breaking and non-breaking interface changes.',
      inputSchema: AnalysisToolSchemas.DiffInterfaceInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleDiffInterface(args, deps),
  );
}
