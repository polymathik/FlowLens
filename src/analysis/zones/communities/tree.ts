/**
 * The community tree of one group (a package, or the files outside packages): cluster, key, name, and
 * split oversized communities recursively — which is what gives nested zones.
 *
 * Keys are `<parentKey>/<slug>`; on a warm start a community keeps the key of the previous community it
 * overlaps most (see `match.ts`) and its label is read back from that key, so neither jumps on small edits.
 */
import type { ZoningFileEdge } from '../../../contracts/zones.js';
import { claimKey } from '../keys.js';
import { childOf, matchKeys, previousSizes } from './match.js';
import { commonPrefix, dirSegments, labelOfSlug, nameSiblings, slugOf, type NameFile } from './naming.js';
import { clusterLevel, MAX_ZONE, MIN_ZONE } from './partition.js';
import { seedOf } from './rng.js';

export interface TreeCtx {
  /** Seed text: project + group, so the same package clusters the same way from any scope. */
  seed: string;
  pathOf(id: string): string;
  nameFile(id: string): NameFile;
  /** Previous assignment: file path → leaf community key. */
  prev: Readonly<Record<string, string>>;
  /** Keys that had children before (a split community stays split down to `KEEP_SPLIT`). */
  prevParents: ReadonlySet<string>;
  edges: ZoningFileEdge[];
}

export interface CNode {
  key: string;
  label: string;
  /** Every file below (children included), sorted by id. */
  ids: string[];
  children: CNode[];
}

/** A community split in the previous run stays split while it has more files than this (hysteresis). */
export const KEEP_SPLIT = 30;
const MAX_DEPTH = 3;

export const parentKeysOf = (prev: Readonly<Record<string, string>>): Set<string> => {
  const out = new Set<string>();
  for (const leaf of Object.values(prev)) for (let i = leaf.indexOf('/'); i > 0; i = leaf.indexOf('/', i + 1)) out.add(leaf.slice(0, i));
  return out;
};

/** Files without a tie go to the community whose files share the longest folder prefix with them. */
export function placeByFolder(ctx: TreeCtx, loose: string[], groups: string[][]): void {
  const dirs = groups.map((g) => g.map((id) => dirSegments(ctx.pathOf(id))));
  for (const id of loose) {
    const mine = dirSegments(ctx.pathOf(id));
    let best = 0;
    let bestScore = -1;
    dirs.forEach((list, gi) => {
      let top = 0;
      let hits = 0;
      for (const d of list) {
        let i = 0;
        while (i < d.length && i < mine.length && d[i] === mine[i]) i++;
        if (i > top) [top, hits] = [i, 1];
        else if (i === top) hits++;
      }
      const score = top * 1000 + Math.min(hits, 999);
      if (score > bestScore) [best, bestScore] = [gi, score];
    });
    groups[best].push(id);
  }
  for (const g of groups) g.sort();
}

/** Last resort for a dense community that no resolution splits: one group per sub-folder (small ones merged). */
export function folderGroups(ctx: TreeCtx, ids: string[]): string[][] {
  const prefix = commonPrefix(ids.map((id) => ({ path: ctx.pathOf(id) }))).length;
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const seg = dirSegments(ctx.pathOf(id))[prefix] ?? '.';
    buckets.set(seg, [...(buckets.get(seg) ?? []), id]);
  }
  const groups = [...buckets].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).map(([, g]) => g);
  const big = groups.filter((g) => g.length >= MIN_ZONE);
  if (big.length === 0) return [];
  for (const g of groups.filter((x) => x.length < MIN_ZONE)) big.sort((a, b) => a.length - b.length)[0].push(...g);
  return big.length >= 2 ? big.map((g) => g.sort()) : [];
}

function level(ctx: TreeCtx, ids: string[], parentKey: string, baseSegs: string[], depth: number, needSplit: boolean): CNode[] {
  const inSet = new Set(ids);
  const prevOf = ids.map((id) => childOf(parentKey, ctx.prev[ctx.pathOf(id)]));
  const res = clusterLevel({
    ids, edges: ctx.edges.filter((e) => inSet.has(e.a) && inSet.has(e.b)), seed: seedOf(ctx.seed, parentKey), prev: prevOf, needSplit,
  });
  let groups = res.groups;
  if (groups.length === 0 && ids.length > 0 && !needSplit) groups = [ids];
  if (needSplit && groups.length < 2) groups = folderGroups(ctx, ids);
  else placeByFolder(ctx, res.loose, groups);
  if (groups.length === 0) return [];

  const sizes = previousSizes(parentKey, ctx.prev);
  const prevByFile = new Map(ids.map((id, i) => [id, prevOf[i]]));
  const matched = matchKeys(groups.map((g) => g.map((id) => prevByFile.get(id))), sizes);
  const used = new Set<string>(matched.filter((k): k is string => k !== null));
  const requests = groups.map((g, i) => ({
    files: g.map((id) => ctx.nameFile(id)),
    fixed: matched[i] === null ? undefined : labelOfSlug(matched[i]!.slice(parentKey.length + 1)),
  }));
  const labels = nameSiblings(requests, baseSegs);
  const nodes: CNode[] = groups.map((g, i) => {
    const key = matched[i] ?? claimKey(used, `${parentKey}/${slugOf(labels[i])}`);
    return { key, label: labels[i], ids: g, children: [] };
  });
  nodes.sort((a, b) => (a.ids[0] < b.ids[0] ? -1 : 1));

  if (depth < MAX_DEPTH) {
    for (const node of nodes) {
      const keepSplit = node.ids.length > KEEP_SPLIT && ctx.prevParents.has(node.key);
      if (node.ids.length <= MAX_ZONE && !keepSplit) continue;
      const kids = level(ctx, node.ids, node.key, commonPrefix(node.ids.map((id) => ({ path: ctx.pathOf(id) }))), depth + 1, node.ids.length > MAX_ZONE);
      if (kids.length >= 2) node.children = kids;
    }
  }
  return nodes;
}

/** Top-level communities of a group; an empty list means "keep the group as one zone". */
export function buildTree(ctx: TreeCtx, ids: string[], groupKey: string, baseSegs: string[]): CNode[] {
  const nodes = level(ctx, [...ids].sort(), groupKey, baseSegs, 0, ids.length > MAX_ZONE);
  return nodes.length >= 2 ? nodes : [];
}
