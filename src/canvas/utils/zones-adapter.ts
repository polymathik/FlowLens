/**
 * `getZones` — the ONE import site of the zoning service for the canvas.
 *
 * Until lane Z's `computeZones` (src/analysis/zones/index.ts) is on main this
 * is a minimal local implementation of the same contract
 * (`contracts/zones.ts`: `ZoningInput` → `ZoneSet`), built from the
 * hierarchy. At integration the whole file becomes
 *
 *   export { computeZones as getZones } from '../../analysis/zones/index.js';
 *
 * and nothing else in the canvas changes: every consumer depends only on the
 * `ZoneSet` / `ZoningInput` types. Zones produced here carry an extra
 * `nodeId` (the hierarchy node they stand for); consumers read it through
 * `hierarchyIdOfZone`, which falls back to resolving the zone key so a
 * producer without it still works.
 *
 *   folders  — every package / folder / Config group below the scope is a
 *              zone, nested like the directory tree.
 *   packages — workspace packages (hoisted out of their parent folders) are
 *              zones with all their files flat inside; folders that contain
 *              no package become flat folder zones; Config groups stay muted.
 *   communities / layers — not implemented yet: fall back to folders.
 */
import { PROJECT_NODE_ID, type Hierarchy, type HierarchyNode, type HierarchyStats } from '../../contracts/hierarchy.js';
import { ZONE_COLOR_SLOTS, type Zone, type ZoneOverrides, type ZoneSet, type ZoningInput, type ZoningMode } from '../../contracts/zones.js';

export type ZoneWithNode = Zone & { nodeId?: string };

interface Draft {
  zone: ZoneWithNode;
  files: string[];
  kids: Draft[];
}

const CONTAINER_KINDS = new Set(['package', 'folder', 'config']);
const byName = (h: Hierarchy) => (a: string, b: string) => {
  const x = h.nodes.get(a)?.name ?? a;
  const y = h.nodes.get(b)?.name ?? b;
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1;
};

function colorOf(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) % ZONE_COLOR_SLOTS;
}

function filesBelow(h: Hierarchy, id: string, skipConfig = false, out: string[] = []): string[] {
  for (const c of h.nodes.get(id)?.childIds ?? []) {
    const n = h.nodes.get(c)!;
    if (n.kind === 'file') out.push(c);
    else if (!(skipConfig && n.kind === 'config')) filesBelow(h, c, skipConfig, out);
  }
  return out;
}

function configsBelow(h: Hierarchy, id: string, out: HierarchyNode[] = []): HierarchyNode[] {
  for (const c of h.nodes.get(id)?.childIds ?? []) {
    const n = h.nodes.get(c)!;
    if (n.kind === 'config') out.push(n);
    else if (n.kind !== 'file') configsBelow(h, c, out);
  }
  return out;
}

function packageBelow(h: Hierarchy, id: string, memo: Map<string, boolean>): boolean {
  const hit = memo.get(id);
  if (hit !== undefined) return hit;
  const found = (h.nodes.get(id)?.childIds ?? []).some((c) => {
    const n = h.nodes.get(c)!;
    return n.kind === 'package' || (n.kind === 'folder' && packageBelow(h, c, memo));
  });
  memo.set(id, found);
  return found;
}

function newDraft(mode: ZoningMode, n: HierarchyNode, dupPackageNames: Set<string>): Draft {
  const key = n.kind === 'package' ? (dupPackageNames.has(n.name) ? n.path : n.name) : n.kind === 'config' ? `${n.path || '.'}/config` : n.path;
  return {
    files: [],
    kids: [],
    zone: {
      id: `zone:${mode}:${key}`,
      key,
      label: n.kind === 'config' ? 'Config' : n.name,
      source: n.kind === 'package' ? 'package' : n.kind === 'config' ? 'config' : 'folder',
      parentId: null,
      fileIds: [],
      childIds: [],
      colorIndex: n.kind === 'config' ? ZONE_COLOR_SLOTS - 1 : colorOf(key),
      collapsed: n.kind === 'config',
      stats: { files: 0, folders: 0, symbols: 0, lines: 0 },
      nodeId: n.id,
    },
  };
}

