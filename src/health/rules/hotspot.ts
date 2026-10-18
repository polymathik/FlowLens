/**
 * Rule: hotspots — hard-to-follow code that also changes often
 * (CodeScene's hotspot idea: change frequency × complexity). Uses the
 * existing hotspot analyzer per function, then reports one finding per file.
 * Without git history this rule reports nothing and a caveat explains why.
 */
import { computeHotspots } from '../../analysis/hotspot-analyzer.js';
import type { HotspotEntry } from '../../contracts/analysis/hotspots.js';
import type { HealthSeverity } from '../../contracts/health.js';
import type { HealthContext } from '../context.js';
import { buildFinding, buildFixPrompt, makeFocus, type HealthRule, type RawFinding } from '../finding.js';
import { plural, shortPath } from '../glossary.js';

export const hotspotRule: HealthRule = {
  kind: 'hotspot',
  async run(ctx) {
    const churn = ctx.input.churn;
    if (!churn || churn.size === 0) return [];
    const t = ctx.thresholds.change;
    const entries = await computeHotspots(ctx.store, churn);
    const byFile = new Map<string, HotspotEntry[]>();
    for (const e of entries) {
      if (e.entity_kind !== 'function' && e.entity_kind !== 'method') continue;
      (byFile.get(e.file) ?? byFile.set(e.file, []).get(e.file)!).push(e);
    }
    const out: RawFinding[] = [];
    for (const file of [...byFile.keys()].sort()) {
      const changes = ctx.changes(file);
      const list = byFile.get(file)!.sort((a, b) => b.cognitive_complexity - a.cognitive_complexity || a.entity_id.localeCompare(b.entity_id));
      const top = list[0];
      if (changes < t.hotspot_min_changes || top.cognitive_complexity <= t.hotspot_min_complexity) continue;
      out.push(hotspotFinding(ctx, file, changes, list.filter((e) => e.cognitive_complexity > t.hotspot_min_complexity)));
    }
    return out;
  },
};

function hotspotFinding(ctx: HealthContext, file: string, changes: number, list: HotspotEntry[]): RawFinding {
  const top = list[0];
  const score = changes * top.cognitive_complexity;
  const severity: HealthSeverity = score >= 300 ? 'critical' : score >= 100 ? 'high' : 'medium';
  const days = ctx.input.churn?.get(file)?.period_days ?? ctx.thresholds.change.period_days;
  const entity = ctx.entityById.get(top.entity_id);
  return buildFinding(ctx, {
    kind: 'hotspot',
    category: 'change_risk',
    target: file,
    severity,
    title: `${shortPath(file)} changes often and is hard to follow`,
    why:
      `It changed ${plural(changes, 'time')} in the last ${days} days and ${top.entity_name}() is hard to follow. ` +
      'Code that is both busy and tangled is where new bugs are most likely to appear.',
    evidence: list.slice(0, 5).map((e) => ({
      file,
      line: ctx.entityById.get(e.entity_id)?.location.line_start,
      entity_id: e.entity_id,
      name: e.entity_name,
      numbers: { complexity: e.cognitive_complexity, changes },
    })),
    focus: makeFocus(ctx, {
      kind: 'file',
      identifier: file,
      overlay: 'hotspot',
      entity_ids: list.map((e) => e.entity_id),
      files: [file],
    }),
    prompt: buildFixPrompt({
      goal: `Make ${top.entity_name}() in ${file} simpler, because this file changes often and keeps being edited.`,
      files: [
        {
          file,
          lines: entity ? `${entity.location.line_start}–${entity.location.line_end}` : undefined,
          note: `${top.entity_name}()`,
        },
      ],
      facts: [
        `${file} changed ${plural(changes, 'time')} in the last ${days} days.`,
        `Its hardest-to-follow functions: ${list.slice(0, 3).map((e) => `${e.entity_name}() (score ${e.cognitive_complexity})`).join(', ')}.`,
      ],
      steps: [
        `Add a few tests that pin down what ${top.entity_name}() does today, if there are none.`,
        'Split it into small, well-named helpers so the next change only touches one of them.',
      ],
    }),
    effort: top.cognitive_complexity > 25 ? 'M' : 'S',
    impactFiles: [file],
  });
}
