/**
 * Lexical type environment for member-call resolution (`x.method()`).
 *
 * One scope per function-like node (and one for the module). A binding maps a
 * local name to the *name of its declared type* as written in this file
 * (`DiscoveryService`, `ns.Store`) or to `null` = "a local of unknown type".
 * Unknown bindings matter as much as known ones: they shadow outer typed names,
 * so `function f(store) { store.get() }` never inherits a module-level
 * `const store = new Store()`.
 *
 * Block scoping is deliberately ignored: a name declared twice in the same
 * function scope becomes unknown (`conflict`), which can only lose edges.
 */
export interface TypeBinding {
  /** Type name as written in the file; null = unknown. */
  type: string | null;
}

export class TypeScope {
  private readonly vars = new Map<string, TypeBinding>();

  constructor(readonly parent: TypeScope | null) {}

  /** Declare `name` (first declaration wins its type; a redeclaration makes it unknown). */
  declare(name: string, type: string | null): void {
    const prev = this.vars.get(name);
    this.vars.set(name, { type: prev ? null : type });
  }

  /** Innermost binding of `name` (outer scopes are only consulted when this one has none). */
  lookup(name: string): { binding: TypeBinding; moduleLevel: boolean } | undefined {
    for (let s: TypeScope | null = this; s; s = s.parent) {
      const binding = s.vars.get(name);
      if (binding) return { binding, moduleLevel: s.parent === null };
    }
    return undefined;
  }

  child(): TypeScope {
    return new TypeScope(this);
  }
}
