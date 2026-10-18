/**
 * Read-mostly in-memory GraphStore over plain arrays.
 *
 * The health engine is pure: it receives entities + relations once and
 * reuses the existing analysis functions (cycle detection, architecture
 * validation, hotspots) through this adapter, so they never touch disk.
 */
import type { GraphStore } from '../contracts/graph.js';
import type { Entity, EntityKind } from '../contracts/entities.js';
import type { Relation, RelationType } from '../contracts/relations.js';

export class MemoryGraphStore implements GraphStore {
  private nodes = new Map<string, Entity>();
  private edges = new Map<string, Relation>();
  private from = new Map<string, Relation[]>();
  private to = new Map<string, Relation[]>();

  constructor(entities: Entity[] = [], relations: Relation[] = []) {
    for (const e of entities) this.nodes.set(e.id, e);
    for (const r of relations) this.edges.set(r.id, r);
    this.reindex();
  }

  private reindex(): void {
    this.from.clear();
    this.to.clear();
    for (const r of this.edges.values()) {
      (this.from.get(r.from) ?? this.from.set(r.from, []).get(r.from)!).push(r);
      (this.to.get(r.to) ?? this.to.set(r.to, []).get(r.to)!).push(r);
    }
  }

  async putNode(entity: Entity): Promise<void> {
    this.nodes.set(entity.id, entity);
  }
  async getNode(id: string): Promise<Entity | null> {
    return this.nodes.get(id) ?? null;
  }
  async getNodesByKind(kind: EntityKind): Promise<Entity[]> {
    return [...this.nodes.values()].filter((e) => e.kind === kind);
  }
  async getNodesByFile(filePath: string): Promise<Entity[]> {
    return [...this.nodes.values()].filter((e) => e.file === filePath);
  }
  async deleteNode(id: string): Promise<void> {
    this.nodes.delete(id);
  }
  async deleteNodesByFile(filePath: string): Promise<void> {
    for (const [id, e] of this.nodes) if (e.file === filePath) this.nodes.delete(id);
  }
  async putEdge(relation: Relation): Promise<void> {
    this.edges.set(relation.id, relation);
    this.reindex();
  }
  async getEdgesFrom(entityId: string, type?: RelationType): Promise<Relation[]> {
    const list = this.from.get(entityId) ?? [];
    return type ? list.filter((r) => r.type === type) : [...list];
  }
  async getEdgesTo(entityId: string, type?: RelationType): Promise<Relation[]> {
    const list = this.to.get(entityId) ?? [];
    return type ? list.filter((r) => r.type === type) : [...list];
  }
  async deleteEdge(id: string): Promise<void> {
    this.edges.delete(id);
    this.reindex();
  }
  async deleteEdgesByFile(filePath: string): Promise<void> {
    for (const [id, r] of this.edges) if (r.location.file === filePath) this.edges.delete(id);
    this.reindex();
  }
  async putNodes(entities: Entity[]): Promise<void> {
    for (const e of entities) this.nodes.set(e.id, e);
  }
  async putEdges(relations: Relation[]): Promise<void> {
    for (const r of relations) this.edges.set(r.id, r);
    this.reindex();
  }
  async getAllNodes(): Promise<Entity[]> {
    return [...this.nodes.values()];
  }
  async getAllEdges(): Promise<Relation[]> {
    return [...this.edges.values()];
  }
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  async clear(): Promise<void> {
    this.nodes.clear();
    this.edges.clear();
    this.reindex();
  }
}
