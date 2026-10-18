import { describe, it, expect } from 'vitest';
import { traceFlow } from '../../../src/flow/trace.js';
import { buildFlowModel } from '../../../src/canvas/flow/model/flow-model.js';
import { assignSlots, columnX, FLOW_GEOMETRY, layoutFlow, rowLimit } from '../../../src/canvas/flow/model/flow-layout.js';
import { buildFlowElements, hopHandles } from '../../../src/canvas/flow/model/flow-nodes.js';
import { flowTargetOf, specForTarget, specOfEntry } from '../../../src/canvas/flow/flow-actions.js';
import { buildHierarchy } from '../../../src/analysis/hierarchy/index.js';
import { PROJECT_NODE_ID } from '../../../src/contracts/hierarchy.js';
import { entity } from '../helpers/factories.js';
import type { EntryPoint } from '../../../src/contracts/flow.js';
import { buildGraph, type FileSpec, type RelSpec } from '../../helpers/flow-graph.js';

const fns = (...names: string[]): FileSpec => ({ symbols: names.map((n, i) => ({ qn: n, line: i * 10 + 1, end: i * 10 + 9 })) });

/** One root calling `n` functions of one file, in source order. */
function fanOut(n: number) {
  const names = Array.from({ length: n }, (_, i) => `f${String(i).padStart(3, '0')}`);
  const rels: RelSpec[] = names.map((c, i) => ({ from: 'a.ts/root', to: `a.ts/${c}`, line: 100 + i }));
  const b = buildGraph({ 'a.ts': fns('root', ...names) }, rels);
  return buildFlowModel(traceFlow(b.graph, b.id('a.ts/root'), { depth: 2, maxNodes: 150 }));
}

