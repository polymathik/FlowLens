/**
 * `communities` drafts: group the files of the scope per workspace package (hard boundaries), cluster each
 * group on the weighted file graph and describe the result as `ZoneDraft`s for the shared
 * `finalizeZones` pipeline (overrides, stats, colours, collapse).
 *
 *  - a package below the scope with several communities becomes a wrapper zone (key = package name)
 *    around them; with a single community the package zone holds the files itself;
 *  - the group of the scope itself (the scope's package, or the files outside packages) puts its
 *    communities at the top level; a single community there is the `Root` zone, which the canvas
 *    shows as loose cards, like the other modes;
 *  - tests, docs, assets and generated files join the community they depend on most; config files
 *    stay in the package zone or the Config zone (`attach.ts`, `roles.ts`).
 */
import type { Hierarchy, HierarchyNode } from '../../../contracts/hierarchy.js';
import { PROJECT_NODE_ID } from '../../../contracts/hierarchy.js';
import { ZONE_CONFIG_KEY, type ZoningFileEdge, type ZoningInput } from '../../../contracts/zones.js';
import { DraftBook, type ZoneDraft } from '../draft.js';
import { claimKey } from '../keys.js';
import { filesBelow, rootKey, rootLabel, scopeNodeOf } from '../scope.js';
import { leafFor, neighbourWeights, type Leaf } from './attach.js';
import { buildFileGraph } from './file-graph.js';
import { MAX_ZONE } from './partition.js';
import { fileTokens } from './tokens.js';
import { packageOf, treatmentOf } from './roles.js';
import { buildTree, KEEP_SPLIT, parentKeysOf, type CNode, type TreeCtx } from './tree.js';

const SCOPE = '@scope';

interface Group {
  /** Package node, or null for files outside packages. */
  pkg: HierarchyNode | null;
  wrapper: boolean;
  anchorId: string;
  cluster: string[];
  attach: string[];
  config: string[];
  rootConfig: string[];
}

const leaves = (nodes: CNode[]): CNode[] => nodes.flatMap((n) => (n.children.length > 0 ? leaves(n.children) : [n]));

