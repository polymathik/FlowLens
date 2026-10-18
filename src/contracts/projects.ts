/**
 * Project registry contract — `~/.flowlens/projects.json`.
 *
 * FlowLens keeps each project's graph inside that project's `.flowlens/`.
 * The registry only *points* at projects so one graph service and one
 * explorer UI can serve all of them (one tab per project + a Home tab).
 *
 * Registration is automatic on `flowlens init` and on the first
 * `index`/`serve` of an unregistered project. `flowlens projects
 * list|remove|rename` manage it.
 *
 * Owners: Lane B / Phase 9 (registry + graph service). Readers: CLI,
 * graph service, explorer UI.
 */

export type ProjectStatus =
  /** Root and `.flowlens/` exist. */
  | 'ok'
  /** Root or its `.flowlens/` no longer exists (moved or deleted). */
  | 'missing';

export interface ProjectRecord {
  /** Stable id: short hash of canonical root + registration time. */
  id: string;
  /** Display name; defaults to the root directory name. Unique within the registry. */
  name: string;
  /** Absolute canonical root path. */
  root: string;
  /** ISO-8601 registration time. */
  registered_at: string;
  /** ISO-8601 time of the last completed index, copied from the manifest when known. */
  last_indexed: string | null;
}

export interface ProjectWithStatus extends ProjectRecord {
  status: ProjectStatus;
}

export interface RegistryFile {
  version: 1;
  projects: ProjectRecord[];
}

export interface ProjectRegistry {
  /** All projects with live status (checks the filesystem). */
  list(): Promise<ProjectWithStatus[]>;
  get(id: string): Promise<ProjectWithStatus | null>;
  /** Find by canonical root path. */
  findByRoot(root: string): Promise<ProjectWithStatus | null>;
  /** Idempotent: returns the existing record when the root is already registered. */
  register(root: string, name?: string): Promise<ProjectRecord>;
  remove(id: string): Promise<boolean>;
  rename(id: string, name: string): Promise<ProjectRecord>;
  /** Update last_indexed (and re-point root after a relink). */
  touch(id: string, fields: Partial<Pick<ProjectRecord, 'last_indexed' | 'root'>>): Promise<void>;
}

/** Location override for tests and CI: FLOWLENS_HOME (default `~/.flowlens`). */
export const FLOWLENS_HOME_ENV = 'FLOWLENS_HOME';
