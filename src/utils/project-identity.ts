/**
 * Project identity — `.flowlens/project.json`.
 *
 * A tiny file holding the stable project id. Whoever first needs the id
 * (indexer writing the manifest, registry registering the project) calls
 * `ensureProjectIdentity`; afterwards everyone reads the same value, so
 * the manifest's `project_id` and the registry's `ProjectRecord.id` agree.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface ProjectIdentity {
  id: string;
  created_at: string;
}

const FILE = 'project.json';

export function generateProjectId(root: string, createdAt: string): string {
  return createHash('sha256')
    .update(`${root}\0${createdAt}\0${randomBytes(4).toString('hex')}`)
    .digest('hex')
    .slice(0, 12);
}

export function readProjectIdentity(flowlensDir: string): ProjectIdentity | null {
  const p = join(flowlensDir, FILE);
  if (!existsSync(p)) return null;
  try {
    const v = JSON.parse(readFileSync(p, 'utf8')) as Partial<ProjectIdentity>;
    return typeof v.id === 'string' && typeof v.created_at === 'string'
      ? { id: v.id, created_at: v.created_at }
      : null;
  } catch {
    return null;
  }
}

/** Return the existing identity or create one atomically. `root` must be canonical. */
export function ensureProjectIdentity(flowlensDir: string, root: string): ProjectIdentity {
  const existing = readProjectIdentity(flowlensDir);
  if (existing) return existing;
  mkdirSync(flowlensDir, { recursive: true });
  const created_at = new Date().toISOString();
  const identity = { id: generateProjectId(root, created_at), created_at };
  const tmp = join(flowlensDir, `${FILE}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(identity, null, 2));
  renameSync(tmp, join(flowlensDir, FILE));
  return readProjectIdentity(flowlensDir) ?? identity;
}
