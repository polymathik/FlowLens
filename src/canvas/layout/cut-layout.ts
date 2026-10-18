/**
 * Two-stage deterministic layout of a zone cut (pure; no React Flow needed):
 *
 *  (a) inside every expanded zone: nested zones shelf-packed on top, the
 *      file cards below in a tidy grid (name order, columns from sqrt(n));
 *      the frame grows to fit what is inside it.
 *  (b) over the top-level frames / cards / portals: ELK layered on the
 *      bundled links (fixed seed); items without any link are shelf-packed
 *      below, never scattered.
 *
 * Results are cached by a hash of cut membership + sizes + top-level links,
 * so a toggle that returns to a known arrangement is instant.
 */
import { ZONE_LAYOUT, type CutItem, type MapCut } from '../../contracts/canvas/index.js';
import { shelfPack, gridPack, type PackBlock } from './zone-pack';
import type { LayoutBox, LayoutLink } from './types';

export interface BoxPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CutLayoutInput {
  cut: MapCut;
  /** Links between item ids (cards, zones, portals, scope); mapped to the top level internally. */
  links: LayoutLink[];
  /** Extra top-level boxes: portals (pinned) and the scope node. */
  extras: Array<{ id: string; w: number; h: number; pin?: 'first' | 'last' }>;
  /** Symbol rows a rich card lists (0 = none). */
  rowsOf: (fileId: string) => number;
}

const L = ZONE_LAYOUT;

/** Cards get room for symbol rows only when few cards are on screen. */
export const isRichCut = (cut: MapCut): boolean => cut.items.filter((i) => i.kind === 'file').length <= L.richUpTo;

export const rowsFor = (symbols: number): number => Math.min(symbols, L.maxSymbolRows) + (symbols > L.maxSymbolRows ? 1 : 0);

/** Width of a label chip: square + name + count. */
export const chipWidth = (label: string): number => 62 + label.length * 7.2;

function cardSize(item: CutItem, rich: boolean, rowsOf: CutLayoutInput['rowsOf']): { w: number; h: number } {
  if (item.kind === 'zone') return { w: L.zoneCard.width, h: L.zoneCard.height };
  if (!rich) return { w: L.card.width, h: L.card.height };
  const rows = rowsOf(item.id);
  return { w: L.richCard.width, h: L.richCard.height + (rows > 0 ? 6 + rows * L.richCard.row : 0) };
}

/** Frame sizes bottom-up and child offsets (relative to their frame). */
function sizeFrames(input: CutLayoutInput, rich: boolean, out: Map<string, BoxPos>): void {
  const byId = new Map(input.cut.items.map((i) => [i.id, i]));
  const sizes = new Map<string, { w: number; h: number }>();
  const place = (id: string, x: number, y: number) => {
    const s = sizes.get(id)!;
    out.set(id, { x, y, w: s.w, h: s.h });
  };
  const size = (item: CutItem): { w: number; h: number } => {
    const known = sizes.get(item.id);
    if (known) return known;
    let result: { w: number; h: number };
    if (item.kind === 'file' || !item.expanded) result = cardSize(item, rich, input.rowsOf);
    else {
      const kids = item.childIds.map((c) => byId.get(c)!);
      const zones = kids.filter((k) => k.kind === 'zone');
      const files = kids.filter((k) => k.kind === 'file');
      const zonePack = shelfPack(zones.map((z): PackBlock => ({ id: z.id, ...size(z) })), L.gap);
      const filePack = gridPack(files.map((f): PackBlock => ({ id: f.id, ...cardSize(f, rich, input.rowsOf) })), L.gap);
      const innerW = Math.max(zonePack.width, filePack.width, chipWidth(item.label) + 40);
      const fileY = L.frameHeader + zonePack.height + (zonePack.height > 0 && filePack.height > 0 ? L.gap : 0);
      for (const [id, p] of zonePack.at) out.set(id, { x: L.framePad + p.x, y: L.frameHeader + p.y, w: 0, h: 0 });
      for (const [id, p] of filePack.at) {
        out.set(id, { x: L.framePad + p.x, y: fileY + p.y, w: cardSize(byId.get(id)!, rich, input.rowsOf).w, h: filePack.heights.get(id)! });
      }
      result = { w: innerW + 2 * L.framePad, h: fileY + filePack.height + L.framePad };
    }
    sizes.set(item.id, result);
    return result;
  };
  for (const id of input.cut.topIds) size(byId.get(id)!);
  for (const item of input.cut.items) {
    if (item.kind !== 'zone' && item.parentId) continue; // cards inside a frame were placed by their frame
    const prev = out.get(item.id);
    place(item.id, prev?.x ?? 0, prev?.y ?? 0);
  }
}