describe('flow layout: wrapping a wide column into sub-columns', () => {
  it('keeps a small fan-out in one column', () => {
    const m = fanOut(8);
    expect(rowLimit(m)).toBe(FLOW_GEOMETRY.maxRows);
    expect([...assignSlots(m).values()].every((s) => s.sub === 0)).toBe(true);
  });

  it('wraps after maxRows cards, in call order, top to bottom and then left to right', () => {
    const m = fanOut(30);
    const limit = rowLimit(m);
    expect(limit).toBe(FLOW_GEOMETRY.maxRows);
    const slots = assignSlots(m);
    const children = m.cards.filter((c) => c.role === 'step').sort((a, b) => a.seq - b.seq);
    expect(children.map((c) => slots.get(c.id)!.sub)).toEqual(children.map((_, i) => Math.floor(i / limit)));
    expect(children.map((c) => slots.get(c.id)!.row)).toEqual(children.map((_, i) => i % limit));
    const l = layoutFlow(m);
    const lane = [...l.lanes.values()][0];
    expect(lane.h).toBe(FLOW_GEOMETRY.padY * 2 + limit * FLOW_GEOMETRY.cardH + (limit - 1) * FLOW_GEOMETRY.rowGap);
    // the grid is as wide as three sub-columns: the lane widened by two sub-column steps over a single column
    const single = layoutFlow(fanOut(8));
    expect([...single.lanes.values()][0].w + 2 * (FLOW_GEOMETRY.cardW + FLOW_GEOMETRY.subGap)).toBe(lane.w);
    expect(columnX(2, 0, [1, 3])).toBe(columnX(2) + 2 * (FLOW_GEOMETRY.cardW + FLOW_GEOMETRY.subGap));
  });

  it('allows more rows for a huge group so the picture stays about 2:1, capped', () => {
    expect(rowLimit(fanOut(100))).toBe(Math.round(Math.sqrt(300)));
    expect(rowLimit(fanOut(149))).toBeLessThanOrEqual(FLOW_GEOMETRY.maxRowsCap);
  });

  it('never overlaps two cards and keeps every card inside its lane, for 150 nodes', () => {
    const m = fanOut(149);
    const l = layoutFlow(m);
    const cards = [...l.cards.entries()];
    expect(cards).toHaveLength(150);
    for (let i = 0; i < cards.length; i++) {
      const [id, a] = cards[i];
      const lane = l.lanes.get(m.cards.find((c) => c.id === id)!.laneId)!;
      expect(a.x >= lane.x && a.y >= lane.y && a.x + a.w <= lane.x + lane.w && a.y + a.h <= lane.y + lane.h).toBe(true);
      for (let j = i + 1; j < cards.length; j++) {
        const b = cards[j][1];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
    }
  });
});

describe('flow elements: which side a hop leaves and arrives on', () => {
  const r = (x: number, y: number) => ({ x, y, w: 10, h: 10 });
  it('forward hops go right to left, back-references left to right, same-column hops top / bottom', () => {
    expect(hopHandles(r(0, 0), 0, r(50, 0), 1)).toEqual({ source: 'out-r', target: 'in-l' });
    expect(hopHandles(r(50, 0), 1, r(0, 0), 0)).toEqual({ source: 'out-l', target: 'in-r' });
    expect(hopHandles(r(0, 0), 1, r(0, 50), 1)).toEqual({ source: 'out-b', target: 'in-t' });
    expect(hopHandles(r(0, 50), 1, r(0, 0), 1)).toEqual({ source: 'out-t', target: 'in-b' });
  });

  it('gives every edge of a cycle trace the handles of its direction, and the labels of a dense trace only on hover', () => {
    const b = buildGraph({ 'a.ts': fns('a', 'b') }, [{ from: 'a.ts/a', to: 'a.ts/b', line: 1 }, { from: 'a.ts/b', to: 'a.ts/a', line: 11 }]);
    const m = buildFlowModel(traceFlow(b.graph, b.id('a.ts/a')));
    const els = buildFlowElements(m, layoutFlow(m));
    const back = els.edges.find((e) => e.data?.edge.kind === 'cycle')!;
    expect([back.sourceHandle, back.targetHandle]).toEqual(['out-l', 'in-r']);
    expect(els.edges.every((e) => e.data?.showLabel)).toBe(true);
    const dense = fanOut(70);
    expect(buildFlowElements(dense, layoutFlow(dense)).edges.every((e) => e.data?.showLabel === false)).toBe(true);
  });
});

describe('flow actions: what "Trace from here" does for a map node', () => {
  const ents = [entity('go', 'src/a/x.ts', 'function'), entity('v', 'src/a/x.ts', 'variable'), entity('file-x', 'src/a/x.ts', 'file')];
  const h = buildHierarchy({ projectName: 'P', entities: ents });
  const kinds = new Map(ents.map((e) => [e.id, e]));

  it('traces a function or a file, opens the picker for a folder or the project, ignores a variable', () => {
    expect(flowTargetOf(h, kinds, 'go')).toEqual({ kind: 'trace', id: 'go' });
    expect(flowTargetOf(h, kinds, 'v')).toBeNull();
    expect(flowTargetOf(h, kinds, 'file:src/a/x.ts')).toEqual({ kind: 'trace', id: 'src/a/x.ts' });
    expect(flowTargetOf(h, kinds, 'folder:src/a')).toEqual({ kind: 'picker', path: 'src/a' });
    expect(flowTargetOf(h, kinds, PROJECT_NODE_ID)).toEqual({ kind: 'picker', path: '' });
    expect(flowTargetOf(h, kinds, 'nope')).toBeNull();
    expect(flowTargetOf(h, kinds, null)).toBeNull();
  });

  it('a new root keeps the depth, follow types, node limit and tests of the open flow; an entry carries its label and span', () => {
    const open = { id: 'old', depth: 2, direction: 'in' as const, follow: ['call' as const], maxNodes: 50, includeTests: true };
    expect(specForTarget('go', 'out', open, 'GET /x')).toEqual({ id: 'go', depth: 2, direction: 'out', follow: ['call'], maxNodes: 50, includeTests: true, label: 'GET /x' });
    const entry: EntryPoint = { entity_id: 'go', qualified_name: 'q', file: 'a.ts', line: 3, kind: 'http_route', label: 'GET /x', confidence: 0.9, evidence: '', span: { line_start: 5, line_end: 9 } };
    expect(specOfEntry(entry, open)).toEqual({ id: 'go', depth: 2, direction: 'out', follow: ['call'], maxNodes: 50, includeTests: true, span: { from: 5, to: 9 }, label: 'GET /x' });
    expect(specOfEntry(entry)).toEqual({ id: 'go', depth: 4, direction: 'out', span: { from: 5, to: 9 }, label: 'GET /x' });
  });
});
