/**
 * `layers` strategy: one zone per architecture layer (`.flowlens/architecture.json`),
 * in declaration order — the order a reader scans top to bottom — plus a muted,
 * collapsed `Unassigned` zone for files no layer includes.
 *
 * Membership uses the rule engine's own matcher (`analysis/layer-match.ts`):
 * the FIRST layer whose `patterns` / `files` include the file wins. A layer's
 * `entities` list claims a file too, when a symbol of the file is named there
 * and the layer is declared before the one the file's path matched (the same
 * "first match wins" the rule engine applies per entity; here a file lands in
 * one zone, so the earliest layer that reaches any of its symbols takes it).
 *
 * Without layers (no `architecture.json`) the strategy returns no zone at all,
 * so the canvas can say "No layers defined" and fall back to folders.
 *
 * ```mermaid
 * flowchart LR
 *   L["input.layers (declaration order)"] --> M["first layer matching<br/>path · file list · entity names"]
 *   F["files of the scope"] --> M
 *   M -->|layer i| Z["zone <layer name> (order i)"]
 *   M -->|none| U["Unassigned (muted, collapsed)"]
 *   Z & U --> FIN["finalizeZones"]
 * ```
 */
import type { ArchitectureLayer } from '../../contracts/architecture.js';
import type { Hierarchy, HierarchyNode } from '../../contracts/hierarchy.js';
import { PROJECT_NODE_ID } from '../../contracts/hierarchy.js';
import { ZONE_UNASSIGNED_KEY, type ZoningInput } from '../../contracts/zones.js';
import { firstFileLayerIndex, matchesLayerEntity } from '../layer-match.js';
import { DraftBook, type ZoneDraft } from './draft.js';
import { finalizeZones } from './finalize.js';
import { claimKey } from './keys.js';
import { registerZoning } from './registry.js';
import { filesBelow, scopeNodeOf } from './scope.js';

/** Tooltip text of a layer zone: the access rules the rule engine enforces. */
export function layerRulesText(layer: ArchitectureLayer): string {
  const only = layer.may_only_access;
  const never = layer.must_not_access;
  const lines = [`Layer ${layer.name}`];
  if (only) lines.push(`May only access: ${only.length > 0 ? only.join(', ') : 'no other layer'}`);
  if (never && never.length > 0) lines.push(`Must not access: ${never.join(', ')}`);
  if (!only && !(never && never.length > 0)) lines.push('No access rules');
  return lines.join('\n');
}

/** True when a symbol below `file` is named by the layer's `entities` list. */
function fileHasLayerEntity(h: Hierarchy, file: HierarchyNode, layer: ArchitectureLayer): boolean {
  const stack = [...file.childIds];
  while (stack.length > 0) {
    const n = h.nodes.get(stack.pop()!);
    if (!n || n.kind !== 'symbol') continue;
    if (matchesLayerEntity({ name: n.name, qualified_name: n.qualifiedName }, layer)) return true;
    stack.push(...n.childIds);
  }
  return false;
}

/** Index of the layer that owns `file`, or -1 (unassigned). */
function layerIndexOf(h: Hierarchy, file: HierarchyNode, layers: readonly ArchitectureLayer[], entityRules: readonly number[]): number {
  let idx = firstFileLayerIndex(file.path, layers);
  const limit = idx < 0 ? layers.length : idx;
  for (const i of entityRules) {
    if (i >= limit) break;
    if (fileHasLayerEntity(h, file, layers[i])) idx = i;
    if (idx === i) break;
  }
  return idx;
}

export function layersDrafts(input: ZoningInput): ZoneDraft[] {
  const h = input.hierarchy;
  const layers = input.layers ?? [];
  const scope = scopeNodeOf(h, input.scopeId);
  if (!scope || layers.length === 0) return [];
  const entityRules = layers.flatMap((l, i) => (l.include.entities?.length ? [i] : []));
  const used = new Set<string>([ZONE_UNASSIGNED_KEY]);
  const book = new DraftBook();
  const keys = layers.map((layer, i) => {
    const key = claimKey(used, layer.name);
    book.add({ key, label: layer.name, source: 'layer', parentKey: null, order: i, detail: layerRulesText(layer) });
    return key;
  });

  for (const id of filesBelow(h, scope)) {
    const file = h.nodes.get(id);
    if (!file) continue;
    const idx = layerIndexOf(h, file, layers, entityRules);
    if (idx >= 0) book.get(keys[idx])!.fileIds.push(id);
    else {
      book
        .ensure(ZONE_UNASSIGNED_KEY, () => ({
          label: 'Unassigned', source: 'config', parentKey: null, startCollapsed: true, detail: 'Files that no layer includes',
        }))
        .fileIds.push(id);
    }
  }
  return book.list();
}

export const layersStrategy = (input: ZoningInput) =>
  finalizeZones({
    mode: 'layers',
    hierarchy: input.hierarchy,
    scopeNodeId: scopeNodeOf(input.hierarchy, input.scopeId)?.id ?? PROJECT_NODE_ID,
    drafts: layersDrafts({ ...input, mode: 'layers' }),
    overrides: input.overrides,
    options: input.options,
  });

registerZoning('layers', layersStrategy);
