/**
 * End-to-end MCP correctness (Phase 10, Lane C2): real git repo, real index,
 * real MCP server + SDK client. Every list tool is called with its full cap,
 * with max_results=1 and with defaults; totals and truncation must agree, and
 * every response must conform to the contract schema in contracts/mcp/tools.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, git, type Harness } from './harness.js';
import { TOOL_NAMES, toolEnvelopeSchema, type ToolName } from '../../../src/contracts/mcp/tools.js';
import { ToolErrorSchema } from '../../../src/contracts/mcp/schemas/common.js';

interface ListCase {
  tool: ToolName;
  args: Record<string, unknown>;
  list: string;
  limitKey?: string;
  cap: number;
  exact?: number;
  min?: number;
}

const LIST_CASES: ListCase[] = [
  { tool: 'get_context', args: { entity: 'src/core/store.ts/Store' }, list: 'relations', cap: 250, min: 5 },
  { tool: 'get_dependents', args: { entity: 'src/shared/format.ts/format' }, list: 'dependents', cap: 250, exact: 5 },
  { tool: 'get_module_interface', args: { module: 'src/shared/format.ts' }, list: 'exports', cap: 250, exact: 6 },
  { tool: 'traverse', args: { start: 'format', direction: 'inbound', max_depth: 1 }, list: 'nodes', limitKey: 'max_nodes', cap: 500, exact: 5 },
  { tool: 'detect_cycles', args: {}, list: 'cycles', cap: 250, min: 3 },
  { tool: 'get_metrics', args: {}, list: 'entries', cap: 250, min: 5 },
  { tool: 'diff_interface', args: { since: 'HEAD~1', breaking_only: false }, list: 'changes', cap: 250, min: 6 },
  { tool: 'check_architecture', args: {}, list: 'violations', cap: 250, exact: 3 },
  { tool: 'get_hotspots', args: {}, list: 'hotspots', cap: 250, min: 2 },
];

describe('MCP correctness end-to-end', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  it('covers every registered tool', async () => {
    const listed = (await h.client.listTools()).tools.map((t) => t.name).sort();
    expect(listed).toEqual([...TOOL_NAMES].sort());
  });

  for (const c of LIST_CASES) {
    it(`${c.tool}: truthful total_count/truncated at cap, max=1 and default`, async () => {
      const key = c.limitKey ?? 'max_results';
      const schema = toolEnvelopeSchema(c.tool);

      const full = await h.call(c.tool, { ...c.args, [key]: c.cap });
      expect(full.isError, full.text).toBe(false);
      schema.parse(full.body);
      const total = full.body.data[c.list].length;
      if (c.exact !== undefined) expect(total).toBe(c.exact);
      if (c.min !== undefined) expect(total).toBeGreaterThanOrEqual(c.min);
      expect(full.body).toMatchObject({ total_count: total, returned_count: total, truncated: false, limit: c.cap });

      const one = await h.call(c.tool, { ...c.args, [key]: 1 });
      schema.parse(one.body);
      expect(one.body.data[c.list]).toHaveLength(1);
      expect(one.body).toMatchObject({ total_count: total, returned_count: 1, truncated: true, limit: 1 });

      const def = await h.call(c.tool, c.args);
      schema.parse(def.body);
      const returned = def.body.data[c.list].length;
      expect(def.body.total_count).toBe(total);
      expect(def.body.returned_count).toBe(returned);
      expect(def.body.truncated).toBe(returned < total);
      expect(def.body.total_is_estimate).toBeUndefined();
    });
  }

  it('non-list tools conform and never claim truncation', async () => {
    const cases: Array<[ToolName, Record<string, unknown>]> = [
      ['get_summary', {}],
      ['get_layer_map', {}],
      ['annotate', { entity: 'Store', text: 'e2e', category: 'decision', author: 'test' }],
    ];
    for (const [tool, args] of cases) {
      const r = await h.call(tool, args);
      expect(r.isError, r.text).toBe(false);
      toolEnvelopeSchema(tool).parse(r.body);
      expect(r.body.truncated).toBe(false);
      expect(r.body.total_count).toBeUndefined();
    }
  });

  it('ambiguous names return candidates instead of picking one', async () => {
    const r = await h.call('get_context', { entity: 'parse' });
    expect(r.isError).toBe(true);
    const err = ToolErrorSchema.parse(r.body);
    expect(err.code).toBe('ambiguous');
    expect(err.candidates!.map((c) => c.file).sort()).toEqual(['src/shared/parse-a.ts', 'src/shared/parse-b.ts']);
    expect(err.candidates!.every((c) => c.line > 0)).toBe(true);

    // Retrying with a candidate id resolves exactly.
    const retry = await h.call('get_context', { entity: err.candidates![0].id });
    expect(retry.isError).toBe(false);
  });

  it('a class name resolves to the class, not its members', async () => {
    const r = await h.call('get_context', { entity: 'Store', max_results: 1 });
    expect(r.body.data.entity).toMatchObject({ kind: 'class', qualified_name: 'src/core/store.ts/Store' });
  });

  it('unknown entities get did-you-mean suggestions', async () => {
    const r = await h.call('get_dependents', { entity: 'formt' });
    const err = ToolErrorSchema.parse(r.body);
    expect(err.code).toBe('not_found');
    expect(err.suggestions.join(' ')).toContain('src/shared/format.ts/format');
  });

  it('cycles: ordered closed paths, directory modules, layer-aware severity', async () => {
    const r = await h.call('detect_cycles', {});
    const cycles = r.body.data.cycles as Array<any>;
    const file = cycles.find((c) => c.granularity === 'file');
    expect(file.path[0]).toBe(file.path[file.path.length - 1]);
    expect(new Set(file.path)).toEqual(new Set(['src/api/handler.ts', 'src/core/registry.ts']));
    expect(file.severity).toBe('high');
    expect(file.layers).toEqual(['api', 'core']);
    expect(file.edges).toHaveLength(2);
    expect(cycles.find((c) => c.granularity === 'module').entities.sort()).toEqual(['src/api', 'src/core']);
    expect(cycles.find((c) => c.granularity === 'function').path_labels).toContain('src/core/registry.ts/ping');

    const scoped = await h.call('detect_cycles', { scope: 'src/shared' });
    expect(scoped.body.total_count).toBe(0);
  });

  it('check_architecture reports readable names and full rule text', async () => {
    const r = await h.call('check_architecture', {});
    const v = r.body.data.violations.find((x: any) => x.rule === 'must_not_access');
    expect(v.rule_text).toBe("Layer 'core' must not access 'api'");
    expect(v.entity_from_name).toBe('src/core/registry.ts');
    expect(v.entity_to_name).toBe('src/api/handler.ts');
  });

  it('diff refs: HEAD~1, short SHA, unknown ref, traversal attempt', async () => {
    const v1 = git(h.rootDir, 'rev-parse', 'HEAD~1');
    const byRel = await h.call('diff_interface', { since: 'HEAD~1', breaking_only: true });
    expect(byRel.body.data.from_sha).toBe(v1);
    expect(byRel.body.data.changes.map((c: any) => c.entity_name)).toContain('storeHelper');
    expect(byRel.body.data.changes[0].before).toBeUndefined(); // summary detail

    const short = await h.call('diff_interface', { since: v1.slice(0, 7) });
    expect(short.body.data.from_sha).toBe(v1);

    const unknown = await h.call('diff_interface', { since: 'no-such-branch' });
    expect(ToolErrorSchema.parse(unknown.body).code).toBe('no_snapshot');
    const bad = await h.call('diff_interface', { since: '../config' });
    expect(ToolErrorSchema.parse(bad.body).code).toBe('invalid_argument');

    const mi = await h.call('get_module_interface', { module: 'src/core/store.ts', diff_since: 'nope-ref' });
    expect(mi.isError).toBe(true);
  });

  it('traverse stop_at_boundary returns boundary nodes with layer names', async () => {
    const r = await h.call('traverse', { start: 'src/api/routes.ts', direction: 'outbound', stop_at_boundary: true, max_depth: 3 });
    toolEnvelopeSchema('traverse').parse(r.body);
    expect(r.body.data.start_layer).toBe('api');
    expect(r.body.data.stopped_at_boundaries).toContainEqual(
      { entity: 'src/shared/format.ts', from_layer: 'api', to_layer: 'shared' },
    );
    const boundaryIds = r.body.data.nodes.filter((n: any) => n.boundary).map((n: any) => n.entity.id);
    // Boundary nodes are never expanded: no edge leaves them.
    expect(r.body.data.edges.filter((e: any) => boundaryIds.includes(e.from))).toHaveLength(0);
  });

  it('hotspots carry real last_changed and no zero scores', async () => {
    const r = await h.call('get_hotspots', { max_results: 250 });
    for (const hs of r.body.data.hotspots) {
      expect(hs.hotspot_score).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(hs.last_changed))).toBe(false);
    }
  });

  it('summary detail is smaller than full detail', async () => {
    const s = await h.call('get_context', { entity: 'Store', max_results: 250 });
    const f = await h.call('get_context', { entity: 'Store', max_results: 250, detail: 'full' });
    toolEnvelopeSchema('get_context').parse(f.body);
    expect(f.body.data.relations[0].relation).toBeDefined();
    expect(s.body.data.relations[0].relation).toBeUndefined();
    expect(s.text.length).toBeLessThan(f.text.length);
  });

  it('rejects invalid sort_by and relation types at the input schema', async () => {
    expect((await h.call('get_metrics', { sort_by: 'bogus' })).isError).toBe(true);
    expect((await h.call('get_context', { entity: 'Store', relation_types: ['nope'] })).isError).toBe(true);
  });

  it('warm calls are fast (cached graph view)', async () => {
    for (const c of LIST_CASES) await h.call(c.tool, c.args);
    for (const c of LIST_CASES) {
      const t0 = performance.now();
      await h.call(c.tool, c.args);
      expect(performance.now() - t0, c.tool).toBeLessThan(100);
    }
  });
});
