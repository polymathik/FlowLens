/**
 * Entry points of the project for the picker (`GET …/flow/entry-points`). Loaded when the picker opens and
 * whenever "include tests", the path limit or the graph revision change; the previous list stays visible
 * while the next one loads.
 */
import { useEffect, useState } from 'react';
import type { FlowEntryPointsResponse } from '../../../contracts/flow.js';
import { useProjectContext } from '../../components/explorer/project-context';
import { fetchEntryPoints } from '../api/flow-client';

export interface EntryPointsLoad {
  data: FlowEntryPointsResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useEntryPoints(active: boolean, opts: { includeTests: boolean; path?: string }): EntryPointsLoad {
  const { client, revision } = useProjectContext();
  const [state, setState] = useState<EntryPointsLoad>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!active) return;
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchEntryPoints(client.base, opts, ctl.signal).then(
      (data) => !ctl.signal.aborted && setState({ data, loading: false, error: null }),
      (error: unknown) => !ctl.signal.aborted && setState((s) => ({ ...s, loading: false, error: error instanceof Error ? error : new Error(String(error)) })),
    );
    return () => ctl.abort();
    // `opts` is a fresh object each render; its two fields are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, client, revision, opts.includeTests, opts.path]);

  return state;
}
