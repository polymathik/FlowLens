import { describe, it, expect } from 'vitest';
import { traceFlow } from '../../../src/flow/trace.js';
import { renderTraceText } from '../../../src/flow/render.js';
import type { FlowTrace } from '../../../src/contracts/flow.js';
import { buildFlowModel } from '../../../src/canvas/flow/model/flow-model.js';
import { assignSlots, columnX, FLOW_GEOMETRY, layoutFlow } from '../../../src/canvas/flow/model/flow-layout.js';
import { emphasisForSelection, emphasisForStep, pathTo, stepCaption, stepCount } from '../../../src/canvas/flow/model/flow-emphasis.js';
import { buildFlowElements, DENSE_HOPS } from '../../../src/canvas/flow/model/flow-nodes.js';
import { buildGraph, type FileSpec, type RelSpec } from '../../helpers/flow-graph.js';

const fns = (...names: string[]): FileSpec => ({ symbols: names.map((n, i) => ({ qn: n, line: i * 10 + 1, end: i * 10 + 9 })) });

/** routes → services → db, three folders, three lanes. */
function layered() {
  const b = buildGraph(
    { 'src/routes/users.ts': fns('handler'), 'src/services/users.ts': fns('list', 'audit'), 'src/db/client.ts': fns('query') },
    [
      { from: 'src/routes/users.ts/handler', to: 'src/services/users.ts/list', line: 4 },
      { from: 'src/routes/users.ts/handler', to: 'src/services/users.ts/audit', line: 8 },
      { from: 'src/services/users.ts/list', to: 'src/db/client.ts/query', line: 3, weight: 2 },
    ],
  );
  return { b, trace: traceFlow(b.graph, b.id('src/routes/users.ts/handler')) };
}

describe('flow model: cards, lanes and columns', () => {
  it('puts every node on a card in its lane, the column is the depth, the lanes keep the trace order', () => {
    const { trace } = layered();
    const m = buildFlowModel(trace);
    expect(m.cards.map((c) => [c.name, c.column, c.role])).toEqual([
      ['handler()', 0, 'root'], ['list()', 1, 'step'], ['query()', 2, 'step'], ['audit()', 1, 'step'],
    ]);
    expect(m.lanes.map((l) => l.label)).toEqual(trace.lanes.map((l) => l.label));
    expect(m.lanes.flatMap((l) => l.cardIds).sort()).toEqual(m.cards.map((c) => c.id).sort());
    expect(m.columns).toBe(3);
    // an arbitrary function (kind 'unknown') has no entry label: its card shows its own name
    expect(trace.root.kind).toBe('unknown');
    expect(m.cards.find((c) => c.role === 'root')?.entryLabel).toBeUndefined();
    const entry = buildFlowModel({ ...trace, root: { ...trace.root, kind: 'http_route', label: 'GET /x' } });
    expect(entry.cards.find((c) => c.role === 'root')).toMatchObject({ entryLabel: 'GET /x', entryKind: 'http_route' });
  });

  it('every hop is exactly one edge, numbered in call order, labelled with the call site and its repeat count', () => {
    const { trace } = layered();
    const m = buildFlowModel(trace);
    expect(m.edges).toHaveLength(trace.hops.length);
    expect(m.edges.map((e) => e.step)).toEqual([1, 2, 3]);
    // call order is depth first: handler>list, list>query, handler>audit
    expect(m.edges.map((e) => `${m.cards.find((c) => c.id === e.from)?.name}>${m.cards.find((c) => c.id === e.to)?.name}`)).toEqual(['handler()>list()', 'list()>query()', 'handler()>audit()']);
    expect(m.edges[1]).toMatchObject({ label: 'users.ts:3 ×2', count: 2, tree: true, back: false, kind: 'normal', lowConfidence: false });
    expect(m.edges[0].label).toBe('users.ts:4');
    expect(m.cards.map((c) => c.step)).toEqual([0, 1, 2, 3]);
  });

  it('orders cards inside a lane and column by call sequence (source line), not by name', () => {
    const b = buildGraph({ 'a.ts': fns('main', 'x', 'y', 'z') }, [
      { from: 'a.ts/main', to: 'a.ts/x', line: 30 }, { from: 'a.ts/main', to: 'a.ts/y', line: 10 }, { from: 'a.ts/main', to: 'a.ts/z', line: 20 },
    ]);
    const m = buildFlowModel(traceFlow(b.graph, b.id('a.ts/main')));
    const slots = assignSlots(m);
    const inOrder = m.cards.filter((c) => c.column === 1).sort((p, q) => (slots.get(p.id)?.row ?? 0) - (slots.get(q.id)?.row ?? 0)).map((c) => c.name);
    expect(inOrder).toEqual(['y()', 'z()', 'x()']);
  });
});

