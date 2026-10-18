/**
 * FlowGraph — the read-only, indexed view of the graph that the flow
 * service works on (pure: built from arrays, no I/O).
 *
 * Besides the usual id / adjacency / per-file lookups it carries the
 * *unresolved* relations (the store keeps them in a separate keyspace) and a
 * few lookups the detectors and the tracer share: the enclosing entity of a
 * source line, imported files of a file, members of a container.
 */
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type { GraphStore } from '../contracts/graph.js';
import { resolveFileRole } from '../analysis/hierarchy/file-role.js';

export interface FlowGraphData {
  entities: Entity[];
  relations: Relation[];
  /** Unresolved + ambiguous relations (`to === ''`). */
  unresolved?: Relation[];
}

const CODE_SCOPES = new Set(['function', 'method', 'component', 'class']);

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const byLine = (a: Entity, b: Entity): number =>
  a.location.line_start - b.location.line_start || a.qualified_name.localeCompare(b.qualified_name);

export class FlowGraph {
  readonly byId = new Map<string, Entity>();
  readonly byFile = new Map<string, Entity[]>();
  readonly fileEntity = new Map<string, Entity>();
  readonly byName = new Map<string, Entity[]>();
  readonly byQn = new Map<string, Entity>();
  readonly out = new Map<string, Relation[]>();
  readonly in = new Map<string, Relation[]>();
  readonly unresolvedFrom = new Map<string, Relation[]>();
  private readonly memo = new Map<string, unknown>();

  constructor(readonly data: FlowGraphData) {
    for (const e of data.entities) {
      this.byId.set(e.id, e);
      push(this.byFile, e.file, e);
      push(this.byName, e.name, e);
      if (!this.byQn.has(e.qualified_name)) this.byQn.set(e.qualified_name, e);
      if (e.kind === 'file') this.fileEntity.set(e.file, e);
    }
    for (const list of this.byFile.values()) list.sort(byLine);
    for (const r of data.relations) {
      push(this.out, r.from, r);
      push(this.in, r.to, r);
    }
    for (const r of data.unresolved ?? []) push(this.unresolvedFrom, r.from, r);
  }

  get entities(): Entity[] {
    return this.data.entities;
  }

  entity(id: string): Entity | undefined {
    return this.byId.get(id);
  }

  edgesFrom(id: string, type?: string): Relation[] {
    const list = this.out.get(id) ?? [];
    return type ? list.filter((r) => r.type === type) : list;
  }

  edgesTo(id: string, type?: string): Relation[] {
    const list = this.in.get(id) ?? [];
    return type ? list.filter((r) => r.type === type) : list;
  }

  isTestFile(file: string): boolean {
    return resolveFileRole(file, this.fileEntity.get(file)?.file_role) === 'test';
  }

  /** Files whose entities are source code (not config/docs/data/generated). */
  sourceFiles(): Entity[] {
    return this.memoize('sourceFiles', () =>
      [...this.fileEntity.values()]
        .filter((f) => f.file_role === undefined || f.file_role === 'source' || f.file_role === 'test')
        .sort((a, b) => a.file.localeCompare(b.file)));
  }

  /** Smallest function / method / component / class whose lines contain `line` of `file`. */
  enclosing(file: string, line: number): Entity | undefined {
    let best: Entity | undefined;
    for (const e of this.byFile.get(file) ?? []) {
      if (!CODE_SCOPES.has(e.kind) || e.location.line_start > line || e.location.line_end < line) continue;
      if (!best || e.location.line_end - e.location.line_start <= best.location.line_end - best.location.line_start) best = e;
    }
    return best;
  }

  /** Direct members of a container by qualified-name prefix (`Class.` / `Class.method`). */
  member(container: Entity, name: string): Entity | undefined {
    const qn = `${container.qualified_name}.${name}`;
    return (this.byFile.get(container.file) ?? []).find((e) => e.qualified_name === qn && e.kind !== 'parameter' && e.kind !== 'decorator');
  }

  /** Container (class / interface / namespace) of a member, from the qualified name. */
  container(member: Entity): Entity | undefined {
    const qn = member.qualified_name;
    const dot = qn.lastIndexOf('.');
    if (dot <= qn.lastIndexOf('/')) return undefined;
    const parent = qn.slice(0, dot);
    return (this.byFile.get(member.file) ?? []).find((e) => e.qualified_name === parent && e.kind !== 'file');
  }

  /** Files directly imported by `file` (incl. through barrels that re-export), nearest first. */
  importedFiles(file: string, maxHops = 3): string[] {
    return this.memoize(`imports:${file}`, () => {
      const seen = new Set<string>([file]);
      const order: string[] = [];
      let frontier = [file];
      for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
        const next: string[] = [];
        for (const f of frontier) {
          const id = this.fileEntity.get(f)?.id;
          if (!id) continue;
          for (const r of this.edgesFrom(id, 'import')) {
            const target = this.byId.get(r.to);
            if (!target || seen.has(target.file)) continue;
            if (hop > 0 && !r.meta?.reexport) continue; // only barrels are looked through
            seen.add(target.file);
            order.push(target.file);
            next.push(target.file);
          }
        }
        frontier = next;
      }
      return order;
    });
  }

  memoize<T>(key: string, compute: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, compute());
    return this.memo.get(key) as T;
  }
}

/** Load a FlowGraph from a store (the unresolved keyspace is optional on stores that lack it). */
export async function loadFlowGraph(store: GraphStore): Promise<FlowGraph> {
  const [entities, relations, unresolved] = await Promise.all([
    store.getAllNodes(),
    store.getAllEdges(),
    store.getUnresolvedRelations?.() ?? Promise.resolve([]),
  ]);
  return new FlowGraph({ entities, relations, unresolved });
}
