import { afterEach, describe, expect, it, vi } from 'vitest';
import { entryPointsUrl, FlowApiError, fetchTrace, findEntry, getWithRetry, traceUrl } from '../../../src/canvas/flow/api/flow-client.js';
import type { EntryPoint } from '../../../src/contracts/flow.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, statusText: String(status), headers: { 'content-type': 'application/json' } });
const spec = { id: 'x', depth: 3, direction: 'out' as const };

afterEach(() => vi.unstubAllGlobals());

describe('flow client', () => {
  it('writes the REST query from a spec: defaults left out, lists comma-joined', () => {
    expect(traceUrl('/b', 'GET /a', { depth: 4, direction: 'out' })).toBe('/b/flow/trace?entity=GET+%2Fa&depth=4&direction=out');
    expect(traceUrl('/b', 'e1', { depth: 2, direction: 'in', follow: ['call', 'use'], maxNodes: 50, includeTests: true }))
      .toBe('/b/flow/trace?entity=e1&depth=2&direction=in&follow=call%2Cuse&max_nodes=50&include_tests=1');
    expect(entryPointsUrl('/b')).toBe('/b/flow/entry-points?max=1000');
    expect(entryPointsUrl('/b', { includeTests: true, path: 'src/a' })).toBe('/b/flow/entry-points?max=1000&include_tests=1&path=src%2Fa');
  });

  it('turns a flow error body into a FlowApiError with its code, candidates and suggestions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { ok: false, error: { code: 'not_found', message: "Entity not found: 'q'" }, suggestions: ['GET /a'] })));
    const err = await fetchTrace('/b', 'q', spec).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowApiError);
    expect(err).toMatchObject({ status: 404, code: 'not_found', suggestions: ['GET /a'], candidates: [], message: "Entity not found: 'q'" });
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { ok: false, error: { code: 'ambiguous', message: 'two' }, candidates: [{ id: '1', kind: 'method', qualified_name: 'A.step', file: 'a.ts', line: 3 }] })));
    expect(await fetchTrace('/b', 'step', spec).catch((e: unknown) => e)).toMatchObject({ code: 'ambiguous', candidates: [{ id: '1' }] });
  });

  it('retries once after a server error or a dropped connection (the daemon may be re-indexing), not after a 404', async () => {
    const calls = vi.fn().mockResolvedValueOnce(json(503, { error: 'busy' })).mockResolvedValueOnce(json(200, { ok: 1 }));
    vi.stubGlobal('fetch', calls);
    await expect(getWithRetry('/u', undefined, 1)).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveBeenCalledTimes(2);
    calls.mockReset().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(200, { ok: 2 }));
    await expect(getWithRetry('/u', undefined, 1)).resolves.toEqual({ ok: 2 });
    calls.mockReset().mockResolvedValue(json(503, { error: 'still busy' }));
    await expect(getWithRetry('/u', undefined, 1)).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveBeenCalledTimes(2); // one retry only
    calls.mockReset().mockResolvedValue(json(404, { error: { code: 'not_found', message: 'no' } }));
    await expect(getWithRetry('/u', undefined, 1)).rejects.toMatchObject({ code: 'not_found' });
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('finds the entry a link names: the entity, and the inline handler by its span', () => {
    const e = (label: string, span?: [number, number]): EntryPoint => ({ entity_id: 'app', qualified_name: 'app', file: 'a.ts', line: 1, kind: 'http_route', label, confidence: 1, evidence: '', ...(span ? { span: { line_start: span[0], line_end: span[1] } } : {}) });
    const list = [e('GET /a', [5, 7]), e('POST /a', [9, 12]), e('main')];
    expect(findEntry(list, { id: 'app', span: { from: 9, to: 12 } })?.label).toBe('POST /a');
    expect(findEntry(list, { id: 'app', span: { from: 1, to: 2 } })).toBeUndefined();
    expect(findEntry(list, { id: 'app' })?.label).toBe('main');
    expect(findEntry(list, { id: 'other' })).toBeUndefined();
  });
});
