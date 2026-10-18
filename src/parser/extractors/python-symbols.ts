/**
 * Python import bindings (pass 1).
 *
 * `import a.b [as x]`            → local `a.b` (or `x`), namespace of a/b.py
 * `from m import N [as x]`       → local `N`/`x`; if `m.N` is itself a module
 *                                  the binding is that module's namespace
 * `from . import mod`            → namespace of ./mod.py
 * `from m import *`              → wildcard (local `*`)
 * Relative modules that name no file are internal-but-unresolved; absolute
 * modules not found under the source roots are external (stdlib/site-packages).
 */
import type { SgNode } from '@ast-grep/napi';
import type { FileSymbols, ImportBinding } from '../../contracts/symbols.js';
import { findChild } from '../extractor-helpers.js';
import { resolvePythonModule } from '../resolution/python-module-resolver.js';
import { loc } from '../symbols/emitter.js';

export function extractPythonSymbols(root: SgNode, filePath: string, rootDir: string): FileSymbols {
  const imports: ImportBinding[] = [];
  for (const node of statementNodes(root)) {
    const k = node.kind();
    if (k === 'import_statement') collectImport(node, filePath, rootDir, imports);
    else if (k === 'import_from_statement') collectFromImport(node, filePath, rootDir, imports);
  }
  return { file: filePath, language: 'python', imports, exports: [], reexports: [], implicit_exports: true };
}

/** Module-level statements, including those nested in if/try blocks (e.g. guarded imports). */
function statementNodes(root: SgNode): SgNode[] {
  const out: SgNode[] = [];
  const stack = [...root.children()].reverse();
  const CONTAINERS = new Set(['if_statement', 'else_clause', 'elif_clause', 'try_statement', 'except_clause', 'finally_clause', 'block', 'with_statement']);
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    if (CONTAINERS.has(String(n.kind()))) stack.push(...[...n.children()].reverse());
  }
  return out;
}

function collectImport(node: SgNode, filePath: string, rootDir: string, out: ImportBinding[]): void {
  for (const c of node.children()) {
    let dotted: SgNode | null = null;
    let alias: string | null = null;
    if (c.kind() === 'dotted_name') dotted = c;
    else if (c.kind() === 'aliased_import') {
      dotted = findChild(c, 'dotted_name');
      alias = findChild(c, 'identifier')?.text() ?? null;
    }
    if (!dotted) continue;
    const module = dotted.text();
    const res = resolvePythonModule(module, 0, filePath, rootDir);
    out.push({
      local: alias ?? module, imported: '*', specifier: module,
      source_file: res.file, external: res.external, location: loc(node),
    });
  }
}

function collectFromImport(node: SgNode, filePath: string, rootDir: string, out: ImportBinding[]): void {
  const children = node.children();
  const importIdx = children.findIndex((c) => c.kind() === 'import');
  const moduleNode = children.slice(0, importIdx).find((c) => c.kind() === 'relative_import' || c.kind() === 'dotted_name');
  if (!moduleNode) return;
  let level = 0;
  let module = moduleNode.text();
  if (moduleNode.kind() === 'relative_import') {
    const prefix = findChild(moduleNode, 'import_prefix')?.text() ?? '';
    level = prefix.length;
    module = findChild(moduleNode, 'dotted_name')?.text() ?? '';
  }
  const specifier = '.'.repeat(level) + module;
  const res = resolvePythonModule(module, level, filePath, rootDir);
  const location = loc(node);

  for (const c of children.slice(importIdx + 1)) {
    const k = c.kind();
    if (k === 'wildcard_import') {
      out.push({ local: '*', imported: '*', specifier, source_file: res.file, external: res.external, location });
      continue;
    }
    let name: string | null = null;
    let alias: string | null = null;
    if (k === 'dotted_name') name = c.text();
    else if (k === 'aliased_import') {
      name = findChild(c, 'dotted_name')?.text() ?? null;
      alias = findChild(c, 'identifier')?.text() ?? null;
    }
    if (!name) continue;
    // `from pkg import mod` where pkg/mod.py exists binds the submodule
    const sub = resolvePythonModule(module ? `${module}.${name}` : name, level, filePath, rootDir);
    if (sub.file) {
      const subSpec = '.'.repeat(level) + (module ? `${module}.` : '') + name;
      out.push({ local: alias ?? name, imported: '*', specifier: subSpec, source_file: sub.file, external: false, location });
    } else {
      out.push({ local: alias ?? name, imported: name, specifier, source_file: res.file, external: res.external, location });
    }
  }
}