function foldersDraft(h: Hierarchy, n: HierarchyNode, dup: Set<string>): Draft {
  const d = newDraft('folders', n, dup);
  for (const c of n.childIds) {
    const child = h.nodes.get(c)!;
    if (child.kind === 'file') d.files.push(c);
    else if (CONTAINER_KINDS.has(child.kind)) d.kids.push(foldersDraft(h, child, dup));
  }
  return d;
}

/** A package or a package-free folder: every file flat inside, Config groups as nested zones. */
function flatDraft(h: Hierarchy, n: HierarchyNode, dup: Set<string>): Draft {
  const d = newDraft('packages', n, dup);
  d.files = n.kind === 'config' ? filesBelow(h, n.id) : filesBelow(h, n.id, true);
  if (n.kind !== 'config') d.kids = configsBelow(h, n.id).map((cfg) => flatDraft(h, cfg, dup));
  return d;
}

function buildDrafts(h: Hierarchy, scope: HierarchyNode, mode: ZoningMode): { roots: Draft[]; loose: string[] } {
  const roots: Draft[] = [];
  const loose: string[] = [];
  const names = new Map<string, number>();
  for (const n of h.nodes.values()) if (n.kind === 'package') names.set(n.name, (names.get(n.name) ?? 0) + 1);
  const dup = new Set([...names].filter(([, c]) => c > 1).map(([name]) => name));
  if (mode !== 'packages') {
    for (const c of scope.childIds) {
      const n = h.nodes.get(c)!;
      if (n.kind === 'file') loose.push(c);
      else if (CONTAINER_KINDS.has(n.kind)) roots.push(foldersDraft(h, n, dup));
    }
    return { roots, loose };
  }
  const memo = new Map<string, boolean>();
  const visit = (id: string): void => {
    const n = h.nodes.get(id)!;
    if (n.kind === 'file') loose.push(id);
    else if (n.kind === 'package' || n.kind === 'config' || !packageBelow(h, id, memo)) roots.push(flatDraft(h, n, dup));
    else n.childIds.forEach(visit); // a folder that only holds packages: dissolve it
  };
  scope.childIds.forEach(visit);
  return { roots, loose };
}

function fold(h: Hierarchy, d: Draft): HierarchyStats {
  const s: HierarchyStats = { files: d.files.length, folders: d.kids.length, symbols: 0, lines: 0 };
  let qSum = 0;
  let qWeight = 0;
  const take = (st: HierarchyStats) => {
    s.symbols += st.symbols;
    s.lines += st.lines;
    if (st.quality !== undefined) {
      qSum += st.quality * Math.max(1, st.symbols);
      qWeight += Math.max(1, st.symbols);
    }
    if (st.churn !== undefined) s.churn = Math.max(s.churn ?? 0, st.churn);
    if (st.hotspot !== undefined) s.hotspot = Math.max(s.hotspot ?? 0, st.hotspot);
  };
  for (const f of d.files) take(h.nodes.get(f)!.stats);
  for (const k of d.kids) {
    const ks = fold(h, k);
    s.files += ks.files;
    take(ks);
  }
  if (qWeight > 0) s.quality = Math.round(qSum / qWeight);
  d.zone.stats = s;
  return s;
}

