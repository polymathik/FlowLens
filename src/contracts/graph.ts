import type { Entity, EntityKind } from './entities.js';
import type { Relation, RelationType } from './relations.js';

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

  open(dbPath: string): Promise<void>;
  close(): Promise<void>;
  clear(): Promise<void>;
}
