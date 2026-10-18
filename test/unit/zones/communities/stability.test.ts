/**
 * Stability benchmark: 20 random one-file edits (add / remove a few edges, add a file, delete a file) in a row.
 * Each edit is zoned warm (from the previous result) and cold (from scratch); we count the share of files
 * whose community changed. The numbers are printed so the plan log can quote them.
 */
import { describe, it, expect } from 'vitest';
import { assignmentOf, changedByKey, changedByOverlap, halcyonCorpus, importRelation, randomEdit, rng, synthProject, toHierarchy, zoneRun, type Corpus } from './synth.js';
import { computeZones } from '../../../../src/analysis/zones/index.js';

const median = (x: number[]): number => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
const mean = (x: number[]): number => x.reduce((a, b) => a + b, 0) / x.length;
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

interface Series { warm: number[]; coldOverlap: number[]; coldKey: number[] }

function run(start: Corpus, seed: number, edits = 20): Series {
  const rnd = rng(seed);
  let corpus = start;
  let previous = zoneRun(start).assignment;
  const out: Series = { warm: [], coldOverlap: [], coldKey: [] };
  for (let i = 0; i < edits; i++) {
    const { next } = randomEdit(corpus, rnd);
    const warm = zoneRun(next, previous).assignment;
    const coldBefore = zoneRun(corpus).assignment;
    const coldAfter = zoneRun(next).assignment;
    out.warm.push(changedByKey(previous, warm));
    out.coldKey.push(changedByKey(coldBefore, coldAfter));
    out.coldOverlap.push(changedByOverlap(coldBefore, coldAfter));
    corpus = next;
    previous = warm;
  }
  return out;
}

function report(name: string, files: number, s: Series): void {
  const line = (label: string, x: number[]): string => `${label}: median ${pct(median(x))} mean ${pct(mean(x))} max ${pct(Math.max(...x))}`;
  console.info(`[stability] ${name} (${files} files, ${s.warm.length} edits)\n  warm start  ${line('keys', s.warm)}\n  cold start  ${line('keys', s.coldKey)} | ${line('overlap-matched', s.coldOverlap)}`);
}

const MESSY = [
  { clusters: 8, min: 10, max: 20, seed: 7, noise: 0.25, scatter: 0.35, degree: 1 },
  { clusters: 7, min: 14, max: 24, seed: 11, noise: 0.3, scatter: 0.5, degree: 1 },
  { clusters: 9, min: 8, max: 18, seed: 23, noise: 0.2, scatter: 0.2, degree: 2 },
];

describe('community stability under one-file edits', () => {
  for (const [i, spec] of MESSY.entries()) {
    it(`synthetic messy project #${i + 1}: median share of files changing community is below 5% (warm start)`, () => {
      const start = synthProject(spec);
      const s = run(start, 100 + i);
      report(`synthetic #${i + 1}`, start.entities.filter((e) => e.kind === 'file').length, s);
      expect(median(s.warm)).toBeLessThan(0.05);
      expect(mean(s.warm)).toBeLessThan(0.05);
      expect(Math.max(...s.warm)).toBeLessThan(0.2);
      expect(mean(s.warm)).toBeLessThanOrEqual(mean(s.coldKey));
    });
  }

  const halcyon = halcyonCorpus();
  for (const seed of [1, 2, 3]) {
    it.skipIf(!halcyon)(`Halcyon export, edit sequence ${seed}: median below 5% (warm start)`, () => {
      const s = run(halcyon!, seed);
      report(`halcyon seq ${seed}`, 122, s);
      expect(median(s.warm)).toBeLessThan(0.05);
      expect(mean(s.warm)).toBeLessThan(0.05);
      expect(Math.max(...s.warm)).toBeLessThan(0.2);
    });
  }

  it('a batch of ten edits at once (a re-index after a bigger change) still moves under 15% of the files', () => {
    const start = synthProject(MESSY[0]);
    const before = zoneRun(start).assignment;
    const rnd = rng(5);
    let corpus = start;
    for (let i = 0; i < 10; i++) corpus = randomEdit(corpus, rnd).next;
    expect(changedByKey(before, zoneRun(corpus, before).assignment)).toBeLessThan(0.15);
  });

  it('is not frozen: a file whose dependencies all move to another community follows them', () => {
    const start = synthProject({ clusters: 4, min: 14, max: 16, seed: 2, noise: 0.02 });
    const before = zoneRun(start).assignment;
    const mover = Object.keys(before).find((p) => p.startsWith('src/auth/'))!;
    const target = Object.keys(before).filter((p) => p.startsWith('src/billing/'));
    const dropped = new Set(start.relations.filter((r) => r.from === `f:${mover}` || r.to === `f:${mover}`).map((r) => r.id));
    const corpus: Corpus = {
      ...start,
      relations: [...start.relations.filter((r) => !dropped.has(r.id)), ...target.slice(0, 7).flatMap((t) => [importRelation(mover, t), importRelation(t, mover)])],
    };
    const after = zoneRun(corpus, before).assignment;
    expect(after[mover]).toBe(before[target[0]]);
    expect(changedByKey(before, after)).toBeLessThan(0.05);
  });

  it('survives a reload: re-zoning an unchanged graph from its own assignment reproduces it exactly', () => {
    const start = synthProject(MESSY[1]);
    const first = zoneRun(start);
    const again = zoneRun(start, first.assignment);
    expect(again.assignment).toEqual(first.assignment);
    expect(again.set.zones.map((z) => [z.key, z.label])).toEqual(first.set.zones.map((z) => [z.key, z.label]));
  });

  it('keeps labels of matched communities (read back from the key) while a fresh run may name them differently', () => {
    const start = synthProject(MESSY[0]);
    const first = zoneRun(start);
    const rnd = rng(1);
    const edited = randomEdit(start, rnd).next;
    const warm = zoneRun(edited, first.assignment).set;
    const labelOf = (set: typeof warm, key: string): string | undefined => set.zones.find((z) => z.key === key)?.label;
    for (const z of first.set.zones.filter((x) => x.source === 'community')) {
      const l = labelOf(warm, z.key);
      if (l !== undefined) expect(l).toBe(z.label);
    }
  });

  it('scope views read the stored assignment of the whole package without moving files', () => {
    const start = synthProject(MESSY[2]);
    const { h, graph } = toHierarchy(start);
    const full = computeZones({ mode: 'communities', hierarchy: h, fileGraph: graph });
    const asg = assignmentOf(full, h);
    const sub = computeZones({ mode: 'communities', hierarchy: h, fileGraph: graph, scopeId: 'src', previousAssignment: asg });
    const subAsg = assignmentOf(sub, h);
    const moved = Object.keys(subAsg).filter((p) => p.startsWith('src/') && subAsg[p] !== asg[p]).length;
    expect(moved / Object.keys(subAsg).length).toBeLessThan(0.1);
  });
});
