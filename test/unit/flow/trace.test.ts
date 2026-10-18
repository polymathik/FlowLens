import { describe, it, expect } from 'vitest';
import { FlowTraceError, traceFlow } from '../../../src/flow/trace.js';
import { renderTraceText } from '../../../src/flow/render.js';
import { FlowGraph } from '../../../src/flow/graph.js';
import { buildGraph, type FileSpec, type RelSpec } from '../../helpers/flow-graph.js';
import { FlowTraceSchema, type FlowTrace } from '../../../src/contracts/flow.js';

const fns = (...names: string[]): FileSpec => ({ symbols: names.map((n, i) => ({ qn: n, line: i * 10 + 1, end: i * 10 + 9 })) });
const names = (t: FlowTrace): string[] => t.nodes.map((n) => n.qualified_name.split('/').pop() as string);
const hopNames = (t: FlowTrace, b: ReturnType<typeof buildGraph>): string[] => t.hops.map((h) => `${b.graph.byId.get(h.from)?.name}>${b.graph.byId.get(h.to)?.name ?? `?${h.target_name}`}`);

function chain(n: number) {
  const symbols = Array.from({ length: n }, (_, i) => `f${i}`);
  const rels: RelSpec[] = symbols.slice(1).map((s, i) => ({ from: `a.ts/f${i}`, to: `a.ts/${s}`, line: 2 }));
  return buildGraph({ 'a.ts': fns(...symbols) }, rels);
}

