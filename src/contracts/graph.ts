import type { Entity, EntityKind } from './entities.js';
import type { Relation, RelationType } from './relations.js';

/**
 * Graph store.
 *
 * Edge identity (Phase 8): an edge is unique per (from, type, to). Repeated
 * occurrences must be aggregated by the caller (or within one `putEdges`
 * batch, which the store aggregates itself) into a single relation whose
 * `weight` is the occurrence count. Writing a second edge with the same
 * (from, type, to) in a later call replaces the first.
 *
 * Unresolved / ambiguous relations (`resolution` 'unresolved' | 'ambiguous',
 * `to === ''`) passed to `putEdge(s)` are kept in a separate keyspace: they
 * are never returned by `getEdgesFrom/To` or `getAllEdges`, are removed by
 * `deleteEdgesByFile`, and can be listed with `getUnresolvedRelations`.
 */
export interface GraphStore {
  putNode(entity: Entity): Promise<void>;
  getNode(id: string): Promise<Entity | null>;
  getNodesByKind(kind: EntityKind): Promise<Entity[]>;
  getNodesByFile(filePath: string): Promise<Entity[]>;
  deleteNode(id: string): Promise<void>;
  deleteNodesByFile(filePath: string): Promise<void>;

  putEdge(relation: Relation): Promise<void>;
  getEdgesFrom(entityId: string, type?: RelationType): Promise<Relation[]>;
  getEdgesTo(entityId: string, type?: RelationType): Promise<Relation[]>;
  deleteEdge(id: string): Promise<void>;
  deleteEdgesByFile(filePath: string): Promise<void>;

  putNodes(entities: Entity[]): Promise<void>;
  putEdges(relations: Relation[]): Promise<void>;

  getAllNodes(): Promise<Entity[]>;
  getAllEdges(): Promise<Relation[]>;

  /**
   * Phase 8 (optional): replace all nodes and edges owned by `filePath`
   * (delete edges + nodes of the file, then put) in one call.
   */
  replaceFile?(filePath: string, entities: Entity[], relations: Relation[]): Promise<void>;

  /** Phase 8 (optional): unresolved / ambiguous relations, excluded from every other read. */
  getUnresolvedRelations?(): Promise<Relation[]>;

  open(dbPath: string): Promise<void>;
  close(): Promise<void>;
  clear(): Promise<void>;
}
