import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { parse } from '@ast-grep/napi';
import { normalizeRelativePath } from '../utils/paths.js';

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Extensions that can contain re-exports and should be checked for barrel patterns */
const BARREL_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export function resolveImportPath(
  specifier: string,
  fromFile: string,
  rootDir: string
): string | null {
  // Skip external packages and node builtins
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }

  const fromDir = dirname(join(rootDir, fromFile));
  const absolute = resolve(fromDir, specifier);

  // Try exact path (already has extension)
  if (existsSync(absolute) && !statSync(absolute).isDirectory()) {
    return normalizeRelativePath(absolute.slice(rootDir.length + 1));
  }

  // Try adding extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = absolute + ext;
    if (existsSync(withExt)) {
      return normalizeRelativePath(withExt.slice(rootDir.length + 1));
    }
  }

  // Try as directory with index file
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexPath = join(absolute, `index${ext}`);
    if (existsSync(indexPath)) {
      return normalizeRelativePath(indexPath.slice(rootDir.length + 1));
    }
  }

  return null;
}

/**
 * Resolve barrel file re-exports. Given a resolved barrel file path and an
 * imported name, follow `export { Name } from './source'` chains to find
 * the actual source file.
 *
 * Returns an array of resolved file paths (one per re-exported name found).
 * If the barrel file doesn't re-export the given name, returns the original
 * barrel file path.
 *
 * @param barrelFilePath - resolved relative path of the barrel file (e.g., "index.ts")
 * @param importedNames  - names being imported (e.g., ["Foo"]). If empty, resolves ALL re-exports.
 * @param rootDir        - project root directory for path resolution
 * @param maxDepth       - max chain depth to prevent infinite loops (default 5)
 */
export function resolveBarrelReExports(
  barrelFilePath: string,
  importedNames: string[],
  rootDir: string,
  maxDepth = 5,
): Map<string, string> {
  const results = new Map<string, string>(); // name → resolved file path
  if (maxDepth <= 0) return results;

  const absolutePath = join(rootDir, barrelFilePath);
  if (!existsSync(absolutePath)) return results;

  const ext = '.' + barrelFilePath.split('.').pop();
  if (!BARREL_EXTENSIONS.has(ext)) return results;

  let content: string;
  try {
    content = readFileSync(absolutePath, 'utf-8');
  } catch {
    return results;
  }

  // Determine ast-grep language
  const lang = ext === '.ts' || ext === '.mjs' || ext === '.cjs' || ext === '.js'
    ? (ext === '.ts' ? 'TypeScript' : 'JavaScript')
    : (ext === '.tsx' || ext === '.jsx' ? 'Tsx' : null);

  if (!lang) return results;

  let root;
  try {
    root = parse(lang, content).root();
  } catch {
    return results;
  }

  // Find all `export { ... } from '...'` statements
  for (const node of root.children()) {
    if (node.kind() !== 'export_statement') continue;

    // Must have a string child (the source specifier) — that means it's a re-export
    let specifier: string | null = null;
    for (const child of node.children()) {
      if (child.kind() === 'string') {
        const fragment = child.children().find(c => c.kind() === 'string_fragment');
        if (fragment) specifier = fragment.text();
      }
    }
    if (!specifier) continue;

    // Resolve the re-export target
    const targetPath = resolveImportPath(specifier, barrelFilePath, rootDir);
    if (!targetPath) continue;

    // Extract exported names from the export clause
    const exportClause = node.children().find(c => c.kind() === 'export_clause');
    if (exportClause) {
      for (const spec of exportClause.children()) {
        if (spec.kind() !== 'export_specifier') continue;
        const nameNode = spec.children().find(c => c.kind() === 'identifier');
        if (!nameNode) continue;
        const name = nameNode.text();

        // If we're looking for specific names, filter
        if (importedNames.length > 0 && !importedNames.includes(name)) continue;

        // Check if target is itself a barrel file (recursive)
        const deeper = resolveBarrelReExports(targetPath, [name], rootDir, maxDepth - 1);
        if (deeper.has(name)) {
          results.set(name, deeper.get(name)!);
        } else {
          results.set(name, targetPath);
        }
      }
    } else {
      // `export * from './source'` — wildcard re-export
      // For wildcard, we can't know the names without parsing the source.
      // Map all requested names to the target file as best-effort.
      for (const name of importedNames) {
        results.set(name, targetPath);
      }
    }
  }

  return results;
}
