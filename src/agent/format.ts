import type {
  AgentContextPacket,
  AgentCycleReference,
  AgentGuardReport,
  AgentViolationReference,
} from '../contracts/agent.js';
import { formatHealthHeadline } from './health-headline.js';

const MAX_CYCLE_FILES = 8;

/** Compact markdown: empty sections are omitted to save agent context. */
export function formatContextMarkdown(packet: AgentContextPacket): string {
  return [
    '## FlowLens Agent Context',
    `Event: ${packet.event} · Graph: ${packet.summary.entity_count} entities, ${packet.summary.relation_count} relations · Languages: ${formatCounts(packet.summary.languages)}`,
    packet.health ? section('Health', formatHealthHeadline(packet.health)) : '',
    section('Relevant files', packet.relevant_files),
    section('Relevant entities', packet.relevant_entities.map(formatEntity)),
    section('Hotspots', packet.hotspots.map(formatEntity)),
    section('Cycles', packet.cycles.map(formatCycle)),
    section('Architecture violations', packet.architecture_violations.map(formatViolation)),
    section('Warnings', packet.warnings ?? []),
    section('Guidance', packet.guidance),
  ].filter(Boolean).join('\n');
}

export function formatGuardMarkdown(report: AgentGuardReport): string {
  const attributed = report.attribution?.mode === 'baseline';
  const reindex = report.reindex
    ? `Re-index: ${report.reindex.files_reparsed} reparsed, ${report.reindex.files_deleted} deleted, ${report.reindex.errors.length} errors in ${report.reindex.duration_ms}ms`
    : '';
  return [
    '## FlowLens Guard',
    `Risk: ${report.risk} · Changed source: ${report.changed_source} · Attribution: ${attributed ? `baseline @ ${shortHead(report.attribution?.git_head)}` : 'none (all touching issues count)'}`,
    reindex,
    section('Changed files', report.changed_files),
    section(attributed ? 'NEW cycles touching changes' : 'Cycles touching changes', report.cycles.map(formatCycle)),
    section(attributed ? 'NEW architecture violations touching changes' : 'Architecture violations touching changes',
      report.architecture_violations.map(formatViolationWithFix)),
    section('Pre-existing cycles touching changes (not blocking)', (report.preexisting_cycles ?? []).map(formatCycle)),
    section('Pre-existing violations touching changes (not blocking)', (report.preexisting_violations ?? []).map(formatViolation)),
    section('Impacted entities', report.impacted_entities.map((impact) =>
      `${impact.entity.qualified_name} (${impact.inbound_count} inbound, ${impact.outbound_count} outbound)`)),
    section('Warnings', report.warnings ?? []),
    section('Guidance', report.guidance),
  ].filter(Boolean).join('\n');
}

function formatEntity(entity: { qualified_name: string; file: string; reason?: string }): string {
  const reason = entity.reason ? ` - ${entity.reason}` : '';
  return `${entity.qualified_name} (${entity.file})${reason}`;
}

function formatCycle(cycle: AgentCycleReference): string {
  const shown = cycle.entities.slice(0, MAX_CYCLE_FILES);
  const more = cycle.entities.length > shown.length ? ` -> … (+${cycle.entities.length - shown.length} more files)` : '';
  return `${cycle.severity} ${cycle.granularity} cycle (${cycle.length} files): ${shown.join(' -> ')}${more}`;
}

function formatViolation(violation: AgentViolationReference): string {
  return `${violation.layer_from} -> ${violation.layer_to} in ${violation.file}:${violation.line} (${violation.rule})`;
}

function formatViolationWithFix(violation: AgentViolationReference): string {
  return `${formatViolation(violation)}: ${violation.suggestion}`;
}

function section(title: string, items: string[]): string {
  if (items.length === 0) return '';
  return [`### ${title}`, ...items.map((item) => `- ${item}`)].join('\n');
}

function shortHead(head: string | null | undefined): string {
  return head ? head.slice(0, 7) : 'no-git';
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return 'none';
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
}
