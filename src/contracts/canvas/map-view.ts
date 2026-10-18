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
import type { ZoneOverrides, ZoneSet, ZoningFileGraph, ZoningMode } from '../zones.js';
import type { MapCut } from './zones-view.js';

export type TypeCounts = Partial<Record<RelationType, number>>;

/** Relations collapsed between two nodes of a view (hierarchy node ids, or `scope:`/`portal:` ids). */
export interface AggregatedLink {
  source: string;
  target: string;
  count: number;
  typeCounts: TypeCounts;
  /** Every relation id behind the link. */
  relationIds: string[];
  /**
   * Zone views: the endpoints sit under different frames. The link is drawn
   * dimmed at card level and is also counted in a frame-level bundle.
   */
  cross?: boolean;
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
  /** Zone views (Map v2 M2): the cut of the zone tree that is on screen. */
  cut?: MapCut;
  /** Zone views: the grouping in effect (falls back to folders when `requested` finds no zone) and its zones. */
  zoning?: { mode: ZoningMode; requested: ZoningMode; zoneSet: ZoneSet };
  /**
   * Zone views: frame-level aggregates of the `cross` links. Their counts add
   * up to the `cross` links' counts (every relation sits in exactly one bundle).
   */
  bundles?: AggregatedLink[];
}

export interface MapViewOptions {
  showLockfiles: boolean;
  /** Maximum portals per direction before they roll up to coarser containers. */
  portalCap?: number;
  /** Map v2 M2: render folders / packages as zones (absent = flat M1 children view). */
  zones?: ZoneViewOptions;
}

/** Inputs of the zone view: grouping, user state and overrides. */
export interface ZoneViewOptions {
  mode: ZoningMode;
  overrides?: ZoneOverrides;
  /** Explicit expand / collapse state keyed `<containerId>|<itemId>` (beats every default). */
  expansion: Record<string, boolean>;
  /** Zone item ids that must be expanded now. */
  reveal?: string[];
  /** Hierarchy refs (file / symbol / entity ids) to reveal: every zone containing them opens (search, deep link). */
  revealRefs?: string[];
  /** Mounted-node budget (default `ZONE_LAYOUT.nodeBudget`). */
  nodeBudget?: number;
  /** Weighted file graph for `communities` (built once per graph by `buildFileGraph`). */
  fileGraph?: ZoningFileGraph;
  /** Last community assignment (file path → community key) for stable re-zoning. */
  previousAssignment?: Record<string, string>;
}
