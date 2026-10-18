import { describe, it, expect } from 'vitest';
import { buildResponse, paginate, toMCPError } from '../../../src/mcp/response-builder.js';
import { clampLimit } from '../../../src/mcp/limits.js';
import { ToolErrorSchema } from '../../../src/contracts/mcp/schemas/common.js';

describe('response builder', () => {
  it('reports truncation from the full list, not the capped one', () => {
    const { items, page } = paginate([1, 2, 3, 4, 5], 1);
    const r = buildResponse({ items }, 'ts', { page });
    expect(r).toMatchObject({ truncated: true, total_count: 5, returned_count: 1, limit: 1 });
  });

  it('is not truncated when everything fits', () => {
    const { page } = paginate([1, 2], 10);
    expect(buildResponse({}, 'ts', { page })).toMatchObject({ truncated: false, total_count: 2, returned_count: 2 });
  });

  it('flags lower-bound totals', () => {
    const { page } = paginate([1, 2, 3], 2, { estimate: true });
    expect(buildResponse({}, 'ts', { page }).total_is_estimate).toBe(true);
  });

  it('non-list responses omit counts', () => {
    const r = buildResponse({ a: 1 }, 'ts');
    expect(r.truncated).toBe(false);
    expect(r.total_count).toBeUndefined();
  });

  it('clamps limits to [1, cap] with defaults', () => {
    const spec = { default: 20, cap: 250 };
    expect(clampLimit(undefined, spec)).toBe(20);
    expect(clampLimit(1000, spec)).toBe(250);
    expect(clampLimit(0, spec)).toBe(1);
  });

  it('errors follow the ToolError contract', () => {
    const e = toMCPError({ error: 'x', code: 'not_found' }, 'ts');
    expect(e.isError).toBe(true);
    expect(ToolErrorSchema.parse(JSON.parse(e.content[0].text))).toMatchObject({ code: 'not_found', suggestions: [] });
  });
});
