/**
 * Community state: load the last assignment once per project, and save the new one (debounced) after the
 * communities were computed, so zones keep their keys across re-indexes and reloads. Best effort: a
 * daemon without the route, or a failed save, only means the next session starts cold.
 */
import { useEffect } from 'react';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { MapView } from '../../contracts/canvas/index.js';
import { useGraphClient } from '../components/explorer/project-context';
import { useCanvasStoreApi } from '../store/canvas-store';
import { mergeAssignment, recordsAssignment } from '../utils/community-assignment';

export const SAVE_DELAY_MS = 1500;

export function useCommunityStateLoader(): void {
  const client = useGraphClient();
  const store = useCanvasStoreApi();
  useEffect(() => {
    let cancelled = false;
    client
      .fetchZoneState()
      .then((state) => !cancelled && store.getState().communityAssignment === null && store.getState().setCommunityAssignment(state.assignment))
      .catch(() => !cancelled && store.getState().communityAssignment === null && store.getState().setCommunityAssignment({}));
    return () => {
      cancelled = true;
    };
  }, [client, store]);
}

/** After every communities computation: merge into the store and schedule the save. */
export function useCommunitySync(view: MapView, hierarchy: Hierarchy): void {
  const client = useGraphClient();
  const store = useCanvasStoreApi();
  const zoneSet = view.zoning?.mode === 'communities' ? view.zoning.zoneSet : null;
  const containerId = view.containerId;
  useEffect(() => {
    if (!zoneSet || !recordsAssignment(hierarchy, containerId)) return;
    const { communityAssignment, zoneOverrides } = store.getState();
    const before = communityAssignment ?? {};
    const next = mergeAssignment(before, zoneSet, hierarchy, zoneOverrides.pins);
    if (next === before) return;
    store.getState().setCommunityAssignment(next);
    const timer = setTimeout(() => void client.putZoneState({ version: 1, assignment: next }).catch(() => undefined), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [zoneSet, hierarchy, containerId, client, store]);
}