describe('flow model: unresolved, ambiguous, cycle, seen, text-derived', () => {
  it('an unresolved call is a dashed leaf card with the callee name, in the caller\'s lane and next column', () => {
    const b = buildGraph({ 'a.ts': fns('go', 'ok') }, [{ from: 'a.ts/go', to: 'a.ts/ok', line: 2 }], [{ from: 'a.ts/go', name: 'fetch', line: 5 }]);
    const t = traceFlow(b.graph, b.id('a.ts/go'));
    const m = buildFlowModel(t);
    const leaf = m.cards.find((c) => c.role === 'unresolved');
    expect(leaf).toMatchObject({ name: '?? fetch', entityId: null, column: 1, laneId: m.cards.find((c) => c.role === 'root')?.laneId });
    const e = m.edges.find((x) => x.to === leaf?.id);
    expect(e).toMatchObject({ kind: 'unresolved', resolution: 'unresolved', tree: true });
    expect(e?.explain).toMatch(/could not tell/);
    expect(m.notices.map((n) => n.id)).toContain('unresolved');
    expect(m.cards).toHaveLength(t.nodes.length + 1);
  });

  it('an ambiguous name with candidates is an amber leaf with the alternatives listed', () => {
    const b = buildGraph({ 'a.ts': fns('go', 'one', 'two') }, [], [{ from: 'a.ts/go', name: 'dup', line: 4, candidates: ['a.ts/one', 'a.ts/two'] }]);
    const m = buildFlowModel(traceFlow(b.graph, b.id('a.ts/go')), { entity: (id) => ({ name: id.replace('id:a.ts/', ''), file: 'a.ts', line: 1 }) });
    const leaf = m.cards.find((c) => c.role === 'candidates');
    expect(leaf?.candidates.map((c) => [c.name, c.inTrace])).toEqual([['one', false], ['two', false]]);
    expect(m.edges[0].kind).toBe('ambiguous');
  });

  it('override dispatch: the base card lists the implementations, which are cards of their own joined by amber edges', () => {
    const b = buildGraph({ 'a.ts': { symbols: [
      { qn: 'run' }, { qn: 'Job', kind: 'class' }, { qn: 'Job.step', line: 5 }, { qn: 'Email', kind: 'class' }, { qn: 'Email.step', line: 10 }, { qn: 'Report', kind: 'class' }, { qn: 'Report.step', line: 15 },
    ] } }, [
      { from: 'a.ts/run', to: 'a.ts/Job.step', line: 2 }, { from: 'a.ts/Email.step', to: 'a.ts/Job.step', type: 'override' }, { from: 'a.ts/Report.step', to: 'a.ts/Job.step', type: 'override' },
    ]);
    const m = buildFlowModel(traceFlow(b.graph, b.id('a.ts/run')));
    const base = m.cards.find((c) => c.name === 'Job.step()');
    expect(base?.candidates.map((c) => [c.name, c.inTrace])).toEqual([['Email.step()', true], ['Report.step()', true]]);
    const dispatch = m.edges.filter((e) => e.provenance === 'dispatch');
    expect(dispatch).toHaveLength(2);
    expect(dispatch.every((e) => e.kind === 'ambiguous' && e.lowConfidence)).toBe(true);
    expect(dispatch[0].explain).toMatch(/interface or override/);
  });

  it('a cycle hop is a back-reference to its ancestor and is never expanded again; a diamond hop is "seen"', () => {
    const b = buildGraph({ 'a.ts': fns('ping', 'pong', 'a', 'b', 'd') }, [
      { from: 'a.ts/ping', to: 'a.ts/pong', line: 2 }, { from: 'a.ts/pong', to: 'a.ts/ping', line: 12 },
      { from: 'a.ts/ping', to: 'a.ts/a', line: 3 }, { from: 'a.ts/ping', to: 'a.ts/b', line: 4 }, { from: 'a.ts/a', to: 'a.ts/d', line: 22 }, { from: 'a.ts/b', to: 'a.ts/d', line: 32 },
    ]);
    const m = buildFlowModel(traceFlow(b.graph, b.id('a.ts/ping'), { depth: 5 }));
    const cycle = m.edges.find((e) => e.kind === 'cycle');
    expect(cycle).toMatchObject({ back: true, tree: false, link: 'cycle' });
    expect(m.cards.find((c) => c.id === cycle?.to)?.role).toBe('root');
    const seen = m.edges.find((e) => e.kind === 'seen');
    expect(seen).toMatchObject({ link: 'seen', tree: false });
    expect(m.cards.filter((c) => c.name === 'd()')).toHaveLength(1);
    expect(seen?.explain).toMatch(/already in the picture/);
  });

  it('hops read from source text are low-confidence (dotted) and explained', () => {
    const b = buildGraph({ 'a.ts': { ...fns('handler', 'work'), text: 'app.get("/x", () => {\n  work();\n});\n' } }, [{ from: 'a.ts/handler', to: 'a.ts/work', line: 2 }]);
    const t = traceFlow(b.graph, b.id('a.ts/handler'));
    const hacked: FlowTrace = { ...t, hops: t.hops.map((h) => ({ ...h, provenance: 'source_scan' as const, confidence: 0.6 })) };
    const m = buildFlowModel(hacked);
    expect(m.edges[0]).toMatchObject({ lowConfidence: true, provenance: 'source_scan' });
    expect(m.edges[0].explain).toMatch(/source text of an inline handler/);
    expect(m.notices.find((n) => n.id === 'text-derived')?.text).toMatch(/1 hop read from source text/);
  });
});

