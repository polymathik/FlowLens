/**
 * Canvas data contract — the shape of nodes and edges rendered by the
 * React Flow canvas. These types are the boundary between:
 *   (a) the graph API (Entity / Relation from the backend) and
 *   (b) React Flow's internal node/edge representation.
 *
 * Transformers in `src/canvas/utils/node-transformer.ts` and
 * `src/canvas/utils/edge-transformer.ts` produce values satisfying
 * these types. Custom node components consume the discriminated
 * `CanvasNodeData` variants by switching on node `type`.
 */
import type { Entity, EntityMetrics } from '../entities.js';
import type { Relation, RelationType } from '../relations.js';

/** React Flow node type identifiers — discriminator for the data union. */
export type CanvasNodeType =
  | 'system'   // top-level directory (e.g. src, test)
  | 'module'   // subdirectory within a system (e.g. src/parser)
  | 'file'     // individual source file
  | 'entity';  // class / function / interface / method

/** Data payload for a system-level node (top-level directory). */
export interface SystemNodeData {
  kind: 'system';
  name: string;
  path: string;
  entityCount: number;
  qualityScore?: number;
  /** For drill-down filtering — set on child nodes, not on system nodes. */
  parentSystem?: undefined;
}

/** Data payload for a module-level node (subdirectory). */
export interface ModuleNodeData {
  kind: 'module';
  name: string;
  path: string;
  entityCount: number;
  qualityScore?: number;
  /** Parent system id (e.g. "system:src"). */
  parentSystem: string;
}

/** Data payload for a file-level node. */
export interface FileNodeData {
  kind: 'file';
  name: string;
  path: string;
  entityCount: number;
  qualityScore?: number;
  /** Parent system id. */
  parentSystem: string;
  /** Parent module id (e.g. "module:src/parser"). Undefined for files at the system root. */
  parentModule?: string;
}

/** Data payload for an entity-level node (class, function, etc.). */
export interface EntityNodeData {
  kind: 'entity';
  entity: Entity;
  metrics?: EntityMetrics;
  annotations?: CanvasAnnotation[];
  /** Parent file id (e.g. "file:src/parser/ast.ts"). */
  parentFile: string;
  /** Parent system id (for breadcrumb context). */
  parentSystem: string;
  /** Optional architecture layer label for overlay display. */
  layer?: string;
}

/** Minimal annotation shape used on the canvas. Mirrors backend annotation record. */
export interface CanvasAnnotation {
  id?: string;
  entity_id?: string;
  text: string;
  author?: string;
  category?: 'convention' | 'decision' | 'warning' | 'todo';
  created_at?: string;
}

/** Discriminated union of all node-data shapes, keyed by `kind`. */
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
 * Edge data payload. An edge is either an entity-level edge (one underlying
 * Relation) or an aggregated edge collapsing multiple relations between
 * two parent nodes.
 */
export type CanvasEdgeData =
  | {
      kind: 'entity-edge';
      relation: Relation;
      is_violation?: boolean;
      is_cycle?: boolean;
    }
  | {
      kind: 'aggregated-edge';
      types: RelationType[];
      count: number;
      is_violation?: boolean;
      is_cycle?: boolean;
    };

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
  markerEnd?: string;
}
