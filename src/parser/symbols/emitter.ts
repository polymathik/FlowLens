/**
 * Relation emitter shared by every language extractor (pass 1).
 *
 * `link()` decides, for a reference written in the source, whether it is
 *   - a same-file target → direct relation (resolved by qualified name),
 *   - bound to a project import / package scope → pending relation for pass 2,
 *   - external / a builtin / unbound → dropped.
 * Targets are always looked up by qualified name, so `B.m` and `A.m` never
 * collide and target ids are produced exactly like entity ids.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind } from '../../contracts/entities.js';
import type { Relation, RelationMeta, RelationType } from '../../contracts/relations.js';
import type { FileSymbols, ImportBinding, PendingRelation } from '../../contracts/symbols.js';
import { generateRelationId } from '../../utils/id.js';
import { preferByKind, targetKinds } from './target-kinds.js';

export interface LinkOptions {
  /** Drop silently when pass 2 finds nothing (override candidates, inherited members). */
  optional?: boolean;
  meta?: RelationMeta;
  confidence?: number;
  /** Override the default target kinds for this relation type. */
  kinds?: EntityKind[];
}

export interface EmitterOptions {
  /** Unbound names may live in same-package files (Java, Go). */
  packageScope?: boolean;
}

export class RelationEmitter {
  readonly relations: Relation[] = [];
  readonly filePath: string;
  private byQn = new Map<string, Entity[]>();
  private bindings = new Map<string, ImportBinding>();
  private wildcard = false;
  private packageScope: boolean;

  constructor(filePath: string, entities: Entity[], symbols?: FileSymbols, opts: EmitterOptions = {}) {
    this.filePath = filePath;
    this.packageScope = opts.packageScope ?? false;
    for (const e of entities) {
      if (e.file !== filePath || e.kind === 'parameter') continue;
      const list = this.byQn.get(e.qualified_name);
      if (list) list.push(e); else this.byQn.set(e.qualified_name, [e]);
    }
    for (const b of symbols?.imports ?? []) {
      if (b.local === '*') { if (!b.external) this.wildcard = true; continue; }
      if (b.local && !this.bindings.has(b.local)) this.bindings.set(b.local, b);
    }
  }

  /** Entity with exactly this scope path (`['Cls', 'method']`), preferring `kinds`. */
  entityAt(path: string[], kinds?: EntityKind[]): Entity | undefined {
    if (path.length === 0) return undefined;
    const list = this.byQn.get(`${this.filePath}/${path.join('.')}`) ?? [];
    return (kinds ? preferByKind(list, kinds) : list)[0];
  }

  /** Innermost entity along a scope path (longest existing prefix). */
  enclosing(path: string[], kinds?: EntityKind[]): Entity | undefined {
    for (let n = path.length; n > 0; n--) {
      const e = this.entityAt(path.slice(0, n), kinds);
      if (e) return e;
    }
    return undefined;
  }

  /** Member of a same-file entity by name. */
  member(owner: Entity, name: string, kinds?: EntityKind[]): Entity | undefined {
    const list = this.byQn.get(`${owner.qualified_name}.${name}`) ?? [];
    return (kinds ? preferByKind(list, kinds) : list)[0];
  }

  binding(local: string): ImportBinding | undefined {
    return this.bindings.get(local);
  }

  /** Is `name` (head of a reference) bound by an import in this file? */
  isImported(name: string): boolean {
    return this.bindings.has(name);
  }

  isLocal(name: string): boolean {
    return this.byQn.has(`${this.filePath}/${name}`);
  }

  direct(from: Entity | string, to: Entity, type: RelationType, node: SgNode, opts: LinkOptions = {}): void {
    const fromId = typeof from === 'string' ? from : from.id;
    const actualType = type === 'call' && to.kind === 'class' ? 'create' : type;
    const { line, column } = loc(node);
    const rel: Relation = {
      id: generateRelationId(fromId, to.id, actualType, this.filePath, line),
      from: fromId,
      to: to.id,
      type: actualType,
      location: { file: this.filePath, line, column },
      weight: 1,
      confidence: opts.confidence ?? 1,
    };
    if (opts.meta) rel.meta = opts.meta;
    this.relations.push(rel);
  }

  pending(
    from: Entity | string, type: RelationType, targetName: string, node: SgNode,
    opts: LinkOptions & { resolve_to?: 'entity' | 'file' } = {},
  ): void {
    const fromId = typeof from === 'string' ? from : from.id;
    const { line, column } = loc(node);
    const rel: PendingRelation = {
      id: generateRelationId(fromId, `?${targetName}`, type, this.filePath, line),
      from: fromId,
      to: '',
      type,
      location: { file: this.filePath, line, column },
      weight: 1,
      confidence: opts.confidence ?? 1,
      resolution: 'unresolved',
      target_name: targetName,
    };
    if (opts.optional) rel.optional = true;
    if (opts.kinds) rel.kinds = opts.kinds;
    if (opts.resolve_to) rel.resolve_to = opts.resolve_to;
    if (opts.meta) rel.meta = opts.meta;
    this.relations.push(rel);
  }

  /**
   * Link `from` to the entity named `targetName` (dotted path) as seen from
   * this file. Returns 'direct' | 'pending' | 'dropped'.
   */
  link(from: Entity | string, type: RelationType, targetName: string, node: SgNode, opts: LinkOptions = {}): 'direct' | 'pending' | 'dropped' {
    const parts = targetName.split('.').filter(Boolean);
    if (parts.length === 0) return 'dropped';
    const kinds = opts.kinds ?? targetKinds(type);

    for (let k = parts.length; k >= 1; k--) {
      const b = this.bindings.get(parts.slice(0, k).join('.'));
      if (!b) continue;
      if (b.external) return 'dropped';
      this.pending(from, type, targetName, node, opts);
      return 'pending';
    }

    const head = this.byQn.get(`${this.filePath}/${parts[0]}`);
    if (head) {
      let candidates: Entity[] = head;
      for (const part of parts.slice(1)) {
        candidates = candidates.flatMap((c) => this.byQn.get(`${c.qualified_name}.${part}`) ?? []);
      }
      const target = (kinds ? preferByKind(candidates, kinds) : candidates)[0];
      if (target) {
        this.direct(from, target, type, node, opts);
        return 'direct';
      }
      return 'dropped';
    }

    if (this.packageScope || this.wildcard) {
      this.pending(from, type, targetName, node, opts);
      return 'pending';
    }
    return 'dropped';
  }
}

export function loc(node: SgNode): { line: number; column: number } {
  const r = node.range();
  return { line: r.start.line + 1, column: r.start.column + 1 };
}
