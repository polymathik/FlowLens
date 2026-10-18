import { describe, it, expect, beforeEach } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { computeMapView } from '../../../src/canvas/utils/map-view';
import { buildViewEdges } from '../../../src/canvas/utils/edge-transformer';
import { applyRelationFilter } from '../../../src/canvas/utils/edge-transformer';
import { bulgeStackEdges, computeLayerBreaks, decorateBreaks, markLayerBreaks } from '../../../src/canvas/utils/layer-breaks';
import { clearCutLayoutCache, layoutCut } from '../../../src/canvas/layout/cut-layout';
import type { ArchitectureLayer } from '../../../src/contracts/architecture.js';
import type { ArchitectureViolation } from '../../../src/contracts/analysis/architecture.js';
import type { CanvasEdgeData } from '../../../src/contracts/canvas/index.js';
import type { Relation } from '../../../src/contracts/relations.js';
import { F, rel, zoneFixture } from '../helpers/zone-fixture';

const LAYERS: ArchitectureLayer[] = [
  { name: 'Web', include: { patterns: ['apps/web/**'] }, may_only_access: ['Core'] },
  { name: 'Server', include: { patterns: ['packages/server/**'] }, may_only_access: ['Core'] },
  { name: 'Core', include: { patterns: ['packages/core/**'] } },
];
const WEB = 'apps/web/src/app.ts';
const CORE = 'packages/core/src/index.ts';
const SERVER = 'packages/server/src/a.ts';

const fx = zoneFixture();
const { hierarchy: h } = fx;
const relations: Relation[] = [
  rel(F(WEB), F(CORE)), // allowed
  rel(F(SERVER), F(CORE)), // allowed
  rel(F(WEB), F(SERVER)), // Web -> Server: breaks may_only_access
  rel(F(WEB), F(SERVER), 'call'), // second broken relation on the same pair
  rel(F(WEB), F('packages/server/src/b.ts')), // third
  rel(F('apps/web/src/ui/button.ts'), F('apps/web/src/ui/card.ts')), // inside a layer
];
const violation = (r: Relation): ArchitectureViolation => ({
  id: `v:${r.id}`, rule: 'may_only_access', layer_from: 'Web', layer_to: 'Server', entity_from: r.from, entity_to: r.to,
  relation_type: r.type, location: { file: WEB, line: 1, column: 0 }, rule_text: "Layer 'Web' may only access 'Core', but accesses 'Server'",
});
const broken = relations.filter((r) => r.from === F(WEB) && r.to.includes('packages/server'));
const view = () => computeMapView(h, relations, [], { showLockfiles: false, zones: { mode: 'layers', expansion: {}, layers: LAYERS } });
const visible = new Set(['import', 'call', 'extend', 'implement']);

describe('layers view model', () => {
  it('top-level frames follow declaration order; every file is in a layer frame or the Unassigned card', () => {
    const v = view();
    expect(v.zoning?.mode).toBe('layers');
    expect(v.zoning?.requested).toBe('layers');
    const tops = v.cut!.topIds.map((id) => v.cut!.items.find((i) => i.id === id)!.label);
    expect(tops.slice(0, 3)).toEqual(['Web', 'Server', 'Core']);
    expect(tops[tops.length - 1]).toBe('Unassigned');
    expect(v.cut!.items.find((i) => i.label === 'Unassigned')!.expanded).toBe(false);
    expect(Object.keys(v.cut!.atomOfFile).length).toBe(v.cut!.totalFiles);
  });

  it('accounting stays exact and the frame bundles add up to the cross links', () => {
    const v = view();
    const a = v.accounting;
    expect(a.considered).toBe(a.edges + a.portalIn + a.portalOut + a.internal + a.hidden);
    const cross = v.links.filter((l) => l.cross).reduce((n, l) => n + l.count, 0);
    expect((v.bundles ?? []).reduce((n, b) => n + b.count, 0)).toBe(cross);
  });

  it('without layers the zoning falls back to folders and says what was requested', () => {
    const v = computeMapView(h, relations, [], { showLockfiles: false, zones: { mode: 'layers', expansion: {}, layers: [] } });
    expect(v.zoning).toMatchObject({ mode: 'folders', requested: 'layers' });
  });
});

