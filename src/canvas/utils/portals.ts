/**
 * Portal grouping: relations that cross the boundary of the open container
 * are grouped by the outside container they reach. Groups start at file
 * granularity and roll up to coarser containers (folder → package → …) until
 * at most `cap` portals remain per direction, so a hub file with importers in
 * thirty files shows a handful of readable stubs. Counts stay exact — every
 * relation lands in exactly one group.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { AggregatedLink, PortalSpec, TypeCounts } from '../../contracts/canvas/index.js';
import type { Relation } from '../../contracts/relations.js';

export const DEFAULT_PORTAL_CAP = 10;

export interface PortalHit {
  direction: 'in' | 'out';
  /** Outside endpoint's path below the lowest common ancestor, coarsest first. */
  chain: string[];
  /** The inside node the relation attaches to. */
  inner: string;
  relation: Relation;
}

/** Deepest portal granularity for a chain: its file when it has one, else its first element. */
export function baseChain(h: Hierarchy, chain: string[]): string[] {
  const fileAt = chain.findIndex((id) => h.nodes.get(id)?.kind === 'file');
  return fileAt >= 0 ? chain.slice(0, fileAt + 1) : chain.slice(0, 1);
}

function groupLevel(chains: string[][], cap: number): number {
  let level = chains.reduce((m, c) => Math.max(m, c.length), 1) - 1;
  const groups = (l: number) => new Set(chains.map((c) => c[Math.min(l, c.length - 1)])).size;
  while (level > 0 && groups(level) > cap) level--;
  return level;
}

function portalLabel(h: Hierarchy, id: string): string {
  const n = h.nodes.get(id);
  if (!n) return id;
  if (n.kind === 'package' || n.kind === 'symbol') return n.name;
  return n.kind === 'config' ? `${n.path || '.'}/Config` : n.path || '.';
}

function bump(counts: TypeCounts, type: Relation['type']): void {
  counts[type] = (counts[type] ?? 0) + 1;
}

export function buildPortals(h: Hierarchy, hits: PortalHit[], cap = DEFAULT_PORTAL_CAP): PortalSpec[] {
  const out: PortalSpec[] = [];
  for (const direction of ['in', 'out'] as const) {
    const mine = hits.filter((x) => x.direction === direction).map((x) => ({ ...x, chain: baseChain(h, x.chain) }));
    if (mine.length === 0) continue;
    const level = groupLevel(mine.map((x) => x.chain), cap);
    const groups = new Map<string, { spec: PortalSpec; links: Map<string, AggregatedLink> }>();
    for (const x of mine) {
      const targetId = x.chain[Math.min(level, x.chain.length - 1)];
      const id = `portal:${direction}:${targetId}`;
      let g = groups.get(id);
      if (!g) {
        const kind = h.nodes.get(targetId)?.kind ?? 'file';
        g = { spec: { id, direction, targetId, targetKind: kind, label: portalLabel(h, targetId), count: 0, typeCounts: {}, links: [] }, links: new Map() };
        groups.set(id, g);
      }
      g.spec.count++;
      bump(g.spec.typeCounts, x.relation.type);
      const [source, target] = direction === 'in' ? [id, x.inner] : [x.inner, id];
      const key = `${source}->${target}`;
      let link = g.links.get(key);
      if (!link) g.links.set(key, (link = { source, target, count: 0, typeCounts: {}, relationIds: [] }));
      link.count++;
      bump(link.typeCounts, x.relation.type);
      link.relationIds.push(x.relation.id);
    }
    for (const g of groups.values()) {
      g.spec.links = [...g.links.values()].sort((a, b) => (a.source + a.target < b.source + b.target ? -1 : 1));
      out.push(g.spec);
    }
  }
  return out.sort((a, b) => (a.direction === b.direction ? b.count - a.count || (a.id < b.id ? -1 : 1) : a.direction === 'in' ? -1 : 1));
}