describe('flow model: truncation and empty traces', () => {
  it('says how many nodes were left out and keeps the nearest', () => {
    const b = buildGraph({ 'a.ts': fns('r', 'a', 'b', 'c', 'd') }, ['a', 'b', 'c', 'd'].map((x, i) => ({ from: 'a.ts/r', to: `a.ts/${x}`, line: i + 2 }) as RelSpec));
    const t = traceFlow(b.graph, b.id('a.ts/r'), { maxNodes: 3 });
    const m = buildFlowModel(t);
    expect(t.truncated).toBe(true);
    expect(m.stats.dropped).toBe(2);
    expect(m.notices.find((n) => n.id === 'truncated')?.text).toMatch(/^\+2 more nodes hidden/);
    expect(m.cards).toHaveLength(3);
  });

  it('a root without calls is one card and an "empty" notice; the trace\'s own notes travel with the model', () => {
    const b = buildGraph({ 'a.ts': fns('lonely') });
    const t = traceFlow(b.graph, b.id('a.ts/lonely'));
    const m = buildFlowModel(t);
    expect(m.cards).toHaveLength(1);
    expect(m.edges).toHaveLength(0);
    expect(m.notices.map((n) => n.id)).toEqual(['empty']);
    expect(m.notes).toEqual(t.notes);
    expect(layoutFlow(m).cards.size).toBe(1);
  });
});

