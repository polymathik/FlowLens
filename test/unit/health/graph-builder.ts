/**
 * Tiny synthetic-graph builder for health rule tests.
 *   const g = new GraphBuilder().file('a.ts').file('b.ts').dep('a.ts', 'b.ts');
 *   const report = await buildHealthReport(g.input());
 */
import type { Entity, EntityKind } from '../../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../../src/contracts/relations.js';
import type { HealthInput } from '../../../src/contracts/health.js';
import type { FileChurnData } from '../../../src/contracts/analysis/churn.js';
import type { ArchitectureConfig } from '../../../src/contracts/architecture.js';
import type { GraphManifest } from '../../../src/contracts/manifest.js';

export class GraphBuilder {
  entities: Entity[] = [];
  relations: Relation[] = [];
  churn: Map<string, FileChurnData> | null = null;
  architecture: ArchitectureConfig | null = null;
  manifest: GraphManifest | null = null;
  private seq = 0;

  fileId(file: string): string {
    return `file:${file}`;
  }

  file(file: string, opts: { lines?: number; language?: string } = {}): this {
    if (this.entities.some((e) => e.id === this.fileId(file))) return this;
    this.entities.push(entity(this.fileId(file), 'file', file.split('/').pop()!, file, file, 1, opts.lines ?? 20, opts.language));
    return this;
  }

  fn(file: string, name: string, opts: { cc?: number; cyclo?: number; line?: number; lines?: number; kind?: EntityKind } = {}): this {
    this.file(file);
    const start = opts.line ?? 1 + this.seq++;
    const e = entity(`fn:${file}:${name}`, opts.kind ?? 'function', name, `${file}/${name}`, file, start, start + (opts.lines ?? 10) - 1);
    e.metrics = { line_count: opts.lines ?? 10, cognitive_complexity: opts.cc ?? 1, cyclomatic_complexity: opts.cyclo };
    this.entities.push(e);
    this.relations.push(rel(this.fileId(file), e.id, 'contain', file, start));
    return this;
  }

  /** File-level import from `from` to `to` (creates both files). */
  dep(from: string, to: string, opts: { line?: number; type?: RelationType } = {}): this {
    this.file(from).file(to);
    this.relations.push(rel(this.fileId(from), this.fileId(to), opts.type ?? 'import', from, opts.line ?? 1));
    return this;
  }

  /** Import whose target does not exist in the graph. */
  dangling(from: string, line = 1): this {
    this.file(from);
    this.relations.push(rel(this.fileId(from), `missing:${from}:${line}:${this.seq++}`, 'import', from, line));
    return this;
  }

  changes(file: string, count: number): this {
    this.churn ??= new Map();
    this.churn.set(file, { file, change_count: count, period_days: 90, churn_rate: count / 90, last_changed: '2026-10-01T00:00:00Z' });
    return this;
  }

  withGit(): this {
    this.churn ??= new Map();
    return this;
  }

  input(overrides: Partial<HealthInput> = {}): HealthInput {
    return {
      entities: this.entities.map((e) => ({ ...e })),
      relations: this.relations.map((r) => ({ ...r })),
      project: { id: 'proj1', name: 'demo', root: '/tmp/demo' },
      manifest: this.manifest,
      churn: this.churn,
      architecture: this.architecture,
      ...overrides,
    };
  }
}

function entity(id: string, kind: EntityKind, name: string, qn: string, file: string, start: number, end: number, language = 'typescript'): Entity {
  return {
    id,
    kind,
    name,
    qualified_name: qn,
    file,
    location: { line_start: start, line_end: end, column_start: 0, column_end: 0 },
    visibility: 'public',
    language,
    metrics: { line_count: end - start + 1 },
  };
}

let relSeq = 0;
function rel(from: string, to: string, type: RelationType, file: string, line: number): Relation {
  return { id: `r${relSeq++}:${from}->${to}:${type}:${line}`, from, to, type, location: { file, line, column: 1 }, weight: 1, confidence: 1 };
}

export function completeManifest(overrides: Partial<GraphManifest> = {}): GraphManifest {
  return {
    project_id: 'proj1',
    root: '/tmp/demo',
    schema_version: 2,
    flowlens_version: '0.1.0',
    git_head: 'abc',
    git_dirty: false,
    completion: 'complete',
    started_at: '2026-10-18T00:00:00Z',
    finished_at: '2026-10-18T00:01:00Z',
    file_count: 0,
    entity_count: 0,
    relation_count: 0,
    errors: { parse_failures: 0, unresolved_relations: 0, ambiguous_relations: 0, failed_files: [] },
    ...overrides,
  };
}

/** A fan of `n` files that each import `target`. */
export function fanIn(g: GraphBuilder, target: string, n: number, prefix = 'src/user'): GraphBuilder {
  for (let i = 0; i < n; i++) g.dep(`${prefix}${i}.ts`, target, { line: i + 1 });
  return g;
}
