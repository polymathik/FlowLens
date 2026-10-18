/**
 * Hand-off between the Health screen and a project's map: "Show on map"
 * records which ids to highlight for the hash it is about to open, and the
 * map consumes it when it applies that route. Also remembers which route
 * each project's map already applied, so returning to a tab does not
 * re-run an old jump over the user's own navigation.
 */
const pendingHighlights = new Map<string, { key: string; ids: string[] }>();
const applied = new Map<string, string>();

export function setPendingHighlight(projectId: string, key: string, ids: string[]): void {
  pendingHighlights.set(projectId, { key, ids });
}

export function takePendingHighlight(projectId: string, key: string): string[] | undefined {
  const p = pendingHighlights.get(projectId);
  if (!p || p.key !== key) return undefined;
  pendingHighlights.delete(projectId);
  return p.ids;
}

export function wasApplied(projectId: string, key: string, stamp: number): boolean {
  return applied.get(projectId) === `${key}#${stamp}`;
}

export function markApplied(projectId: string, key: string, stamp: number): void {
  applied.set(projectId, `${key}#${stamp}`);
}
