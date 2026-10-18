/**
 * Zone overrides: loaded once per project (and again when the graph
 * revision changes), written back optimistically — the canvas applies the
 * edit at once, PUTs it, and rolls back with a notice when the save fails.
 * A daemon without the zones route answers 404 on read (no overrides) and
 * fails the write, which rolls back with the notice.
 */
import { useCallback, useEffect } from 'react';
import type { ZoneOverrides } from '../../contracts/zones.js';
import { useGraphClient, useProjectContext } from '../components/explorer/project-context';
import { useCanvasStoreApi } from '../store/canvas-store';

export function useZoneOverridesLoader(): void {
  const client = useGraphClient();
  const { revision } = useProjectContext();
  const store = useCanvasStoreApi();
  useEffect(() => {
    let cancelled = false;
    client
      .fetchZoneOverrides()
      .then((o) => !cancelled && store.getState().setZoneOverrides(o))
      .catch((err) => console.warn('[flowlens] zone overrides unavailable', err));
    return () => {
      cancelled = true;
    };
  }, [client, revision, store]);
}

export type OverrideEdit = (current: ZoneOverrides) => ZoneOverrides;

type OverrideStore = ReturnType<typeof useCanvasStoreApi>;
type OverrideClient = Pick<ReturnType<typeof useGraphClient>, 'putZoneOverrides'>;

/** Apply an edit optimistically, persist it, roll back with a notice on failure. */
export async function applyOverrideEdit(store: OverrideStore, client: OverrideClient, edit: OverrideEdit): Promise<void> {
  const { zoneOverrides: before, setZoneOverrides, setZoneNotice } = store.getState();
  const next = edit(before);
  setZoneOverrides(next);
  try {
    setZoneOverrides((await client.putZoneOverrides(next)) ?? next);
    setZoneNotice(null);
  } catch (err) {
    setZoneOverrides(before);
    setZoneNotice(`Could not save the zone change (${err instanceof Error ? err.message : 'unknown error'}). It was undone.`);
  }
}

export function useApplyZoneOverride(): (edit: OverrideEdit) => Promise<void> {
  const client = useGraphClient();
  const store = useCanvasStoreApi();
  return useCallback((edit) => applyOverrideEdit(store, client, edit), [client, store]);
}
