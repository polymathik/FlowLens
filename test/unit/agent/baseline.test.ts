import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attributeCycles,
  loadBaseline,
  makeBaseline,
  saveBaseline,
} from '../../../src/agent/baseline.js';
import { buildAgentGuardReport, shouldBlock } from '../../../src/agent/guard.js';
import { computeGraphDigest } from '../../../src/agent/digest.js';
import { graphFromDigest } from '../../../src/agent/guard-graph.js';
import { buildContextFromDigest } from '../../../src/agent/context-builder.js';
import type { AgentCycleReference } from '../../../src/contracts/agent.js';
import { entity, makeGraph, relation } from './helpers.js';

const cycle = (entities: string[]): AgentCycleReference => ({
  id: entities.join('|'), granularity: 'file', severity: 'low', entities, relation_types: ['import'], length: entities.length,
});

describe('strict-mode baseline attribution', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'flowlens-baseline-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('treats equal or shrunk cycles as pre-existing and grown/new cycles as new', () => {
    const baseline = makeBaseline('abc', 'session_start', [['a.ts', 'b.ts', 'c.ts']], []);
    const result = attributeCycles([
      cycle(['a.ts', 'b.ts', 'c.ts']),
      cycle(['a.ts', 'b.ts']),
      cycle(['a.ts', 'b.ts', 'c.ts', 'd.ts']),
      cycle(['x.ts', 'y.ts']),
    ], baseline);
    expect(result.preexisting.map((c) => c.id)).toEqual(['a.ts|b.ts|c.ts', 'a.ts|b.ts']);
    expect(result.fresh.map((c) => c.id)).toEqual(['a.ts|b.ts|c.ts|d.ts', 'x.ts|y.ts']);
    expect(attributeCycles([cycle(['x.ts', 'y.ts'])], null).fresh).toHaveLength(1);
  });

  it('stores baselines keyed by git HEAD (or no-git) and keeps only recent ones', async () => {
    for (let i = 0; i < 7; i++) {
      await saveBaseline(tmp, { ...makeBaseline(`head${i}`, 'guard', [], []), created_at: `2026-10-18T00:00:0${i}.000Z` });
    }
    await saveBaseline(tmp, makeBaseline(null, 'manual', [['a', 'b']], ['v1']));
    expect(await loadBaseline(tmp, 'head0')).toBeNull();
    expect((await loadBaseline(tmp, 'head6'))?.source).toBe('guard');
    expect((await loadBaseline(tmp, null))?.violation_ids).toEqual(['v1']);
  });

  it('does not block on a pre-existing cycle but reports it as context', async () => {
    const graph = makeGraph();
    const baseline = makeBaseline('h', 'session_start', [['src/data/user-repo.ts', 'src/services/user-service.ts']], []);
    const report = await buildAgentGuardReport(graph, {
      changed_files: ['src/services/user-service.ts'],
      baseline,
    }, { flowlensDir: tmp });
    expect(report.cycles).toEqual([]);
    expect(report.preexisting_cycles).toHaveLength(1);
    expect(report.risk).toBe('medium');
    expect(report.attribution?.mode).toBe('baseline');
    expect(shouldBlock(report)).toBe(false);
  });

  it('blocks on a cycle introduced after the baseline', async () => {
    const graph = makeGraph();
    const baseline = makeBaseline('h', 'session_start', [['src/data/user-repo.ts', 'src/services/user-service.ts']], []);
    await graph.putNode(entity('file:new', 'file', 'new.ts', 'src/new.ts'));
    await graph.putEdge(relation('r9', 'file:new', 'file:service', 'src/new.ts'));
    await graph.putEdge(relation('r10', 'file:service', 'file:new', 'src/services/user-service.ts'));
    const report = await buildAgentGuardReport(graph, { changed_files: ['src/new.ts'], baseline }, { flowlensDir: tmp });
    expect(report.risk).toBe('high');
    expect(report.cycles[0]?.entities).toContain('src/new.ts');
    expect(shouldBlock(report)).toBe(true);
  });

  it('digest round-trips into an equivalent in-memory graph and context', async () => {
    const digest = await computeGraphDigest(makeGraph(), tmp);
    expect(digest.cycle_keys).toEqual([['src/data/user-repo.ts', 'src/services/user-service.ts']]);
    const view = graphFromDigest(digest);
    expect((await view.getAllNodes()).map((n) => n.id).sort()).toEqual(['file:repo', 'file:service', 'repo', 'svc']);
    expect(await view.getAllEdges()).toHaveLength(3);
    const packet = buildContextFromDigest(digest, { event: 'prompt_submit', prompt: 'UserRepo' }, 'cache');
    expect(packet.relevant_entities[0]?.name).toBe('UserRepo');
    expect(packet.digest?.source).toBe('cache');
  });
});
