/**
 * Rule: fragile hubs — files many others rely on that are themselves
 * risky to change (they depend on many files, contain hard-to-follow code,
 * or change often). Hub bar = max(8 files, 20% of files) direct dependents.
 */
import type { HealthSeverity } from '../../contracts/health.js';
import type { HealthContext } from '../context.js';
import { buildFinding, buildFixPrompt, makeFocus, type HealthRule } from '../finding.js';
import { plural, shortPath } from '../glossary.js';

export function hubBar(ctx: HealthContext): number {
  const t = ctx.thresholds.coupling;
  return Math.max(t.hub_min_dependents, Math.ceil(t.hub_min_dependents_share * ctx.files.length));
}

export const fragileHubRule: HealthRule = {
  kind: 'fragile_hub',
  run(ctx) {
    const t = ctx.thresholds;
    const bar = hubBar(ctx);
    return ctx.files.flatMap((file) => {
      const dependents = [...(ctx.fileDependents.get(file) ?? [])].sort();
      if (dependents.length < bar) return [];
      const outgoing = ctx.fileDeps.get(file)?.size ?? 0;
      const maxComplexity = Math.max(0, ...ctx.functionsIn(file).map((e) => ctx.complexity(e)?.value ?? 0));
      const changes = ctx.changes(file);
      const reasons: string[] = [];
      if (outgoing >= t.coupling.hub_min_outgoing) reasons.push(`it depends on ${plural(outgoing, 'other file')} itself`);
      if (maxComplexity > t.coupling.hub_complexity) reasons.push('it contains hard-to-follow code');
      if (changes >= t.change.hotspot_min_changes) reasons.push(`it changed ${plural(changes, 'time')} recently`);
      if (reasons.length === 0) return [];

      const blast = ctx.blast(file);
      const severity: HealthSeverity = blast / Math.max(1, ctx.files.length) >= 0.5 ? 'critical' : 'high';
      return [
        buildFinding(ctx, {
          kind: 'fragile_hub',
          category: 'coupling',
          target: file,
          severity,
          title: `${plural(dependents.length, 'file')} rely on ${shortPath(file)}, and it is fragile`,
          why:
            `Many parts of the app rely on this file, and ${reasons.join(' and ')}. ` +
            'A small mistake here can break many features at once.',
          evidence: [
            {
              file,
              numbers: { direct_dependents: dependents.length, all_dependents: blast, depends_on: outgoing, max_complexity: maxComplexity, changes },
            },
            ...dependents.slice(0, 8).map((d) => ({ file: d, line: ctx.depSites.get(`${d}->${file}`)?.line, note: 'relies on it' })),
          ],
          focus: makeFocus(ctx, { kind: 'file', identifier: file, overlay: 'hotspot', files: [file, ...dependents] }),
          prompt: buildFixPrompt({
            goal: `Make ${file} safer to change, because ${plural(dependents.length, 'file')} rely on it.`,
            files: [{ file, note: `relied on by ${plural(dependents.length, 'file')}` }],
            facts: [
              `${plural(dependents.length, 'file')} import ${file} directly (${plural(blast, 'file')} directly or indirectly).`,
              `It is risky because ${reasons.join(' and ')}.`,
              `Some files that rely on it: ${dependents.slice(0, 5).join(', ')}.`,
            ],
            steps: [
              `List what the other files actually use from ${file} (its public surface).`,
              'Keep that surface exactly as it is. Behind it, move unrelated or hard-to-follow parts into separate files, and remove dependencies it does not need.',
              `If ${file} has no tests, add a few for the functions other files use most before changing anything.`,
            ],
          }),
          effort: dependents.length >= 2 * bar ? 'L' : 'M',
          impactFiles: [file],
        }),
      ];
    });
  },
};
