/**
 * 3-line health headline for SessionStart context, from the Phase 11 health
 * engine. Computed only when a digest is built from the live graph (it reads
 * full entity metrics and git history), stored in the digest, and carried
 * forward by guard refreshes. Any failure → null (the section is omitted).
 */
import type { AgentHealthHeadline } from '../contracts/agent.js';
import type { GraphStore } from '../contracts/graph.js';
import { buildHealthReport, loadHealthInput, summarizeHealth } from '../health/index.js';
import { HEALTH_RESOURCE_URI } from '../contracts/health.js';

export async function computeHealthHeadline(rootDir: string, graph: GraphStore): Promise<AgentHealthHeadline | null> {
  try {
    const input = await loadHealthInput(rootDir, { graphStore: graph });
    const summary = summarizeHealth(await buildHealthReport(input));
    return {
      grade: summary.grade,
      score: summary.score,
      confidence: summary.confidence,
      top_risk: summary.top_finding,
      findings: summary.counts.findings,
      critical_or_high: summary.counts.critical_or_high,
    };
  } catch {
    return null;
  }
}

export function formatHealthHeadline(health: AgentHealthHeadline): string[] {
  return [
    `Grade ${health.grade} (${health.score}/100, confidence ${health.confidence}) · ${health.findings} findings, ${health.critical_or_high} critical/high`,
    `Top risk: ${health.top_risk ?? 'none found'}`,
    `Full report: MCP resource \`${HEALTH_RESOURCE_URI}\` or \`flowlens report\``,
  ];
}
