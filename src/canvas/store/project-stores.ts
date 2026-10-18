/**
 * One canvas store per project id, kept while the tab is open so switching
 * tabs (which unmounts the map) preserves drill path, overlay, filters and
 * selection. Closing a tab drops its store.
 */
import { createCanvasStore, type CanvasStore } from './canvas-store';

const stores = new Map<string, CanvasStore>();

export function getProjectStore(projectId: string): CanvasStore {
  let s = stores.get(projectId);
  if (!s) stores.set(projectId, (s = createCanvasStore({ projectId })));
  return s;
}

export function dropProjectStore(projectId: string): void {
  stores.delete(projectId);
}

export function projectStoreIds(): string[] {
  return [...stores.keys()];
}
