/**
 * Contract registry runtime checks. Compile-time drift guards (handler input
 * types == contract types, Zod schemas == analysis types) live in
 * src/mcp/contract-conformance.ts and are enforced by `npm run lint`, because
 * test files are not type-checked by the project tsconfig.
 */

import { describe, it, expect } from 'vitest';
import { TOOL_CONTRACTS, TOOL_NAMES, toolEnvelopeSchema } from '../../../src/contracts/mcp/tools.js';
import { CONTRACT_CONFORMANCE } from '../../../src/mcp/contract-conformance.js';

describe('MCP tool contracts', () => {
  it('every tool has a contract with an output schema and envelope', () => {
    expect(TOOL_NAMES).toHaveLength(12);
    for (const name of TOOL_NAMES) {
      expect(TOOL_CONTRACTS[name].output).toBeDefined();
      expect(() => toolEnvelopeSchema(name)).not.toThrow();
    }
  });

  it('envelope schema rejects undeclared fields (drift) and bad truncation types', () => {
    const schema = toolEnvelopeSchema('annotate');
    const data = { annotation_id: 'a', entity_id: 'b', created_at: 'c' };
    expect(schema.safeParse({ data, last_indexed: '', truncated: false }).success).toBe(true);
    expect(schema.safeParse({ data, last_indexed: '', truncated: 'no' }).success).toBe(false);
    expect(schema.safeParse({ data, last_indexed: '', truncated: false, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ data: { ...data, extra: 1 }, last_indexed: '', truncated: false }).success).toBe(false);
  });

  it('compile-time conformance tuple is all true', () => {
    expect(CONTRACT_CONFORMANCE.every(Boolean)).toBe(true);
  });
});
