/**
 * Rule: boundary violations — code reaching into a part of the app that
 * `.flowlens/architecture.json` says it should not use. Uses the existing
 * architecture validator; one finding per (source file, target file, rule).
 */
import { validateArchitecture } from '../../analysis/architecture-validator.js';
import type { ArchitectureViolation } from '../../contracts/analysis/architecture.js';
import { BOUNDARY_MAX_EDGES_PER_PAIR, BOUNDARY_POINTS_PER_EDGE } from '../config.js';
import type { HealthContext } from '../context.js';
import { buildFinding, buildFixPrompt, makeFocus, type HealthRule, type RawFinding } from '../finding.js';
import { shortPath } from '../glossary.js';

export const boundaryRule: HealthRule = {
  kind: 'boundary_violation',
  async run(ctx) {
    const arch = ctx.input.architecture;
    if (!arch || arch.layers.length === 0) return [];
    const violations = await validateArchitecture(ctx.store, arch);
    const groups = new Map<string, { from: string; to: string; list: ArchitectureViolation[] }>();
    for (const v of violations) {
      const from = ctx.entityById.get(v.entity_from)?.file;
      const to = ctx.entityById.get(v.entity_to)?.file;
      if (!from || !to || from === to) continue;
      const key = `${from}->${to}:${v.rule}`;
      (groups.get(key) ?? groups.set(key, { from, to, list: [] }).get(key)!).list.push(v);
    }
    return [...groups.keys()].sort().map((key) => {
      const g = groups.get(key)!;
      return violationFinding(ctx, key, g.from, g.to, g.list);
    });
  },
};

function violationFinding(
  ctx: HealthContext,
  key: string,
  from: string,
  to: string,
  list: ArchitectureViolation[],
): RawFinding {
  const v = list.sort((a, b) => a.location.line - b.location.line)[0];
  const forbidden = v.rule === 'must_not_access';
  const allowed = ctx.input.architecture?.layers.find((l) => l.name === v.layer_from)?.may_only_access ?? [];
  const ruleText = forbidden
    ? `"${v.layer_from}" must not use "${v.layer_to}"`
    : `"${v.layer_from}" may only use ${allowed.length > 0 ? allowed.map((a) => `"${a}"`).join(', ') : 'nothing else'}`;
  const count = Math.min(list.length, BOUNDARY_MAX_EDGES_PER_PAIR);
  const lines = [...new Set(list.map((x) => x.location.line))].sort((a, b) => a - b);
  return buildFinding(ctx, {
    kind: 'boundary_violation',
    category: 'structure',
    target: key,
    severity: forbidden ? 'high' : 'medium',
    title: `${shortPath(from)} (${v.layer_from}) reaches into ${shortPath(to)} (${v.layer_to})`,
    why:
      `Your architecture rules say ${ruleText}, but this file uses it directly. ` +
      'Shortcuts like this make parts of the app depend on each other in ways that are easy to break later.',
    evidence: list.slice(0, 5).map((x) => ({
      file: from,
      line: x.location.line,
      entity_id: x.entity_from,
      name: targetName(ctx, x.entity_to),
      note: `uses ${to} (${x.relation_type})`,
    })),
    focus: makeFocus(ctx, { kind: 'file', identifier: from, overlay: 'violations', files: [from, to] }),
    prompt: buildFixPrompt({
      goal: `Remove the direct dependency from ${from} (the "${v.layer_from}" part of the app) on ${to} (the "${v.layer_to}" part).`,
      files: [
        { file: from, lines: lines.slice(0, 5).join(', '), note: `"${v.layer_from}"` },
        { file: to, note: `"${v.layer_to}"` },
      ],
      facts: [
        `Architecture rule: ${ruleText}.`,
        `${from} uses ${to} on line(s) ${lines.slice(0, 5).join(', ')}.`,
        v.auto_fix_suggestion ? `Suggested direction: ${v.auto_fix_suggestion.replace(/\.$/, '')}.` : 'Go through an allowed part of the app instead.',
      ],
      steps: [
        allowed.length > 0
          ? `Call ${to}'s functionality through the allowed part of the app (${allowed.join(', ')}) — add a small function there if one does not exist yet.`
          : `Move the piece that ${from} needs into a shared place both are allowed to use, or pass it in from the caller.`,
        `Update ${from} to use that instead of importing ${to}.`,
      ],
    }),
    effort: list.length > 3 ? 'M' : 'S',
    impactFiles: [from],
    points: BOUNDARY_POINTS_PER_EDGE * count,
  });
}

function targetName(ctx: HealthContext, id: string): string | undefined {
  const e = ctx.entityById.get(id);
  return e && e.kind !== 'file' ? e.name : undefined;
}
