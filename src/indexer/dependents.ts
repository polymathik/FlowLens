/**
 * Reverse-dependency detection for incremental indexing.
 *
 * When files change, are added or deleted, other (unchanged) files whose
 * cross-file edges were resolved through them must be re-parsed so their
 * edges are re-resolved. A file is a dependent when it:
 *   1. imports / re-exports a touched file (transitively through barrels —
 *      files that re-export, or Python `__init__.py`),
 *   2. shares a package scope with a touched file, or imports that package
 *      (Java packages, Go directories),
 *   3. has an import that did not resolve before and now names a file,
 *   4. owns an edge pointing at an entity id that no longer exists,
 *   5. uses a `#subpath` import under a touched package.json (its `imports`
 *      map may have changed, so those specifiers must be re-resolved).
 */
import type { FileSymbolRecord, ImportBinding } from '../contracts/symbols.js';

export interface DependentsInput {
  /** Symbol records after the changed files were re-parsed (deleted files removed). */
  records: Map<string, FileSymbolRecord>;
  /** Records before this run (for deleted / changed files' old imports and packages). */
  previous: Map<string, FileSymbolRecord>;
  touched: Set<string>;
  /** Files owning edges to entity ids that disappeared this run. */
  ownersOfRemovedTargets: Set<string>;
  /** Re-resolve a previously unresolved binding; returns the file it now names, or null. */
  recheck: (binding: ImportBinding, fromFile: string, language: string) => string | null;
}

export function findDependents(input: DependentsInput): Set<string> {
  const { records, previous, touched } = input;
  const reverse = new Map<string, Set<string>>();
  const barrels = new Set<string>();
  const packageFiles = new Map<string, Set<string>>();
  const packageImporters = new Map<string, Set<string>>();

  for (const [file, rec] of records) {
    const sym = rec.symbols;
    for (const b of sym.imports) {
      if (b.source_file) add(reverse, b.source_file, file);
      if (b.source_package !== undefined) add(packageImporters, b.source_package, file);
    }
    for (const re of sym.reexports) if (re.source_file) add(reverse, re.source_file, file);
    const locals = new Set(sym.imports.map((b) => b.local));
    if (sym.reexports.length > 0 || file.endsWith('__init__.py') || sym.exports.some((e) => locals.has(e.local))) {
      barrels.add(file);
    }
    if (sym.package !== undefined) add(packageFiles, sym.package, file);
  }

  const out = new Set<string>();
  const queue = [...touched];
  const visited = new Set<string>(touched);
  while (queue.length > 0) {
    const x = queue.shift()!;
    for (const f of reverse.get(x) ?? []) {
      out.add(f);
      if (barrels.has(f) && !visited.has(f)) { visited.add(f); queue.push(f); }
    }
  }

  for (const t of touched) {
    for (const rec of [records.get(t), previous.get(t)]) {
      const pkg = rec?.symbols.package;
      if (pkg === undefined) continue;
      for (const f of packageFiles.get(pkg) ?? []) out.add(f);
      for (const f of packageImporters.get(pkg) ?? []) out.add(f);
    }
  }

  for (const [file, rec] of records) {
    if (touched.has(file)) continue;
    for (const b of rec.symbols.imports) {
      if (b.source_file || b.external || b.source_package !== undefined) continue;
      const now = input.recheck(b, file, rec.symbols.language);
      if (now && touched.has(now)) { out.add(file); break; }
    }
  }

  for (const t of touched) {
    if (!isPackageJson(t)) continue;
    const dir = t === 'package.json' ? '' : t.slice(0, -'package.json'.length);
    for (const [file, rec] of records) {
      if (dir && !file.startsWith(dir)) continue;
      if (usesSubpathImport(rec)) out.add(file);
    }
  }

  for (const f of input.ownersOfRemovedTargets) out.add(f);
  for (const t of touched) out.delete(t);
  for (const f of [...out]) if (!records.has(f)) out.delete(f);
  return out;
}

function isPackageJson(file: string): boolean {
  return file === 'package.json' || file.endsWith('/package.json');
}

function usesSubpathImport(rec: FileSymbolRecord): boolean {
  return rec.symbols.imports.some((b) => b.specifier.startsWith('#'))
    || rec.symbols.reexports.some((r) => r.specifier.startsWith('#'));
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  if (set) set.add(value); else map.set(key, new Set([value]));
}
