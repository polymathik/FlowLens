/**
 * LevelGraph-backed implementation of the GraphStore interface.
 *
 * Wraps LevelGraph's callback-based API with promises and adds
 * secondary index triples for querying nodes by kind and file.
 *
 * Storage schema:
 *   Node entity:   { subject: entityId, predicate: 'entity',       object: entityKind, _data: <json> }
 *   Node file idx: { subject: entityId, predicate: 'in_file',      object: filePath }
 *   Edge:          { subject: fromId,   predicate: relationType,    object: toId,  _data: <json> }
 *   Edge ID idx:   { subject: edgeId,   predicate: 'edge_idx',     object: fromId, _data: <json> }
 *   Edge file idx: { subject: edgeId,   predicate: 'edge_in_file', object: filePath }
 *   Unresolved:    { subject: edgeId,   predicate: 'unresolved',   object: filePath, _data: <json> }
 *
 * Edge identity: the primary edge triple is keyed by (from, type, to), so
 * repeated occurrences must be aggregated into one relation with a summed
 * `weight` (see graph/aggregate.ts). `putEdges` aggregates within its batch
 * and, if an edge with the same key already exists from an earlier write,
 * replaces it and removes the stale index triples.
 *
 * Unresolved / ambiguous relations (`to === ''`) never become edge triples;
 * they live under the internal `unresolved` predicate, are excluded from
 * every edge read and removed by `deleteEdgesByFile`.
 */

import { createRequire } from 'node:module';
import { ClassicLevel } from 'classic-level';
import type { GraphStore } from '../contracts/graph.js';
import type { Entity, EntityKind } from '../contracts/entities.js';
import type { Relation, RelationType } from '../contracts/relations.js';
import { wrapForCallbacks } from './level-compat.js';
import { aggregateRelations } from './aggregate.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const levelgraph = require('levelgraph');

/** Internal predicates used for node/edge index triples. */
const INTERNAL_PREDICATES = new Set(['entity', 'in_file', 'edge_idx', 'edge_in_file', 'unresolved']);

function isUnresolved(r: Relation): boolean {
  return r.to === '' || r.resolution === 'unresolved' || r.resolution === 'ambiguous';
}

import { type Triple, type LevelGraphDB, lgPut, lgGet, lgDel } from './levelgraph-helpers.js';

/* ---------- LevelGraphStore ---------- */

export class LevelGraphStore implements GraphStore {
  private db: LevelGraphDB | null = null;
  private level: ClassicLevel | null = null;

  /* ---- lifecycle ---- */

  async open(dbPath: string): Promise<void> {
    const raw = new ClassicLevel(dbPath, { valueEncoding: 'json' });
    await raw.open();
    this.level = raw;
    this.db = levelgraph(wrapForCallbacks(raw)) as LevelGraphDB;
  }

