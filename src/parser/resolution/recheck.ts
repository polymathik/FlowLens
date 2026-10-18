/**
 * Re-resolve an import binding that pointed nowhere when its file was last
 * parsed (used by incremental indexing to notice newly added files).
 */
import type { ImportBinding } from '../../contracts/symbols.js';
import { resolveModuleSpecifier } from './ts-module-resolver.js';
import { resolvePythonModule } from './python-module-resolver.js';

const TS_FAMILY = new Set(['typescript', 'tsx', 'javascript', 'jsx']);

export function recheckBinding(b: ImportBinding, fromFile: string, language: string, rootDir: string): string | null {
  if (TS_FAMILY.has(language)) return resolveModuleSpecifier(b.specifier, fromFile, rootDir).file;
  if (language === 'python') {
    const level = /^\.*/.exec(b.specifier)?.[0].length ?? 0;
    return resolvePythonModule(b.specifier.slice(level), level, fromFile, rootDir).file;
  }
  return null;
}
