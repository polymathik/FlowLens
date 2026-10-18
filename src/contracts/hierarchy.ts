/**
 * Code hierarchy contract (Map v2, lane M1) — the ONE definition of how a
 * repository is structured, shared by the Map and Health:
 *
 *   Project → package → folder → file → class / interface → member
 *
 * Implemented in `src/analysis/hierarchy/` (pure, no Node.js imports, so the
 * canvas bundle and the Node services use the same code).
 *
 * Identity of tree nodes:
 *   project           'project'                     (virtual root)
 *   package           'package:<dir>'               workspace package root
 *   folder            'folder:<dir>'                <dir> = deepest directory of a collapsed chain
 *   config group      'config:<dir>'                muted pseudo-folder of config files / lockfiles
 *   file              'file:<repo-relative path>'
 *   symbol            the entity id
 *
 * Health relation: the folder node that directly holds a file always has
 * `path === moduleOfFile(file)` (see `analysis/module-path.ts`), so Health's
 * "module" and the Map's "folder" are the same thing; the Map additionally
 * collapses single-child chains for display.
 */
import type { EntityKind } from './entities.js';

export type HierarchyKind = 'project' | 'package' | 'folder' | 'config' | 'file' | 'symbol';

/** What a file is for. `config` and `lockfile` go into the muted Config group. */
export type FileRole = 'source' | 'test' | 'config' | 'lockfile' | 'docs' | 'asset' | 'declaration';

export const PROJECT_NODE_ID = 'project';

/** A workspace package (package.json / pyproject.toml / Cargo.toml / go.mod directory). */
export interface PackageInfo {
  /** Repo-relative directory ('' / '.' is the project root and is never a package). */
  dir: string;
  /** Display name, e.g. '@halcyon/server' (falls back to the directory name). */
  name: string;
  manifest?: string;
}

/**
 * Raw workspace facts from the project root, served by `GET /workspace`
 * (additive canvas API route). The canvas runs `selectPackages` over it.
 */
export interface WorkspaceInfo {
  /** Root manifest name (package.json `name`), when present. */
  project_name?: string;
  /** Workspace globs from pnpm-workspace.yaml / package.json `workspaces` (empty when none). */
  workspace_globs: string[];
  /** Every manifest found in the indexed file list (including the root one). */
  manifests: PackageInfo[];
}

/** The slice of an entity the hierarchy builder needs (`file_role` is an optional indexer hint). */
export interface HierarchyEntity {
  id: string;
  kind: EntityKind;
  name: string;
  qualified_name: string;
  file: string;
  language?: string;
  location?: { line_start: number; line_end: number };
  visibility?: string;
  file_role?: string;
  metrics?: {
    line_count?: number;
    quality_score?: number;
    churn_rate?: number;
    hotspot_score?: number;
  };
}

export interface HierarchyInput {
  /** Display name of the root ('Halcyon'). */
  projectName: string;
  entities: HierarchyEntity[];
  /** Selected workspace packages (see `selectPackages`); empty = no packages. */
  packages?: PackageInfo[];
}

/** Recursive counts and metric aggregates for a node (symbols counted below it). */
export interface HierarchyStats {
  files: number;
  folders: number;
  symbols: number;
  lines: number;
  /** Mean quality over contained symbols. */
  quality?: number;
  /** Max churn / hotspot over contained symbols. */
  churn?: number;
  hotspot?: number;
}

export interface HierarchyNode {
  id: string;
  kind: HierarchyKind;
  /** Display label ('@halcyon/server', 'src/adapters/codex', 'codex-adapter.ts', 'CodexAdapter'). */
  name: string;
  /** Directory (package/folder/config), file path (file) or the symbol's file. '' for the project. */
  path: string;
  parentId: string | null;
  /** Ordered children: packages/folders, then files, then the config group. */
  childIds: string[];
  /** Number of ancestors (project = 0). */
  depth: number;
  stats: HierarchyStats;
  /** Entity id this node stands for (symbols; files that have a file entity). */
  entityId?: string;
  symbolKind?: EntityKind;
  /** Symbols: the entity's qualified_name (deep-link identifier). */
  qualifiedName?: string;
  language?: string;
  role?: FileRole;
  /** Every directory merged into a collapsed folder node (deepest last). */
  collapsedDirs?: string[];
  /** Largest files below a folder/package/project (node ids, at most 3). */
  topFiles?: string[];
}

/** Built tree with the lookups the Map needs. */
export interface Hierarchy {
  rootId: typeof PROJECT_NODE_ID;
  nodes: Map<string, HierarchyNode>;
  /** entity id → node id (symbols → themselves, file entities → file node). */
  byEntity: Map<string, string>;
  /** file path → file node id. */
  byFile: Map<string, string>;
  /** directory path → folder/package node id (every merged directory maps to its node). */
  byDir: Map<string, string>;
  /** symbol qualified_name → node id (deep links by qualified name). */
  byQualifiedName: Map<string, string>;
}