describe('rule breaks on the layers map', () => {
  const v = view();
  const breaks = computeLayerBreaks(broken.map(violation), relations, h, v.cut);
  const edges = () => applyRelationFilter([], buildViewEdges(v), visible).edges;
  const ctx = { relationById: new Map(relations.map((r) => [r.id, r])), visibleTypes: visible };

  it('finds the broken relations and attributes them to the card and the frames around it', () => {
    expect(breaks.total).toBe(3);
    expect([...breaks.relationIds].sort()).toEqual(broken.map((r) => r.id).sort());
    const webCard = v.cut!.atomOfFile[`file:${WEB}`];
    expect(breaks.perItem.get(webCard)).toBe(3);
    expect(breaks.perItem.get(v.cut!.items.find((i) => i.label === 'Web')!.id)).toBe(3);
    expect(breaks.perItem.get(v.cut!.items.find((i) => i.label === 'Core')!.id)).toBeUndefined();
  });

  it('a link that carries only broken relations becomes one red violation edge with the count', () => {
    const marked = markLayerBreaks(edges(), breaks, ctx);
    const bundle = marked.find((e) => e.data?.layer === 'bundle' && e.data.is_violation)!;
    expect(bundle.type).toBe('violation');
    expect(bundle.data!.count).toBe(3);
    expect(bundle.data!.breakLabel).toBe('3 rule breaks');
    expect(bundle.data!.ruleText).toContain("may only access 'Core'");
    expect(bundle.data!.relationIds!.sort()).toEqual(broken.map((r) => r.id).sort());
    expect(marked.some((e) => e.data?.layer === 'bundle' && !e.data.is_violation && e.source === bundle.source && e.target === bundle.target)).toBe(false);
  });

  it('a link that also carries allowed relations is split; the two counts add up to the original', () => {
    const extra = rel(F(WEB), F(SERVER), 'extend'); // allowed relation type? no: still Web -> Server, but not reported by the engine
    const all = [...relations, extra];
    const v2 = computeMapView(h, all, [], { showLockfiles: false, zones: { mode: 'layers', expansion: {}, layers: LAYERS } });
    const b2 = computeLayerBreaks(broken.map(violation), all, h, v2.cut);
    const before = applyRelationFilter([], buildViewEdges(v2), visible).edges.find((e) => e.data?.layer === 'bundle' && e.data.count === 4)!;
    const after = markLayerBreaks([before], b2, { relationById: new Map(all.map((r) => [r.id, r])), visibleTypes: visible });
    expect(after).toHaveLength(2);
    const red = after.find((e) => e.data!.is_violation)!;
    const plain = after.find((e) => !e.data!.is_violation)!;
    expect(red.data!.count + plain.data!.count).toBe(before.data!.count);
    expect(red.id).not.toBe(plain.id);
    expect(red.data!.curve).toBeGreaterThan(0.25);
    expect(plain.data!.relationIds).toEqual([extra.id]);
  });

  it('restricted to the visible relation types: hiding calls leaves two breaks', () => {
    const imports = new Set(['import']);
    const filtered = applyRelationFilter([], buildViewEdges(v), imports).edges;
    const marked = markLayerBreaks(filtered, breaks, { ...ctx, visibleTypes: imports });
    expect(marked.find((e) => e.data?.layer === 'bundle' && e.data.is_violation)!.data!.count).toBe(2);
  });

  it('marks the offending card like the overlay does and gives frames a count; clean cards stay untouched', () => {
    const nodes: Node[] = [
      { id: v.cut!.atomOfFile[`file:${WEB}`], type: 'file', position: { x: 0, y: 0 }, data: {} },
      { id: v.cut!.atomOfFile[`file:${CORE}`], type: 'file', position: { x: 0, y: 0 }, data: {} },
      { id: v.cut!.items.find((i) => i.label === 'Web')!.id, type: 'zone', position: { x: 0, y: 0 }, data: {} },
    ];
    const out = decorateBreaks(nodes, breaks);
    expect((out[0].data as { overlay: { tag: string; badge: string } }).overlay).toMatchObject({ tag: 'violations', badge: '3 rule breaks' });
    expect(out[1]).toBe(nodes[1]);
    expect((out[2].data as { ruleBreaks: number }).ruleBreaks).toBe(3);
  });

  it('no violations: no edge is marked', () => {
    const none = markLayerBreaks(edges(), computeLayerBreaks([], relations, h, v.cut), ctx);
    expect(none.some((e) => e.data?.is_violation)).toBe(false);
  });
});

describe('stacked layout and routing', () => {
  beforeEach(() => clearCutLayoutCache());

  it('stacks the top level top to bottom in the cut order, in one column, without overlap', async () => {
    const v = view();
    const boxes = await layoutCut({ cut: v.cut!, links: v.links, extras: [], rowsOf: () => 1, stack: true });
    const tops = v.cut!.topIds.map((id) => boxes.get(id)!);
    for (let i = 1; i < tops.length; i++) expect(tops[i].y).toBeGreaterThanOrEqual(tops[i - 1].y + tops[i - 1].h);
    expect(new Set(tops.map((b) => b.x))).toEqual(new Set([0]));
    // Cards stay inside their frame.
    for (const item of v.cut!.items.filter((i) => i.parentId)) {
      const b = boxes.get(item.id)!;
      const f = boxes.get(item.parentId!)!;
      expect(b.x + b.w).toBeLessThanOrEqual(f.w + 0.5);
      expect(b.y + b.h).toBeLessThanOrEqual(f.h + 0.5);
    }
    // Deterministic.
    clearCutLayoutCache();
    const again = await layoutCut({ cut: v.cut!, links: v.links, extras: [], rowsOf: () => 1, stack: true });
    expect([...again]).toEqual([...boxes]);
  });

  it('only edges between non-neighbouring layers bulge out to the right of the stack', () => {
    const topIds = ['a', 'b', 'c'];
    const nodes: Node[] = topIds.map((id, i) => ({ id, position: { x: 0, y: i * 200 }, width: 100 + i * 50, height: 80, data: {} }));
    const edge = (source: string, target: string): Edge<CanvasEdgeData> => ({ id: `${source}${target}`, source, target, data: { kind: 'aggregated-edge', types: ['import'], dominantType: 'import', count: 1 } });
    const out = bulgeStackEdges([edge('a', 'b'), edge('a', 'c'), edge('c', 'a')], nodes, topIds);
    expect(out[0].data!.bulgeX).toBeUndefined();
    expect(out[1].data!.bulgeX).toBeGreaterThan(200); // right of the widest box (200)
    expect(out[2].data!.bulgeX).toBe(out[1].data!.bulgeX);
  });
});
