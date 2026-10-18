/**
 * Go package scope + import bindings (pass 1).
 *
 * A Go package is a directory, so every file's `package` is its directory
 * ('.' at the root) and imports bind a *package*: `import sh "mod/x/y"`
 * binds local `sh` (default: last path segment) to directory `x/y` when the
 * import path starts with the module path from go.mod; anything else
 * (stdlib, third-party) is external.
 */
import type { SgNode } from '@ast-grep/napi';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileSymbols, ImportBinding } from '../../contracts/symbols.js';
import { findChild } from '../extractor-helpers.js';
import { loc } from '../symbols/emitter.js';
import { walkNodes } from '../ast-walk.js';

const modulePathCache = new Map<string, { path: string; dir: string } | null>();

export function clearGoModuleCache(): void {
  modulePathCache.clear();
}

/** Nearest go.mod at or above the file (within rootDir): module path + its directory (relative). */
function goModule(rootDir: string, fileDir: string): { path: string; dir: string } | null {
  const key = `${rootDir}\0${fileDir}`;
  if (modulePathCache.has(key)) return modulePathCache.get(key)!;
  let found: { path: string; dir: string } | null = null;
  if (rootDir) {
    let rel = fileDir;
    for (;;) {
      const gomod = join(rootDir, rel, 'go.mod');
      if (existsSync(gomod)) {
        const m = /^module\s+(\S+)/m.exec(readFileSync(gomod, 'utf-8'));
        if (m) found = { path: m[1], dir: rel };
        break;
      }
      if (rel === '.' || rel === '') break;
      rel = dirname(rel);
    }
  }
  modulePathCache.set(key, found);
  return found;
}

export function goPackageOf(filePath: string): string {
  return dirname(filePath);
}

export function extractGoSymbols(root: SgNode, filePath: string, rootDir: string): FileSymbols {
  const imports: ImportBinding[] = [];
  const mod = goModule(rootDir, dirname(filePath));
  walkNodes(root, (n) => {
    const k = n.kind();
    if (k === 'source_file' || k === 'import_declaration' || k === 'import_spec_list') return true;
    if (k === 'import_spec') {
      const b = binding(n, mod);
      if (b) imports.push(b);
    }
    return false;
  });
  return { file: filePath, language: 'go', package: goPackageOf(filePath), imports, exports: [], reexports: [], implicit_exports: true };
}

function binding(spec: SgNode, mod: { path: string; dir: string } | null): ImportBinding | null {
  const str = findChild(spec, 'interpreted_string_literal') ?? findChild(spec, 'raw_string_literal');
  if (!str) return null;
  const path = str.text().slice(1, -1);
  const aliasNode = spec.children().find((c) => c.kind() === 'package_identifier' || c.kind() === 'dot' || c.kind() === 'blank_identifier');
  const alias = aliasNode?.text();
  const local = alias === '.' ? '*' : alias === '_' ? '' : alias ?? path.split('/').pop()!;
  const internal = !!mod && (path === mod.path || path.startsWith(mod.path + '/'));
  const b: ImportBinding = {
    local, imported: '*', specifier: path, source_file: null, external: !internal, location: loc(spec),
  };
  if (internal) {
    const sub = path.slice(mod!.path.length + 1);
    b.source_package = normalize(join(mod!.dir, sub || '.'));
  }
  return b;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '') || '.';
}
