/**
 * Quality of a zoning against the dependency graph: Newman modularity and the share of edge weight that
 * stays inside a zone — for the whole partition (innermost zones) and per zone (its files, children
 * included). Computed from the final `ZoneSet`, so user pins and merges are reflected.
 */
import type { Zone, ZoneQuality, ZoneSet, ZoningFileEdge } from '../../../contracts/zones.js';

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** `undefined` when no edge connects two zoned files. */
export function partitionQuality(zoneOfFile: Readonly<Record<string, string>>, edges: readonly ZoningFileEdge[]): ZoneQuality | undefined {
  let m = 0;
  let intra = 0;
  const strength = new Map<string, number>();
  const inside = new Map<string, number>();
  for (const e of edges) {
    const za = zoneOfFile[e.a];
    const zb = zoneOfFile[e.b];
    if (za === undefined || zb === undefined) continue;
    m += e.weight;
    strength.set(za, (strength.get(za) ?? 0) + e.weight);
    strength.set(zb, (strength.get(zb) ?? 0) + e.weight);
    if (za === zb) {
      intra += e.weight;
      inside.set(za, (inside.get(za) ?? 0) + e.weight);
    }
  }
  if (m === 0) return undefined;
  let q = 0;
  for (const [z, tot] of strength) q += (inside.get(z) ?? 0) / m - (tot / (2 * m)) ** 2;
  return { modularity: round3(q), intraRatio: round3(intra / m) };
}

/** Per zone id: weight inside / (inside + crossing the zone border), for zones with any dependency weight. */
export function zoneCohesion(set: ZoneSet, edges: readonly ZoningFileEdge[]): Map<string, number> {
  const byId = new Map(set.zones.map((z) => [z.id, z]));
  const chain = (file: string): string[] => {
    const out: string[] = [];
    for (let z: Zone | undefined = byId.get(set.zoneOfFile[file]); z; z = z.parentId ? byId.get(z.parentId) : undefined) out.push(z.id);
    return out;
  };
  const inside = new Map<string, number>();
  const border = new Map<string, number>();
  for (const e of edges) {
    const ca = chain(e.a);
    const cb = new Set(chain(e.b));
    const sa = new Set(ca);
    for (const z of ca) {
      if (cb.has(z)) inside.set(z, (inside.get(z) ?? 0) + e.weight);
      else border.set(z, (border.get(z) ?? 0) + e.weight);
    }
    for (const z of cb) if (!sa.has(z)) border.set(z, (border.get(z) ?? 0) + e.weight);
  }
  const out = new Map<string, number>();
  for (const z of set.zones) {
    const i = inside.get(z.id) ?? 0;
    const b = border.get(z.id) ?? 0;
    if (i + b > 0) out.set(z.id, round3(i / (i + b)));
  }
  return out;
}
