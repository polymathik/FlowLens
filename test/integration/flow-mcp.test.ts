/**
 * trace_flow / list_entry_points through the real MCP server (SDK in-memory
 * transport) on an indexed copy of the flow-app fixture: registration,
 * contract conformance of the envelopes, truthful paging, error codes,
 * canvas_url deep link, and the direct-from-source behaviour of inline
 * handlers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import { AnnotationStore } from '../../src/mcp/annotation-store.js';
import { SnapshotManager } from '../../src/analysis/snapshot-manager.js';
import { createFlowLensServer, type ServerDependencies } from '../../src/mcp/server.js';
import { toolEnvelopeSchema } from '../../src/contracts/mcp/tools.js';
import { ToolErrorSchema } from '../../src/contracts/mcp/schemas/common.js';
import { FlowTraceSchema } from '../../src/contracts/flow.js';
import { createFlowFixture, type FlowFixture } from '../helpers/flow-fixture.js';

let fx: FlowFixture;
let store: LevelGraphStore;
let client: Client;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<{ body: any; isError: boolean }> {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
  return { body: JSON.parse(text), isError: Boolean(r.isError) };
}

beforeAll(async () => {
  fx = await createFlowFixture();
  store = new LevelGraphStore();
  await store.open(join(fx.flowlensDir, 'graph'));
  const annotationStore = new AnnotationStore(join(fx.flowlensDir, 'annotations.json'));
  await annotationStore.load();
  const deps: ServerDependencies = {
    graph: store, annotationStore, snapshotManager: new SnapshotManager(join(fx.flowlensDir, 'snapshots')),
    flowlensDir: fx.flowlensDir, rootDir: fx.rootDir, fileIndexPath: join(fx.flowlensDir, 'file_index.json'),
  };
  const server = createFlowLensServer(deps);
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  client = new Client({ name: 'flow-test', version: '0.0.0' });
  await client.connect(c);
}, 60_000);

afterAll(async () => {
  await client?.close();
  await store?.close();
  await fx?.cleanup();
});

describe('MCP: flow tools', () => {
  it('are registered (14 tools: the 12 originals + trace_flow + list_entry_points)', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(14);
    expect(names).toEqual(expect.arrayContaining(['trace_flow', 'list_entry_points']));
  });

  it('list_entry_points: default kinds, labels, truthful paging', async () => {
    const all = await call('list_entry_points', { max_results: 200 });
    expect(all.isError).toBe(false);
    toolEnvelopeSchema('list_entry_points').parse(all.body);
    const labels = all.body.data.entry_points.map((e: { label: string }) => e.label);
    expect(labels).toEqual(expect.arrayContaining(['GET /api/users', 'GET /api/orders', 'GET /cats/:id', 'GET /api/ping', 'cli: serve', 'cli: db migrate', 'bin: flow-app', 'page /', 'ui: <App>']));
    expect(labels.some((l: string) => l.startsWith('test:'))).toBe(false); // tests excluded by default
    expect(all.body).toMatchObject({ total_count: labels.length, returned_count: labels.length, truncated: false });
    expect(all.body.data.counts_by_kind.http_route).toBeGreaterThanOrEqual(9);

    const one = await call('list_entry_points', { kind: ['http_route'], max_results: 1 });
    expect(one.body.data.entry_points).toHaveLength(1);
    expect(one.body).toMatchObject({ returned_count: 1, truncated: true, limit: 1 });
    expect(one.body.total_count).toBe(all.body.data.counts_by_kind.http_route);

    const tests = await call('list_entry_points', { kind: ['test'], include_tests: true });
    expect(tests.body.data.entry_points.map((e: { kind: string }) => e.kind)).toEqual(['test']);
    const scoped = await call('list_entry_points', { path: 'src/routes/' });
    expect(scoped.body.data.entry_points.map((e: { file: string }) => e.file)).toEqual(['src/routes/orders.ts', 'src/routes/orders.ts']);
  });

  it('trace_flow by entry label: ordered hops, lanes, canvas_url, contract-valid', async () => {
    const r = await call('trace_flow', { entity: 'GET /api/users', depth: 3 });
    expect(r.isError).toBe(false);
    toolEnvelopeSchema('trace_flow').parse(r.body);
    const { trace, text } = r.body.data;
    FlowTraceSchema.parse(trace);
    expect(trace.root.label).toBe('GET /api/users');
    const names = trace.nodes.map((n: { name: string }) => n.name);
    expect(names.slice(0, 4)).toEqual(expect.arrayContaining(['listUsers', 'findUsers']));
    expect(names).toContain('query');
    expect(trace.lanes.map((l: { path: string }) => l.path)).toEqual(expect.arrayContaining(['src/handlers', 'src/services', 'src/db']));
    expect(text).toContain('listUsers');
    expect(text).toContain('└─');
    expect(r.body.canvas_url).toMatch(/#\/p\/[^/]+\/map\/flow\/.+\?depth=3/);
  });

  it('trace_flow sees inline handlers by reading the registration (source_scan) and flags unresolved calls', async () => {
    const r = await call('trace_flow', { entity: 'POST /api/users' });
    const { trace } = r.body.data;
    const hops = trace.hops as Array<{ provenance: string; resolution: string; target_name?: string }>;
    expect(hops.some((h) => h.provenance === 'source_scan')).toBe(true);
    expect(hops.some((h) => h.resolution === 'unresolved' && h.target_name === 'auditLog')).toBe(true);
    expect(trace.stats.unresolved).toBeGreaterThanOrEqual(1);
    expect(r.body.data.text).toContain('?? auditLog');
  });

  it('trace_flow follows constructors and shows interface/override dispatch as ambiguous', async () => {
    const r = await call('trace_flow', { entity: 'src/services/jobs.ts/Job.run' });
    const hops = r.body.data.trace.hops as Array<{ resolution: string; candidates?: string[] }>;
    expect(hops.some((h) => h.resolution === 'ambiguous' && (h.candidates?.length ?? 0) >= 2)).toBe(true);
  });

  it("trace_flow direction 'in' lists the entry points that lead to a function", async () => {
    const r = await call('trace_flow', { entity: 'src/db/client.ts/query', direction: 'in', depth: 4 });
    expect(r.isError).toBe(false);
    const triggers = (r.body.data.trace.triggers as Array<{ label: string }>).map((t) => t.label);
    expect(triggers).toEqual(expect.arrayContaining(['GET /api/users']));
  });

  it('cycles in the fixture terminate and are marked', async () => {
    const r = await call('trace_flow', { entity: 'src/services/cycle.ts/ping', depth: 5 });
    const links = (r.body.data.trace.hops as Array<{ link: string }>).map((h) => h.link);
    expect(links).toContain('cycle');
    expect(r.body.data.trace.nodes.map((n: { name: string }) => n.name)).toEqual(['ping', 'query', 'pong']);
  });

  it('max_nodes truncates truthfully', async () => {
    const r = await call('trace_flow', { entity: 'GET /api/users', max_nodes: 2 });
    expect(r.body.data.trace.nodes).toHaveLength(2);
    expect(r.body.data.trace.truncated).toBe(true);
    expect(r.body.data.trace.stats.dropped).toBeGreaterThan(0);
  });

  it('errors: not_found with suggestions, ambiguous with candidates, invalid arguments rejected by the schema', async () => {
    const nf = await call('trace_flow', { entity: 'GET /api/userz' });
    expect(nf.isError).toBe(true);
    const nfErr = ToolErrorSchema.parse(nf.body);
    expect(nfErr.code).toBe('not_found');
    expect(nfErr.suggestions.join(' ')).toContain('GET /api/users');

    const amb = await call('trace_flow', { entity: 'step' });
    expect(amb.isError).toBe(true);
    const ambErr = ToolErrorSchema.parse(amb.body);
    expect(ambErr.code).toBe('ambiguous');
    expect(ambErr.candidates!.length).toBeGreaterThan(1);

    const raw = await client.callTool({ name: 'trace_flow', arguments: { entity: 'GET /api/users', depth: 0 } });
    expect(raw.isError).toBe(true);
  });
});
