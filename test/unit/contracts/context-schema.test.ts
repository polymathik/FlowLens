import { describe, it, expect } from 'vitest';
import {
  ContextItemSchema,
  NewContextItemSchema,
  ContextConfigSchema,
  ContextIdSchema,
  CONTEXT_ITEM_TYPES,
} from '../../../src/contracts/context.js';
import { ANNOTATION_CATEGORY_TO_TYPE } from '../../../src/contracts/mcp/context-tools.js';

const baseItem = {
  id: 'ctx_3f9a1c2e',
  type: 'decision',
  scope: 'project',
  title: 'Use LevelGraph for graph storage',
  body: 'Embedded, no server.',
  status: 'active',
  anchors: [
    {
      qualified_name: 'LevelGraphStore',
      file: 'src/graph/levelgraph-store.ts',
      kind: 'class',
      entity_id: '1a2b3c4d5e6f7a8b',
      body_hash: 'abc',
    },
  ],
  provenance: { source: 'agent', agent: 'claude-code', session: 's1', origin: 'conversation' },
  rev: 1,
  created_at: '2026-10-10T17:00:00Z',
  updated_at: '2026-10-10T17:00:00Z',
};

describe('context contract schemas', () => {
  it('parses a full item and applies defaults', () => {
    const item = ContextItemSchema.parse(baseItem);
    expect(item.tags).toEqual([]);
    expect(item.feature).toBeNull();
    expect(item.supersedes).toBeNull();
    expect(item.confidence).toBe(0.8);
  });

  it('rejects malformed ids, unknown types and stale-as-persisted status', () => {
    expect(ContextIdSchema.safeParse('ctx_XYZ').success).toBe(false);
    expect(ContextItemSchema.safeParse({ ...baseItem, type: 'idea' }).success).toBe(false);
    expect(ContextItemSchema.safeParse({ ...baseItem, status: 'stale' }).success).toBe(false);
  });

  it('accepts a minimal new item', () => {
    const r = NewContextItemSchema.safeParse({
      type: 'gotcha',
      scope: 'project',
      title: 'classic-level locks the DB',
      body: 'Close before reopening in tests.',
      provenance: { source: 'human', origin: 'canvas' },
    });
    expect(r.success).toBe(true);
  });

  it('fills config defaults', () => {
    const cfg = ContextConfigSchema.parse({ version: 1 });
    expect(cfg.auto_accept_types).toEqual(['command', 'handoff']);
    expect(cfg.brief_token_budget).toBe(1500);
  });

  it('maps every legacy annotation category to a valid type', () => {
    for (const t of Object.values(ANNOTATION_CATEGORY_TO_TYPE)) {
      expect(CONTEXT_ITEM_TYPES).toContain(t);
    }
  });
});