describe('flow model: direction in', () => {
  it('mirrors the columns so callers are on the left and edges still run caller to callee', () => {
    const b = buildGraph({ 'a.ts': fns('trigger', 'mid', 'target') }, [{ from: 'a.ts/trigger', to: 'a.ts/mid', line: 2 }, { from: 'a.ts/mid', to: 'a.ts/target', line: 12 }]);
    const m = buildFlowModel(traceFlow(b.graph, b.id('a.ts/target'), { direction: 'in' }));
    expect(m.cards.map((c) => [c.name, c.column, c.depth])).toEqual([['target()', 0, 0], ['mid()', 1, 1], ['trigger()', 2, 2]].map(([n, , d]) => [n, 2 - (d as number), d]));
    expect(m.edges.map((e) => `${m.cards.find((c) => c.id === e.from)?.name}>${m.cards.find((c) => c.id === e.to)?.name}`)).toEqual(['mid()>target()', 'trigger()>mid()']);
    expect(m.edges.every((e) => !e.back)).toBe(true);
    expect(m.edges.every((e) => e.tree)).toBe(true);
  });
});

describe('flow layout', () => {
  it('is deterministic, keeps every card inside its lane band and never overlaps two cards', () => {
    const { trace } = layered();
    const m = buildFlowModel(trace);
    const a = layoutFlow(m);
    const again = layoutFlow(buildFlowModel(trace));
    expect([...a.cards.entries()]).toEqual([...again.cards.entries()]);
    const rects = [...a.cards.entries()];
    for (const [id, r] of rects) {
      const lane = a.lanes.get(m.cards.find((c) => c.id === id)?.laneId ?? '');
      expect(lane && r.y >= lane.y && r.y + r.h <= lane.y + lane.h).toBe(true);
      expect(r.x + r.w).toBeLessThanOrEqual(a.width);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [p, q] = [rects[i][1], rects[j][1]];
        expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h).toBe(false);
      }
    }
  });

  it('puts a child level with its parent in the same lane (a straight edge) and stacks the siblings below', () => {
    const b = buildGraph({ 'a.ts': fns('root', 'c1', 'c2', 'g1') }, [
      { from: 'a.ts/root', to: 'a.ts/c1', line: 2 }, { from: 'a.ts/root', to: 'a.ts/c2', line: 3 }, { from: 'a.ts/c1', to: 'a.ts/g1', line: 12 },
    ]);
    const m = buildFlowModel(traceFlow(b.graph, b.id('a.ts/root')));
    const slots = assignSlots(m);
    const rowOf = (n: string) => slots.get(m.cards.find((c) => c.name === n)?.id ?? '')?.row;
    expect([rowOf('root()'), rowOf('c1()'), rowOf('c2()'), rowOf('g1()')]).toEqual([0, 0, 1, 0]);
  });

  it('gives the wider root card room on the outer side without moving the grid of the others', () => {
    const { trace } = layered();
    const out = layoutFlow(buildFlowModel(trace));
    const root = [...out.cards.values()].find((r) => r.x < columnX(1, FLOW_GEOMETRY.rootExtra));
    expect(root?.w).toBe(FLOW_GEOMETRY.cardW + FLOW_GEOMETRY.rootExtra);
    expect(root!.x + root!.w).toBe(columnX(0, FLOW_GEOMETRY.rootExtra) + FLOW_GEOMETRY.cardW);
  });

  it('handles a trace with 150 nodes in lane bands with finite size', () => {
    const names = Array.from({ length: 150 }, (_, i) => `f${i}`);
    const b = buildGraph({ 'src/a/x.ts': fns(...names.slice(0, 50)), 'src/b/y.ts': fns(...names.slice(50, 100)), 'src/c/z.ts': fns(...names.slice(100)) },
      names.slice(1).map((n, i) => {
        const parent = names[Math.floor(i / 3)];
        const file = (x: string) => { const k = Number(x.slice(1)); return k < 50 ? 'src/a/x.ts' : k < 100 ? 'src/b/y.ts' : 'src/c/z.ts'; };
        return { from: `${file(parent)}/${parent}`, to: `${file(n)}/${n}`, line: 2 + i } as RelSpec;
      }));
    const m = buildFlowModel(traceFlow(b.graph, b.id('src/a/x.ts/f0'), { depth: 5, maxNodes: 150 }));
    expect(m.cards.length).toBeGreaterThan(100);
    const l = layoutFlow(m);
    expect(l.cards.size).toBe(m.cards.length);
    expect(Number.isFinite(l.width) && Number.isFinite(l.height) && l.height > 0).toBe(true);
  });
});

