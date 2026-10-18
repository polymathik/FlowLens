/**
 * Hand-built FlowGraphs for the flow unit tests: declare files (with their
 * text), entities and relations compactly, no indexing involved.
 */
import type { Entity, EntityKind } from '../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../src/contracts/relations.js';
import { FlowGraph } from '../../src/flow/graph.js';
import type { SourceProvider } from '../../src/flow/source.js';

export interface SymSpec {
  /** Qualified name relative to the file: 'handler', 'Cls', 'Cls.method'. */
  qn: string;
  kind?: EntityKind;
  line?: number;
  end?: number;
  visibility?: Entity['visibility'];
}

export interface FileSpec {
  text?: string;
  language?: string;
  role?: Entity['file_role'];
  symbols?: SymSpec[];
}

export interface RelSpec {
  from: string;
  to: string;
  type?: RelationType;
  line?: number;
  weight?: number;
  meta?: Relation['meta'];
}

export interface Built {
  graph: FlowGraph;
  source: SourceProvider;
  id: (qn: string) => string;
}

const LANG = (f: string): string => (f.endsWith('.svelte') ? 'svelte' : f.endsWith('.vue') ? 'vue' : f.endsWith('.tsx') ? 'tsx' : f.endsWith('.py') ? 'python' : f.endsWith('.go') ? 'go' : f.endsWith('.json') ? 'json' : 'typescript');

/** `from`/`to` in RelSpec are qualified names ('a.ts/h' or a bare file path). */
export function buildGraph(files: Record<string, FileSpec>, rels: RelSpec[] = [], unresolved: Array<{ from: string; name: string; line?: number; type?: RelationType; candidates?: string[] }> = []): Built {
  const entities: Entity[] = [];
  const byQn = new Map<string, Entity>();
  const mk = (file: string, qn: string, kind: EntityKind, line: number, end: number, language: string, extra: Partial<Entity> = {}): Entity => {
    const e: Entity = {
      id: `id:${qn}`, kind, name: qn.split(/[/.]/).pop() as string, qualified_name: qn, file,
      location: { line_start: line, line_end: end, column_start: 1, column_end: 1 }, visibility: 'public', language, ...extra,
    };
    entities.push(e);
    byQn.set(qn, e);
    return e;
  };
  for (const [file, spec] of Object.entries(files)) {
    const lang = spec.language ?? LANG(file);
    const lines = (spec.text ?? '').split('\n').length;
    mk(file, file, 'file', 1, lines, lang, { name: file.split('/').pop() as string, file_role: spec.role ?? 'source' });
    for (const s of spec.symbols ?? []) {
      mk(file, `${file}/${s.qn}`, s.kind ?? (s.qn.includes('.') ? 'method' : 'function'), s.line ?? 1, s.end ?? s.line ?? 1, lang, { visibility: s.visibility ?? 'public' });
    }
  }
  const ent = (qn: string): Entity => {
    const e = byQn.get(qn);
    if (!e) throw new Error(`unknown entity ${qn}`);
    return e;
  };
  let n = 0;
  const relations: Relation[] = rels.map((r) => ({
    id: `r${n++}`, from: ent(r.from).id, to: ent(r.to).id, type: r.type ?? 'call',
    location: { file: ent(r.from).file, line: r.line ?? 1, column: 1 }, weight: r.weight ?? 1, confidence: 1, ...(r.meta ? { meta: r.meta } : {}),
  }));
  const unres: Relation[] = unresolved.map((u) => ({
    id: `u${n++}`, from: ent(u.from).id, to: '', type: u.type ?? 'call', location: { file: ent(u.from).file, line: u.line ?? 1, column: 1 },
    weight: 1, confidence: 0.5, resolution: u.candidates ? 'ambiguous' : 'unresolved', target_name: u.name, ...(u.candidates ? { meta: { candidates: u.candidates.map((c) => ent(c).id) } } : {}),
  }));
  return {
    graph: new FlowGraph({ entities, relations, unresolved: unres }),
    source: (f) => files[f]?.text,
    id: (qn) => ent(qn).id,
  };
}
