/**
 * get_module_interface tool — returns the public API surface of a module/file.
 *
 * Lists all public entities in the file, counts their dependents, and
 * optionally attaches interface diff entries when diff_since is provided.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerDependencies } from '../server.js';
import type { Entity } from '../../contracts/entities.js';
import type { InterfaceDiffEntry } from '../../contracts/analysis/diff.js';
import { resolveEntity, isResolveError } from '../entity-resolver.js';
import { buildResponse, toMCPContent, toMCPError } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';
import { computeDiff } from '../../analysis/diff-computer.js';
import { buildCanvasUrl } from '../../contracts/canvas-links.js';

export interface GetModuleInterfaceInput {
  module: string;
  include_private?: boolean;
  diff_since?: string;
  max_results?: number;
}

export interface ExportEntry {
  entity: Entity;
  type_signature?: string;
  dependent_count: number;
  diff?: InterfaceDiffEntry[];
}

export interface GetModuleInterfaceResult {
  module: Entity;
  exports: ExportEntry[];
}

const MAX_RESULTS_CAP = 250;

export async function handleGetModuleInterface(
  args: GetModuleInterfaceInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);
  const outcome = await resolveEntity(deps.graph, args.module);

  if (isResolveError(outcome)) {
    return toMCPError(outcome.error, outcome.suggestions, lastIndexed);
  }

  const { entity } = outcome;
  const maxResults = Math.min(args.max_results ?? 50, MAX_RESULTS_CAP);
  const includePrivate = args.include_private ?? false;

  // Get all entities in this file
  const fileEntities = await deps.graph.getNodesByFile(entity.file);

  // Filter to public entities (unless include_private)
  const filtered = includePrivate
    ? fileEntities
    : fileEntities.filter(e => e.visibility === 'public');

  // For each export, count dependents and compute type_signature
  const exports: ExportEntry[] = [];
  for (const e of filtered) {
    if (exports.length >= maxResults) break;

    const inbound = await deps.graph.getEdgesTo(e.id);
    const entry: ExportEntry = {
      entity: e,
      dependent_count: inbound.length,
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

    exports.push(entry);
  }

  // Compute diff if diff_since is provided
  if (args.diff_since) {
    const snapshot = await deps.snapshotManager.loadSnapshot(args.diff_since);
    if (snapshot) {
      const diff = await computeDiff(deps.graph, snapshot, {
        scope: entity.file,
      });

      // Attach diff entries to matching exports
      for (const entry of exports) {
        const matchingChanges = diff.changes.filter(
          c => c.entity_id === entry.entity.id || c.entity_name === entry.entity.name,
        );
        if (matchingChanges.length > 0) {
          entry.diff = matchingChanges;
        }
      }
    }
  }

  const data: GetModuleInterfaceResult = {
    module: entity,
    exports,
  };

  const response = buildResponse(data, lastIndexed, {
    max_results: maxResults,
    actualCount: exports.length,
    total_count: filtered.length,
    canvas_url: buildCanvasUrl({
      kind: entity.kind === 'file' ? 'file' : 'module',
      identifier: entity.file || entity.qualified_name,
    }),
  });

  return toMCPContent(response);
}

export function registerGetModuleInterface(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_module_interface',
    {
      description:
        'Returns the public API surface of a module or file, with optional diff against a snapshot.',
      inputSchema: {
        module: z.string().describe('Module/file identifier: qualified name, ID, or file path'),
        include_private: z.boolean().optional().default(false).describe('Include private entities'),
        diff_since: z.string().optional().describe('Git SHA to diff against'),
        max_results: z.number().optional().default(50).describe('Max results (default 50, max 250)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetModuleInterface(args as GetModuleInterfaceInput, deps),
  );
}
