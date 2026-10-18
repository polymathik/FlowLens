import type { AgentContextPacket, AgentGuardReport } from '../contracts/agent.js';

export function formatContextMarkdown(packet: AgentContextPacket): string {
  return [
    '## FlowLens Agent Context',
    '',
    `Event: ${packet.event}`,
    `Graph: ${packet.summary.entity_count} entities, ${packet.summary.relation_count} relations`,
    `Languages: ${formatCounts(packet.summary.languages)}`,
    '',
    formatList('Relevant files', packet.relevant_files),
    formatEntities('Relevant entities', packet.relevant_entities),
    formatEntities('Hotspots', packet.hotspots),
    formatList('Cycles', packet.cycles.map((cycle) =>
      `${cycle.severity} ${cycle.granularity} cycle: ${cycle.entities.join(' -> ')}`)),
    formatList('Architecture violations', packet.architecture_violations.map((violation) =>
      `${violation.layer_from} -> ${violation.layer_to} in ${violation.file}:${violation.line} (${violation.rule})`)),
    formatList('Guidance', packet.guidance),
  ].filter(Boolean).join('\n');
}

export function formatGuardMarkdown(report: AgentGuardReport): string {
  return [
    '## FlowLens Guard',
    '',
    `Risk: ${report.risk}`,
    `Changed source: ${report.changed_source}`,
    report.reindex ? `Re-index: ${report.reindex.files_reparsed} reparsed, ${report.reindex.files_deleted} deleted, ${report.reindex.errors.length} errors in ${report.reindex.duration_ms}ms` : '',
    formatList('Changed files', report.changed_files),
    formatList('Cycles touching changes', report.cycles.map((cycle) =>
      `${cycle.severity} ${cycle.granularity} cycle: ${cycle.entities.join(' -> ')}`)),
    formatList('Architecture violations touching changes', report.architecture_violations.map((violation) =>
      `${violation.layer_from} -> ${violation.layer_to} in ${violation.file}:${violation.line}: ${violation.suggestion}`)),
    formatList('Impacted entities', report.impacted_entities.map((impact) =>
      `${impact.entity.qualified_name} (${impact.inbound_count} inbound, ${impact.outbound_count} outbound)`)),
    formatList('Guidance', report.guidance),
  ].filter(Boolean).join('\n');
}

function formatEntities(
  title: string,
  entities: Array<{ qualified_name: string; file: string; reason?: string }>,
): string {
  return formatList(title, entities.map((entity) => {
    const reason = entity.reason ? ` - ${entity.reason}` : '';
    return `${entity.qualified_name} (${entity.file})${reason}`;
  }));
}

function formatList(title: string, items: string[]): string {
  if (items.length === 0) return `### ${title}\nNone.`;
  return [`### ${title}`, ...items.map((item) => `- ${item}`)].join('\n');
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return 'none';
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
}