function applyOverrides(mode: ZoningMode, drafts: Draft[], loose: string[], h: Hierarchy, overrides?: ZoneOverrides): string[] {
  if (!overrides) return loose;
  const byKey = new Map(drafts.map((d) => [`${mode}:${d.zone.key}`, d]));
  for (const [ref, d] of byKey) {
    const ov = overrides.zones[ref];
    if (!ov) continue;
    if (ov.name) d.zone.label = ov.name;
    if (ov.color !== undefined) d.zone.colorIndex = ((ov.color % ZONE_COLOR_SLOTS) + ZONE_COLOR_SLOTS) % ZONE_COLOR_SLOTS;
    if (ov.collapsed !== undefined) d.zone.collapsed = ov.collapsed;
    d.zone.customized = true;
  }
  let rest = loose;
  for (const [path, target] of Object.entries(overrides.pins)) {
    const fileId = h.byFile.get(path);
    const to = byKey.get(target);
    if (!fileId || !to) continue;
    let moved = false;
    for (const d of drafts) {
      const i = d.files.indexOf(fileId);
      if (i >= 0) {
        d.files.splice(i, 1);
        d.zone.customized = true;
        moved = true;
      }
    }
    if (rest.includes(fileId)) {
      rest = rest.filter((f) => f !== fileId);
      moved = true;
    }
    if (moved) {
      to.files.push(fileId);
      to.zone.customized = true;
    }
  }
  return rest;
}

export function getZones(input: ZoningInput): ZoneSet {
  const h = input.hierarchy;
  const scope = h.nodes.get(input.scopeId ?? PROJECT_NODE_ID) ?? h.nodes.get(PROJECT_NODE_ID)!;
  const mode: ZoningMode = input.mode === 'packages' ? 'packages' : 'folders';
  const { roots, loose } = buildDrafts(h, scope, mode);
  const all: Draft[] = [];
  const collect = (d: Draft, parent: Draft | null) => {
    all.push(d);
    d.zone.parentId = parent?.zone.id ?? null;
  };
  const walk = (d: Draft, parent: Draft | null) => {
    collect(d, parent);
    d.kids.forEach((k) => walk(k, d));
  };
  roots.forEach((r) => walk(r, null));
  applyOverrides(mode, all, loose, h, input.overrides);
  // A zone emptied by pins (and without child zones) is dropped; Z's producer does the same.
  const prune = (list: Draft[]): Draft[] => list.filter((d) => ((d.kids = prune(d.kids)), d.files.length > 0 || d.kids.length > 0));
  roots.splice(0, roots.length, ...prune(roots));

  const sortFiles = byName(h);
  const finish = (d: Draft) => {
    d.files.sort(sortFiles);
    d.kids.sort((a, b) => a.zone.label.localeCompare(b.zone.label) || (a.zone.id < b.zone.id ? -1 : 1));
    d.zone.fileIds = d.files;
    d.zone.childIds = d.kids.map((k) => k.zone.id);
    d.kids.forEach(finish);
  };
  const rank = (d: Draft) => (d.zone.source === 'config' ? 1 : 0);
  roots.sort((a, b) => rank(a) - rank(b) || a.zone.label.localeCompare(b.zone.label) || (a.zone.id < b.zone.id ? -1 : 1));
  roots.forEach((r) => {
    finish(r);
    fold(h, r);
  });

  const zones: Zone[] = [];
  const zoneOfFile: Record<string, string> = {};
  const emit = (d: Draft) => {
    zones.push(d.zone);
    for (const f of d.files) zoneOfFile[f] = d.zone.id;
    d.kids.forEach(emit);
  };
  roots.forEach(emit);
  return { mode, zones, rootIds: roots.map((r) => r.zone.id), zoneOfFile };
}

/** Hierarchy node a zone stands for: the producer's `nodeId`, else resolved from its source and key. */
export function hierarchyIdOfZone(h: Hierarchy, zone: Zone): string | undefined {
  const given = (zone as ZoneWithNode).nodeId;
  if (given && h.nodes.has(given)) return given;
  if (zone.source === 'folder') return h.byDir.get(zone.key);
  if (zone.source === 'package') {
    for (const n of h.nodes.values()) if (n.kind === 'package' && (n.name === zone.key || n.path === zone.key)) return n.id;
    return undefined;
  }
  if (zone.source === 'config') {
    const id = `config:${zone.key.replace(/\/config$/, '')}`;
    return h.nodes.has(id) ? id : undefined;
  }
  return undefined;
}