describe('traceFlow: shape of the walk', () => {
  it('respects depth (default 4, capped at 5) and reports depth_reached', () => {
    const b = chain(10);
    const root = b.id('a.ts/f0');
    expect(names(traceFlow(b.graph, root, { depth: 2 }))).toEqual(['f0', 'f1', 'f2']);
    expect(names(traceFlow(b.graph, root))).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    const deep = traceFlow(b.graph, root, { depth: 99 });
    expect(names(deep)).toHaveLength(6);
    expect(deep.stats).toMatchObject({ depth_reached: 5, nodes: 6, hops: 5 });
  });

  it('orders a node\'s hops by reference line and walks depth-first in call order', () => {
    const b = buildGraph({ 'a.ts': fns('main', 'x', 'y', 'z', 'leaf') }, [
      { from: 'a.ts/main', to: 'a.ts/x', line: 30 }, { from: 'a.ts/main', to: 'a.ts/y', line: 10 }, { from: 'a.ts/main', to: 'a.ts/z', line: 20 },
      { from: 'a.ts/y', to: 'a.ts/leaf', line: 11 },
    ]);
    const t = traceFlow(b.graph, b.id('a.ts/main'));
    expect(hopNames(t, b)).toEqual(['main>y', 'y>leaf', 'main>z', 'main>x']);
    expect(t.hops.map((h) => h.depth)).toEqual([1, 2, 1, 1]);
    expect(t.nodes.map((n) => n.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('cuts cycles: the back edge is a hop flagged cycle, never expanded twice', () => {
    const b = buildGraph({ 'a.ts': fns('ping', 'pong', 'self') }, [
      { from: 'a.ts/ping', to: 'a.ts/pong', line: 2 }, { from: 'a.ts/pong', to: 'a.ts/ping', line: 12 }, { from: 'a.ts/ping', to: 'a.ts/self', line: 3 }, { from: 'a.ts/self', to: 'a.ts/self', line: 22 },
    ]);
    const t = traceFlow(b.graph, b.id('a.ts/ping'), { depth: 5 });
    expect(names(t)).toEqual(['ping', 'pong', 'self']);
    expect(t.hops.map((h) => `${h.link}`)).toEqual(['new', 'cycle', 'new', 'cycle']);
  });

  it('shares nodes of a diamond (second path is "seen") and folds repeated call sites into a count', () => {
    const b = buildGraph({ 'a.ts': fns('a', 'b', 'c', 'd') }, [
      { from: 'a.ts/a', to: 'a.ts/b', line: 2, weight: 3 }, { from: 'a.ts/a', to: 'a.ts/c', line: 3 },
      { from: 'a.ts/b', to: 'a.ts/d', line: 12 }, { from: 'a.ts/c', to: 'a.ts/d', line: 22 },
    ]);
    const t = traceFlow(b.graph, b.id('a.ts/a'));
    expect(names(t)).toEqual(['a', 'b', 'd', 'c']);
    expect(t.hops.map((h) => `${h.link}:${h.count}`)).toEqual(['new:3', 'new:1', 'new:1', 'seen:1']);
    expect(t.nodes.find((n) => n.qualified_name.endsWith('/d'))?.depth).toBe(2);
  });

  it('keeps a create and a call to the same target as two hops (constructor expansion for classes)', () => {
    const b = buildGraph({ 'a.ts': { symbols: [{ qn: 'run', line: 1, end: 5 }, { qn: 'Svc', kind: 'class', line: 10, end: 20 }, { qn: 'Svc.constructor', line: 11, end: 13 }, { qn: 'warm', line: 30 }] } }, [
      { from: 'a.ts/run', to: 'a.ts/Svc', type: 'create', line: 2 }, { from: 'a.ts/Svc.constructor', to: 'a.ts/warm', line: 12 },
    ]);
    const t = traceFlow(b.graph, b.id('a.ts/run'));
    expect(hopNames(t, b)).toEqual(['run>Svc', 'constructor>warm']);
    expect(t.hops[0].type).toBe('create');
  });

  it('only follows the requested relation types', () => {
    const b = buildGraph({ 'a.ts': fns('a', 'b', 'v') }, [{ from: 'a.ts/a', to: 'a.ts/b' }, { from: 'a.ts/a', to: 'a.ts/v', type: 'use', line: 5 }]);
    expect(names(traceFlow(b.graph, b.id('a.ts/a')))).toEqual(['a', 'b']);
    expect(names(traceFlow(b.graph, b.id('a.ts/a'), { follow: ['call', 'use'] }))).toEqual(['a', 'b', 'v']);
  });

  it('is deterministic whatever the order of the input arrays', () => {
    const b = buildGraph({ 'a.ts': fns('a', 'b', 'c', 'd') }, [
      { from: 'a.ts/a', to: 'a.ts/b', line: 2 }, { from: 'a.ts/a', to: 'a.ts/c', line: 2 }, { from: 'a.ts/b', to: 'a.ts/d', line: 12 }, { from: 'a.ts/c', to: 'a.ts/d', line: 22 },
    ]);
    const shuffled = new FlowGraph({ entities: [...b.graph.data.entities].reverse(), relations: [...b.graph.data.relations].reverse() });
    const strip = (t: FlowTrace) => JSON.stringify({ ...t, hops: t.hops.map((h) => ({ ...h, relation_id: '' })) });
    expect(strip(traceFlow(shuffled, b.id('a.ts/a')))).toBe(strip(traceFlow(b.graph, b.id('a.ts/a'))));
  });

  it('throws a typed error for an unknown root, and always produces a contract-valid trace', () => {
    const b = chain(3);
    expect(() => traceFlow(b.graph, 'nope')).toThrow(FlowTraceError);
    expect(() => FlowTraceSchema.parse(traceFlow(b.graph, b.id('a.ts/f0')))).not.toThrow();
  });
});

describe('traceFlow: resolution quality', () => {
  it('shows unresolved calls as leaves with the callee name, and ambiguous ones with candidates', () => {
    const b = buildGraph({ 'a.ts': fns('go', 'one', 'two') }, [], [
      { from: 'a.ts/go', name: 'missing', line: 3 }, { from: 'a.ts/go', name: 'dup', line: 4, candidates: ['a.ts/one', 'a.ts/two'] },
    ]);
    const t = traceFlow(b.graph, b.id('a.ts/go'));
    expect(t.nodes).toHaveLength(1);
    expect(t.hops).toMatchObject([
      { to: '', resolution: 'unresolved', target_name: 'missing', confidence: 0.3 },
      { to: '', resolution: 'ambiguous', target_name: 'dup', candidates: [b.id('a.ts/one'), b.id('a.ts/two')] },
    ]);
    expect(t.stats).toMatchObject({ unresolved: 1, ambiguous: 1 });
    expect(renderTraceText(t)).toContain('?? missing');
  });

  it('marks a call to an overridden method ambiguous and follows every override (provenance dispatch)', () => {
    const b = buildGraph({ 'a.ts': { symbols: [
      { qn: 'run' }, { qn: 'Job', kind: 'class' }, { qn: 'Job.step', line: 5 }, { qn: 'Email', kind: 'class' }, { qn: 'Email.step', line: 10 }, { qn: 'Report', kind: 'class' }, { qn: 'Report.step', line: 15 },
      { qn: 'mail', line: 20 }, { qn: 'render', line: 21 }, { qn: 'base', line: 22 },
    ] } }, [
      { from: 'a.ts/run', to: 'a.ts/Job.step', line: 2 }, { from: 'a.ts/Email.step', to: 'a.ts/Job.step', type: 'override' }, { from: 'a.ts/Report.step', to: 'a.ts/Job.step', type: 'override' },
      { from: 'a.ts/Job.step', to: 'a.ts/base', line: 6 }, { from: 'a.ts/Email.step', to: 'a.ts/mail', line: 11 }, { from: 'a.ts/Report.step', to: 'a.ts/render', line: 16 },
    ]);
    const t = traceFlow(b.graph, b.id('a.ts/run'));
    expect(t.hops[0]).toMatchObject({ resolution: 'ambiguous', candidates: [b.id('a.ts/Email.step'), b.id('a.ts/Report.step')], confidence: 0.6 });
    expect(t.hops.filter((h) => h.provenance === 'dispatch').map((h) => h.type)).toEqual(['override', 'override']);
    expect(names(t)).toEqual(expect.arrayContaining(['Email.step', 'Report.step', 'mail', 'render', 'base']));
  });

  it('resolves an interface member to its implementations by method name', () => {
    const b = buildGraph({ 'a.ts': { symbols: [
      { qn: 'use' }, { qn: 'Repo', kind: 'interface' }, { qn: 'Repo.find', line: 3 }, { qn: 'Sql', kind: 'class' }, { qn: 'Sql.find', line: 8 }, { qn: 'Mem', kind: 'class' }, { qn: 'Mem.find', line: 12 },
    ] } }, [{ from: 'a.ts/use', to: 'a.ts/Repo.find', line: 2 }, { from: 'a.ts/Sql', to: 'a.ts/Repo', type: 'implement' }, { from: 'a.ts/Mem', to: 'a.ts/Repo', type: 'implement' }]);
    const t = traceFlow(b.graph, b.id('a.ts/use'));
    expect(t.hops[0]).toMatchObject({ resolution: 'ambiguous', candidates: [b.id('a.ts/Mem.find'), b.id('a.ts/Sql.find')] });
    expect(t.hops.filter((h) => h.type === 'implement')).toHaveLength(2);
  });

  it('skips test files unless asked (or unless the root is itself a test)', () => {
    const b = buildGraph({ 'src/a.ts': fns('a'), 'test/helper.ts': { ...fns('helper'), role: 'test' } }, [{ from: 'src/a.ts/a', to: 'test/helper.ts/helper' }]);
    expect(names(traceFlow(b.graph, b.id('src/a.ts/a')))).toEqual(['a']);
    expect(names(traceFlow(b.graph, b.id('src/a.ts/a'), { includeTests: true }))).toEqual(['a', 'helper']);
    expect(names(traceFlow(b.graph, b.id('test/helper.ts/helper')))).toEqual(['helper']);
  });
});

describe('traceFlow: limits and direction', () => {
  it('keeps the nearest nodes when max_nodes truncates, and says so', () => {
    const leaves = Array.from({ length: 10 }, (_, i) => `l${i}`);
    const b = buildGraph({ 'a.ts': fns('root', 'mid', ...leaves) }, [
      { from: 'a.ts/root', to: 'a.ts/mid', line: 2 }, ...leaves.map((l, i) => ({ from: 'a.ts/root', to: `a.ts/${l}`, line: 10 + i })), { from: 'a.ts/mid', to: 'a.ts/l9', line: 99 },
    ]);
    const t = traceFlow(b.graph, b.id('a.ts/root'), { maxNodes: 4 });
    expect(t.nodes).toHaveLength(4);
    expect(t.truncated).toBe(true);
    expect(t.stats.dropped).toBe(8); // 12 reachable nodes - 4 kept
    expect(t.notes.join(' ')).toContain('max_nodes 4');
    expect(names(t)).toEqual(['root', 'mid', 'l0', 'l1']);
  });

  it('"in" walks callers to entry points, records them as triggers and keeps going past them', () => {
    const b = buildGraph({ 'a.ts': fns('h1', 'h2', 'mid', 'leaf', 'other') }, [
      { from: 'a.ts/h1', to: 'a.ts/mid', line: 2 }, { from: 'a.ts/h2', to: 'a.ts/mid', line: 12 }, { from: 'a.ts/mid', to: 'a.ts/leaf', line: 22 }, { from: 'a.ts/other', to: 'a.ts/h1', line: 32 },
    ]);
    const entry = (n: string, label: string) => ({ entity_id: b.id(`a.ts/${n}`), qualified_name: `a.ts/${n}`, file: 'a.ts', line: 1, kind: 'http_route' as const, label, confidence: 0.9, evidence: 't' });
    const t = traceFlow(b.graph, b.id('a.ts/leaf'), { direction: 'in', entries: [entry('h1', 'GET /1'), entry('h2', 'GET /2')] });
    expect(t.direction).toBe('in');
    expect(hopNames(t, b)).toEqual(['mid>leaf', 'h1>mid', 'other>h1', 'h2>mid']);
    expect(t.triggers.map((e) => e.label)).toEqual(['GET /1', 'GET /2']);
    expect(t.nodes.find((n) => n.id === b.id('a.ts/h1'))?.entry_kind).toBe('http_route');
  });

  it('"in" reaches an inline handler through its span', () => {
    const b = buildGraph({ 'a.ts': { symbols: [{ qn: 'createApp', line: 1, end: 30 }, { qn: 'work', line: 40 }] } }, [{ from: 'a.ts/createApp', to: 'a.ts/work', line: 12 }, { from: 'a.ts/createApp', to: 'a.ts/work', type: 'create', line: 25 }]);
    const e = { entity_id: b.id('a.ts/createApp'), qualified_name: 'x', file: 'a.ts', line: 10, kind: 'http_route' as const, label: 'GET /a', confidence: 0.9, evidence: 't', span: { line_start: 10, line_end: 14 } };
    const t = traceFlow(b.graph, b.id('a.ts/work'), { direction: 'in', entries: [e] });
    expect(t.triggers.map((x) => x.label)).toEqual(['GET /a']);
  });

  it('restricts a root with a span to the calls inside it', () => {
    const b = buildGraph({ 'a.ts': { symbols: [{ qn: 'app', line: 1, end: 40 }, { qn: 'one', line: 50 }, { qn: 'two', line: 51 }] } }, [{ from: 'a.ts/app', to: 'a.ts/one', line: 11 }, { from: 'a.ts/app', to: 'a.ts/two', line: 21 }]);
    const entry = { entity_id: b.id('a.ts/app'), qualified_name: 'x', file: 'a.ts', line: 10, kind: 'http_route' as const, label: 'GET /1', confidence: 0.9, evidence: 't', span: { line_start: 10, line_end: 12 } };
    const t = traceFlow(b.graph, entry);
    expect(names(t)).toEqual(['app', 'one']);
    expect(t.notes.join(' ')).toContain('lines 10-12');
  });
});

describe('traceFlow: module-scope code', () => {
  it('reads the direct calls of a file-rooted flow from source and resolves them through imports', () => {
    const text = "import { work } from './w.js';\nimport { other } from './w.js';\nfunction named() { other(); }\nprogram.action(() => {\n  work();\n  new Svc();\n  local.method();\n});\nwork();\n";
    const b = buildGraph({
      'src/cli.ts': { text, symbols: [{ qn: 'named', line: 3, end: 3 }] },
      'src/w.ts': { symbols: [{ qn: 'work', line: 1 }, { qn: 'other', line: 2 }, { qn: 'Svc', kind: 'class', line: 3 }] },
    }, [{ from: 'src/cli.ts', to: 'src/w.ts', type: 'import' }]);
    const whole = traceFlow(b.graph, b.id('src/cli.ts'), { source: b.source });
    expect(hopNames(whole, b)).toEqual(['cli.ts>work', 'cli.ts>Svc']); // `other()` is inside the named function: graph territory, not module scope
    expect(whole.hops.every((h) => h.provenance === 'source_scan')).toBe(true);
    expect(whole.hops[0]).toMatchObject({ count: 2, confidence: 0.6, ref: { file: 'src/cli.ts', line: 5 } });
    const entry = { entity_id: b.id('src/cli.ts'), qualified_name: 'src/cli.ts', file: 'src/cli.ts', line: 4, kind: 'cli_command' as const, label: 'cli: x', confidence: 0.7, evidence: 't', span: { line_start: 4, line_end: 8 } };
    expect(hopNames(traceFlow(b.graph, entry, { source: b.source }), b)).toEqual(['cli.ts>work', 'cli.ts>Svc']);
    expect(traceFlow(b.graph, entry, { source: b.source }).hops[0].count).toBe(1); // `work()` on line 9 is outside the span
    expect(traceFlow(b.graph, b.id('src/cli.ts')).hops).toHaveLength(0); // no source reader: nothing invented
  });
});

describe('lanes', () => {
  it('groups by package when the trace crosses packages, in order of first appearance', () => {
    const b = buildGraph({ 'packages/web/src/a.ts': fns('a'), 'packages/core/src/b.ts': fns('b'), 'packages/core/lib/c.ts': fns('c') }, [
      { from: 'packages/web/src/a.ts/a', to: 'packages/core/src/b.ts/b', line: 2 }, { from: 'packages/core/src/b.ts/b', to: 'packages/core/lib/c.ts/c', line: 3 },
    ]);
    const packages = [{ dir: 'packages/core', name: '@x/core' }, { dir: 'packages/web', name: '@x/web' }];
    const t = traceFlow(b.graph, b.id('packages/web/src/a.ts/a'), { packages });
    expect(t.lanes.map((l) => [l.id, l.kind, l.label, l.nodeIds.length])).toEqual([['package:packages/web', 'package', '@x/web', 1], ['package:packages/core', 'package', '@x/core', 2]]);
    expect(t.nodes.every((n) => t.lanes.some((l) => l.id === n.lane_id))).toBe(true);
  });

  it('uses folders inside one package and coarsens beyond 8 lanes', () => {
    const files: Record<string, FileSpec> = {};
    const rels: RelSpec[] = [];
    for (let i = 0; i < 12; i++) {
      files[`src/m${i}/deep/f.ts`] = fns('f');
      if (i > 0) rels.push({ from: `src/m${i - 1}/deep/f.ts/f`, to: `src/m${i}/deep/f.ts/f`, line: 2 });
    }
    const b = buildGraph(files, rels);
    const folder = traceFlow(b.graph, b.id('src/m0/deep/f.ts/f'), { depth: 2 });
    expect(folder.lanes.map((l) => l.kind)).toEqual(['folder', 'folder', 'folder']);
    expect(folder.lanes[0].path).toMatch(/src\/m0\/deep/);
    const many = buildGraph(files, [...Array(11).keys()].map((i) => ({ from: `src/m${i}/deep/f.ts/f`, to: `src/m${i + 1}/deep/f.ts/f`, line: 2 })));
    const wide = traceFlow(many.graph, many.id('src/m0/deep/f.ts/f'), { depth: 5 });
    expect(wide.nodes).toHaveLength(6);
    expect(wide.lanes.length).toBeLessThanOrEqual(8);
  });
});

describe('renderTraceText', () => {
  it('draws the tree with box characters, flags and a summary', () => {
    const b = buildGraph({ 'a.ts': fns('a', 'b', 'c') }, [{ from: 'a.ts/a', to: 'a.ts/b', line: 2, weight: 2 }, { from: 'a.ts/b', to: 'a.ts/a', line: 12 }, { from: 'a.ts/a', to: 'a.ts/c', line: 3 }]);
    const text = renderTraceText(traceFlow(b.graph, b.id('a.ts/a')));
    expect(text).toContain('├─ b()  a.ts:11  (x2)');
    expect(text).toContain('│  └─ a()  a.ts:1  (cycle)');
    expect(text).toContain('└─ c()  a.ts:21');
    expect(text).toContain('3 nodes, 3 hops, depth 1');
  });
});