  async close(): Promise<void> {
    if (!this.db) return;
    return new Promise<void>((resolve, reject) => {
      this.db!.close((err?: Error | null) => {
        this.db = null;
        this.level = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async clear(): Promise<void> {
    const db = this.ensureOpen();
    const all = await lgGet(db, {});
    if (all.length === 0) return;
    for (const triple of all) {
      await lgDel(db, triple);
    }
  }

  /* ---- nodes ---- */

  async putNode(entity: Entity): Promise<void> {
    await this.putNodes([entity]);
  }

  async putNodes(entities: Entity[]): Promise<void> {
    if (entities.length === 0) return;
    const db = this.ensureOpen();
    const triples: Triple[] = [];
    for (const entity of entities) {
      triples.push(
        { subject: entity.id, predicate: 'entity', object: entity.kind, _data: JSON.stringify(entity) },
        { subject: entity.id, predicate: 'in_file', object: entity.file },
      );
    }
    await lgPut(db, triples);
  }

  async getNode(id: string): Promise<Entity | null> {
    const db = this.ensureOpen();
    const results = await lgGet(db, { subject: id, predicate: 'entity' });
    if (results.length === 0) return null;
    return JSON.parse(results[0]._data as string) as Entity;
  }

  async getNodesByKind(kind: EntityKind): Promise<Entity[]> {
    const db = this.ensureOpen();
    const results = await lgGet(db, { predicate: 'entity', object: kind });
    return results.map((t) => JSON.parse(t._data as string) as Entity);
  }

  async getNodesByFile(filePath: string): Promise<Entity[]> {
    const db = this.ensureOpen();
    const fileTriples = await lgGet(db, { predicate: 'in_file', object: filePath });
    const entities: Entity[] = [];
    for (const ft of fileTriples) {
      const entity = await this.getNode(ft.subject);
      if (entity) entities.push(entity);
    }
    return entities;
  }

  async deleteNode(id: string): Promise<void> {
    const db = this.ensureOpen();

    // Remove entity triple
    const entityTriples = await lgGet(db, { subject: id, predicate: 'entity' });
    for (const t of entityTriples) await lgDel(db, t);

    // Remove in_file index triple
    const fileTriples = await lgGet(db, { subject: id, predicate: 'in_file' });
    for (const t of fileTriples) await lgDel(db, t);
  }

  async deleteNodesByFile(filePath: string): Promise<void> {
    const db = this.ensureOpen();
    const fileTriples = await lgGet(db, { predicate: 'in_file', object: filePath });
    for (const ft of fileTriples) {
      await this.deleteNode(ft.subject);
    }
  }

  /* ---- edges ---- */

  async putEdge(relation: Relation): Promise<void> {
    await this.putEdges([relation]);
  }

  async putEdges(relations: Relation[]): Promise<void> {
    if (relations.length === 0) return;
    const db = this.ensureOpen();
    const triples: Triple[] = [];
    for (const relation of aggregateRelations(relations)) {
      const data = JSON.stringify(relation);
      if (isUnresolved(relation)) {
        triples.push({ subject: relation.id, predicate: 'unresolved', object: relation.location.file, _data: data });
        continue;
      }
      // Replace an existing edge with the same key written by an earlier call.
      const existing = await lgGet(db, { subject: relation.from, predicate: relation.type, object: relation.to });
      for (const t of existing) {
        if (t._edgeId && t._edgeId !== relation.id) await this.deleteEdge(t._edgeId as string);
      }
      triples.push(
        // Primary edge triple
        { subject: relation.from, predicate: relation.type, object: relation.to, _data: data, _edgeId: relation.id, _file: relation.location.file },
        // Edge ID index — lookup/delete by edge ID
        { subject: relation.id, predicate: 'edge_idx', object: relation.from, _data: data },
        // Edge file index — deleteEdgesByFile
        { subject: relation.id, predicate: 'edge_in_file', object: relation.location.file },
      );
    }
    await lgPut(db, triples);
  }

  async getUnresolvedRelations(): Promise<Relation[]> {
    const db = this.ensureOpen();
    const results = await lgGet(db, { predicate: 'unresolved' });
    return results.map((t) => JSON.parse(t._data as string) as Relation);
  }

  async getEdgesFrom(entityId: string, type?: RelationType): Promise<Relation[]> {
    const db = this.ensureOpen();
    const pattern: Partial<Triple> = { subject: entityId };
    if (type) pattern.predicate = type;

    const results = await lgGet(db, pattern);
    return results
      .filter((t) => !INTERNAL_PREDICATES.has(t.predicate) && t._data)
      .map((t) => JSON.parse(t._data as string) as Relation);
  }

  async getEdgesTo(entityId: string, type?: RelationType): Promise<Relation[]> {
    const db = this.ensureOpen();
    const pattern: Partial<Triple> = { object: entityId };
    if (type) pattern.predicate = type;

    const results = await lgGet(db, pattern);
    return results
      .filter((t) => !INTERNAL_PREDICATES.has(t.predicate) && t._data)
      .map((t) => JSON.parse(t._data as string) as Relation);
  }

  async deleteEdge(id: string): Promise<void> {
    const db = this.ensureOpen();

    // Find the edge via the ID index
    const idxTriples = await lgGet(db, { subject: id, predicate: 'edge_idx' });
    if (idxTriples.length === 0) return;

    const relation = JSON.parse(idxTriples[0]._data as string) as Relation;

    // Delete primary edge triple
    const edgeTriples = await lgGet(db, {
      subject: relation.from,
      predicate: relation.type,
      object: relation.to,
    });
    for (const t of edgeTriples) {
      if (t._edgeId === id) await lgDel(db, t);
    }

    // Delete edge ID index
    for (const t of idxTriples) await lgDel(db, t);

    // Delete edge file index
    const fileTriples = await lgGet(db, { subject: id, predicate: 'edge_in_file' });
    for (const t of fileTriples) await lgDel(db, t);
  }

  async deleteEdgesByFile(filePath: string): Promise<void> {
    const db = this.ensureOpen();
    const fileTriples = await lgGet(db, { predicate: 'edge_in_file', object: filePath });
    for (const ft of fileTriples) {
      await this.deleteEdge(ft.subject);
    }
    const unresolved = await lgGet(db, { predicate: 'unresolved', object: filePath });
    if (unresolved.length > 0) await lgDel(db, unresolved);
  }

  /* ---- bulk reads ---- */

  async getAllNodes(): Promise<Entity[]> {
    const db = this.ensureOpen();
    const results = await lgGet(db, { predicate: 'entity' });
    return results.map((t) => JSON.parse(t._data as string) as Entity);
  }

  async getAllEdges(): Promise<Relation[]> {
    // Scan only the edge-id index (one triple per edge) instead of the whole store.
    const db = this.ensureOpen();
    const results = await lgGet(db, { predicate: 'edge_idx' });
    return results.filter((t) => t._data).map((t) => JSON.parse(t._data as string) as Relation);
  }

  /** Replace everything stored for one file in a single call. */
  async replaceFile(filePath: string, entities: Entity[], relations: Relation[]): Promise<void> {
    await this.deleteEdgesByFile(filePath);
    await this.deleteNodesByFile(filePath);
    await this.putNodes(entities);
    await this.putEdges(relations);
  }

  /* ---- internal ---- */

  private ensureOpen(): LevelGraphDB {
    if (!this.db) throw new Error('LevelGraphStore is not open');
    return this.db;
  }
}
