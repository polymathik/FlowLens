/**
 * Loads the trace of a `FlowSpec`: resolves the root (an inline handler named by `entity id + span` is
 * looked up in the entry points to get its label, the only way the trace route can address it), requests
 * the trace, and keeps the previous picture on screen while a new one loads (a slider drag does not flash).
 * Re-requests when the project's graph revision changes (a re-index) and on `reload()`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowSpec } from '../../../contracts/canvas/index.js';
import type { FlowTrace } from '../../../contracts/flow.js';
import { useProjectContext } from '../../components/explorer/project-context';
import { fetchEntryPoints, fetchTrace, findEntry } from '../api/flow-client';
import { routeFlowOfSpec, flowRouteKey } from '../flow-route';

export interface FlowLoad {
  /** Last successfully loaded trace of the SAME root (kept while the next one loads). */
  trace: FlowTrace | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/** What to send as `entity`: the entry label when the root is an entry point, else the id as given. */
export async function resolveEntity(base: string, spec: FlowSpec, signal?: AbortSignal): Promise<string> {
  if (spec.label) return spec.label;
  if (!spec.span) return spec.id;
  const { entry_points } = await fetchEntryPoints(base, { includeTests: true }, signal);
  return findEntry(entry_points, spec)?.label ?? spec.id;
}

export function useFlowTrace(spec: FlowSpec): FlowLoad {
  const { client, revision } = useProjectContext();
  const [state, setState] = useState<{ root: string; trace: FlowTrace | null; loading: boolean; error: Error | null }>({ root: '', trace: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);
  const key = flowRouteKey(routeFlowOfSpec(spec));
  const specRef = useRef(spec);
  specRef.current = spec;

  useEffect(() => {
    const s = specRef.current;
    const ctl = new AbortController();
    setState((prev) => ({ root: s.id + (s.span ? `#${s.span.from}` : ''), trace: prev.root === s.id + (s.span ? `#${s.span.from}` : '') ? prev.trace : null, loading: true, error: null }));
    (async () => {
      try {
        const entity = await resolveEntity(client.base, s, ctl.signal);
        const trace = await fetchTrace(client.base, entity, s, ctl.signal);
        if (!ctl.signal.aborted) setState((prev) => ({ ...prev, trace, loading: false, error: null }));
      } catch (err) {
        if (ctl.signal.aborted) return;
        setState((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err : new Error(String(err)) }));
      }
    })();
    return () => ctl.abort();
  }, [client, key, revision, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { trace: state.trace, loading: state.loading, error: state.error, reload };
}
