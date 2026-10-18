/**
 * Pass 2 for one batch of parsed files: resolve pending relations through
 * the project symbol table, validate direct targets, aggregate edges.
 */
import type { Relation } from '../contracts/relations.js';
import type { FileSymbolRecord, ResolutionStats } from '../contracts/symbols.js';
import { ProjectSymbolTable } from '../parser/symbols/symbol-table.js';
import { resolvePendingRelations, emptyStats } from '../parser/symbols/resolve-pending.js';
import { aggregateRelations } from '../graph/aggregate.js';
import type { ParsedFileOutput } from './parallel-parser.js';

export interface FileEdges {
  edges: Relation[];
  unresolved: Relation[];
}

export interface Pass2Result {
  byFile: Map<string, FileEdges>;
  stats: ResolutionStats;
  /** Direct relations dropped because their target is not an indexed entity. */
  droppedDirect: number;
}

export function runPass2(records: Map<string, FileSymbolRecord>, parsed: ParsedFileOutput[]): Pass2Result {
  const table = new ProjectSymbolTable(records);
  const stats = emptyStats();
  const byFile = new Map<string, FileEdges>();
  let droppedDirect = 0;

  for (const file of parsed) {
    if (file.failed) continue;
    const resolved = resolvePendingRelations(table, file.pending, stats);
    const direct: Relation[] = [];
    for (const r of file.relations) {
      // Same-file targets are always known; import edges may name files that
      // exist on disk but are not indexed (excluded / unsupported) → drop.
      if (table.entity(r.to) || isOwnEntity(file, r.to)) direct.push({ ...r, resolution: r.resolution ?? 'direct' });
      else droppedDirect++;
    }
    byFile.set(file.path, {
      edges: aggregateRelations([...direct, ...resolved.relations]),
      unresolved: aggregateRelations(resolved.unresolved),
    });
  }
  return { byFile, stats, droppedDirect };
}

function isOwnEntity(file: ParsedFileOutput, id: string): boolean {
  return file.entities.some((e) => e.id === id);
}

/**
 * Cross-file id collisions: the same id produced by two different files.
 * (Same-file duplicates are merged by the parser and counted separately.)
 */
export function countIdCollisions(records: Map<string, FileSymbolRecord>): { count: number; examples: string[] } {
  const owner = new Map<string, string>();
  let count = 0;
  const examples: string[] = [];
  for (const [file, rec] of records) {
    for (const e of rec.entities) {
      const prev = owner.get(e.id);
      if (prev !== undefined && prev !== file) {
        count++;
        if (examples.length < 5) examples.push(`${e.id}: ${prev} / ${file} (${e.qualified_name})`);
      } else {
        owner.set(e.id, file);
      }
    }
  }
  return { count, examples };
}

/** Strict id checking: tests and FLOWLENS_STRICT_IDS=1 fail loudly. */
export function strictIds(): boolean {
  return process.env.FLOWLENS_STRICT_IDS === '1' || process.env.VITEST === 'true';
}
