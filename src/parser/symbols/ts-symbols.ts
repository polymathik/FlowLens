/**
 * Import / export / re-export extraction for TS and JS files (pass 1).
 *
 * Only module-level statements are inspected: ESM `import` / `export`,
 * plus CommonJS `const x = require('…')` and `const { a, b: c } = require('…')`.
 * Files without any ESM export statement are treated as CommonJS-style with
 * implicit exports (every top-level declaration is importable).
 */
import type { SgNode } from '@ast-grep/napi';
import type { ExportBinding, FileSymbols, ImportBinding, ReExport } from '../../contracts/symbols.js';
import { findChild } from '../extractor-helpers.js';
import { resolveModuleSpecifier } from '../resolution/ts-module-resolver.js';

const DECLARATION_KINDS = new Set([
  'class_declaration', 'abstract_class_declaration', 'function_declaration',
  'generator_function_declaration', 'interface_declaration', 'type_alias_declaration',
  'enum_declaration', 'internal_module', 'module',
]);

export function extractTsSymbols(
  root: SgNode,
  filePath: string,
  rootDir: string,
  language: string,
): FileSymbols {
  const symbols: FileSymbols = { file: filePath, language, imports: [], exports: [], reexports: [] };
  let sawEsmExport = false;

  for (const node of root.children()) {
    const kind = node.kind();
    if (kind === 'import_statement') {
      collectImport(node, filePath, rootDir, symbols.imports);
    } else if (kind === 'export_statement') {
      sawEsmExport = true;
      collectExport(node, filePath, rootDir, symbols);
    } else if (kind === 'lexical_declaration' || kind === 'variable_declaration') {
      collectRequire(node, filePath, rootDir, symbols.imports);
    }
  }
  if (!sawEsmExport) symbols.implicit_exports = true;
  return symbols;
}

/** String literal content of the first `string` child. */
export function stringSpecifier(node: SgNode): string | null {
  const str = findChild(node, 'string');
  if (!str) return null;
  const frag = findChild(str, 'string_fragment');
  return frag ? frag.text() : '';
}

function location(node: SgNode): { line: number; column: number } {
  const r = node.range();
  return { line: r.start.line + 1, column: r.start.column + 1 };
}

function binding(
  local: string, imported: string, specifier: string, filePath: string, rootDir: string,
  node: SgNode, typeOnly: boolean,
): ImportBinding {
  const res = resolveModuleSpecifier(specifier, filePath, rootDir);
  const b: ImportBinding = {
    local, imported, specifier,
    source_file: res.file,
    external: res.external,
    location: location(node),
  };
  if (typeOnly) b.type_only = true;
  return b;
}

function hasTypeKeyword(node: SgNode): boolean {
  return node.children().some((c) => c.kind() === 'type');
}

function collectImport(node: SgNode, filePath: string, rootDir: string, out: ImportBinding[]): void {
  const specifier = stringSpecifier(node);
  if (specifier === null) return;
  const stmtTypeOnly = hasTypeKeyword(node);
  const clause = findChild(node, 'import_clause');
  if (!clause) {
    out.push(binding('', '', specifier, filePath, rootDir, node, stmtTypeOnly));
    return;
  }
  for (const part of clause.children()) {
    const pk = part.kind();
    if (pk === 'identifier') {
      out.push(binding(part.text(), 'default', specifier, filePath, rootDir, node, stmtTypeOnly));
    } else if (pk === 'namespace_import') {
      const id = findChild(part, 'identifier');
      if (id) out.push(binding(id.text(), '*', specifier, filePath, rootDir, node, stmtTypeOnly));
    } else if (pk === 'named_imports') {
      for (const spec of part.children()) {
        if (spec.kind() !== 'import_specifier') continue;
        const ids = spec.children().filter((c) => c.kind() === 'identifier' || c.kind() === 'string');
        if (ids.length === 0) continue;
        const imported = ids[0].kind() === 'string' ? ids[0].text().slice(1, -1) : ids[0].text();
        const local = (ids[1] ?? ids[0]).text();
        out.push(binding(local, imported, specifier, filePath, rootDir, node, stmtTypeOnly || hasTypeKeyword(spec)));
      }
    }
  }
}

