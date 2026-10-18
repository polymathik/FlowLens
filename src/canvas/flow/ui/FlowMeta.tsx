/** Second row of the flow bar: exact counts, the notices (truncation, text-derived hops, unresolved calls) and the "cannot see" disclosure. */
import React from 'react';
import type { FlowModel } from '../../../contracts/canvas/index.js';
import { FLOW_BLIND_SPOTS } from '../model/flow-limits';
import { FLOW_MAX_DEPTH } from '../../../contracts/canvas/index.js';
import { plural } from '../model/flow-labels';

export function FlowMeta({ model, loading, depth, children }: { model: FlowModel; loading: boolean; depth: number; children?: React.ReactNode }) {
  const s = model.stats;
  return (
    <div className="fl-flow-meta" data-testid="flow-meta" aria-busy={loading}>
      <span data-testid="flow-stats" data-nodes={s.nodes} data-hops={s.hops} data-dropped={s.dropped}>
        {plural(s.nodes, 'function')} · {plural(s.hops, 'hop')} · {plural(model.lanes.length, 'lane')} · depth {s.depthReached}
        {loading && ' · updating…'}
      </span>
      {model.notices.map((n) => (
        <span key={n.id} data-testid={`flow-notice-${n.id}`} className={n.tone === 'warn' ? 'is-warn' : undefined}>{n.text}</span>
      ))}
      {s.depthReached >= depth && depth < FLOW_MAX_DEPTH && (
        <span data-testid="flow-notice-depth">Followed {depth} levels: calls further down are not shown (raise Depth).</span>
      )}
      <details className="fl-flow-limits" data-testid="flow-limits">
        <summary>This trace cannot see…</summary>
        <ul>
          {[...model.notes, ...FLOW_BLIND_SPOTS].map((t) => <li key={t}>{t}</li>)}
        </ul>
      </details>
      <span style={{ flex: 1 }} />
      <span className="fl-flow-actions-row">{children}</span>
    </div>
  );
}
