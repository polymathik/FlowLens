/**
 * Project-wide symbol table (pass 2).
 *
 * Resolves a dotted reference (`Base`, `ns.helper`, `Parent.method`,
 * `pkg.mod.func`) as seen from one file:
 *   1. the longest import binding whose local name prefixes the reference,
 *   2. the file's own top-level declarations,
 *   3. same-package files (Java package, Go directory),
 *   4. wildcard imports (`import a.b.*`, `from x import *`).
 * Exports are followed through named re-exports, aliases, import-then-export
 * and `export *` fan-out (the module that actually declares the name wins;
 * two different declarations → ambiguous). Member paths walk qualified
 * names and fall back to the parent class (up to 5 levels).
 */
import type { EntityKind } from '../../contracts/entities.js';
import type {
  FileSymbolRecord, ImportBinding, ResolutionOutcome, SymbolEntity, SymbolTable,
} from '../../contracts/symbols.js';
import { preferByKind } from './target-kinds.js';

type ParentRef = { file: string; to?: string; target_name?: string };

type Target =
  | { kind: 'entity'; entity: SymbolEntity }
  | { kind: 'module'; file: string }
  /** The member may live in a base class outside the project: a miss is not an error. */
  | { kind: 'opaque' };

const MAX_DEPTH = 12;

export class ProjectSymbolTable implements SymbolTable {
  private records: Map<string, FileSymbolRecord>;
  private byId = new Map<string, SymbolEntity>();
  private byQn = new Map<string, SymbolEntity[]>();
  private fileIds = new Map<string, string>();
  private packages = new Map<string, string[]>();
  private bindings = new Map<string, Map<string, ImportBinding>>();
  /** Base classes / interfaces per entity, in declaration order (a marker without target = an unresolvable base). */
  private parents = new Map<string, ParentRef[]>();

  constructor(records: Map<string, FileSymbolRecord>) {
    this.records = records;
    for (const [file, rec] of records) {
      for (const e of rec.entities) {
        this.byId.set(e.id, e);
        const list = this.byQn.get(e.qualified_name);
        if (list) list.push(e); else this.byQn.set(e.qualified_name, [e]);
        if (e.kind === 'file') this.fileIds.set(file, e.id);
      }
      const pkg = rec.symbols.package;
      if (pkg !== undefined) {
        const files = this.packages.get(pkg);
        if (files) files.push(file); else this.packages.set(pkg, [file]);
      }
      const local = new Map<string, ImportBinding>();
      for (const b of rec.symbols.imports) if (b.local && b.local !== '*' && !local.has(b.local)) local.set(b.local, b);
      this.bindings.set(file, local);
      for (const ext of rec.extends) {
        const list = this.parents.get(ext.from);
        if (list) list.push({ file, ...ext }); else this.parents.set(ext.from, [{ file, ...ext }]);
      }
    }
  }

  entity(id: string): SymbolEntity | undefined {
    return this.byId.get(id);
  }

  fileEntityId(file: string): string | undefined {
    return this.fileIds.get(file);
  }

  hasPackage(pkg: string): boolean {
    return this.packages.has(pkg);
  }

  resolve(fromFile: string, targetName: string, kinds?: EntityKind[]): ResolutionOutcome {
    const parts = targetName.split('.').filter((p) => p.length > 0);
    if (parts.length === 0) return { status: 'unresolved' };
    const rec = this.records.get(fromFile);
    if (!rec) return { status: 'unresolved' };

    // 1. import bindings (longest dotted local first)
    const local = this.bindings.get(fromFile)!;
    for (let k = parts.length; k >= 1; k--) {
      const b = local.get(parts.slice(0, k).join('.'));
      if (b) return this.finish(this.viaBinding(b, parts.slice(k), 0), kinds, true);
    }

    // 2. own top-level declarations
    const own = this.inFile(fromFile, parts, 0);
    if (own.length > 0) return this.finish(own, kinds, true);

    // 3. same package
    const pkg = rec.symbols.package;
    if (pkg !== undefined) {
      const hits = (this.packages.get(pkg) ?? [])
        .filter((f) => f !== fromFile)
        .flatMap((f) => this.inFile(f, parts, 0));
      if (hits.length > 0) return this.finish(hits, kinds, true);
    }

    // 4. wildcard imports
    for (const b of rec.symbols.imports) {
      if (b.local !== '*' || b.external) continue;
      const hits = this.viaBinding({ ...b, imported: '*' }, parts, 0);
      if (hits.length > 0) return this.finish(hits, kinds, true);
    }
    return { status: 'external' };
  }

  /** Turn raw targets into an outcome; `internal` = the reference was expected to resolve. */
  private finish(targets: Target[] | 'external', kinds: EntityKind[] | undefined, internal: boolean): ResolutionOutcome {
    if (targets === 'external') return { status: 'external' };
    const entities = dedupe(targets.filter((t): t is Extract<Target, { kind: 'entity' }> => t.kind === 'entity').map((t) => t.entity));
    const preferred = preferByKind(entities, kinds);
    if (preferred.length === 1) return { status: 'resolved', id: preferred[0].id };
    if (preferred.length > 1) return { status: 'ambiguous', candidates: preferred.map((e) => e.id) };
    if (targets.some((t) => t.kind === 'opaque')) return { status: 'external' };
    return internal ? { status: 'unresolved' } : { status: 'external' };
  }

