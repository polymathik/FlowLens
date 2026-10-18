/**
 * `communities` strategy: files grouped by how strongly they depend on each other.
 *
 *   fileGraph (import 1 · inherit 1 · call 0.5 · folder 0.3) → per package: Leiden with a resolution
 *   search toward 5–40 files per zone, recursive split of bigger ones, tiny ones merged → names and
 *   stable keys (warm start from `previousAssignment`) → shared `finalizeZones` → quality figures.
 *
 * Detected from the dependencies, not a statement about the intended architecture.
 */
import { PROJECT_NODE_ID, type Hierarchy } from '../../../contracts/hierarchy.js';
import type { ZoneSet, ZoningFileGraph, ZoningInput, ZoningStrategy } from '../../../contracts/zones.js';
import { communityDrafts } from './drafts.js';
import { buildFileGraph } from './file-graph.js';
import { partitionQuality, zoneCohesion } from './quality.js';
import { finalizeZones } from '../finalize.js';
import type { ZoneDraft } from '../draft.js';
import { scopeNodeOf } from '../scope.js';

export { buildFileGraph } from './file-graph.js';

type Bucket = Map<string, ZoneDraft[]>;
const cache = new WeakMap<Hierarchy, WeakMap<object, Bucket>>();
const NO_GRAPH = {};
let nextId = 1;
const ids = new WeakMap<object, number>();
const idOf = (o: object | undefined): number => (o ? (ids.get(o) ?? (ids.set(o, nextId++), nextId - 1)) : 0);

/** Drafts are cached per (hierarchy, graph, scope, previous assignment): expand / collapse must not re-cluster. */
function cachedDrafts(input: ZoningInput): ZoneDraft[] {
  const perGraph = cache.get(input.hierarchy) ?? new WeakMap<object, Bucket>();
  cache.set(input.hierarchy, perGraph);
  const graph: ZoningFileGraph | object = input.fileGraph ?? NO_GRAPH;
  const bucket = perGraph.get(graph) ?? new Map<string, ZoneDraft[]>();
  perGraph.set(graph, bucket);
  const key = `${input.scopeId ?? ''}|${idOf(input.previousAssignment)}`;
  let drafts = bucket.get(key);
  if (!drafts) {
    drafts = communityDrafts(input);
    if (bucket.size >= 8) bucket.delete(bucket.keys().next().value as string);
    bucket.set(key, drafts);
  }
  return drafts;
}

export const communitiesStrategy: ZoningStrategy = (input) => {
  const mode = 'communities';
  const set: ZoneSet = finalizeZones({
    mode,
    hierarchy: input.hierarchy,
    scopeNodeId: scopeNodeOf(input.hierarchy, input.scopeId)?.id ?? PROJECT_NODE_ID,
    drafts: cachedDrafts({ ...input, mode }),
    overrides: input.overrides,
    options: input.options,
  });
  const edges = (input.fileGraph ?? buildFileGraph(input.hierarchy, [])).edges.filter((e) => set.zoneOfFile[e.a] !== undefined || set.zoneOfFile[e.b] !== undefined);
  const quality = partitionQuality(set.zoneOfFile, edges);
  const cohesion = zoneCohesion(set, edges);
  const zones = set.zones.map((z) => (cohesion.has(z.id) ? { ...z, cohesion: cohesion.get(z.id)! } : z));
  return quality ? { ...set, zones, quality } : { ...set, zones };
};
