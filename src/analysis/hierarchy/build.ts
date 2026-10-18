/**
 * Hierarchy builder (pure): entities → Project / package / folder / file /
 * symbol tree. See `contracts/hierarchy.ts` for the model and id scheme.
 *
 * Folders mirror the real directory tree; a chain of folders where each
 * has exactly one child (a folder) and no files is collapsed into one node
 * (`src/adapters/codex`). Packages keep their own node (named by their
 * manifest) and are never merged into a chain. Config files and lockfiles
 * of a directory live in a `config:<dir>` pseudo-folder at the end.
 */
import {
  PROJECT_NODE_ID,
  type FileRole,
  type Hierarchy,
  type HierarchyEntity,
  type HierarchyInput,
  type HierarchyNode,
} from '../../contracts/hierarchy.js';
import { dirnameOf } from '../module-path.js';
import { isConfigRole, resolveFileRole } from './file-role.js';
import { configId, fileNodeId, folderId, packageId } from './ids.js';
import { compareSymbols, isSymbolEntity, symbolParents } from './symbols.js';
import { emptyAcc, emptyStats, finishStats, mergeAcc, topFiles, type MetricAcc } from './stats.js';

interface FileInfo {
  path: string;
  entityId?: string;
  language?: string;
  role: FileRole;
  lines: number;
  symbols: HierarchyEntity[];
}

interface DirInfo {
  subdirs: Set<string>;
  files: string[];
  config: string[];
}

const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
const cmp = (a: string, b: string): number => {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
};
const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (file: string): string => {
  const d = dirnameOf(file);
  return d === '.' ? '' : d;
};

function collectFiles(entities: HierarchyEntity[]): Map<string, FileInfo> {
  const files = new Map<string, FileInfo>();
  const ensure = (path: string): FileInfo => {
    let f = files.get(path);
    if (!f) files.set(path, (f = { path, role: resolveFileRole(path), lines: 0, symbols: [] }));
    return f;
  };
  for (const e of entities) {
    if (e.kind === 'module' || !e.file) continue;
    const path = normalize(e.file);
    if (!path) continue;
    const f = ensure(path);
    if (e.kind === 'file') {
      f.entityId = e.id;
      f.language = e.language;
      f.lines = e.metrics?.line_count ?? e.location?.line_end ?? 0;
      f.role = resolveFileRole(path, e.file_role);
    } else if (isSymbolEntity(e)) f.symbols.push(e);
  }
  return files;
}

function buildDirs(files: Map<string, FileInfo>): Map<string, DirInfo> {
  const dirs = new Map<string, DirInfo>([['', { subdirs: new Set(), files: [], config: [] }]]);
  const ensure = (dir: string): DirInfo => {
    let d = dirs.get(dir);
    if (!d) {
      d = { subdirs: new Set(), files: [], config: [] };
      dirs.set(dir, d);
      const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
      ensure(parent).subdirs.add(dir);
    }
    return d;
  };
  for (const f of files.values()) {
    const d = ensure(dirOf(f.path));
    (isConfigRole(f.role) ? d.config : d.files).push(f.path);
  }
  return dirs;
}

