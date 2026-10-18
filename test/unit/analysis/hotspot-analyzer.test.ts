import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeHotspots } from '../../../src/analysis/hotspot-analyzer.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import type { FileChurnData } from '../../../src/contracts/analysis/churn.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeEntity(id: string, name: string, file: string, cc = 0) {
  return { id, kind: 'function' as const, name, qualified_name: `${file}/${name}`, file, location: { line_start: 1, line_end: 10, column_start: 0, column_end: 0 }, visibility: 'public' as const, language: 'typescript', metrics: { line_count: 10, cognitive_complexity: cc } };
}

describe('HotspotAnalyzer', () => {
  let store: LevelGraphStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-hs-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('computes hotspot_score as churn_rate × complexity', async () => {
    await store.putNode(makeEntity('a', 'funcA', 'src/a.ts', 10));
    const churn = new Map<string, FileChurnData>([
      ['src/a.ts', { file: 'src/a.ts', change_count: 20, period_days: 90, churn_rate: 0.222, last_changed: '' }],
    ]);
    const hotspots = await computeHotspots(store, churn);
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0].hotspot_score).toBeCloseTo(0.222 * 10, 2);
  });

  it('sorts by hotspot_score descending', async () => {
    await store.putNodes([
      makeEntity('a', 'low', 'src/a.ts', 2),
      makeEntity('b', 'high', 'src/b.ts', 20),
    ]);
    const churn = new Map<string, FileChurnData>([
      ['src/a.ts', { file: 'src/a.ts', change_count: 10, period_days: 90, churn_rate: 0.111, last_changed: '' }],
      ['src/b.ts', { file: 'src/b.ts', change_count: 10, period_days: 90, churn_rate: 0.111, last_changed: '' }],
    ]);
    const hotspots = await computeHotspots(store, churn);
    expect(hotspots[0].entity_name).toBe('high');
  });

  it('filters by entity kind', async () => {
    await store.putNodes([
      makeEntity('a', 'func', 'src/a.ts', 5),
      { ...makeEntity('b', 'cls', 'src/a.ts', 5), kind: 'class' as const },
    ]);
    const churn = new Map<string, FileChurnData>([['src/a.ts', { file: 'src/a.ts', change_count: 10, period_days: 90, churn_rate: 0.111, last_changed: '' }]]);
    const hotspots = await computeHotspots(store, churn, { kind: 'function' });
    expect(hotspots).toHaveLength(1);
  });

  it('respects max_results', async () => {
    await store.putNodes([
      makeEntity('a', 'f1', 'src/a.ts', 10),
      makeEntity('b', 'f2', 'src/b.ts', 20),
      makeEntity('c', 'f3', 'src/c.ts', 30),
    ]);
    const churn = new Map<string, FileChurnData>([
      ['src/a.ts', { file: 'src/a.ts', change_count: 10, period_days: 90, churn_rate: 0.1, last_changed: '' }],
      ['src/b.ts', { file: 'src/b.ts', change_count: 10, period_days: 90, churn_rate: 0.1, last_changed: '' }],
      ['src/c.ts', { file: 'src/c.ts', change_count: 10, period_days: 90, churn_rate: 0.1, last_changed: '' }],
    ]);
    const hotspots = await computeHotspots(store, churn, { max_results: 2 });
    expect(hotspots).toHaveLength(2);
  });

  it('skips entities with no complexity', async () => {
    await store.putNode(makeEntity('a', 'simple', 'src/a.ts', 0));
    const churn = new Map<string, FileChurnData>([['src/a.ts', { file: 'src/a.ts', change_count: 100, period_days: 90, churn_rate: 1.11, last_changed: '' }]]);
    const hotspots = await computeHotspots(store, churn);
    expect(hotspots).toHaveLength(0);
  });
  it('omits score-0 entities unless include_zero, and carries churn details', async () => {
    await store.putNodes([makeEntity('a', 'churned', 'src/a.ts', 5), makeEntity('b', 'still', 'src/b.ts', 50)]);
    const churn = new Map<string, FileChurnData>([
      ['src/a.ts', { file: 'src/a.ts', change_count: 3, period_days: 90, churn_rate: 3 / 90, last_changed: '2026-10-01T00:00:00Z' }],
    ]);
    const hot = await computeHotspots(store, churn);
    expect(hot.map((h) => h.entity_id)).toEqual(['a']);
    expect(hot[0]).toMatchObject({ change_count: 3, last_changed: '2026-10-01T00:00:00Z', qualified_name: 'src/a.ts/churned' });
    const all = await computeHotspots(store, churn, { include_zero: true });
    expect(all.map((h) => h.entity_id)).toEqual(['a', 'b']);
  });
});
