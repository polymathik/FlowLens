/**
 * Rule: tangles — files that depend on each other in a loop.
 *
 * Uses the existing file-level cycle detector (Tarjan SCC) and adds an
 * ordered loop path for the explanation. Only runtime dependencies count
 * (Phase 12): loops made of type-only imports / type annotations are
 * reported separately as `type_cycle` design notes (see type-cycles.ts). Penalty is a per-file sum
 * (TANGLE_POINTS_PER_FILE × impact of each file in a tangle) so adding a
 * dependency can never lower it, even when two tangles merge into one.
 */
import { detectCycles } from '../../analysis/cycle-detector.js';
import type { HealthEvidence, HealthSeverity } from '../../contracts/health.js';
import { TANGLE_POINTS_PER_FILE } from '../config.js';
import type { HealthContext } from '../context.js';
import { buildFinding, buildFixPrompt, makeFocus, type HealthRule, type RawFinding } from '../finding.js';
import { plural, shortPath } from '../glossary.js';

export const cycleRule: HealthRule = {
  kind: 'cycle',
  async run(ctx) {
    const cycles = await detectCycles(ctx.store, { granularity: 'file' });
    const known = new Set(ctx.files);
    return cycles
      .map((c) => c.entities.filter((f) => known.has(f)).sort())
      .filter((members) => members.length > 1)
      .map((members) => tangleFinding(ctx, members));
  },
};

function tangleFinding(ctx: HealthContext, members: string[]): RawFinding {
  const loop = orderedLoop(ctx, members);
  const blast = Math.max(...members.map((f) => ctx.blast(f)));
  const severity = tangleSeverity(members.length, blast, ctx.files.length);
  const evidence: HealthEvidence[] = [];
  for (let i = 0; i < loop.length - 1; i++) {
    const site = ctx.runtimeSites.get(`${loop[i]}->${loop[i + 1]}`);
    evidence.push({
      file: loop[i],
      line: site?.line,
      note: `uses ${loop[i + 1]}${site ? ` (line ${site.line})` : ''}`,
    });
  }
  const pretty = loop.map(shortPath).join(' → ');
  const title =
    members.length === 2
      ? `Tangle: ${shortPath(members[0])} and ${shortPath(members[1])} depend on each other`
      : `Tangle: ${plural(members.length, 'file')} depend on each other in a loop`;
  const extra = members.length > 2 ? ` (${members.length} files: ${pretty})` : '';
  return buildFinding(ctx, {
    kind: 'cycle',
    category: 'tangles',
    target: members.join('|'),
    severity,
    title,
    why:
      `These files depend on each other in a loop${extra}, so a change in one can ripple into all of them. ` +
      'This is a common reason an AI fix in one place breaks something somewhere else.',
    evidence,
    focus: makeFocus(ctx, { kind: 'file', identifier: members[0], overlay: 'cycles', files: members }),
    prompt: buildFixPrompt({
      goal: `Break the dependency loop between these files so dependencies only go one way: ${loop.join(' → ')}.`,
      files: members.map((f) => ({ file: f })),
      facts: [
        `The loop is: ${loop.join(' → ')}.`,
        ...evidence.map((e) => `${e.file} ${e.note}.`),
        ...(blast > 0 ? [`${plural(blast, 'other file')} rely on these files directly or indirectly.`] : []),
      ],
      steps: [
        'Look at what each file uses from the next one in the loop (the lines listed above).',
        'Pick the smallest piece that causes the loop and move it into a new, small shared file that the others import, or pass it in as a parameter instead of importing it.',
        'Check that none of these files import each other in a loop any more.',
      ],
    }),
    effort: members.length === 2 ? 'S' : members.length <= 4 ? 'M' : 'L',
    impactFiles: members,
    penalty: TANGLE_POINTS_PER_FILE * members.reduce((sum, f) => sum + ctx.impact(f), 0),
  });
}

/** Severity grows with tangle size and with how much of the project relies on it. */
export function tangleSeverity(size: number, blast: number, totalFiles: number): HealthSeverity {
  if (size >= 6 || (totalFiles >= 10 && blast / totalFiles >= 0.5)) return 'critical';
  if (size >= 3 || blast >= 5) return 'high';
  return 'medium';
}

/**
 * A shortest loop through the first member (BFS inside the tangle), as an
 * ordered path ending where it started: [a, b, c, a].
 */
export function orderedLoop(
  ctx: HealthContext,
  members: string[],
  deps: Map<string, Set<string>> = ctx.runtimeDeps,
): string[] {
  const inside = new Set(members);
  const start = members[0];
  const prev = new Map<string, string>();
  const queue: string[] = [start];
  const seen = new Set<string>([start]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of [...(deps.get(cur) ?? [])].sort()) {
      if (!inside.has(next)) continue;
      if (next === start) {
        const path = [cur];
        while (path[0] !== start) path.unshift(prev.get(path[0])!);
        return [...path, start];
      }
      if (!seen.has(next)) {
        seen.add(next);
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }
  return [...members, start];
}