export function buildHierarchy(input: HierarchyInput): Hierarchy {
  const files = collectFiles(input.entities);
  const dirs = buildDirs(files);
  const packages = new Map((input.packages ?? []).map((p) => [normalize(p.dir), p]));
  const h: Hierarchy = {
    rootId: PROJECT_NODE_ID,
    nodes: new Map(),
    byEntity: new Map(),
    byFile: new Map(),
    byDir: new Map(),
    byQualifiedName: new Map(),
  };
  const accs = new Map<string, MetricAcc>();
  const fileIdsBelow = new Map<string, string[]>();

  const add = (n: Omit<HierarchyNode, 'childIds' | 'stats'> & { childIds?: string[] }): HierarchyNode => {
    const node: HierarchyNode = { childIds: [], stats: emptyStats(), ...n };
    h.nodes.set(node.id, node);
    if (node.parentId) h.nodes.get(node.parentId)!.childIds.push(node.id);
    accs.set(node.id, emptyAcc());
    return node;
  };

  /** Fold a finished child into its parent's statistics. */
  const rollUp = (child: HierarchyNode, parent: HierarchyNode, countsAsFolder: boolean): void => {
    parent.stats.files += child.stats.files;
    parent.stats.folders += child.stats.folders + (countsAsFolder ? 1 : 0);
    parent.stats.symbols += child.stats.symbols;
    parent.stats.lines += child.stats.lines;
    mergeAcc(accs.get(parent.id)!, accs.get(child.id)!);
    const below = fileIdsBelow.get(parent.id) ?? [];
    below.push(...(fileIdsBelow.get(child.id) ?? []));
    fileIdsBelow.set(parent.id, below);
  };

  const addSymbols = (file: FileInfo, fileNode: HierarchyNode): void => {
    const syms = [...file.symbols].sort(compareSymbols);
    const parents = symbolParents(file.path, syms);
    const made = new Map<string, HierarchyNode>();
    let pending = syms;
    while (pending.length > 0) {
      const next: HierarchyEntity[] = [];
      for (const s of pending) {
        const parentEntity = parents.get(s.id) ?? null;
        if (parentEntity && !made.has(parentEntity)) {
          next.push(s); // parent not created yet (declared later in the file)
          continue;
        }
        const parent = parentEntity ? made.get(parentEntity)! : fileNode;
        const node = add({
          id: s.id, kind: 'symbol', name: s.name, path: file.path, parentId: parent.id, depth: parent.depth + 1,
          entityId: s.id, symbolKind: s.kind, qualifiedName: s.qualified_name, language: s.language,
        });
        const m = s.metrics;
        node.stats.symbols = 1;
        node.stats.lines = m?.line_count ?? 0;
        const own = accs.get(node.id)!;
        if (m?.quality_score !== undefined) {
          own.qSum = m.quality_score;
          own.qCount = 1;
        }
        own.churn = m?.churn_rate;
        own.hotspot = m?.hotspot_score;
        h.byEntity.set(s.id, node.id);
        if (!h.byQualifiedName.has(s.qualified_name)) h.byQualifiedName.set(s.qualified_name, node.id);
        made.set(s.id, node);
        // A file aggregates every symbol below it (classes and their members).
        fileNode.stats.symbols += 1;
        mergeAcc(accs.get(fileNode.id)!, own);
      }
      if (next.length === pending.length) {
        // Cyclic / unresolvable scopes: attach the rest to the file.
        for (const s of next) parents.set(s.id, null);
      }
      pending = next;
    }
  };

  const addFile = (f: FileInfo, parent: HierarchyNode): HierarchyNode => {
    const node = add({
      id: fileNodeId(f.path), kind: 'file', name: baseOf(f.path), path: f.path, parentId: parent.id,
      depth: parent.depth + 1, entityId: f.entityId, language: f.language, role: f.role,
    });
    node.stats.files = 1;
    node.stats.lines = f.lines;
    h.byFile.set(f.path, node.id);
    if (f.entityId) h.byEntity.set(f.entityId, node.id);
    addSymbols(f, node);
    fileIdsBelow.set(node.id, isConfigRole(f.role) ? [] : [node.id]);
    return node;
  };

  const sortedFiles = (paths: string[]): FileInfo[] => [...paths].sort((a, b) => cmp(baseOf(a), baseOf(b))).map((p) => files.get(p)!);

  const addChildren = (dir: string, parent: HierarchyNode): void => {
    const info = dirs.get(dir)!;
    for (const sub of [...info.subdirs].sort((a, b) => cmp(baseOf(a), baseOf(b)))) addDir(sub, parent);
    for (const f of sortedFiles(info.files)) rollUp(addFile(f, parent), parent, false);
    if (info.config.length > 0) {
      const group = add({ id: configId(dir), kind: 'config', name: 'Config', path: dir, parentId: parent.id, depth: parent.depth + 1 });
      for (const f of sortedFiles(info.config)) rollUp(addFile(f, group), group, false);
      rollUp(group, parent, false);
    }
  };

  const addDir = (dir: string, parent: HierarchyNode): void => {
    const pkg = packages.get(dir);
    const merged = [dir];
    let tail = dir;
    if (!pkg) {
      for (;;) {
        const info = dirs.get(tail)!;
        if (info.files.length || info.config.length || info.subdirs.size !== 1) break;
        const only = [...info.subdirs][0];
        if (packages.has(only)) break;
        tail = only;
        merged.push(only);
      }
    }
    const node = add({
      id: pkg ? packageId(dir) : folderId(tail),
      kind: pkg ? 'package' : 'folder',
      name: pkg ? pkg.name : merged.map(baseOf).join('/'),
      path: tail,
      parentId: parent.id,
      depth: parent.depth + 1,
      collapsedDirs: merged.length > 1 ? merged : undefined,
    });
    for (const d of merged) h.byDir.set(d, node.id);
    addChildren(tail, node);
    rollUp(node, parent, true);
  };

  const root = add({ id: PROJECT_NODE_ID, kind: 'project', name: input.projectName, path: '', parentId: null, depth: 0 });
  h.byDir.set('', root.id);
  h.byDir.set('.', root.id);
  addChildren('', root);

  for (const [id, node] of h.nodes) {
    finishStats(node.stats, accs.get(id)!);
    if (node.kind === 'project' || node.kind === 'package' || node.kind === 'folder' || node.kind === 'config') {
      node.topFiles = topFiles(h.nodes, fileIdsBelow.get(id) ?? []);
    }
  }
  return h;
}
