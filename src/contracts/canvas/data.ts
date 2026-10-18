/**
 * Canvas data contract — the shape of nodes and edges rendered by the
 * React Flow canvas. These types are the boundary between:
 *   (a) the graph API (Entity / Relation from the backend) and
 *   (b) React Flow's internal node/edge representation.
 *
 * Transformers in `src/canvas/utils/node-transformer.ts` and
 * `src/canvas/utils/edge-transformer.ts` produce values satisfying
 * these types. Custom node components consume the discriminated
 * `CanvasNodeData` variants by switching on `level`.
 *
 * Phase 10 (Lane C3) revised this contract to the shape the canvas really
 * renders (it had drifted: components used `label`, the contract `name`).
 * Breaking only for canvas-internal code — nothing outside `src/canvas/`
 * imports these types.
 */
import type { EntityKind, Visibility } from '../entities.js';
import type { RelationType, Relation } from '../relations.js';
import type { HierarchyKind } from '../hierarchy.js';

/**
 * React Flow node type identifiers — discriminator for the data union.
 * Map v2 (lane M1): the hierarchy is Project → package → folder → file →
 * symbol (see `contracts/hierarchy.ts`); a view shows ONLY the children of
 * the container in the breadcrumb, plus portals for links that leave it.
 */
export type CanvasNodeType =
  | 'package'  // workspace package (named by its manifest)
  | 'folder'   // directory (single-child chains collapsed)
  | 'config'   // muted pseudo-folder holding config files / lockfiles
  | 'file'     // individual file (also symbol-less ones)
  | 'entity'   // class / function / interface / method ("symbol" in UI text)
  | 'scope'    // the open file's own top level (its imports / exports)
  | 'portal';  // stub for links to/from outside the open container

/**
 * Visual overlay decoration computed by the overlay manager and rendered by
 * node components (never by mutating the React Flow wrapper style, whose
 * `transform` positions the node).
 */
export interface NodeOverlayStyle {
  /** Background tint. */
  fill?: string;
  /** Border colour. */
  stroke?: string;
  strokeStyle?: 'solid' | 'dashed';
  strokeWidth?: number;
  /** Visual scale of the node body (hotspot overlay). */
  scale?: number;
  /** Short badge text (e.g. "cycle", "2 rule breaks"). */
  badge?: string;
  /** Stable marker used by tests and styling: overlay id that produced this. */
  tag: string;
  /** True when the overlay has nothing to say about this node (rendered subdued). */
  muted?: boolean;
}

/** Fields shared by all node levels. */
interface CanvasNodeBase {
  label: string;
  qualityScore?: number;
  /** Git churn (changes/day), max over contained symbols. */
  churnRate?: number;
  /** churn × cognitive complexity, max over contained symbols. */
  hotspotScore?: number;
  overlay?: NodeOverlayStyle;
  /** Index signature required by React Flow's `Node<Data>` constraint. */
  [key: string]: unknown;
}

/** Hierarchy facts every container card shows. */
interface ContainerFacts {
  /** Hierarchy node id (same as the React Flow node id). */
  hierarchyId: string;
  /** Directory (package/folder/config). */
  path: string;
  /** Direct children by kind. */
  folderCount: number;
  fileCount: number;
  /** Symbols below (recursive). */
  symbolCount: number;
  /** Names of the largest files below (at most 3). */
  topFiles: string[];
}

/** Data payload for a package or folder node. */
export interface FolderNodeData extends CanvasNodeBase, ContainerFacts {
  level: 'package' | 'folder';
  /** Package nodes: manifest name differs from the directory name. */
  packageName?: string;
}

/** Data payload for the muted Config group. */
export interface ConfigNodeData extends CanvasNodeBase, ContainerFacts {
  level: 'config';
}

/** Data payload for a file-level node. */
export interface FileNodeData extends CanvasNodeBase {
  level: 'file';
  hierarchyId: string;
  filePath: string;
  /** Symbols declared in the file (recursive). */
  symbolCount: number;
  role?: string;
  language?: string;
  lines?: number;
}

/** Data payload for an entity-level node (class, function, etc.). */
export interface EntityNodeData extends CanvasNodeBase {
  level: 'entity';
  hierarchyId: string;
  entityKind: EntityKind;
  visibility: Visibility;
  filePath: string;
  /** Direct members (classes, namespaces). */
  memberCount: number;
  cognitiveComplexity?: number;
  annotations?: CanvasAnnotation[];
}

/** The open file's own top level: where its import / export relations attach. */
export interface ScopeNodeData extends CanvasNodeBase {
  level: 'scope';
  hierarchyId: string;
  filePath: string;
}

/** A stub standing for every link between the open container and one outside container. */
export interface PortalNodeData extends CanvasNodeBase {
  level: 'portal';
  direction: 'in' | 'out';
  /** Hierarchy node a click navigates to. */
  targetId: string;
  targetKind: HierarchyKind;
  /** Relations behind the portal (exact), over all structural types. */
  count: number;
  typeCounts: Partial<Record<RelationType, number>>;
  /** Relations behind the portal that the relation-type filter currently hides. */
  hiddenByFilter?: number;
}

/** Minimal annotation shape used on the canvas. Mirrors backend annotation record. */
export interface CanvasAnnotation {
  id: string;
  text: string;
  author: string;
  category: string;
}

/** Discriminated union of all node-data shapes, keyed by `level`. */
export type CanvasNodeData =
  | FolderNodeData
  | ConfigNodeData
  | FileNodeData
  | EntityNodeData
  | ScopeNodeData
  | PortalNodeData;

/** React Flow-compatible canvas node (strict CanvasNodeData). */
export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  data: CanvasNodeData;
  position: { x: number; y: number };
  /** Set only when compound nesting is in use (zones, lane M2). */
  parentId?: string;
  extent?: 'parent';
  style?: Record<string, string | number>;
  /** Width/height measured after first render; used by ELK layout. */
  measured?: { width: number; height: number };
}

/**
 * Edge data payload. An edge is either an entity-level edge (exactly one
 * underlying Relation between two visible symbols) or an aggregated edge
 * collapsing several relations between two visible nodes. Both carry the
 * full `types` list so relation filters can check every aggregated type.
 */
export interface CanvasEdgeData {
  kind: 'entity-edge' | 'aggregated-edge';
  /** Every relation type collapsed into this edge, most frequent first. */
  types: RelationType[];
  /** Most frequent type — drives colour and arrow marker. */
  dominantType: RelationType;
  /** Relations behind the edge, restricted to the visible relation types. */
  count: number;
  /** Per-type breakdown of `count` (same restriction). */
  typeCounts?: Partial<Record<RelationType, number>>;
  /** Text on the edge, e.g. "imports 12 · calls 3". */
  label?: string;
  /** Ids of every relation collapsed into the edge (for the detail panel). */
  relationIds?: string[];
  /** Set on edges between a portal stub and an inner node. */
  portal?: 'in' | 'out';
  /** Present on entity-level edges only. */
  relation?: Relation;
  is_violation?: boolean;
  is_cycle?: boolean;
  /** Index signature required by React Flow's `Edge<Data>` constraint. */
  [key: string]: unknown;
}

/** React Flow-compatible canvas edge. */
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  /** Custom edge component: 'relation', 'violation', or 'cycle'. */
  type?: 'relation' | 'violation' | 'cycle';
  data: CanvasEdgeData;
  animated?: boolean;
  style?: Record<string, string | number>;
  label?: string;
  /** URL reference or a React Flow marker object ({ type: 'arrowclosed', color }). */
  markerEnd?: string | { type: string; color?: string; width?: number; height?: number };
}
