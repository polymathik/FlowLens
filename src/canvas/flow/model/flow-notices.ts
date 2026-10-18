/**
 * The sentences under the Flow bar: what was cut, what is a guess, what could not be resolved.
 * Pure; built from the trace's own statistics so they are always exact.
 */
import type { FlowEdge, FlowNotice } from '../../../contracts/canvas/index.js';
import type { FlowTrace } from '../../../contracts/flow.js';
import { FLOW_LIMITS } from '../../../contracts/flow-constants.js';
import { plural } from './flow-labels.js';

export function flowNotices(trace: FlowTrace, edges: FlowEdge[]): FlowNotice[] {
  const out: FlowNotice[] = [];
  const s = trace.stats;
  if (trace.truncated || s.dropped > 0) {
    out.push({
      id: 'truncated', tone: 'warn',
      text: `+${s.dropped} more ${s.dropped === 1 ? 'node' : 'nodes'} hidden (the nearest ${s.nodes} are shown): ${s.nodes >= FLOW_LIMITS.maxNodes.cap ? 'this is the most the view draws, so trace from a function further down to see the rest.' : 'raise Max nodes to see more.'}`,
    });
  }
  if (trace.hops.length === 0) {
    out.push({ id: 'empty', tone: 'info', text: trace.direction === 'in' ? 'Nothing calls this in the index.' : 'No calls found from here.' });
  }
  const scanned = edges.filter((e) => e.provenance === 'source_scan').length;
  if (scanned > 0) {
    out.push({ id: 'text-derived', tone: 'info', text: `${plural(scanned, 'hop')} read from source text (dotted): less certain than indexed calls.` });
  }
  if (s.unresolved > 0) {
    out.push({ id: 'unresolved', tone: 'warn', text: `${plural(s.unresolved, 'call')} not resolved to a function (dashed ?? leaves).` });
  }
  if (s.ambiguous > 0) {
    out.push({ id: 'ambiguous', tone: 'info', text: `${plural(s.ambiguous, 'ambiguous hop')} (amber): more than one function could run.` });
  }
  return out;
}
