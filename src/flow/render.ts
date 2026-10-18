/**
 * Plain-text rendering of a trace as an indented tree (CLI output and the
 * `text` field of the MCP `trace_flow` tool), and of entry-point lists.
 */
import type { EntryPoint, FlowHop, FlowNode, FlowTrace } from '../contracts/flow.js';

const pct = (n: number): string => (n >= 0.995 ? '' : ` ~${Math.round(n * 100)}%`);

/** `Class.method` / `function` — the qualified name without the file prefix. */
function shortName(n: FlowNode): string {
  const rest = n.qualified_name.startsWith(`${n.file}/`) ? n.qualified_name.slice(n.file.length + 1) : n.name;
  return n.kind === 'function' || n.kind === 'method' ? `${rest}()` : rest;
}

function nodeLabel(n: FlowNode | undefined): string {
  if (!n) return '?';
  if (n.kind === 'file') return `${n.file} (module scope)`;
  return `${shortName(n)}  ${n.file}:${n.line}`;
}

function hopLine(h: FlowHop, trace: FlowTrace, byId: Map<string, FlowNode>): string {
  const farId = trace.direction === 'out' ? h.to : h.from;
  const far = byId.get(farId);
  let label: string;
  if (h.resolution === 'unresolved') label = `?? ${h.target_name ?? '?'}`;
  else if (h.to === '' || !far) label = `?? ${h.target_name ?? '?'}${h.candidates ? ` [${h.candidates.length} candidates]` : ''}`;
  else label = nodeLabel(far);
  const flags: string[] = [];
  if (h.type !== 'call') flags.push(h.type);
  if (h.count > 1) flags.push(`x${h.count}`);
  if (h.link === 'cycle') flags.push('cycle');
  else if (h.link === 'seen') flags.push('see above');
  if (h.resolution === 'ambiguous' && h.candidates && h.to !== '') {
    flags.push(`ambiguous: ${h.candidates.map((id) => { const c = byId.get(id); return c ? shortName(c) : '?'; }).join(' | ')}`);
  }
  if (h.provenance === 'source_scan') flags.push('from source');
  return `${label}${flags.length ? `  (${flags.join(', ')})` : ''}${pct(h.confidence)}`;
}

export function describeEntry(e: EntryPoint): string {
  return `${e.label}  [${e.kind} · ${e.file}:${e.line} · confidence ${e.confidence}]`;
}

export function renderTraceText(trace: FlowTrace): string {
  const byId = new Map(trace.nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  lines.push(`${describeEntry(trace.root)}`);
  lines.push(`→ ${nodeLabel(byId.get(trace.root.entity_id))}${trace.root.span ? `  (inline handler, lines ${trace.root.span.line_start}-${trace.root.span.line_end})` : ''}`);
  if (trace.direction === 'in') lines.push('Callers, nearest first (each line calls the one above it):');

  const hops = trace.hops;
  const prefixes: boolean[] = []; // prefixes[d] = does an ancestor at depth d still have later siblings
  hops.forEach((h, i) => {
    const d = h.depth;
    let last = true;
    for (let j = i + 1; j < hops.length; j++) {
      if (hops[j].depth < d) break;
      if (hops[j].depth === d) { last = false; break; }
    }
    prefixes.length = d - 1;
    const indent = prefixes.map((more) => (more ? '│  ' : '   ')).join('');
    lines.push(`${indent}${last ? '└─' : '├─'} ${hopLine(h, trace, byId)}`);
    prefixes[d - 1] = !last;
  });
  if (hops.length === 0) lines.push('(no calls found)');

  const s = trace.stats;
  lines.push('');
  lines.push(`${trace.nodes.length} nodes, ${s.hops} hops, depth ${s.depth_reached}${s.unresolved ? `, ${s.unresolved} unresolved` : ''}${s.ambiguous ? `, ${s.ambiguous} ambiguous` : ''}${trace.truncated ? ` (truncated: ${s.dropped} more)` : ''}`);
  if (trace.triggers.length > 0) {
    lines.push('Triggered by:');
    for (const t of trace.triggers) lines.push(`  ${describeEntry(t)}`);
  }
  if (trace.lanes.length > 1) lines.push(`Lanes: ${trace.lanes.map((l) => `${l.label} (${l.nodeIds.length})`).join(' → ')}`);
  for (const n of trace.notes) lines.push(`Note: ${n}`);
  return lines.join('\n');
}

export function renderEntryPointsText(entries: EntryPoint[], countsByKind: Record<string, number>): string {
  const head = Object.entries(countsByKind).map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
  const rows = entries.map((e) => `  ${e.kind.padEnd(17)} ${e.label.padEnd(36)} ${e.file}:${e.line}${e.confidence < 0.8 ? `  ~${Math.round(e.confidence * 100)}%` : ''}`);
  return [`Entry points: ${head}`, ...rows].join('\n');
}
