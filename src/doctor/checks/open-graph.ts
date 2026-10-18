/**
 * How doctor checks open the graph: through `openGraphStore` (the FlowLens
 * daemon by default, `--no-daemon` → LevelDB directly), never
 * `new LevelGraphStore()`. Failures are classified once for every check.
 */
import { dirname } from 'node:path';
import type { GraphStore } from '../../contracts/graph.js';
import type { DoctorContext } from '../../contracts/doctor.js';
import { isGraphLockedError } from '../../agent/graph-access.js';
import { daemonDisabled, openGraphStore } from '../../service/open-graph-store.js';

export type DoctorGraph =
  | { ok: true; graph: GraphStore }
  | { ok: false; locked: boolean; message: string };

export async function openDoctorGraph(ctx: DoctorContext): Promise<DoctorGraph> {
  try {
    // The graph's project is the folder holding `.flowlens/` (normally rootDir).
    const graphRoot = dirname(ctx.flowlensDir);
    return { ok: true, graph: await openGraphStore(graphRoot, { client: 'doctor', daemon: ctx.daemon }) };
  } catch (err) {
    return { ok: false, locked: isGraphLockedError(err), message: graphErrorMessage(err) };
  }
}

/** Honest text for a lock: only possible with `--no-daemon` or a non-daemon holder. */
export function lockedMessage(ctx: DoctorContext): string {
  return daemonDisabled({ daemon: ctx.daemon })
    ? 'graph is locked by another FlowLens process (this run used --no-daemon; drop it to share the graph through the daemon)'
    : 'graph is locked by a process outside the FlowLens daemon (a --no-daemon command or an older FlowLens)';
}

export function graphErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
}
