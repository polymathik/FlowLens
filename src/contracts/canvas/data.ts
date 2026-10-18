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

/** React Flow node type identifiers — discriminator for the data union. */
export type CanvasNodeType =
  | 'system'   // top-level directory (e.g. src, test) or a root-level file
  | 'module'   // second-level directory within a system (e.g. src/parser)
  | 'file'     // individual source file
  | 'entity';  // class / function / interface / method ("symbol" in UI text)

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

/** Data payload for a system-level node (top-level directory). */
export interface SystemNodeData extends CanvasNodeBase {
  level: 'system';
  /** Directory (or root file) path. */
  path: string;
  entityCount: number;
}

/** Data payload for a module-level node (subdirectory). */
export interface ModuleNodeData extends CanvasNodeBase {
  level: 'module';
  path: string;
  entityCount: number;
  /** Parent system id (e.g. "system:src"). */
  parentSystem: string;
}

/** Data payload for a file-level node. */
export interface FileNodeData extends CanvasNodeBase {
  level: 'file';
  filePath: string;
  entityCount: number;
  parentSystem: string;
  /** Parent module id (e.g. "module:src/parser"). Undefined for files at the system root. */
  parentModule?: string;
}

/** Data payload for an entity-level node (class, function, etc.). */
export interface EntityNodeData extends CanvasNodeBase {
  level: 'entity';
  entityKind: EntityKind;
  visibility: Visibility;
  filePath: string;
  cognitiveComplexity?: number;
  annotations?: CanvasAnnotation[];
  /** Parent file id (e.g. "file:src/parser/ast.ts"). */
  parentFile: string;
  parentSystem: string;
  parentModule?: string;
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
  | SystemNodeData
  | ModuleNodeData
  | FileNodeData
  | EntityNodeData;

/** React Flow-compatible canvas node (strict CanvasNodeData). */
export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  data: CanvasNodeData;
  position: { x: number; y: number };
  /** Set only when compound nesting is in use. */
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
  count: number;
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
