import type { Entity } from '../contracts/entities.js';
import type { GraphStore } from '../contracts/graph.js';
import type {
  AgentCycleReference,
  AgentGuardReport,
  AgentGuardRequest,
  AgentImpactReference,
  AgentRisk,
  AgentViolationReference,
} from '../contracts/agent.js';
import { attributeCycles, attributeViolations } from './baseline.js';
import { computeGraphIssues, type GraphIssues } from './digest.js';
import { memoizeGraphScans } from './graph-access.js';
import { toEntityReference } from './reference.js';

export const DEFAULT_GUARD_ITEMS = 10;

export async function buildAgentGuardReport(
  graph: GraphStore,
  request: AgentGuardRequest,
  options: { flowlensDir: string; issues?: GraphIssues },
): Promise<AgentGuardReport> {
  const memo = memoizeGraphScans(graph);
  const maxItems = request.max_items ?? DEFAULT_GUARD_ITEMS;
  const changedFiles = normalizeFiles(request.changed_files);
  const changedSet = new Set(changedFiles);
  const issues = options.issues ?? await computeGraphIssues(memo, options.flowlensDir);

  const touchingCycles = issues.cycles
    .filter((cycle) => cycle.entities.some((file) => changedSet.has(normalizeFile(file))));
  const touchingViolations = issues.violations
    .filter((violation) => changedSet.has(normalizeFile(violation.file)));
  const baseline = request.baseline ?? null;
  const cycles = attributeCycles(touchingCycles, baseline);
  const violations = attributeViolations(touchingViolations, baseline);

  const impacted = changedFiles.length > 0 ? await buildImpact(memo, changedSet, maxItems) : [];
  const risk = computeRisk(cycles.fresh.length, violations.fresh.length,
    cycles.preexisting.length + violations.preexisting.length, impacted);
  const reindexErrors = request.reindex?.errors.length ?? 0;
  const warnings = [...issues.warnings];
  if (reindexErrors > 0) warnings.push(`Re-index reported ${reindexErrors} error(s); results may be incomplete.`);

  return {
    generated_at: new Date().toISOString(),
    changed_files: changedFiles,
    changed_source: request.changed_source ?? (changedFiles.length > 0 ? 'argument' : 'none'),
    risk,
    reindex: request.reindex,
    cycles: cycles.fresh.slice(0, maxItems),
    architecture_violations: violations.fresh.slice(0, maxItems),
    impacted_entities: impacted,
    guidance: buildGuardGuidance(changedFiles, risk, cycles, violations, Boolean(baseline)),
    preexisting_cycles: cycles.preexisting.slice(0, maxItems),
    preexisting_violations: violations.preexisting.slice(0, maxItems),
    attribution: baseline
      ? { mode: 'baseline', git_head: baseline.git_head, created_at: baseline.created_at }
      : { mode: 'none' },
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/** True when strict mode should block: high risk caused by NEW issues. */
export function shouldBlock(report: AgentGuardReport): boolean {
  return report.risk === 'high' && (report.cycles.length > 0 || report.architecture_violations.length > 0);
}

async function buildImpact(
  graph: GraphStore,
  changedSet: Set<string>,
  maxItems: number,
): Promise<AgentImpactReference[]> {
  // Bounded: per-file lookups instead of scanning every entity.
  const entities: Entity[] = [];
  for (const file of changedSet) entities.push(...await graph.getNodesByFile(file));
  const impacted = await Promise.all(entities.map(async (entity) => {
    const [inbound, outbound] = await Promise.all([
      graph.getEdgesTo(entity.id),
      graph.getEdgesFrom(entity.id),
    ]);
    return {
      entity: toEntityReference(entity, 'changed file impact'),
      inbound_count: inbound.length,
      outbound_count: outbound.length,
    };
  }));
  return impacted
    .sort((a, b) =>
      (b.inbound_count + b.outbound_count) - (a.inbound_count + a.outbound_count)
      || a.entity.qualified_name.localeCompare(b.entity.qualified_name))
    .slice(0, maxItems);
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map(normalizeFile).filter(Boolean))].sort();
}

function normalizeFile(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\/+/, '');
}

function computeRisk(
  newIssues: number,
  newViolations: number,
  preexisting: number,
  impacted: AgentImpactReference[],
): AgentRisk {
  if (newIssues > 0 || newViolations > 0) return 'high';
  const maxImpact = Math.max(0, ...impacted.map((item) => item.inbound_count));
  if (preexisting > 0 || maxImpact >= 5) return 'medium';
  if (impacted.length > 0) return 'low';
  return 'none';
}

function buildGuardGuidance(
  changedFiles: string[],
  risk: AgentRisk,
  cycles: { fresh: AgentCycleReference[]; preexisting: AgentCycleReference[] },
  violations: { fresh: AgentViolationReference[]; preexisting: AgentViolationReference[] },
  attributed: boolean,
): string[] {
  if (changedFiles.length === 0) return ['No changed files were detected from the hook input.'];
  const guidance = [`Guard risk: ${risk}.`];
  const label = attributed ? 'new ' : '';
  if (cycles.fresh.length > 0) guidance.push(`This change touches ${cycles.fresh.length} ${label}dependency cycle(s): remove the import that closes the cycle or justify it.`);
  if (violations.fresh.length > 0) guidance.push(`This change touches ${violations.fresh.length} ${label}layer violation(s): follow the suggestion or update architecture rules intentionally.`);
  if (cycles.preexisting.length + violations.preexisting.length > 0) {
    guidance.push('Pre-existing cycles/violations touch these files; avoid making them worse (not blocking).');
  }
  if (risk === 'none') guidance.push('No graph-level issues were found for the changed files.');
  return guidance;
}
