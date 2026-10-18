/**
 * Rule: type-only loops (Phase 12) — files that form a loop only because of
 * `import type` lines or type annotations. These have no runtime effect (the
 * types are erased), so they are `info` design notes with no score penalty;
 * real runtime loops are the `cycle` rule's job.
 */
import { detectCycles } from '../../analysis/cycle-detector.js';
import type { HealthEvidence } from '../../contracts/health.js';
import type { HealthContext } from '../context.js';
import { buildFinding, buildFixPrompt, makeFocus, type HealthRule, type RawFinding } from '../finding.js';
import { plural, shortPath } from '../glossary.js';
import { orderedLoop } from './cycles.js';

export const typeCycleRule: HealthRule = {
  kind: 'type_cycle',
  async run(ctx) {
    const cycles = await detectCycles(ctx.store, { granularity: 'file', include_type_only: true });
    const known = new Set(ctx.files);
    return cycles
      .filter((c) => c.type_only)
      .map((c) => c.entities.filter((f) => known.has(f)).sort())
      .filter((members) => members.length > 1)
      .map((members) => typeLoopFinding(ctx, members));
  },
};

function typeLoopFinding(ctx: HealthContext, members: string[]): RawFinding {
  const loop = orderedLoop(ctx, members, ctx.fileDeps);
  const evidence: HealthEvidence[] = [];
  for (let i = 0; i < loop.length - 1; i++) {
    const key = `${loop[i]}->${loop[i + 1]}`;
    const runtime = ctx.runtimeSites.get(key);
    const site = runtime ?? ctx.depSites.get(key);
    const how = runtime ? 'uses' : 'uses only types from';
    evidence.push({ file: loop[i], line: site?.line, note: `${how} ${loop[i + 1]}${site ? ` (line ${site.line})` : ''}` });
  }
  const title =
    members.length === 2
      ? `Type loop: ${shortPath(members[0])} and ${shortPath(members[1])} share types both ways`
      : `Type loop: ${plural(members.length, 'file')} share types in a loop`;
  return buildFinding(ctx, {
    kind: 'type_cycle',
    category: 'tangles',
    target: members.join('|'),
    severity: 'info',
    title,
    why:
      'These files only borrow type definitions from each other, which disappears when the app runs, so it is not a real tangle. ' +
      'Moving the shared types into their own file keeps the design easier to follow.',
    evidence,
    focus: makeFocus(ctx, { kind: 'file', identifier: members[0], overlay: 'cycles', files: members }),
    prompt: buildFixPrompt({
      goal: `Move the shared type definitions out of this loop so the files only depend one way: ${loop.join(' → ')}.`,
      files: members.map((f) => ({ file: f })),
      facts: [`The loop is: ${loop.join(' → ')}.`, ...evidence.map((e) => `${e.file} ${e.note}.`)],
      steps: [
        'Find the type definitions (interfaces / type aliases) that the files borrow from each other.',
        'Move them into a small types-only file that both sides import with `import type`.',
        'This is a tidy-up only: nothing changes when the app runs.',
      ],
    }),
    effort: 'S',
    impactFiles: members,
    penalty: 0,
  });
}
