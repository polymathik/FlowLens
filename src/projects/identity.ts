/**
 * Re-write `.flowlens/project.json` with a known id (or a fresh one).
 * Used by the registry when the identity file was deleted (`init --force`)
 * or duplicated (a `.flowlens/` copied between repos). Reads go through the
 * shared `utils/project-identity.ts`; this only adds the "write this id" case.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateProjectId, type ProjectIdentity } from '../utils/project-identity.js';
import { writeJsonAtomic } from './atomic.js';

export function restoreProjectIdentity(
  flowlensDir: string,
  root: string,
  id: string | null,
): ProjectIdentity {
  mkdirSync(flowlensDir, { recursive: true });
  const created_at = new Date().toISOString();
  const identity: ProjectIdentity = { id: id ?? generateProjectId(root, created_at), created_at };
  writeJsonAtomic(join(flowlensDir, 'project.json'), identity);
  return identity;
}
