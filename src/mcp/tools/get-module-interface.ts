/**
 * get_module_interface tool — returns the public API surface of a module/file.
 *
 * Lists the public entities of a file (or of every file directly inside a
 * directory module), counts their dependents, and optionally attaches
 * interface diff entries when diff_since is provided.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../server.js';
import type { Entity } from '../../contracts/entities.js';
import type { InterfaceDiffEntry } from '../../contracts/analysis/diff.js';
import {
  LIMITS, EntityToolSchemas,
  type ExportEntry, type GetModuleInterfaceInput, type GetModuleInterfaceOutput,
} from '../../contracts/mcp/tools.js';
import { buildResponse, paginate, toMCPContent, toMCPError, type ToolResult } from '../response-builder.js';
import { clampLimit } from '../limits.js';
import { DEFAULT_DETAIL, toEntityView } from '../entity-view.js';
import { entityCanvasUrl, openView, resolveOrError } from '../tool-runtime.js';
import { computeDiff } from '../../analysis/diff-computer.js';
import { resolveSnapshotRef } from '../../analysis/snapshot-refs.js';
import { moduleOfFile } from '../../analysis/module-path.js';
import { toDiffEntryView } from './diff-interface.js';

/** Kinds that are never part of a module's exported interface. */
const NON_EXPORT_KINDS = new Set<Entity['kind']>(['file', 'module', 'parameter']);

export async function handleGetModuleInterface(
  args: GetModuleInterfaceInput,
  deps: ServerDependencies,
): Promise<ToolResult> {
  const view = await openView(deps);
  const resolved = resolveOrError(view, args.module);
  if (resolved.error) return resolved.error;
  const { entity } = resolved;

  const limit = clampLimit(args.max_results, LIMITS.moduleInterface);
  const detail = args.detail ?? DEFAULT_DETAIL;
  const includePrivate = args.include_private ?? false;

  // Resolve diff_since up front so an unknown ref is an error, not silently ignored.
  let diffChanges: InterfaceDiffEntry[] | null = null;
  let diffSha: string | undefined;
  if (args.diff_since) {
    const ref = await resolveSnapshotRef(args.diff_since, deps.snapshotManager, deps.rootDir);
    if (!ref.ok) {
      return toMCPError({ error: ref.message, code: ref.code === 'invalid_ref' ? 'invalid_argument' : 'no_snapshot', suggestions: ref.suggestions }, view.lastIndexed);
    }
    diffSha = ref.sha;
    const scope = entity.kind === 'module' ? entity.file + '/' : entity.file;
    diffChanges = (await computeDiff(deps.graph, ref.snapshot, { scope })).changes;
  }

  const members = entity.kind === 'module'
    ? view.nodes.filter((n) => n.kind !== 'module' && moduleOfFile(n.file) === entity.file)
    : view.byFile.get(entity.file) ?? [];
  const filtered = members
    .filter((e) => !NON_EXPORT_KINDS.has(e.kind))
    .filter((e) => includePrivate || e.visibility === 'public')
    .sort((a, b) => a.file.localeCompare(b.file) || a.location.line_start - b.location.line_start);

  const { items, page } = paginate(filtered, limit);
  const exports: ExportEntry[] = [];
  for (const e of items) {
    const dependents = new Set(view.edgesTo(e.id).filter((r) => r.type !== 'contain').map((r) => r.from));
    const entry: ExportEntry = {
      entity: toEntityView(e, detail),
      dependent_count: dependents.size,
    };

    // Build type_signature based on entity kind
    if (e.kind === 'function' || e.kind === 'method') {
      // Look up child parameter entities from the graph
      const allFileEntities = await deps.graph.getNodesByFile(e.file);
      const params = allFileEntities
        .filter(p => p.kind === 'parameter' && p.qualified_name.startsWith(e.qualified_name + '.'))
        .map(p => p.name);
      entry.type_signature = `(${params.join(', ')})`;
    } else if (e.kind === 'class') {
      entry.type_signature = `class ${e.name}`;
    } else if (e.kind === 'interface') {
      entry.type_signature = `interface ${e.name}`;
    }

    if (diffChanges) {
      const matching = diffChanges.filter((c) => c.entity_id === e.id || c.entity_name === e.name);
      if (matching.length > 0) entry.diff = matching.map((c) => toDiffEntryView(c, detail));
    }
    exports.push(entry);
  }

  const data: GetModuleInterfaceOutput = {
    module: toEntityView(entity, detail),
    exports,
    ...(diffSha ? { diff_since_sha: diffSha } : {}),
  };

  return toMCPContent(buildResponse(data, view.lastIndexed, {
    page, detail, canvas_url: entityCanvasUrl(entity),
  }));
}

export function registerGetModuleInterface(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_module_interface',
    {
      description:
        'Public API surface of a file or directory module (exports with dependent counts), with optional diff against a snapshot ref.',
      inputSchema: EntityToolSchemas.GetModuleInterfaceInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetModuleInterface(args, deps),
  );
}
