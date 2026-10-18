/**
 * Rule: functions that are hard to follow.
 *
 * Cognitive complexity > 15 (SonarSource S3776 default); falls back to
 * cyclomatic > 10 where the parser does not compute cognitive complexity.
 * When one file has more than `group_per_file` such functions they are
 * reported as one grouped finding (dedupe), with the summed penalty.
 */
import type { Entity } from '../../contracts/entities.js';
import type { HealthSeverity } from '../../contracts/health.js';
import { SEVERITY_POINTS } from '../config.js';
import type { Complexity, HealthContext } from '../context.js';
import {
  bandSeverity,
  buildFinding,
  buildFixPrompt,
  lineRange,
  makeFocus,
  round2,
  type HealthRule,
  type RawFinding,
} from '../finding.js';
import { complexityWords, plural, shortPath } from '../glossary.js';

interface Hit {
  entity: Entity;
  c: Complexity;
  severity: HealthSeverity;
}

const SEV_ORDER: HealthSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

export const complexFunctionRule: HealthRule = {
  kind: 'complex_function',
  run(ctx) {
    const out: RawFinding[] = [];
    for (const file of ctx.files) {
      const hits = complexHits(ctx, file);
      if (hits.length === 0) continue;
      if (hits.length > ctx.thresholds.complexity.group_per_file) out.push(groupFinding(ctx, file, hits));
      else for (const h of hits) out.push(singleFinding(ctx, h));
    }
    return out;
  },
};

export function complexHits(ctx: HealthContext, file: string): Hit[] {
  const hits: Hit[] = [];
  for (const entity of ctx.functionsIn(file)) {
    const c = ctx.complexity(entity);
    if (!c || c.value <= c.warn) continue;
    hits.push({ entity, c, severity: bandSeverity(c.value, c.warn, c.high, c.critical) });
  }
  return hits.sort((a, b) => b.c.value - a.c.value || a.entity.id.localeCompare(b.entity.id));
}

function why(c: Complexity, subject = 'It has'): string {
  const metric = c.metric === 'cognitive' ? 'nested decisions and branches' : 'separate paths through it';
  return (
    `${subject} a lot of ${metric} (score ${c.value}; above ${c.warn} is hard to follow). ` +
    'Code like this is where bugs hide, and where AI edits most often change behaviour by accident.'
  );
}

function reliedOn(ctx: HealthContext, file: string): string[] {
  const n = ctx.blast(file);
  return n > 0 ? [`${plural(n, 'file')} rely on ${file} directly or indirectly, so mistakes here spread.`] : [];
}

function effortFor(c: Complexity): 'S' | 'M' | 'L' {
  return c.value > c.critical ? 'L' : c.value > c.high ? 'M' : 'S';
}

function singleFinding(ctx: HealthContext, h: Hit): RawFinding {
  const { entity, c } = h;
  const lines = lineRange(entity.location.line_start, entity.location.line_end);
  return buildFinding(ctx, {
    kind: 'complex_function',
    category: 'complexity',
    target: entity.id,
    severity: h.severity,
    title: `${entity.name}() in ${shortPath(entity.file)} is ${complexityWords(c.value)}`,
    why: why(c),
    evidence: [
      {
        file: entity.file,
        line: entity.location.line_start,
        entity_id: entity.id,
        name: entity.name,
        numbers: { complexity: c.value, lines: entity.location.line_end - entity.location.line_start + 1 },
      },
    ],
    focus: makeFocus(ctx, {
      kind: 'entity',
      identifier: entity.qualified_name,
      overlay: 'complexity',
      entity_ids: [entity.id],
      files: [entity.file],
    }),
    prompt: buildFixPrompt({
      goal: `Make ${entity.name}() in ${entity.file} easier to follow by splitting it into smaller, well-named helper functions.`,
      files: [{ file: entity.file, lines, note: `${entity.name}()` }],
      facts: [
        `${entity.name}() has a complexity score of ${c.value} (above ${c.warn} is hard to follow).`,
        ...reliedOn(ctx, entity.file),
      ],
      steps: [
        `If there are no tests for ${entity.name}(), first add a few that pin down what it does today for the main cases.`,
        'Split out the separate jobs it does into small helper functions in the same file, with names that say what they do.',
        'Replace deep nesting with early returns where it keeps the logic identical.',
      ],
    }),
    effort: effortFor(c),
    impactFiles: [entity.file],
  });
}

function groupFinding(ctx: HealthContext, file: string, hits: Hit[]): RawFinding {
  const worst = hits[0];
  const severity = hits.reduce<HealthSeverity>(
    (s, h) => (SEV_ORDER.indexOf(h.severity) > SEV_ORDER.indexOf(s) ? h.severity : s),
    'low',
  );
  const points = hits.reduce((sum, h) => sum + SEVERITY_POINTS[h.severity], 0);
  const names = hits.slice(0, 5).map((h) => `${h.entity.name}() (${h.c.value})`);
  return buildFinding(ctx, {
    kind: 'complex_function',
    category: 'complexity',
    target: `group:${file}`,
    severity,
    title: `${plural(hits.length, 'function')} in ${shortPath(file)} are hard to follow`,
    why: why(worst.c, 'The worst one has'),
    evidence: hits.map((h) => ({
      file,
      line: h.entity.location.line_start,
      entity_id: h.entity.id,
      name: h.entity.name,
      numbers: { complexity: h.c.value },
    })),
    focus: makeFocus(ctx, {
      kind: 'file',
      identifier: file,
      overlay: 'complexity',
      entity_ids: hits.map((h) => h.entity.id),
      files: [file],
    }),
    prompt: buildFixPrompt({
      goal: `Make the hardest-to-follow functions in ${file} simpler, starting with ${worst.entity.name}().`,
      files: hits.slice(0, 5).map((h) => ({
        file,
        lines: lineRange(h.entity.location.line_start, h.entity.location.line_end),
        note: `${h.entity.name}()`,
      })),
      facts: [`Hard-to-follow functions (complexity score): ${names.join(', ')}.`],
      steps: [
        `Work on one function at a time, starting with ${worst.entity.name}(); stop after each one so I can review.`,
        'If a function has no tests, first add a few that pin down what it does today.',
        'Split each into small, well-named helpers in the same file and use early returns instead of deep nesting.',
      ],
    }),
    effort: hits.length > 6 ? 'L' : 'M',
    impactFiles: [file],
    points: round2(points),
  });
}
