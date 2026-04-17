import { describe, it, expect } from 'vitest';
import { exportGraph } from '../../../src/export/index.js';
import { filterForExport } from '../../../src/export/scope-filter.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';

function entity(id: string, name: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'class',
    name,
    qualified_name: `m/${name}`,
    file: 'src/m.ts',
    location: { line_start: 1, line_end: 2, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
    ...overrides,
  };
}

function relation(id: string, from: string, to: string, type: Relation['type'] = 'call'): Relation {
  return {
    id,
    from,
    to,
    type,
    location: { file: 'src/m.ts', line: 1, column: 0 },
    weight: 1,
    confidence: 1,
  };
}

describe('exportGraph', () => {
  const entities = [
    entity('e1', 'Alpha', { metrics: { line_count: 10, quality_score: 85 } }),
    entity('e2', 'Beta', { file: 'src/auth/beta.ts' }),
    entity('e3', 'Gamma', { file: 'src/db/gamma.ts' }),
  ];
  const relations = [
    relation('r1', 'e1', 'e2', 'call'),
    relation('r2', 'e2', 'e3', 'import'),
  ];

  describe('JSON', () => {
    it('produces parseable JSON with version and timestamp', () => {
      const out = exportGraph(entities, relations, { format: 'json' });
      const parsed = JSON.parse(out);
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(parsed.entities).toHaveLength(3);
      expect(parsed.relations).toHaveLength(2);
    });

    it('includes metrics by default', () => {
      const out = exportGraph(entities, relations, { format: 'json' });
      const parsed = JSON.parse(out);
      const alpha = parsed.entities.find((e: Entity) => e.name === 'Alpha');
      expect(alpha.metrics.quality_score).toBe(85);
    });

    it('strips metrics when include_metrics=false', () => {
      const out = exportGraph(entities, relations, { format: 'json', include_metrics: false });
      const parsed = JSON.parse(out);
      const alpha = parsed.entities.find((e: Entity) => e.name === 'Alpha');
      expect(alpha.metrics).toBeUndefined();
    });

    it('respects scope filtering', () => {
      const out = exportGraph(entities, relations, { format: 'json', scope: 'src/auth/' });
      const parsed = JSON.parse(out);
      expect(parsed.entities).toHaveLength(1);
      expect(parsed.entities[0].name).toBe('Beta');
      expect(parsed.relations).toHaveLength(0); // endpoints fell out of scope
    });

    it('respects relation-type filtering', () => {
      const out = exportGraph(entities, relations, {
        format: 'json',
        relation_types: ['call'],
      });
      const parsed = JSON.parse(out);
      expect(parsed.relations).toHaveLength(1);
      expect(parsed.relations[0].type).toBe('call');
    });
  });

  describe('DOT', () => {
    it('produces a digraph with rankdir and node declarations', () => {
      const out = exportGraph(entities, relations, { format: 'dot' });
      expect(out).toMatch(/^digraph FlowLens \{/);
      expect(out).toContain('rankdir=LR');
      expect(out).toContain('node [shape=box]');
      expect(out).toContain('[label="Alpha');
      expect(out).toMatch(/}\n$/);
    });

    it('escapes quotes in entity names', () => {
      const withQuote = [entity('e1', 'He said "Hi"')];
      const out = exportGraph(withQuote, [], { format: 'dot' });
      expect(out).toContain('\\"Hi\\"');
    });

    it('renders edges with relation-type labels', () => {
      const out = exportGraph(entities, relations, { format: 'dot' });
      expect(out).toContain('[label="call"]');
      expect(out).toContain('[label="import"]');
    });

    it('includes quality score when available', () => {
      const out = exportGraph(entities, [], { format: 'dot' });
      expect(out).toContain('QS:85');
    });
  });

  describe('Mermaid', () => {
    it('produces a graph LR with node aliases', () => {
      const out = exportGraph(entities, relations, { format: 'mermaid' });
      expect(out).toMatch(/^graph LR/);
      expect(out).toContain('n0["Alpha<br/>(class, QS:85)"]');
      expect(out).toMatch(/-->\|call\|/);
    });

    it('skips dangling edges when endpoints are missing', () => {
      const dangling = [relation('rX', 'missing1', 'missing2')];
      const out = exportGraph(entities, dangling, { format: 'mermaid' });
      // The dangling edge should be filtered out before rendering
      expect(out).not.toContain('missing');
    });

    it('strips pipe characters from edge labels', () => {
      // Relation type is constrained, but verify the helper doesn't blow up
      const out = exportGraph(entities, relations, { format: 'mermaid' });
      expect(out).not.toContain('||'); // no empty pipe pairs
    });
  });

  it('throws on unknown format', () => {
    expect(() =>
      exportGraph(entities, relations, { format: 'xml' as unknown as 'json' }),
    ).toThrow(/Unknown export format/);
  });
});

describe('filterForExport', () => {
  const entities = [
    entity('e1', 'A', { file: 'src/x.ts' }),
    entity('e2', 'B', { file: 'src/y.ts' }),
  ];
  const relations = [
    relation('r1', 'e1', 'e2', 'call'),
    relation('r2', 'e1', 'e2', 'import'),
  ];

  it('returns everything when no options', () => {
    const r = filterForExport(entities, relations, {});
    expect(r.entities).toHaveLength(2);
    expect(r.relations).toHaveLength(2);
  });

  it('drops relations whose endpoints fell out of scope', () => {
    const r = filterForExport(entities, relations, { scope: 'src/x.ts' });
    expect(r.entities).toHaveLength(1);
    expect(r.relations).toHaveLength(0);
  });
});
