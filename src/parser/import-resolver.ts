import { existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { normalizeRelativePath } from '../utils/paths.js';

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

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
