/**
 * Builds the AI inference prompt from a topology request.
 *
 * The prompt asks the model to return strict JSON matching the
 * `AIInferenceResponse` schema. We include a JSON schema string in the
 * prompt so any half-decent instruction-tuned model produces
 * machine-parseable output. Response parsing uses `tryParseJson` which
 * is lenient about surrounding prose.
 */
import type {
  AIInferenceRequest,
  AIInferenceResponse,
} from '../contracts/ai-integration.js';

export function buildPrompt(request: AIInferenceRequest): string {
  const { topology } = request;
  const langBreakdown = Object.entries(topology.languages)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => `${lang}:${count}`)
    .join(', ');

  const clusterLines = topology.clusters.map((c, i) => {
    const sampleFiles = c.files.slice(0, 10).join(', ');
    const more = c.files.length > 10 ? ` (+${c.files.length - 10} more)` : '';
    const prefixes = c.common_prefixes.join(', ') || '(none)';
    return [
      `Cluster ${i}: ${c.files.length} files`,
      `  Common prefixes: ${prefixes}`,
      `  Internal edges: ${c.internal_edge_count}, External: ${c.external_edge_count}`,
      `  Sample files: ${sampleFiles}${more}`,
    ].join('\n');
  });

  return [
    'You are analyzing the dependency graph of a software project to infer its architectural layers.',
    '',
    'Here is the graph topology:',
    `- ${topology.clusters.length} clusters detected by community analysis`,
    `- ${topology.total_entities} total entities, ${topology.total_relations} total relations`,
    `- Languages: ${langBreakdown}`,
    '',
    'Clusters:',
    clusterLines.join('\n'),
    '',
    'Define architectural layers by:',
    '1. Giving each layer a descriptive human-readable name',
    '2. Listing glob patterns that define membership (e.g. "src/auth/**")',
    '3. Stating access rules: which layers may access which (optional)',
    '',
    'Respond ONLY with a valid JSON object matching this TypeScript type:',
    '',
    'interface Response {',
    '  layers: Array<{',
    '    name: string;',
    '    description: string;',
    '    include: { patterns?: string[]; files?: string[]; entities?: string[] };',
    '    may_only_access?: string[];',
    '    must_not_access?: string[];',
    '  }>;',
    '  reasoning: string;',
    '}',
    '',
    'Do not include prose before or after the JSON.',
  ].join('\n');
}

/**
 * Extract a JSON object from model output. Handles three cases:
 *   1. Clean JSON                                — JSON.parse directly
 *   2. JSON in a ```json ... ``` fence          — strip fence first
 *   3. JSON surrounded by prose                 — find first `{` to last `}`
 */
export function tryParseJson(text: string): AIInferenceResponse | null {
  const trimmed = text.trim();

  // Strip fence if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : extractJsonObject(trimmed);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate) as AIInferenceResponse;
    if (!Array.isArray(parsed.layers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractJsonObject(s: string): string | null {
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  return s.slice(first, last + 1);
}
