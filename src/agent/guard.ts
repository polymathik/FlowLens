import type { GraphStore } from '../contracts/graph.js';
import type {
  AgentGuardReport,
  AgentImpactReference,
  AgentRisk,
  AgentReindexSummary,
} from '../contracts/agent.js';
import { detectCycles } from '../analysis/cycle-detector.js';
import { validateArchitecture } from '../analysis/architecture-validator.js';
import { loadArchitecture } from './architecture.js';
import { toCycleReference, toEntityReference, toViolationReference } from './reference.js';

export async function buildAgentGuardReport(
  graph: GraphStore,
  request: {
    changed_files: string[];
    changed_source?: AgentGuardReport['changed_source'];
    max_items?: number;
    reindex?: AgentReindexSummary;
  },
  options: { flowlensDir: string },
): Promise<AgentGuardReport> {
  const maxItems = request.max_items ?? 10;
  const changedFiles = normalizeFiles(request.changed_files);
  const changedSet = new Set(changedFiles);
  const entities = await graph.getAllNodes();
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));

  const cycles = (await detectCycles(graph, { granularity: 'file' }))
    .filter((cycle) => cycle.entities.some((file) => changedSet.has(normalizeFile(file))))
    .slice(0, maxItems)
    .map(toCycleReference);

  const architecture = await loadArchitecture(options.flowlensDir);
  const violations = architecture
    ? (await validateArchitecture(graph, architecture))
      .filter((violation) => touchesChangedFile(violation.location.file, changedSet))
      .slice(0, maxItems)
      .map(toViolationReference)
    : [];

  const impacted = await buildImpact(graph, changedSet, entityById, maxItems);
  const risk = computeRisk(cycles.length, violations.length, impacted);

  return {
    generated_at: new Date().toISOString(),
    changed_files: changedFiles,
    changed_source: request.changed_source ?? (changedFiles.length > 0 ? 'argument' : 'none'),
    risk,
    reindex: request.reindex,
    cycles,
    architecture_violations: violations,
    impacted_entities: impacted,
    guidance: buildGuardGuidance(changedFiles, risk, cycles.length, violations.length),
  };
}

async function buildImpact(
  graph: GraphStore,
  changedSet: Set<string>,
  entityById: Map<string, Awaited<ReturnType<GraphStore['getAllNodes']>>[number]>,
  maxItems: number,
): Promise<AgentImpactReference[]> {
  const impacted: AgentImpactReference[] = [];
  for (const entity of entityById.values()) {
    if (!changedSet.has(normalizeFile(entity.file))) continue;
    const [inbound, outbound] = await Promise.all([
      graph.getEdgesTo(entity.id),
      graph.getEdgesFrom(entity.id),
    ]);
    impacted.push({
      entity: toEntityReference(entity, 'changed file impact'),
      inbound_count: inbound.length,
      outbound_count: outbound.length,
    });
  }
  return impacted
    .sort((a, b) =>
      (b.inbound_count + b.outbound_count) - (a.inbound_count + a.outbound_count))
    .slice(0, maxItems);
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map(normalizeFile).filter(Boolean))].sort();
}

function normalizeFile(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\/+/, '');
}

function touchesChangedFile(file: string, changedSet: Set<string>): boolean {
  const normalized = normalizeFile(file);
  return changedSet.has(normalized);
}

function computeRisk(
  cycleCount: number,
  violationCount: number,
  impacted: AgentImpactReference[],
): AgentRisk {
  if (cycleCount > 0 || violationCount > 0) return 'high';
  const maxImpact = Math.max(0, ...impacted.map((item) => item.inbound_count));
  if (maxImpact >= 5) return 'medium';
  if (impacted.length > 0) return 'low';
  return 'none';
}

function buildGuardGuidance(
  changedFiles: string[],
  risk: AgentRisk,
  cycleCount: number,
  violationCount: number,
): string[] {
  if (changedFiles.length === 0) return ['No changed files were detected from the hook input.'];
  const guidance = [`Guard risk: ${risk}. Review this before finishing the edit.`];
  if (cycleCount > 0) guidance.push('Resolve or justify cycles touching changed files.');
  if (violationCount > 0) guidance.push('Fix layer violations or update architecture rules intentionally.');
  if (risk === 'none') guidance.push('No graph-level issues were found for the changed files.');
  return guidance;
}
