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
 */

import { createRequire } from 'node:module';
import { ClassicLevel } from 'classic-level';
import type { GraphStore } from '../contracts/graph.js';
import type { Entity, EntityKind } from '../contracts/entities.js';
import type { Relation, RelationType } from '../contracts/relations.js';
import { wrapForCallbacks } from './level-compat.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const levelgraph = require('levelgraph');

/** Internal predicates used for node/edge index triples. */
const INTERNAL_PREDICATES = new Set(['entity', 'in_file', 'edge_idx', 'edge_in_file']);

/* ---------- LevelGraph minimal typings ---------- */

interface Triple {
  subject: string;
  predicate: string;
  object: string;
  [key: string]: unknown;
}

interface LevelGraphDB {
  put(triple: Triple | Triple[], cb: (err: Error | null) => void): void;
  get(pattern: Partial<Triple>, cb: (err: Error | null, list: unknown[]) => void): void;
  del(triple: Triple | Triple[], cb: (err: Error | null) => void): void;
  close(cb: (err?: Error | null) => void): void;
}

/* ---------- Promisified helpers ---------- */

function lgPut(db: LevelGraphDB, triple: Triple | Triple[]): Promise<void> {
  return new Promise((resolve, reject) => {
    db.put(triple, (err) => (err ? reject(err) : resolve()));
  });
}

function lgGet(db: LevelGraphDB, pattern: Partial<Triple>): Promise<Triple[]> {
  return new Promise((resolve, reject) => {
    db.get(pattern, (err, list) => {
      if (err) return reject(err);
      const triples = (list as unknown[]).map((item) =>
        typeof item === 'string' ? JSON.parse(item) as Triple : item as Triple,
      );
      resolve(triples);
    });
  });
}

function lgDel(db: LevelGraphDB, triple: Triple | Triple[]): Promise<void> {
  return new Promise((resolve, reject) => {
    db.del(triple, (err) => (err ? reject(err) : resolve()));
  });
}

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
    const db = this.ensureOpen();
    const entityTriple: Triple = {
      subject: entity.id,
      predicate: 'entity',
      object: entity.kind,
      _data: JSON.stringify(entity),
    };
    const fileTriple: Triple = {
      subject: entity.id,
      predicate: 'in_file',
      object: entity.file,
    };
    await lgPut(db, entityTriple);
    await lgPut(db, fileTriple);
  }

  async putNodes(entities: Entity[]): Promise<void> {
    for (const entity of entities) {
      await this.putNode(entity);
    }
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
    const db = this.ensureOpen();
    const data = JSON.stringify(relation);

    // Primary edge triple
    const edgeTriple: Triple = {
      subject: relation.from,
      predicate: relation.type,
      object: relation.to,
      _data: data,
      _edgeId: relation.id,
      _file: relation.location.file,
    };
    await lgPut(db, edgeTriple);

    // Edge ID index — allows lookup/delete by edge ID
    const idxTriple: Triple = {
      subject: relation.id,
      predicate: 'edge_idx',
      object: relation.from,
      _data: data,
    };
    await lgPut(db, idxTriple);

    // Edge file index — allows deleteEdgesByFile
    const fileTriple: Triple = {
      subject: relation.id,
      predicate: 'edge_in_file',
      object: relation.location.file,
    };
    await lgPut(db, fileTriple);
  }

  async putEdges(relations: Relation[]): Promise<void> {
    for (const rel of relations) {
      await this.putEdge(rel);
    }
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
  }

  /* ---- internal ---- */

  private ensureOpen(): LevelGraphDB {
    if (!this.db) throw new Error('LevelGraphStore is not open');
    return this.db;
  }
}
