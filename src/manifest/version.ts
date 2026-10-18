/** FlowLens package version and parser revision recorded in the manifest. */
import { createRequire } from 'node:module';

/** Bump when extraction output changes (entity identity, relation semantics). */
export const PARSER_VERSION = '8.1.0';
// 8.1.0 (Map M0): source-first workspace imports, .svelte/.vue components (`component` entity),
//                 `file_role` on file entities, `meta.reexport` on re-export edges.

let cached: string | null = null;

export function flowlensVersion(): string {
  if (cached) return cached;
  try {
    const require = createRequire(import.meta.url);
    cached = (require('../../package.json') as { version?: string }).version ?? '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}
