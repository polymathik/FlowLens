/**
 * Phase 10 export fixes: DOT label escaping, Mermaid size guard,
 * stdout drain (stream writer).
 */
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { exportGraph, renderExport } from '../../../src/export/index.js';
import { escapeDot } from '../../../src/export/dot-exporter.js';
import { mermaidSizeWarnings } from '../../../src/export/mermaid-size-guard.js';
import { writeFully } from '../../../src/export/stream-writer.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';

function entity(id: string, name: string, file = 'src/a.ts'): Entity {
  return {
    id,
    kind: 'function',
    name,
    qualified_name: `${file}/${name}`,
    file,
    location: { line_start: 1, line_end: 2, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
    metrics: { quality_score: 80 } as Entity['metrics'],
  };
}

describe('DOT labels', () => {
  it('uses a real DOT line break, not a literal backslash-n', () => {
    const out = exportGraph([entity('e1', 'foo')], [], { format: 'dot' });
    expect(out).toContain('[label="foo\\n(function, QS:80)"]');
    expect(out).not.toContain('\\\\n');
  });

  it('still escapes quotes and backslashes inside names', () => {
    const out = exportGraph([entity('e1', 'a"b\\c')], [], { format: 'dot' });
    expect(out).toContain('label="a\\"b\\\\c\\n(function');
  });

  it('escapeDot converts raw newlines to the DOT escape', () => {
    expect(escapeDot('x\ny')).toBe('x\\ny');
  });
});

describe('Mermaid size guard', () => {
  it('returns no warnings for small diagrams', () => {
    const r = renderExport([entity('e1', 'a'), entity('e2', 'b')], [], { format: 'mermaid' });
    expect(r.warnings).toEqual([]);
    expect(r.entity_count).toBe(2);
  });

  it('warns with a concrete --scope hint when over the edge limit', () => {
    const entities: Entity[] = [];
    const relations: Relation[] = [];
    for (let i = 0; i < 600; i++) {
      entities.push(entity(`e${i}`, `f${i}`, i % 3 === 0 ? 'src/auth/x.ts' : 'src/ui/y.ts'));
      if (i > 0) relations.push({ from: `e${i - 1}`, to: `e${i}`, type: 'call' } as Relation);
    }
    const r = renderExport(entities, relations, { format: 'mermaid' });
    expect(r.relation_count).toBe(599);
    expect(r.warnings.join(' ')).toMatch(/599 edges > 500/);
    expect(r.warnings.join(' ')).toContain('--scope "src/ui/"');
    // Output is still produced (warning, not failure).
    expect(r.output.startsWith('graph LR')).toBe(true);
  });

  it('warns on text size alone', () => {
    const w = mermaidSizeWarnings('x'.repeat(60_000), [], 1);
    expect(w[0]).toMatch(/60,000 chars > 50,000/);
  });

  it('never warns for non-mermaid formats', () => {
    const entities = Array.from({ length: 800 }, (_, i) => entity(`e${i}`, `f${i}`));
    expect(renderExport(entities, [], { format: 'dot' }).warnings).toEqual([]);
  });
});

describe('writeFully', () => {
  it('resolves only after a slow consumer accepted every byte', async () => {
    let received = 0;
    const slow = new Writable({
      highWaterMark: 1024,
      write(chunk, _enc, cb) {
        received += chunk.length;
        setTimeout(cb, 1);
      },
    });
    const data = 'y'.repeat(256 * 1024);
    await writeFully(slow, data);
    expect(received).toBe(data.length);
  });

  it('treats EPIPE (reader went away) as success', async () => {
    const broken = new Writable({
      write(_chunk, _enc, cb) {
        const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
        cb(err);
      },
    });
    await expect(writeFully(broken, 'data')).resolves.toBeUndefined();
  });

  it('rejects other stream errors', async () => {
    const broken = new Writable({
      write(_chunk, _enc, cb) {
        cb(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
      },
    });
    await expect(writeFully(broken, 'data')).rejects.toThrow('disk full');
  });
});
