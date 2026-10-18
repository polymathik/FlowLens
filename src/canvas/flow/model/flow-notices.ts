/**
 * The sentences under the Flow bar: what was cut, what is a guess, what could not be resolved.
 * Pure; built from the trace's own statistics so they are always exact.
 */
import type { FlowEdge, FlowNotice } from '../../../contracts/canvas/index.js';
import type { FlowTrace } from '../../../contracts/flow.js';
import { plural } from './flow-labels.js';

export function flowNotices(trace: FlowTrace, edges: FlowEdge[]): FlowNotice[] {
  const out: FlowNotice[] = [];
  const s = trace.stats;
  if (trace.truncated || s.dropped > 0) {
    out.push({
      id: 'truncated', tone: 'warn',
      text: `+${s.dropped} more ${s.dropped === 1 ? 'node' : 'nodes'} hidden: the nearest ${plural(s.nodes, 'node')} are shown. Raise Max nodes or Depth to see more.`,
    });
  }
  if (trace.hops.length === 0) {
    out.push({ id: 'empty', tone: 'info', text: trace.direction === 'in' ? 'Nothing calls this in the index.' : 'No calls found from here.' });
  }
  const scanned = edges.filter((e) => e.provenance === 'source_scan').length;
  if (scanned > 0) {
    out.push({ id: 'text-derived', tone: 'info', text: `${plural(scanned, 'hop')} read from source text (dotted): inline handlers are not indexed relations, so these are less certain.` });
  }
  if (s.unresolved > 0) {
    out.push({ id: 'unresolved', tone: 'warn', text: `${plural(s.unresolved, 'call')} could not be resolved to a function (dashed grey leaves marked ??).` });
  }
  if (s.ambiguous > 0) {
    out.push({ id: 'ambiguous', tone: 'info', text: `${plural(s.ambiguous, 'ambiguous hop')} (amber): an interface or override means more than one function could run.` });
  }
  return out;
}
