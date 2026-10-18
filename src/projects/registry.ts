/**
 * FileProjectRegistry — `ProjectRegistry` over `$FLOWLENS_HOME/projects.json`.
 *
 * - Every mutation runs read-modify-write under a cross-process lockfile and
 *   writes atomically (tmp + rename), so concurrent `init`s never lose entries.
 * - Roots are canonical (realpath). Display names are unique.
 * - Ids come from `<root>/.flowlens/project.json` (`ensureProjectIdentity`), so
 *   registry id == manifest `project_id`. A project that was moved together
 *   with its `.flowlens/` is re-linked (same id, new root) on registration.
 * - Status is computed live: `missing` when the root or `.flowlens/` is gone.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  ProjectRecord, ProjectRegistry, ProjectWithStatus, RegistryFile,
} from '../contracts/projects.js';
import { ensureProjectIdentity, readProjectIdentity } from '../utils/project-identity.js';
import { writeJsonAtomic } from './atomic.js';
import { withFileLock } from './file-lock.js';
import { canonicalRoot, ensureFlowlensHome, projectFlowlensDir, registryPath } from './paths.js';
import { restoreProjectIdentity } from './identity.js';

export class FileProjectRegistry implements ProjectRegistry {
  constructor(private readonly file: string = registryPath()) {}

  async list(): Promise<ProjectWithStatus[]> {
    return this.read().projects.map(withStatus);
  }

  async get(id: string): Promise<ProjectWithStatus | null> {
    const rec = this.read().projects.find((p) => p.id === id);
    return rec ? withStatus(rec) : null;
  }

  async findByRoot(root: string): Promise<ProjectWithStatus | null> {
    const canon = canonicalRoot(root);
    const rec = this.read().projects.find((p) => p.root === canon);
    return rec ? withStatus(rec) : null;
  }

  async register(root: string, name?: string): Promise<ProjectRecord> {
    const canon = canonicalRoot(root);
    if (!existsSync(canon)) throw new Error(`Project root does not exist: ${canon}`);
    return this.mutate((reg) => {
      const fdir = projectFlowlensDir(canon);
      const byRoot = reg.projects.find((p) => p.root === canon);
      if (byRoot) {
        reconcileIdentity(reg, byRoot, fdir);
        return byRoot;
      }
      const identity = ensureProjectIdentity(fdir, canon);
      const byId = reg.projects.find((p) => p.id === identity.id);
      if (byId && !existsSync(projectFlowlensDir(byId.root))) {
        byId.root = canon; // moved project: re-link, keep id/name
        return byId;
      }
      let id = identity.id;
      if (byId) {
        // `.flowlens/` copied from a still-present project: give this one its own id.
        id = restoreProjectIdentity(fdir, canon, null).id;
      }
      const rec: ProjectRecord = {
        id,
        name: uniqueName(reg, name ?? (basename(canon) || canon)),
        root: canon,
        registered_at: new Date().toISOString(),
        last_indexed: null,
      };
      reg.projects.push(rec);
      return rec;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.mutate((reg) => {
      const before = reg.projects.length;
      reg.projects = reg.projects.filter((p) => p.id !== id);
      return reg.projects.length !== before;
    });
  }

  async rename(id: string, name: string): Promise<ProjectRecord> {
    const trimmed = name.trim();
    if (trimmed === '') throw new Error('Project name must not be empty');
    return this.mutate((reg) => {
      const rec = reg.projects.find((p) => p.id === id);
      if (!rec) throw new Error(`Unknown project: ${id}`);
      if (reg.projects.some((p) => p.id !== id && p.name === trimmed)) {
        throw new Error(`A project named "${trimmed}" already exists`);
      }
      rec.name = trimmed;
      return { ...rec };
    });
  }

  async touch(
    id: string,
    fields: Partial<Pick<ProjectRecord, 'last_indexed' | 'root'>>,
  ): Promise<void> {
    await this.mutate((reg) => {
      const rec = reg.projects.find((p) => p.id === id);
      if (!rec) throw new Error(`Unknown project: ${id}`);
      if (fields.last_indexed !== undefined) rec.last_indexed = fields.last_indexed;
      if (fields.root !== undefined) rec.root = canonicalRoot(fields.root);
    });
  }

  /** Resolve an id, a unique name, or a root path to a project. */
  async lookup(ref: string): Promise<ProjectWithStatus | null> {
    const all = await this.list();
    return all.find((p) => p.id === ref)
      ?? all.find((p) => p.name === ref)
      ?? all.find((p) => p.root === canonicalRoot(ref))
      ?? null;
  }

  /* ---------------- internals ---------------- */

  private read(): RegistryFile {
    if (!existsSync(this.file)) return { version: 1, projects: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<RegistryFile>;
      return { version: 1, projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
    } catch (err) {
      throw new Error(
        `Project registry ${this.file} is not valid JSON (${(err as Error).message}); fix or delete it.`,
      );
    }
  }

  private async mutate<T>(fn: (reg: RegistryFile) => T): Promise<T> {
    if (this.file === registryPath()) ensureFlowlensHome();
    return withFileLock(`${this.file}.lock`, () => {
      const reg = this.read();
      const result = fn(reg);
      writeJsonAtomic(this.file, reg);
      return result;
    });
  }
}

function withStatus(rec: ProjectRecord): ProjectWithStatus {
  const ok = existsSync(rec.root) && existsSync(join(rec.root, '.flowlens'));
  return { ...rec, status: ok ? 'ok' : 'missing' };
}

function uniqueName(reg: RegistryFile, wanted: string): string {
  const taken = new Set(reg.projects.map((p) => p.name));
  if (!taken.has(wanted)) return wanted;
  for (let i = 2; ; i++) {
    const candidate = `${wanted}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Keep `.flowlens/project.json` and the registry record in agreement for a
 * root that is already registered: recreate the identity file when it was
 * deleted (e.g. `init --force`), adopt a new on-disk id when it is not used
 * by another record, otherwise rewrite the file with the record's id.
 */
function reconcileIdentity(reg: RegistryFile, rec: ProjectRecord, fdir: string): void {
  const onDisk = readProjectIdentity(fdir);
  if (!onDisk) {
    restoreProjectIdentity(fdir, rec.root, rec.id);
    return;
  }
  if (onDisk.id === rec.id) return;
  if (reg.projects.some((p) => p.id === onDisk.id)) restoreProjectIdentity(fdir, rec.root, rec.id);
  else rec.id = onDisk.id;
}
