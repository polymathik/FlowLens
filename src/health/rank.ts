/**
 * Ranking: rank_score = penalty × change factor.
 *
 * penalty already folds in severity (base points) and blast radius (impact
 * multiplier 1–2×). The change factor (1–2×) boosts places that changed
 * often in git history, so busy risky code comes first. Ties break by
 * severity, then id, so output order is fully deterministic.
 */
import type { HealthFinding, HealthNextStep, HealthSeverity } from '../contracts/health.js';
import type { HealthContext } from './context.js';
import { round2, type RawFinding } from './finding.js';

const SEV_RANK: Record<HealthSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function changeFactor(ctx: HealthContext, files: string[]): number {
  const max = Math.max(0, ...files.map((f) => ctx.changes(f)));
  return 1 + Math.min(1, max / ctx.thresholds.change.change_saturation);
}

export function rankFindings(ctx: HealthContext, raw: RawFinding[]): HealthFinding[] {
  const scored = raw.map((f) => ({
    ...f,
    rank: 0,
    rank_score: round2(f.penalty * changeFactor(ctx, f.focus.files)),
  }));
  scored.sort(
    (a, b) =>
      b.rank_score - a.rank_score ||
      SEV_RANK[b.severity] - SEV_RANK[a.severity] ||
      a.id.localeCompare(b.id),
  );
  scored.forEach((f, i) => (f.rank = i + 1));
  linkRelated(scored);
  return scored;
}

/** Findings whose primary file is the same point at each other (god file + fragile hub, …). */
function linkRelated(findings: HealthFinding[]): void {
  const byFile = new Map<string, HealthFinding[]>();
  for (const f of findings) {
    const primary = f.focus.files[0];
    if (!primary) continue;
    (byFile.get(primary) ?? byFile.set(primary, []).get(primary)!).push(f);
  }
  for (const group of byFile.values()) {
    if (group.length < 2) continue;
    for (const f of group) f.related_ids = group.filter((g) => g.id !== f.id).map((g) => g.id);
  }
}

const VERBS: Record<HealthFinding['kind'], string> = {
  cycle: 'Untangle',
  type_cycle: 'Optionally untangle types',
  god_file: 'Split up',
  fragile_hub: 'Make safer to change',
  complex_function: 'Simplify',
  hotspot: 'Simplify (changes often)',
  boundary_violation: 'Reroute',
  large_file: 'Shorten',
  orphan_module: 'Check if still needed',
  unresolved_imports: 'Check imports',
};

/** Top 3 actionable (non-info) findings as plain next steps. */
export function nextSteps(findings: HealthFinding[]): HealthNextStep[] {
  const steps = findings
    .filter((f) => f.severity !== 'info')
    .slice(0, 3)
    .map((f) => ({
      finding_id: f.id,
      action: `${VERBS[f.kind]}: ${f.title.replace(/^(Tangle|Type loop): /, '')}. Copy fix prompt #${f.rank} into your AI assistant.`,
    }));
  if (steps.length > 0) return steps;
  return [
    {
      finding_id: null,
      action: 'Nothing urgent found. Re-run "flowlens report" after your next big change to catch new problems early.',
    },
  ];
}
