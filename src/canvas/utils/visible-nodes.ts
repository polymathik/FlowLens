/**
 * Drill-down visibility rules and drill-path construction.
 *
 * Flat node strategy — parent references live in node data
 * (`parentSystem`, `parentModule`, `parentFile`; see contracts/canvas/data.ts).
 *
 *   []                         → all system nodes
 *   [system:S]                 → modules of S + files at S's root, plus the other systems for context
 *   [system:S, module:M]       → files of M, plus M's sibling modules for context
 *   [..., file:F]              → symbols declared in F
 *
 * An unknown last segment (e.g. a symbol id) falls back to its parent path —
 * never to "everything".
 */
import type { Node } from '@xyflow/react';
import { containerKind, systemId, topDir } from './hierarchy';

type Data = Record<string, unknown>;
const d = (n: Node) => n.data as Data;

export function getVisibleNodes(allNodes: Node[], drillPath: string[]): Node[] {
  if (drillPath.length === 0) {
    return allNodes.filter((n) => n.type === 'system');
  }
  const current = drillPath[drillPath.length - 1];

  switch (containerKind(current)) {
    case 'system':
      return allNodes.filter((n) => {
        if (n.type === 'system') return n.id !== current;
        if (n.type === 'module') return d(n).parentSystem === current;
        if (n.type === 'file') return d(n).parentSystem === current && !d(n).parentModule;
        return false;
      });
    case 'module': {
      const parent = systemId(topDir(current.slice('module:'.length)));
      return allNodes.filter((n) => {
        if (n.type === 'module') return n.id !== current && d(n).parentSystem === parent;
        if (n.type === 'file') return d(n).parentModule === current;
        return false;
      });
    }
    case 'file':
      return allNodes.filter((n) => n.type === 'entity' && d(n).parentFile === current);
    default:
      return getVisibleNodes(allNodes, drillPath.slice(0, -1));
  }
}

/**
 * Drill path that opens `node` (shows its children), or null for nodes that
 * cannot be drilled into (symbols). Built from the node's own ancestry, so
 * drilling into a sibling module replaces the current module instead of
 * stacking it.
 */
export function drillPathForNode(node: Pick<Node, 'id' | 'type' | 'data'>): string[] | null {
  const data = node.data as Data;
  switch (node.type) {
    case 'system':
      return [node.id];
    case 'module':
      return [data.parentSystem as string, node.id];
    case 'file':
      return data.parentModule
        ? [data.parentSystem as string, data.parentModule as string, node.id]
        : [data.parentSystem as string, node.id];
    default:
      return null;
  }
}

/** Stable key of a visible node set — changes whenever membership changes. */
export function nodeSetKey(nodes: Pick<Node, 'id'>[]): string {
  return nodes
    .map((n) => n.id)
    .sort()
    .join('|');
}
