/**
 * Map view model (Map v2, lane M1): what the Map shows for ONE container of
 * the hierarchy — its children, the links between them, and portals for
 * every link that crosses the container boundary. Pure data computed by
 * `src/canvas/utils/map-view.ts`; the transformers turn it into React Flow
 * nodes and edges.
 *
 * Exactness contract: every structural relation (all types except
 * `contain`, with a resolvable target) that touches the container is
 * counted in exactly one bucket of `RelationAccounting`, so
 *   considered = edges + portalIn + portalOut + internal + hidden
 * and nothing is dropped silently.
 */
import type { RelationType } from '../relations.js';
import type { HierarchyKind } from '../hierarchy.js';

export type TypeCounts = Partial<Record<RelationType, number>>;

/** Relations collapsed between two nodes of a view (hierarchy node ids, or `scope:`/`portal:` ids). */
export interface AggregatedLink {
  source: string;
  target: string;
  count: number;
  typeCounts: TypeCounts;
  /** Every relation id behind the link. */
  relationIds: string[];
}

export interface PortalSpec {
  /** `portal:in:<targetId>` / `portal:out:<targetId>`. */
  id: string;
  /** `in`: the outside container depends on the open one; `out`: the open one depends on it. */
  direction: 'in' | 'out';
  /** Hierarchy node the portal navigates to. */
  targetId: string;
  targetKind: HierarchyKind;
  /** Path (files/folders), package name, or symbol name of the target. */
  label: string;
  count: number;
  typeCounts: TypeCounts;
  /** Links between this portal and the inner nodes. */
  links: AggregatedLink[];
}

export interface RelationAccounting {
  /** Relations touching the container (excluding `contain` and unresolved targets). */
  considered: number;
  /** Between two different visible nodes. */
  edges: number;
  portalIn: number;
  portalOut: number;
  /** Both ends inside the same visible node. */
  internal: number;
  /** An end sits in a node hidden by a view option (lockfiles). */
  hidden: number;
  /** Relations skipped because an endpoint is not in the hierarchy. */
  unknownEndpoint: number;
}

export interface MapView {
  /** The open container (`project` at the root). */
  containerId: string;
  /** Visible hierarchy node ids, in display order (scope node last). */
  nodeIds: string[];
  /** True when the container has no visible children: the container itself is shown. */
  leaf: boolean;
  /** `scope:<containerId>` when relations attach to the container itself. */
  scopeId?: string;
  links: AggregatedLink[];
  portals: PortalSpec[];
  accounting: RelationAccounting;
}

export interface MapViewOptions {
  showLockfiles: boolean;
  /** Maximum portals per direction before they roll up to coarser containers. */
  portalCap?: number;
}