function collectExport(node: SgNode, filePath: string, rootDir: string, symbols: FileSymbols): void {
  const specifier = stringSpecifier(node);
  const typeOnly = hasTypeKeyword(node);
  const children = node.children();
  const clause = findChild(node, 'export_clause');

  if (specifier !== null) {
    const res = resolveModuleSpecifier(specifier, filePath, rootDir);
    const push = (imported: string, exported: string, t = typeOnly) => {
      const re: ReExport = { specifier, source_file: res.file, imported, exported };
      if (t) re.type_only = true;
      symbols.reexports.push(re);
    };
    if (clause) {
      for (const spec of clause.children()) {
        if (spec.kind() !== 'export_specifier') continue;
        const ids = spec.children().filter((c) => c.kind() === 'identifier');
        if (ids.length === 0) continue;
        push(ids[0].text(), (ids[1] ?? ids[0]).text(), typeOnly || hasTypeKeyword(spec));
      }
    } else {
      const ns = findChild(node, 'namespace_export');
      const id = ns ? findChild(ns, 'identifier') : null;
      push('*', id ? id.text() : '*');
    }
    return;
  }

  if (clause) {
    for (const spec of clause.children()) {
      if (spec.kind() !== 'export_specifier') continue;
      const ids = spec.children().filter((c) => c.kind() === 'identifier');
      if (ids.length === 0) continue;
      pushExport(symbols.exports, (ids[1] ?? ids[0]).text(), ids[0].text(), typeOnly || hasTypeKeyword(spec));
    }
    return;
  }

  const isDefault = children.some((c) => c.kind() === 'default');
  for (const child of children) {
    const ck = String(child.kind());
    if (DECLARATION_KINDS.has(ck)) {
      const name = declarationName(child);
      if (!name) continue;
      pushExport(symbols.exports, isDefault ? 'default' : name, name, false);
    } else if (ck === 'lexical_declaration' || ck === 'variable_declaration') {
      for (const decl of child.children()) {
        if (decl.kind() !== 'variable_declarator') continue;
        const id = findChild(decl, 'identifier');
        if (id) pushExport(symbols.exports, id.text(), id.text(), false);
      }
    } else if (ck === 'identifier' && isDefault) {
      pushExport(symbols.exports, 'default', child.text(), false);
    }
  }
}

function pushExport(out: ExportBinding[], name: string, local: string, typeOnly: boolean): void {
  const e: ExportBinding = { name, local };
  if (typeOnly) e.type_only = true;
  out.push(e);
}

export function declarationName(node: SgNode): string | null {
  for (const c of node.children()) {
    const k = c.kind();
    if (k === 'type_identifier' || k === 'identifier') return c.text();
  }
  return null;
}

/** `const x = require('m')`, `const { a, b: c } = require('m')`, `const y = require('m').prop`. */
function collectRequire(node: SgNode, filePath: string, rootDir: string, out: ImportBinding[]): void {
  for (const decl of node.children()) {
    if (decl.kind() !== 'variable_declarator') continue;
    const children = decl.children();
    const target = children[0];
    const value = children[children.length - 1];
    if (!target || !value || target === value) continue;
    let call = value;
    let prop: string | null = null;
    if (value.kind() === 'member_expression') {
      call = value.children()[0];
      prop = value.children()[value.children().length - 1]?.text() ?? null;
    }
    const specifier = requireSpecifier(call);
    if (specifier === null) continue;
    if (target.kind() === 'identifier') {
      out.push(binding(target.text(), prop ?? '*', specifier, filePath, rootDir, decl, false));
    } else if (target.kind() === 'object_pattern') {
      for (const p of target.children()) {
        if (p.kind() === 'shorthand_property_identifier_pattern') {
          out.push(binding(p.text(), p.text(), specifier, filePath, rootDir, decl, false));
        } else if (p.kind() === 'pair_pattern') {
          const key = p.children()[0]?.text();
          const val = p.children()[p.children().length - 1];
          if (key && val?.kind() === 'identifier') {
            out.push(binding(val.text(), key, specifier, filePath, rootDir, decl, false));
          }
        }
      }
    }
  }
}

function requireSpecifier(call: SgNode): string | null {
  if (call.kind() !== 'call_expression') return null;
  const fn = call.children()[0];
  if (!fn || fn.kind() !== 'identifier' || fn.text() !== 'require') return null;
  const args = findChild(call, 'arguments');
  return args ? stringSpecifier(args) : null;
}
