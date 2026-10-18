/**
 * Resolve a name written in source to graph entities, the way a reader
 * would: this file first, then the files it imports (through barrels).
 * Used by the detectors (handler references, mounted components) and by the
 * inline-callback scan, where the extractor kept no relation.
 */
import type { Entity, EntityKind } from '../contracts/entities.js';
import type { FlowGraph } from './graph.js';

const CALLABLE: ReadonlySet<EntityKind> = new Set(['function', 'method', 'class', 'component', 'variable']);

export interface NameQuery {
  file: string;
  name: string;
  /** `ctrl` of `ctrl.list`, or `this`. */
  qualifier?: string;
  /** Line of the reference (needed for `this.x`). */
  line?: number;
  kinds?: ReadonlySet<EntityKind>;
}

export interface NameMatch {
  entity: Entity;
  /** 'self' = declared in the same file, 'import' = an imported file, 'member' = found via a class/qualifier. */
  how: 'self' | 'import' | 'member';
}

/** Entities `name` may refer to from `file`, nearest first; empty when nothing matches. */
export function resolveName(graph: FlowGraph, q: NameQuery): NameMatch[] {
  const kinds = q.kinds ?? CALLABLE;
  const ok = (e: Entity | undefined): e is Entity => !!e && kinds.has(e.kind) && e.kind !== 'file';
  const files = [q.file, ...graph.importedFiles(q.file)];
  const out: NameMatch[] = [];
  const add = (e: Entity | undefined, how: NameMatch['how']): void => {
    if (ok(e) && !out.some((m) => m.entity.id === e.id)) out.push({ entity: e, how });
  };

  if (q.qualifier === 'this' && q.line !== undefined) {
    const scope = graph.enclosing(q.file, q.line);
    const cls = scope && (scope.kind === 'class' ? scope : graph.container(scope));
    if (cls) add(graph.member(cls, q.name), 'member');
    return out;
  }
  if (q.qualifier) {
    const head = q.qualifier.split('.').pop() as string;
    for (const f of files) {
      const holder = graph.byQn.get(`${f}/${head}`);
      if (holder && (holder.kind === 'class' || holder.kind === 'interface' || holder.kind === 'namespace')) add(graph.member(holder, q.name), 'member');
    }
    if (out.length > 0) return out;
    // `instance.method`: the receiver's type is unknown; accept a method of that name in this file's scope.
    for (const f of files) {
      for (const e of graph.byName.get(q.name) ?? []) if (e.file === f && e.kind === 'method') add(e, 'member');
    }
    return out;
  }
  files.forEach((f, i) => add(graph.byQn.get(`${f}/${q.name}`), i === 0 ? 'self' : 'import'));
  return out;
}