  private viaBinding(b: ImportBinding, rest: string[], depth: number): Target[] | 'external' {
    if (depth > MAX_DEPTH) return [];
    if (b.external) return 'external';
    if (b.source_package !== undefined && !b.source_file) {
      if (!this.packages.has(b.source_package)) return 'external';
      const path = b.imported === '*' ? rest : [...b.imported.split('.'), ...rest];
      if (path.length === 0) return [];
      return (this.packages.get(b.source_package) ?? []).flatMap((f) => this.inFile(f, path, depth + 1));
    }
    if (!b.source_file) return [];
    if (b.imported === '*' || b.imported === '') {
      if (rest.length === 0) return [{ kind: 'module', file: b.source_file }];
      return this.members(this.exported(b.source_file, rest[0], depth + 1), rest.slice(1), depth);
    }
    return this.members(this.exported(b.source_file, b.imported, depth + 1), rest, depth);
  }

  /** What `file` exports under `name`. */
  private exported(file: string, name: string, depth: number): Target[] {
    if (depth > MAX_DEPTH) return [];
    const rec = this.records.get(file);
    if (!rec) return [];
    const sym = rec.symbols;
    const out: Target[] = [];
    for (const e of sym.exports) {
      if (e.name === name) out.push(...this.localName(file, e.local, depth));
    }
    if (out.length === 0 && (sym.implicit_exports || name === 'default')) {
      out.push(...this.localName(file, name === 'default' && sym.implicit_exports ? '' : name, depth));
      if (name === 'default' && sym.implicit_exports) out.push({ kind: 'module', file });
    }
    for (const re of sym.reexports) {
      if (re.exported !== name || !re.source_file) continue;
      if (re.imported === '*') out.push({ kind: 'module', file: re.source_file });
      else out.push(...this.exported(re.source_file, re.imported, depth + 1));
    }
    if (out.length > 0) return out;
    // `export * from` fan-out: only consulted when nothing above matched.
    const star: Target[] = [];
    for (const re of sym.reexports) {
      if (re.exported === '*' && re.source_file) star.push(...this.exported(re.source_file, name, depth + 1));
    }
    return star;
  }

  /** A local name in `file`: a top-level declaration or an import binding. */
  private localName(file: string, name: string, depth: number): Target[] {
    if (!name) return [];
    const decl = this.byQn.get(`${file}/${name}`)?.filter((e) => e.file === file) ?? [];
    if (decl.length > 0) return decl.map((entity) => ({ kind: 'entity' as const, entity }));
    const b = this.bindings.get(file)?.get(name);
    if (b) {
      const via = this.viaBinding(b, [], depth + 1);
      return via === 'external' ? [] : via;
    }
    return [];
  }

  /** Top-level path lookup inside one file (`A`, `A.method`). */
  private inFile(file: string, parts: string[], depth: number): Target[] {
    const head = this.byQn.get(`${file}/${parts[0]}`)?.filter((e) => e.file === file) ?? [];
    return this.members(head.map((entity) => ({ kind: 'entity' as const, entity })), parts.slice(1), depth);
  }

  /** Walk member names below each target (qualified names, then parent classes). */
  private members(targets: Target[], rest: string[], depth: number): Target[] {
    if (rest.length === 0) return targets;
    const out: Target[] = [];
    for (const t of targets) {
      if (t.kind === 'opaque') { out.push(t); continue; }
      if (t.kind === 'module') {
        out.push(...this.members(this.exported(t.file, rest[0], depth + 1), rest.slice(1), depth + 1));
        continue;
      }
      out.push(...this.memberOf(t.entity, rest, 0));
    }
    return out;
  }

  private memberOf(owner: SymbolEntity, rest: string[], level: number): Target[] {
    const child = this.byQn.get(`${owner.qualified_name}.${rest[0]}`)?.filter((e) => e.file === owner.file) ?? [];
    if (child.length > 0) {
      return this.members(child.map((entity) => ({ kind: 'entity' as const, entity })), rest.slice(1), level);
    }
    if (owner.kind === 'type') return [{ kind: 'opaque' }]; // an alias (`type Db = ExternalDb`): its shape is not indexed
    if (level >= 5) return [];
    const typed = this.typedMember(owner, rest, level);
    if (typed) return typed;
    // A variable's members come from whatever its initializer built (`z.object(…)`, `create(…)`, an
    // object literal): unless its declared type led to a class above, a miss says nothing.
    if (owner.kind === 'variable') return [{ kind: 'opaque' }];
    const refs = this.parents.get(owner.id);
    if (!refs) return [];
    const found: Target[] = [];
    let unknownBase = false;
    for (const ref of refs) {
      const parent = this.resolveParent(ref);
      if (parent) found.push(...this.memberOf(parent, rest, level + 1));
      else unknownBase = true;
    }
    return found.length > 0 || !unknownBase ? found : [{ kind: 'opaque' }];
  }

  /** `store.get` where `store` is a variable declared as an instance of a class: look in that class. */
  private typedMember(owner: SymbolEntity, rest: string[], level: number): Target[] | null {
    if (!owner.type_ref || owner.kind !== 'variable') return null;
    const r = this.resolve(owner.file, owner.type_ref, ['class', 'interface']);
    const cls = r.status === 'resolved' ? this.byId.get(r.id) : undefined;
    return cls ? this.memberOf(cls, rest, level + 1) : null;
  }

  /** Resolve the parent class of a class entity (direct id or symbolic). */
  parentOf(cls: SymbolEntity): SymbolEntity | undefined {
    const ref = this.parents.get(cls.id)?.[0];
    return ref ? this.resolveParent(ref) : undefined;
  }

  private resolveParent(p: ParentRef): SymbolEntity | undefined {
    if (p.to) return this.byId.get(p.to);
    if (!p.target_name) return undefined;
    const r = this.resolve(p.file, p.target_name, ['class', 'interface']);
    return r.status === 'resolved' ? this.byId.get(r.id) : undefined;
  }
}

function dedupe(entities: SymbolEntity[]): SymbolEntity[] {
  const seen = new Map<string, SymbolEntity>();
  for (const e of entities) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()];
}
