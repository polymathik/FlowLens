import type { GraphStore } from '../contracts/graph.js';
import type {
  AgentContextPacket,
  AgentContextRequest,
  AgentEntityReference,
} from '../contracts/agent.js';
import { detectCycles } from '../analysis/cycle-detector.js';
import { validateArchitecture } from '../analysis/architecture-validator.js';
import { loadArchitecture } from './architecture.js';
import {
  toCycleReference,
  toEntityReference,
  toViolationReference,
  uniqueFiles,
} from './reference.js';

export async function buildAgentContext(
  graph: GraphStore,
  request: AgentContextRequest,
  options: { flowlensDir: string },
): Promise<AgentContextPacket> {
  const maxItems = request.max_items ?? 8;
  const [entities, relations] = await Promise.all([
    graph.getAllNodes(),
    graph.getAllEdges(),
  ]);

  const relevantEntities = selectRelevantEntities(
    entities.map((entity) => toEntityReference(entity)),
    request,
    maxItems,
  );
  const hotspots = entities
    .filter((entity) => entity.metrics?.hotspot_score !== undefined)
    .sort((a, b) => (b.metrics?.hotspot_score ?? 0) - (a.metrics?.hotspot_score ?? 0))
    .slice(0, maxItems)
    .map((entity) => toEntityReference(entity, 'high hotspot score'));

  const cycles = (await detectCycles(graph, { granularity: 'file' }))
    .slice(0, maxItems)
    .map(toCycleReference);

  const architecture = await loadArchitecture(options.flowlensDir);
  const violations = architecture
    ? (await validateArchitecture(graph, architecture))
      .slice(0, maxItems)
      .map(toViolationReference)
    : [];

  return {
    generated_at: new Date().toISOString(),
    event: request.event,
    summary: {
      entity_count: entities.length,
      relation_count: relations.length,
      languages: countBy(entities.map((entity) => entity.language)),
    },
    relevant_files: uniqueFiles(relevantEntities),
    relevant_entities: relevantEntities,
    hotspots,
    cycles,
    architecture_violations: violations,
    guidance: buildGuidance(request, relevantEntities.length, cycles.length, violations.length),
  };
}

function selectRelevantEntities(
  entities: AgentEntityReference[],
  request: AgentContextRequest,
  maxItems: number,
): AgentEntityReference[] {
  const changed = new Set((request.changed_files ?? []).map(normalizeFile));
  const tokens = tokenize(request.prompt ?? '');
  const scored = entities.map((entity) => ({
    entity,
    score: scoreEntity(entity, tokens, changed),
  }));
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.entity.qualified_name.localeCompare(b.entity.qualified_name))
    .slice(0, maxItems)
    .map((entry) => ({ ...entry.entity, reason: explainScore(entry.score) }));
}

function scoreEntity(
  entity: AgentEntityReference,
  tokens: string[],
  changed: Set<string>,
): number {
  let score = changed.has(normalizeFile(entity.file)) ? 5 : 0;
  const haystack = `${entity.name} ${entity.qualified_name} ${entity.file}`.toLowerCase();
  for (const token of tokens) {
    if (haystack.includes(token)) score += 2;
  }
  if (entity.hotspot_score) score += Math.min(entity.hotspot_score, 2);
  if (entity.quality_score !== undefined && entity.quality_score < 60) score += 1;
  return score;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((token) => token.length >= 3)
    .slice(0, 20);
}

function normalizeFile(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\/+/, '');
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function explainScore(score: number): string {
  if (score >= 5) return 'changed file or strong prompt match';
  if (score >= 3) return 'prompt match';
  return 'weak prompt or risk signal';
}

function buildGuidance(
  request: AgentContextRequest,
  relevantCount: number,
  cycleCount: number,
  violationCount: number,
): string[] {
  const guidance = [
    `Use this context for ${request.event.replaceAll('_', ' ')} before reading broad file trees.`,
  ];
  if (relevantCount > 0) guidance.push('Start with the relevant files/entities before expanding outward.');
  if (cycleCount > 0) guidance.push('Check cycle entries before adding new imports between listed files.');
  if (violationCount > 0) guidance.push('Respect architecture violation suggestions when moving dependencies.');
  if (relevantCount === 0) guidance.push('No direct prompt matches found; fall back to graph summary and hotspots.');
  return guidance;
}
