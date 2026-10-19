import { buildToolGuidance } from './guidance.js';
import type { GraphStore } from '../contracts/graph.js';
import type {
  AgentContextPacket,
  AgentContextRequest,
  AgentEntityReference,
} from '../contracts/agent.js';
import { computeGraphDigest, expandEntity, type AgentGraphDigest, type CompactEntity } from './digest.js';
import { memoizeGraphScans } from './graph-access.js';
import { uniqueFiles } from './reference.js';

export const DEFAULT_CONTEXT_ITEMS = 8;

/** Build context from a live graph (MCP resources/prompts, tests). */
export async function buildAgentContext(
  graph: GraphStore,
  request: AgentContextRequest,
  options: { flowlensDir: string; digest?: AgentGraphDigest },
): Promise<AgentContextPacket> {
  const digest = options.digest
    ?? await computeGraphDigest(memoizeGraphScans(graph), options.flowlensDir);
  return buildContextFromDigest(digest, request, 'fresh');
}

/** Pure: build a context packet from a (possibly cached) digest. */
export function buildContextFromDigest(
  digest: AgentGraphDigest,
  request: AgentContextRequest,
  source: NonNullable<AgentContextPacket['digest']>['source'],
): AgentContextPacket {
  const maxItems = request.max_items ?? DEFAULT_CONTEXT_ITEMS;
  const relevantEntities = selectRelevantEntities(digest.entities, request, maxItems);
  const changed = new Set((request.changed_files ?? []).map(normalizeFile));
  const touchesChanged = (files: string[]) => files.some((file) => changed.has(normalizeFile(file)));
  const cycles = prioritise(digest.cycles, (cycle) => touchesChanged(cycle.entities)).slice(0, maxItems);
  const violations = prioritise(digest.violations, (v) => touchesChanged([v.file])).slice(0, maxItems);
  const warnings = [...digest.warnings];
  if (source === 'stale-cache') {
    warnings.push(`Graph facts are from a cached digest (${digest.computed_at}); the graph is currently locked by another FlowLens process.`);
  }

  return {
    generated_at: new Date().toISOString(),
    event: request.event,
    summary: digest.summary,
    relevant_files: uniqueFiles(relevantEntities),
    relevant_entities: relevantEntities,
    hotspots: digest.hotspots.slice(0, maxItems),
    cycles,
    architecture_violations: violations,
    guidance: buildGuidance(request, relevantEntities.length, digest.cycle_count, digest.violation_count),
    digest: { source, computed_at: digest.computed_at },
    warnings: warnings.length > 0 ? warnings : undefined,
    health: request.event === 'session_start' && digest.health ? digest.health : undefined,
  };
}

function prioritise<T>(items: T[], first: (item: T) => boolean): T[] {
  return [...items.filter(first), ...items.filter((item) => !first(item))];
}

function selectRelevantEntities(
  entities: CompactEntity[],
  request: AgentContextRequest,
  maxItems: number,
): AgentEntityReference[] {
  const changed = new Set((request.changed_files ?? []).map(normalizeFile));
  const tokens = tokenize(request.prompt ?? '');
  if (tokens.length === 0 && changed.size === 0) return [];
  const weights = tokenWeights(entities, tokens);
  const scored: Array<{ row: CompactEntity; score: number }> = [];
  for (const row of entities) {
    const score = scoreEntity(row, tokens, weights, changed);
    if (score > 0) scored.push({ row, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.row[3].localeCompare(b.row[3]))
    .slice(0, maxItems)
    .map((entry) => expandEntity(entry.row, explainScore(entry.score)));
}

/** Down-weight tokens that match a large share of entities (e.g. "run", "index"). */
function tokenWeights(entities: CompactEntity[], tokens: string[]): Map<string, number> {
  const weights = new Map<string, number>();
  if (tokens.length === 0) return weights;
  const counts = new Map(tokens.map((token) => [token, 0]));
  for (const row of entities) {
    const name = row[2].toLowerCase();
    for (const token of tokens) if (name.includes(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const total = Math.max(entities.length, 1);
  for (const [token, count] of counts) {
    weights.set(token, count / total > 0.05 ? 0.25 : 1);
  }
  return weights;
}

function scoreEntity(
  row: CompactEntity,
  tokens: string[],
  weights: Map<string, number>,
  changed: Set<string>,
): number {
  let score = changed.has(normalizeFile(row[4])) ? 5 : 0;
  let matched = false;
  const name = row[2].toLowerCase();
  const haystack = `${name} ${row[3]} ${row[4]}`.toLowerCase();
  for (const token of tokens) {
    const weight = weights.get(token) ?? 1;
    if (name === token) { score += 4 * weight; matched = true; } else if (haystack.includes(token)) {
      score += 2 * weight;
      matched = true;
    }
  }
  if (score === 0) return 0;
  if (!matched && changed.size === 0) return 0;
  if (row[11]) score += Math.min(row[11], 2) * 0.25;
  if (row[10] !== null && row[10] < 60) score += 0.25;
  return score;
}

function tokenize(input: string): string[] {
  return [...new Set(input
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((token) => token.length >= 3))]
    .slice(0, 20);
}

function normalizeFile(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\/+/, '');
}

function explainScore(score: number): string {
  if (score >= 5) return 'changed file or strong prompt match';
  if (score >= 3) return 'prompt match';
  return 'weak prompt match';
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
  if (cycleCount > 0) guidance.push(`The graph has ${cycleCount} file cycle(s); do not add imports that extend them.`);
  if (violationCount > 0) guidance.push(`The graph has ${violationCount} architecture violation(s); respect layer rules when moving dependencies.`);
  if (relevantCount === 0 && request.prompt) guidance.push('No direct prompt matches found; fall back to graph summary and hotspots.');
  guidance.push(...buildToolGuidance({ tools: request.tools_hint ?? false, gate: request.gate ?? false, agent: request.agent }));
  return guidance;
}