describe('flow emphasis and step-through', () => {
  it('lights exactly the path root → selected card (first tree path) and dims the rest', () => {
    const { trace } = layered();
    const m = buildFlowModel(trace);
    const query = m.cards.find((c) => c.name === 'query()')!;
    const path = pathTo(m, query.id);
    expect(path.cards.map((id) => m.cards.find((c) => c.id === id)?.name)).toEqual(['handler()', 'list()', 'query()']);
    expect(path.edges).toEqual(['hop:0', 'hop:1']);
    const em = emphasisForSelection(m, query.id)!;
    expect([...em.cards.entries()].map(([id, s]) => `${m.cards.find((c) => c.id === id)?.name}:${s}`)).toEqual(['handler():path', 'list():path', 'query():active', 'audit():dim']);
    expect(em.edges.get('hop:2')).toBe('dim');
    expect(emphasisForSelection(m, null)).toBeNull();
    expect(emphasisForSelection(m, 'unknown')).toBeNull();
  });

  it('walks the hops in execution order: done, active, dim', () => {
    const { trace } = layered();
    const m = buildFlowModel(trace);
    expect(stepCount(m)).toBe(3);
    const at0 = emphasisForStep(m, 0);
    expect([...at0.cards.values()].filter((s) => s === 'active')).toHaveLength(1);
    expect([...at0.edges.values()].every((s) => s === 'dim')).toBe(true);
    const at2 = emphasisForStep(m, 2);
    expect([...at2.edges.entries()]).toEqual([['hop:0', 'done'], ['hop:1', 'active'], ['hop:2', 'dim']]);
    expect(at2.cards.get(m.cards.find((c) => c.name === 'query()')!.id)).toBe('active');
    expect(at2.cards.get(m.cards.find((c) => c.name === 'audit()')!.id)).toBe('dim');
    expect(stepCaption(m, 2)).toBe('2/3  list() calls query()  users.ts:3 ×2');
    expect(stepCaption(m, 0)).toBe("Start: handler()");
    const last = emphasisForStep(m, 3);
    expect([...last.edges.values()]).toEqual(['done', 'done', 'active']);
  });

  it('is the same walk as the text rendering: step N is hop N of the trace', () => {
    const { trace } = layered();
    const m = buildFlowModel(trace);
    const text = renderTraceText(trace);
    for (const e of m.edges) {
      const callee = m.cards.find((c) => c.id === e.to)?.name ?? '';
      expect(text).toContain(callee.replace('()', ''));
    }
    expect(m.edges.map((e) => e.step)).toEqual(trace.hops.map((_, i) => i + 1));
  });
});

describe('flow elements for React Flow', () => {
  it('lane bands behind the cards, one node per card, one edge per hop, step numbers shown unless the trace is dense', () => {
    const { trace } = layered();
    const m = buildFlowModel(trace);
    const els = buildFlowElements(m, layoutFlow(m), { quality: (id) => (id === m.rootId ? 80 : undefined) });
    expect(els.nodes.filter((n) => n.type === 'flowLane')).toHaveLength(m.lanes.length);
    expect(els.nodes.filter((n) => n.type === 'flowCard')).toHaveLength(m.cards.length);
    expect(els.nodes.find((n) => n.type === 'flowLane')?.zIndex).toBeLessThan(0);
    expect(els.edges).toHaveLength(trace.hops.length);
    expect(els.edges.every((e) => e.data?.showStep)).toBe(true);
    expect(els.nodes.find((n) => n.id === m.rootId)?.data).toMatchObject({ quality: 80, state: 'normal' });
    const dense = { ...m, edges: Array.from({ length: DENSE_HOPS + 1 }, (_, i) => ({ ...m.edges[0], id: `h${i}`, step: i + 1 })) };
    expect(buildFlowElements(dense, layoutFlow(m)).edges.every((e) => !e.data?.showStep)).toBe(true);
  });
});
