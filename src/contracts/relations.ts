export type RelationType =
  | 'import' | 'call' | 'extend' | 'implement'
  | 'override' | 'mixin' | 'use' | 'contain' | 'create'
  | 'parameter' | 'return' | 'throw' | 'decorate';

/**
 * How the target of a relation was determined (Phase 8, additive).
 *
 * - `direct`     — target found syntactically in the same file (or the import
 *                  specifier resolved straight to a project file).
 * - `resolved`   — target found in another file through the project symbol
 *                  table (pass 2: imports, re-exports, package scope).
 * - `unresolved` — the reference points into the project (e.g. a name bound to
 *                  a project import) but no entity could be found. `to` is ''
 *                  and `target_name` holds the symbolic reference.
 * - `ambiguous`  — more than one candidate matched; `to` is '' and
 *                  `meta.candidates` lists them.
 *
 * Unresolved/ambiguous relations are never written as graph edges; the store
 * keeps them in a separate keyspace (see `GraphStore.getUnresolvedRelations`)
 * so analyses never see fabricated ids. Absent `resolution` means `direct`
 * (relations produced before Phase 8).
 */
export type RelationResolution = 'direct' | 'resolved' | 'unresolved' | 'ambiguous';

export interface RelationMeta {
  /** `import type …` / `import { type X }` — erased at runtime (TS only). */
  type_only?: boolean;
  /** For ambiguous relations: the candidate entity ids. */
  candidates?: string[];
  /** For import edges added through a barrel: the file the specifier named. */
  via?: string;
  /**
   * `export … from '…'` / `export * from '…'` — the file→file `import` edge is
   * a re-export (barrel), not a consuming import (Map M0, additive).
   */
  reexport?: boolean;
  /**
   * Every occurrence of an aggregated `call` / `create` / `use` / `throw` edge
   * (Parser truth 2, additive), sorted by position, capped at
   * `MAX_RELATION_SITES`. Present only when the edge aggregates more than one
   * occurrence (a single occurrence is `Relation.location`); use
   * `relationSites()` (src/graph/sites.ts) to read either form. All sites are
   * in `location.file`. `Relation.location` stays the first *emitted*
   * occurrence (it feeds the stable relation id), so `sites[0]` can precede it.
   */
  sites?: RelationSite[];
  /**
   * Owner of module-level code (Parser truth 2, additive): the edge starts at
   * the file entity (or, in a single-file component, at the component) because
   * the call/create/throw sits in a module-scope statement or inside an
   * anonymous function (callback, IIFE, default export) that has no named
   * enclosing function. Anonymous callbacks inside a *named* function belong to
   * that function and are not marked.
   */
  owner?: 'module';
  /**
   * How the target of a member call (`recv.method()`) was inferred, as written
   * in the source (`discovery`, `this.store`, `new Foo`); absent on plain calls.
   */
  receiver?: string;
  /** Total number of occurrences when `sites` was capped (equals `weight` of the edge). */
  sites_total?: number;
  /**
   * How a `use` / `create` edge to a function, class or component was written
   * when it is a reference rather than a read or a call (Parser truth 2, additive):
   *  - `argument` — passed to a call: `app.get('/x', handler)`, `xs.map(fn)`,
   *                 `emitter.on('e', this.onEvent)`; `ref_via` is the callee as written.
   *  - `table`    — a value in an object / array literal that is exported, assigned
   *                 or passed on: `export default { save }`, `[{ handler: run }]`.
   *  - `binding`  — a markup attribute or directive: JSX `onClick={fn}`, Svelte
   *                 `onclick={fn}` / `on:click={fn}` / `use:action` / `bind:value={x}`,
   *                 Vue `@click="fn"` / `v-model="x"`; `ref_via` is the attribute as written.
   * An aggregated edge keeps the `ref` of its first occurrence.
   */
  ref?: 'argument' | 'table' | 'binding';
  /** The callee (`ref: 'argument'`) or attribute / directive (`ref: 'binding'`) the reference sits in. */
  ref_via?: string;
  /**
   * Route a handler is registered for (Parser truth 2, additive): `VERB /path` as written, for a
   * `ref: 'argument'` edge whose call has a path literal first (`app.get('/x', handler)` →
   * `GET /x`; verbs get / post / put / patch / delete / head / options / all / use / route).
   * Lets entry-point detection read the graph instead of the source line.
   */
  route?: string;
}

/** One occurrence of a relation in its file (1-based line and column). */
export interface RelationSite {
  line: number;
  column: number;
}

/** Relation types whose individual occurrences are kept in `meta.sites`. */
export const SITED_RELATION_TYPES: readonly RelationType[] = ['call', 'create', 'use', 'throw'];

/** Cap of `meta.sites` per aggregated edge. */
export const MAX_RELATION_SITES = 20;

/**
 * Relation types that only express type annotations (Phase 12). In TS/JS they
 * are erased at compile time; in other languages they never trigger module
 * loading on their own. Together with `meta.type_only` imports and edges whose
 * target is a pure type (`interface` / `type`), they form the *type-level*
 * edges that runtime cycle detection ignores by default
 * (see `isTypeLevelRelation` in `src/analysis/type-level.ts`).
 */
export const TYPE_ANNOTATION_RELATION_TYPES: readonly RelationType[] = ['parameter', 'return', 'implement'];

export type Relation = {
  id: string;
  from: string;
  /** Target entity id. '' when `resolution` is 'unresolved' or 'ambiguous'. */
  to: string;
  type: RelationType;
  location: {
    file: string;
    line: number;
    column: number;
  };
  /**
   * Number of occurrences aggregated into this edge. Edges are unique per
   * (from, type, to); repeated occurrences increment `weight` and keep the
   * first occurrence's location/id.
   */
  weight: number;
  confidence: number;
  resolution?: RelationResolution;
  /** Symbolic target (e.g. `Base`, `ns.helper`, `Parent.method`) for pass-2 / unresolved relations. */
  target_name?: string;
  meta?: RelationMeta;
};
