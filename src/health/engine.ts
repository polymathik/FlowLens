/**
 * Health engine — turns a loaded graph (HealthInput) into a HealthReport.
 * Pure and deterministic: same input (+ `now`) → byte-identical JSON.
 */
import {
  HEALTH_SCHEMA_VERSION,
  type HealthCategory,
  type HealthFindingKind,
  type HealthInput,
  type HealthOptions,
  type HealthReport,
  type HealthSeverity,
  type HealthStats,
  type HealthSummary,
} from '../contracts/health.js';
import type { HealthThresholds } from './config.js';
import { buildHealthContext, type HealthContext } from './context.js';
import type { RawFinding } from './finding.js';
import { buildCaveats, confidenceFor, isStale, measureGraphQuality } from './graph-quality.js';
import { nextSteps, rankFindings } from './rank.js';
import { HEALTH_RULES } from './rules/index.js';
import { computeScore } from './score.js';

export interface EngineOptions extends HealthOptions {
  /** Override thresholds (tests). */
  thresholds?: HealthThresholds;
}

export async function buildHealthReport(input: HealthInput, opts: EngineOptions = {}): Promise<HealthReport> {
  const ctx = buildHealthContext(input, { canvasBaseUrl: opts.canvas_base_url, thresholds: opts.thresholds });
  const raw: RawFinding[] = [];
  for (const rule of HEALTH_RULES) raw.push(...(await rule.run(ctx)));
  const findings = rankFindings(ctx, raw);
  const quality = measureGraphQuality(ctx);

  const unknown: HealthCategory[] = ctx.hasGit ? [] : ['change_risk'];
  const { score, grade, breakdown } = computeScore(findings, { fileCount: ctx.files.length, unknown });
  const counts: Partial<Record<HealthFindingKind, number>> = {};
  const severity_counts: Partial<Record<HealthSeverity, number>> = {};
  for (const f of findings) {
    counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    severity_counts[f.severity] = (severity_counts[f.severity] ?? 0) + 1;
  }
  const top = opts.top !== undefined && opts.top >= 0 ? findings.slice(0, opts.top) : findings;

  return {
    schema_version: HEALTH_SCHEMA_VERSION,
    generated_at: opts.now ?? new Date().toISOString(),
    project: input.project,
    graph: {
      has_manifest: input.manifest !== null,
      git_head: input.manifest?.git_head ?? null,
      completion: input.manifest?.completion ?? 'unknown',
      last_indexed: input.manifest?.finished_at ?? input.last_indexed_fallback ?? null,
      stale: isStale(ctx),
    },
    grade,
    score,
    confidence: confidenceFor(ctx, quality),
    breakdown,
    stats: buildStats(ctx),
    findings: top,
    total_findings: findings.length,
    counts,
    severity_counts,
    next_steps: nextSteps(findings),
    caveats: buildCaveats(ctx, quality),
  };
}

function buildStats(ctx: HealthContext): HealthStats {
  const languages: Record<string, number> = {};
  for (const file of ctx.files) {
    const ents = ctx.entitiesByFile.get(file) ?? [];
    const lang = (ents.find((e) => e.kind === 'file') ?? ents[0])?.language ?? 'unknown';
    languages[lang] = (languages[lang] ?? 0) + 1;
  }
  const sorted = Object.fromEntries(Object.entries(languages).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return {
    files: ctx.files.length,
    symbols: ctx.input.entities.filter((e) => e.kind !== 'file' && e.kind !== 'module').length,
    relations: ctx.input.relations.length,
    languages: sorted,
  };
}

/** Compact card data for the Home tab. */
export function summarizeHealth(report: HealthReport): HealthSummary {
  const c = report.counts;
  const s = report.severity_counts;
  const actionable = report.findings.find((f) => f.severity !== 'info');
  return {
    schema_version: HEALTH_SCHEMA_VERSION,
    project: report.project,
    grade: report.grade,
    score: report.score,
    confidence: report.confidence,
    top_finding: actionable?.title ?? null,
    counts: {
      findings: report.total_findings,
      cycles: c.cycle ?? 0,
      boundary_violations: c.boundary_violation ?? 0,
      hotspots: c.hotspot ?? 0,
      critical_or_high: (s.critical ?? 0) + (s.high ?? 0),
    },
    last_indexed: report.graph.last_indexed,
    stale: report.graph.stale,
  };
}
