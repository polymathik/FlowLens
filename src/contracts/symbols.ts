/**
 * Symbol contracts — Phase 8 two-pass resolution.
 *
 * Pass 1 (per file, inside the parser): every extractor reports
 *   - the file's entities,
 *   - direct relations (targets found in the same file / import edges to files),
 *   - *pending* relations whose target lives in another file, expressed by
 *     name (`Relation.target_name`, `to: ''`, `resolution: 'unresolved'`),
 *   - the file's `FileSymbols`: what it imports, exports and re-exports.
 *
 * Pass 2 (project-wide, in the indexer): a `SymbolTable` built from every
 * file's `FileSymbols` + entities resolves pending relations through the
 * importing file's bindings, barrels (`export *` fan-out), package scope
 * (Java package / Go directory) and member paths (`Class.method`).
 */
import type { Entity, EntityKind } from './entities.js';
import type { Relation, RelationType } from './relations.js';

/** One name brought into scope by an import statement. */
export interface ImportBinding {
  /**
   * Local name in the importing file. May be dotted for Python
   * `import pkg.mod` (local `pkg.mod`). Empty for side-effect imports.
   */
  local: string;
  /** Exported name in the source module; `'*'` = namespace, `'default'` = default export. */
  imported: string;
  /** The specifier as written (`./a.js`, `pkg.mod`, `com.x.Foo`, `example.com/m/pkg`). */
  specifier: string;
  /** Project-relative file the specifier resolved to, or null. */
  source_file: string | null;
  /**
   * Package scope the binding refers to, when it is resolved by package
   * rather than by file (Java `com.x`, Go directory `internal/util`).
   */
  source_package?: string;
  /** True when the specifier points outside the project (npm package, stdlib). */
  external: boolean;
  type_only?: boolean;
  location: { line: number; column: number };
}

/** A name a file makes visible to importers. */
export interface ExportBinding {
  /** Exported name (`default` for default exports). */
  name: string;
  /** Local declaration name in the same file (may be an import binding's local). */
  local: string;
  type_only?: boolean;
}

/** `export … from '…'` */
export interface ReExport {
  specifier: string;
  source_file: string | null;
  /** Name in the source module; `'*'` for `export *` / `export * as ns`. */
  imported: string;
  /** Name exported here; `'*'` for a plain `export * from`. */
  exported: string;
  type_only?: boolean;
}

export interface FileSymbols {
  file: string;
  language: string;
  /**
   * Package scope for languages with implicit same-package visibility
   * (Java `package` declaration; Go: the file's directory). Files sharing a
   * package see each other's top-level declarations without imports.
   */
  package?: string;
  imports: ImportBinding[];
  exports: ExportBinding[];
  reexports: ReExport[];
  /**
   * When true every top-level entity counts as exported (Python, Java, Go,
   * CommonJS files without ESM exports).
   */
  implicit_exports?: boolean;
}

/** Entity kinds acceptable as the target of a relation type. */
export type TargetKindFilter = Partial<Record<RelationType, EntityKind[]>>;

/** A relation waiting for pass 2: `to === ''`, `target_name` set. */
export interface PendingRelation extends Relation {
  target_name: string;
  /**
   * When true a failed lookup is dropped silently instead of being recorded
   * as unresolved (e.g. override candidates, `this.m()` falling back to a
   * parent class).
   */
  optional?: boolean;
  /** Acceptable target kinds, overriding the relation type's defaults (Python `X()` may create a class). */
  kinds?: EntityKind[];
  /** Resolve to the *file* entity containing the target (import edges). */
  resolve_to?: 'entity' | 'file';
  /**
   * Already known to be unresolvable after pass 1 (e.g. a relative import
   * specifier that names no project file); pass 2 records it as unresolved
   * without a lookup. Re-evaluated when the importing file is re-parsed.
   */
  final?: boolean;
}

export type ResolutionOutcome =
  | { status: 'resolved'; id: string }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'unresolved' }
  /** The reference leaves the project (external package, builtin, unbound global). */
  | { status: 'external' };

export interface SymbolTable {
  /** Resolve a pending relation's target from the perspective of `fromFile`. */
  resolve(fromFile: string, targetName: string, kinds?: EntityKind[]): ResolutionOutcome;
  /** Entity by id. */
  entity(id: string): SymbolEntity | undefined;
  /** File entity id for a project-relative path. */
  fileEntityId(file: string): string | undefined;
}

/** Counters produced by pass 2. */
export interface ResolutionStats {
  resolved: number;
  unresolved: number;
  ambiguous: number;
  /** Pending references that turned out to leave the project (not errors). */
  external: number;
  /** Optional candidates that did not match (e.g. non-overriding methods). */
  optional_dropped: number;
}

export interface ResolutionResult {
  /** Resolved relations, ready to store as edges. */
  relations: Relation[];
  /** Unresolved + ambiguous relations (stored outside the edge keyspace). */
  unresolved: Relation[];
  stats: ResolutionStats;
}

/** The slice of an entity the symbol table needs. */
export type SymbolEntity = Pick<Entity, 'id' | 'name' | 'qualified_name' | 'kind' | 'file' | 'language'>;

/**
 * Per-file input to the symbol table. The indexer persists one record per
 * indexed file in `.flowlens/symbols.json` so incremental runs can resolve
 * against unchanged files without re-parsing them.
 */
export interface FileSymbolRecord {
  symbols: FileSymbols;
  entities: SymbolEntity[];
  /** Class → parent references, for inherited-member lookup (`this.m()` → `Parent.m`). */
  extends: Array<{ from: string; to?: string; target_name?: string }>;
  /** Same-file duplicate declarations merged by the parser. */
  duplicates?: number;
  /** Tree-sitter ERROR nodes in the file. */
  syntax_errors?: number;
}