export function communityDrafts(input: ZoningInput): ZoneDraft[] {
  const h: Hierarchy = input.hierarchy;
  const scope = scopeNodeOf(h, input.scopeId);
  if (!scope) return [];
  const scopePkgId = scope.kind === 'package' ? scope.id : packageOf(h, scope);
  const scopePkg = scopePkgId ? (h.nodes.get(scopePkgId) ?? null) : null;
  const fileIds = filesBelow(h, scope);
  const inScope = new Set(fileIds);
  const edges: ZoningFileEdge[] = (input.fileGraph ?? buildFileGraph(h, [])).edges.filter((e) => inScope.has(e.a) && inScope.has(e.b));
  const prev = input.previousAssignment ?? {};
  const prevParents = parentKeysOf(prev);
  const projectName = h.nodes.get(PROJECT_NODE_ID)?.name ?? '';
  const pathOf = (id: string): string => h.nodes.get(id)?.path ?? id;
  const tokenCache = new Map<string, ReturnType<typeof fileTokens>>();
  const nameFile = (id: string): { path: string; tokens: ReturnType<typeof fileTokens> } => {
    const node = h.nodes.get(id);
    let tokens = tokenCache.get(id);
    if (!tokens) {
      const symbols = (node?.childIds ?? []).map((c) => h.nodes.get(c)).filter((c) => c?.kind === 'symbol').map((c) => c!.name);
      tokenCache.set(id, (tokens = fileTokens(pathOf(id), symbols)));
    }
    return { path: pathOf(id), tokens };
  };

  // Group per nearest package.
  const groups = new Map<string, Group>();
  for (const id of fileIds) {
    const node = h.nodes.get(id)!;
    const pkgId = packageOf(h, node);
    const gid = pkgId === null || pkgId === scopePkg?.id ? SCOPE : pkgId;
    let g = groups.get(gid);
    if (!g) {
      const pkg = gid === SCOPE ? (scopePkg ?? null) : h.nodes.get(gid)!;
      groups.set(gid, (g = { pkg, wrapper: gid !== SCOPE, anchorId: gid === SCOPE ? scope.id : gid, cluster: [], attach: [], config: [], rootConfig: [] }));
    }
    const t = treatmentOf(node);
    if (t === 'cluster') g.cluster.push(id);
    else if (t === 'attach') g.attach.push(id);
    else {
      const cfg = node.parentId ? h.nodes.get(node.parentId) : undefined;
      if (cfg?.kind === 'config' && cfg.parentId === g.anchorId) g.rootConfig.push(id);
      else g.attach.push(id);
    }
  }

  const book = new DraftBook();
  const used = new Set<string>([ZONE_CONFIG_KEY, rootKey(scope)]);
  const wrapperKeys = new Map<string, string>();
  for (const gid of [...groups.keys()].sort()) {
    const g = groups.get(gid)!;
    if (g.wrapper && g.pkg) wrapperKeys.set(gid, claimKey(used, g.pkg.name, `${g.pkg.name}@${g.pkg.path}`));
  }
  const wrapperParent = (pkg: HierarchyNode): string | null => {
    for (let p = pkg.parentId ? h.nodes.get(pkg.parentId) : undefined; p; p = p.parentId ? h.nodes.get(p.parentId) : undefined) {
      const key = wrapperKeys.get(p.id);
      if (key) return key;
    }
    return null;
  };
  const config = (): ZoneDraft => book.ensure(ZONE_CONFIG_KEY, () => ({ label: 'Config', source: 'config', parentKey: null }));
  const weights = neighbourWeights(edges);

  for (const gid of [...groups.keys()].sort()) {
    const g = groups.get(gid)!;
    const pkgName = g.pkg ? (g.wrapper ? wrapperKeys.get(gid)! : g.pkg.name) : '';
    const baseKey = g.pkg ? pkgName : '.'; // scope-independent, so keys survive moving between views
    const baseSegs = g.pkg ? g.pkg.path.split('/').filter(Boolean) : scope.path.split('/').filter(Boolean);
    const ctx: TreeCtx = { seed: `${projectName}|${baseKey}`, pathOf, nameFile, prev, prevParents, edges: groupEdges(edges, g.cluster) };
    const split = g.cluster.length > MAX_ZONE || (g.cluster.length > KEEP_SPLIT && prevParents.has(baseKey));
    const tree = split ? buildTree(ctx, g.cluster, baseKey, baseSegs) : [];
    const parentKey = g.wrapper && g.pkg ? wrapperParent(g.pkg) : null;

    if (tree.length === 0) {
      if (g.wrapper && g.pkg) {
        book.add({ key: wrapperKeys.get(gid)!, label: g.pkg.name, source: 'package', parentKey, nodeId: g.pkg.id, fileIds: [...g.cluster, ...g.attach, ...g.rootConfig] });
      } else {
        book.add({ key: rootKey(scope), label: rootLabel(scope), source: 'folder', parentKey: null, fileIds: [...g.cluster, ...g.attach] });
        if (g.rootConfig.length > 0) config().fileIds.push(...g.rootConfig);
      }
      continue;
    }

    let top: string | null = null;
    if (g.wrapper && g.pkg) {
      top = wrapperKeys.get(gid)!;
      book.add({ key: top, label: g.pkg.name, source: 'package', parentKey, nodeId: g.pkg.id, fileIds: [...g.rootConfig] });
    } else if (g.rootConfig.length > 0) config().fileIds.push(...g.rootConfig);

    const leafNodes = leaves(tree);
    const leafSets: Leaf[] = leafNodes.map((n) => ({ key: n.key, ids: new Set(n.ids) }));
    const members = new Map<string, string[]>(leafNodes.map((n) => [n.key, [...n.ids]]));
    for (const id of g.attach) members.get(leafNodes[leafFor(id, pathOf(id), leafSets, weights.get(id), pathOf)].key)!.push(id);
    const emit = (n: CNode, parent: string | null): void => {
      book.add({ key: n.key, label: n.label, source: 'community', parentKey: parent, fileIds: n.children.length === 0 ? members.get(n.key)! : [] });
      for (const c of n.children) emit(c, n.key);
    };
    for (const n of tree) emit(n, top);
  }
  return book.list();
}

/** Edges whose two ends are both clustered files of the group. */
function groupEdges(edges: readonly ZoningFileEdge[], cluster: readonly string[]): ZoningFileEdge[] {
  const set = new Set(cluster);
  return edges.filter((e) => set.has(e.a) && set.has(e.b));
}
