/**
 * Read-mostly in-memory GraphStore built from a digest (+ patched changed
 * files). Lets the guard run the SAME analysis code (detectCycles,
 * validateArchitecture) without scanning LevelDB: on a 10K-file graph a full
 * scan costs seconds, while this view answers from memory.
 */
import type { Entity, EntityKind } from '../contracts/entities.js';
import type { GraphStore } from '../contracts/graph.js';
import type { Relation, RelationType } from '../contracts/relations.js';

export class InMemoryGraph implements GraphStore {
  private nodes = new Map<string, Entity>();
  private edges = new Map<string, Relation>();

  constructor(entities: Entity[] = [], relations: Relation[] = []) {
    for (const entity of entities) this.nodes.set(entity.id, entity);
    for (const relation of relations) this.edges.set(relation.id, relation);
  }

  async putNode(entity: Entity): Promise<void> { this.nodes.set(entity.id, entity); }
  async getNode(id: string): Promise<Entity | null> { return this.nodes.get(id) ?? null; }
  async getNodesByKind(kind: EntityKind): Promise<Entity[]> {
    return [...this.nodes.values()].filter((entity) => entity.kind === kind);
  }
  async getNodesByFile(filePath: string): Promise<Entity[]> {
    return [...this.nodes.values()].filter((entity) => entity.file === filePath);
  }
  async deleteNode(id: string): Promise<void> { this.nodes.delete(id); }
  async deleteNodesByFile(filePath: string): Promise<void> {
    for (const [id, entity] of this.nodes) if (entity.file === filePath) this.nodes.delete(id);
  }
  async putEdge(relation: Relation): Promise<void> { this.edges.set(relation.id, relation); }
  async getEdgesFrom(entityId: string, type?: RelationType): Promise<Relation[]> {
    return [...this.edges.values()].filter((r) => r.from === entityId && (!type || r.type === type));
  }
  async getEdgesTo(entityId: string, type?: RelationType): Promise<Relation[]> {
    return [...this.edges.values()].filter((r) => r.to === entityId && (!type || r.type === type));
  }
  async deleteEdge(id: string): Promise<void> { this.edges.delete(id); }
  async deleteEdgesByFile(filePath: string): Promise<void> {
    for (const [id, relation] of this.edges) if (relation.location.file === filePath) this.edges.delete(id);
  }
  async putNodes(entities: Entity[]): Promise<void> { for (const e of entities) this.nodes.set(e.id, e); }
  async putEdges(relations: Relation[]): Promise<void> { for (const r of relations) this.edges.set(r.id, r); }
  async getAllNodes(): Promise<Entity[]> { return [...this.nodes.values()]; }
  async getAllEdges(): Promise<Relation[]> { return [...this.edges.values()]; }
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  async clear(): Promise<void> { this.nodes.clear(); this.edges.clear(); }

  /** Replace everything known about `files` with fresh entities/edges (or drop deleted files). */
  replaceFiles(files: string[], entities: Entity[], relations: Relation[]): void {
    const set = new Set(files);
    for (const [id, entity] of this.nodes) if (set.has(entity.file)) this.nodes.delete(id);
    for (const [id, relation] of this.edges) if (set.has(relation.location.file)) this.edges.delete(id);
    for (const entity of entities) this.nodes.set(entity.id, entity);
    for (const relation of relations) this.edges.set(relation.id, relation);
  }
}