const rankOf = (item: CutItem | undefined): number => (item ? (item.kind === 'zone' ? 0 : 1) : 2);

function topLevelLinks(input: CutLayoutInput): LayoutLink[] {
  const byId = new Map(input.cut.items.map((x) => [x.id, x]));
  const topOf = new Map<string, string>();
  for (const i of input.cut.items) {
    let cur = i;
    while (cur.parentId) cur = byId.get(cur.parentId)!;
    topOf.set(i.id, cur.id);
  }
  const seen = new Set<string>();
  const out: LayoutLink[] = [];
  for (const l of input.links) {
    const a = topOf.get(l.source) ?? l.source;
    const b = topOf.get(l.target) ?? l.target;
    if (a === b || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`);
    out.push({ source: a, target: b });
  }
  return out.sort((x, y) => (x.source + x.target < y.source + y.target ? -1 : 1));
}

const cache = new Map<string, Map<string, BoxPos>>();
const CACHE_LIMIT = 32;

function signature(input: CutLayoutInput, rich: boolean, links: LayoutLink[]): string {
  const parts = input.cut.items.map((i) => `${i.id}|${i.expanded ? 1 : 0}|${i.parentId ?? ''}|${i.kind === 'file' && rich ? input.rowsOf(i.id) : ''}|${i.kind === 'zone' ? i.label.length : ''}`);
  parts.push(rich ? 'rich' : 'compact');
  for (const e of input.extras) parts.push(`${e.id}|${e.w}|${e.h}|${e.pin ?? ''}`);
  for (const l of links) parts.push(`${l.source}>${l.target}`);
  let hash = 2166136261;
  const text = parts.join('\n');
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}

export async function layoutCut(input: CutLayoutInput): Promise<Map<string, BoxPos>> {
  const rich = isRichCut(input.cut);
  const links = topLevelLinks(input);
  const key = signature(input, rich, links);
  const hit = cache.get(key);
  if (hit) return new Map(hit);

  const out = new Map<string, BoxPos>();
  sizeFrames(input, rich, out);
  const byId = new Map(input.cut.items.map((i) => [i.id, i]));
  const tops: LayoutBox[] = [
    ...input.cut.topIds.map((id): LayoutBox => ({ id, width: out.get(id)!.w, height: out.get(id)!.h })),
    ...input.extras.map((e): LayoutBox => ({ id: e.id, width: e.w, height: e.h, pin: e.pin })),
  ];
  const label = (b: LayoutBox) => byId.get(b.id)?.label.toLowerCase() ?? b.id;
  const ordered = [...tops].sort((a, b) => (a.pin === 'first' ? 0 : a.pin === 'last' ? 3 : rankOf(byId.get(a.id)) + 1) - (b.pin === 'first' ? 0 : b.pin === 'last' ? 3 : rankOf(byId.get(b.id)) + 1) || (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : a.id < b.id ? -1 : 1));
  const ids = new Set(ordered.map((b) => b.id));
  const valid = links.filter((l) => ids.has(l.source) && ids.has(l.target));
  const touched = new Set(valid.flatMap((l) => [l.source, l.target]));
  const connected = ordered.filter((b) => touched.has(b.id));
  const loose = ordered.filter((b) => !touched.has(b.id));

  let belowY = 0;
  let connectedW = 0;
  let pos: Awaited<ReturnType<typeof import('./elk-layout').computeElkPositions>> | null = null;
  if (connected.length > 1) {
    try {
      const { computeElkPositions } = await import('./elk-layout');
      pos = await computeElkPositions(connected, valid, { direction: 'RIGHT', nodeSpacing: 56, layerSpacing: 170 });
    } catch (err) {
      console.error('[flowlens] ELK layout failed, packing the top level instead', err);
    }
  }
  if (pos) {
    for (const b of connected) {
      const p = pos.get(b.id) ?? { x: 0, y: 0 };
      out.set(b.id, { x: p.x, y: p.y, w: b.width, h: b.height });
      belowY = Math.max(belowY, p.y + b.height);
      connectedW = Math.max(connectedW, p.x + b.width);
    }
    belowY += 72;
  } else loose.unshift(...connected);
  const packed = shelfPack(loose.map((b): PackBlock => ({ id: b.id, w: b.width, h: b.height })), 40, undefined, connectedW);
  for (const b of loose) {
    const p = packed.at.get(b.id)!;
    out.set(b.id, { x: p.x, y: belowY + p.y, w: b.width, h: b.height });
  }
  cache.set(key, out);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return new Map(out);
}

export const clearCutLayoutCache = (): void => cache.clear();
